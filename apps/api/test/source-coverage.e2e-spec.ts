import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService, sourceHealth } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SourceScheduler, type CollectorLike } from '../src/jobs/source-scheduler.service';
import { DEEP_BUDGET_BOARDS, INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS, REVALIDATE_AFTER_MS, REVALIDATE_PER_RUN } from '../src/jobs/source-discovery';
import type { DiscoveryCursor } from '../src/scrapers/public-jobs/public-job-collector';

// Durable coverage of a LARGE board through bounded scheduled runs: head refreshes, deep segments resumed from a stored cursor, shifting listings,
// interrupted segments, closures and revalidation. A DISPOSABLE database (DATABASE_URL); a synthetic in-process "board" with the real collector contract.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('durable coverage of a large board through bounded scheduled runs (synthetic board, isolated Postgres)', () => {
  const SRC = 'ejob'; // a registered board key; its row is restored afterwards
  const stamp = `${Date.now()}`;
  const id = (n: number) => `${SRC}:cov${stamp}-${n}`;
  let PAGE = 5;
  let prisma: PrismaService, scheduler: SourceScheduler;
  /** The board's current listing, newest first. Tests change it between runs to simulate postings appearing and disappearing. */
  let board: number[] = [];
  let behaviour: { throwAtPage?: number; claimComplete?: boolean } = {};
  const asked: number[][] = [];
  const optionsSeen: any[] = [];
  let original: Record<string, unknown>;

  /** A board collector with the real contract: pages of PAGE postings, isKnown/onListed, a page cursor resumed one page earlier, no completeness when resumed. */
  const collector: CollectorLike = {
    async collect(options: any, accept) {
      optionsSeen.push(options);
      const pages: number[] = [];
      asked.push(pages);
      const resume: DiscoveryCursor | undefined = options.resume;
      let page = resume?.kind === 'page' ? Math.max(1, resume.page - 1) : 1;
      let discovered = 0, fetched = 0, accepted = 0, pagesRead = 0, stopped: number | null = null;
      for (;; page++) {
        const items = board.slice((page - 1) * PAGE, page * PAGE);
        if (!items.length) { stopped = null; break; }
        if (pagesRead >= options.maxPages) { stopped = page; break; }
        if (behaviour.throwAtPage === page) throw new Error('synthetic connection reset');
        pages.push(page); pagesRead++;
        let skipped = 0;
        for (const n of items) {
          discovered++;
          if (options.isKnown?.(id(n))) { await options.onListed?.(id(n)); continue; }
          if (fetched >= options.maxJobs) { skipped++; continue; }
          fetched++;
          await accept({ externalId: id(n), title: `Role ${n}`, company: `${stamp} Co`, description: `Public description ${behaviour.claimComplete ? 'v2' : 'v1'}`, location: 'Bakı', url: `https://example.org/${stamp}-${n}`, postedAt: '2026-09-01T00:00:00Z' });
          accepted++;
        }
        if (skipped) { stopped = page; break; }
      }
      const reachedEnd = stopped === null;
      return { source: SRC, complete: (!resume && reachedEnd) || !!behaviour.claimComplete, pages: pagesRead, discovered, fetched, accepted, expired: 0, failed: 0, cursor: reachedEnd ? null : { kind: 'page', page: stopped! } } as any;
    },
  };

  const makeScheduler = async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    const s = module.get(SourceScheduler);
    s.collectors = (k) => (k === SRC ? collector : null);
    return { module, scheduler: s };
  };
  const src = () => prisma.jobSource.findUniqueOrThrow({ where: { key: SRC } });
  const progress = () => prisma.sourceDiscoveryProgress.findUnique({ where: { sourceKey: SRC } });
  const due = (data: Record<string, unknown> = {}) => prisma.jobSource.update({ where: { key: SRC }, data: { enabled: true, scheduled: true, intervalMinutes: 720, nextRunAt: null, consecutiveFailures: 0, cooldownUntil: null, cooldownCount: 0, leaseUntil: null, leaseOwner: null, ...data } });
  const stored = () => prisma.job.count({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } } });
  const active = () => prisma.job.count({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` }, status: 'ACTIVE' } });
  const tick = (s = scheduler) => s.tick(new Date());
  const runs = () => prisma.jobImportRun.findMany({ where: { source: SRC, startedAt: { gte: new Date(Number(stamp) - 1000) } }, orderBy: { startedAt: 'asc' } });
  const lastAsked = () => asked[asked.length - 1];

  beforeAll(async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    const made = await makeScheduler();
    scheduler = made.scheduler;
    prisma = made.module.get(PrismaService);
    const row = await prisma.jobSource.findUniqueOrThrow({ where: { key: SRC } });
    original = { enabled: row.enabled, scheduled: row.scheduled, intervalMinutes: row.intervalMinutes, nextRunAt: row.nextRunAt };
    await prisma.jobSource.updateMany({ where: { key: { not: SRC } }, data: { scheduled: false } });
  });
  afterAll(async () => {
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: SRC, startedAt: { gte: new Date(Number(stamp) - 1000) } } });
    await prisma.sourceDiscoveryProgress.deleteMany({ where: { sourceKey: SRC } });
    await prisma.jobSource.update({ where: { key: SRC }, data: { ...original, leaseUntil: null, leaseOwner: null, consecutiveFailures: 0, cooldownUntil: null, cooldownCount: 0 } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    asked.length = 0; optionsSeen.length = 0; behaviour = {}; PAGE = 5;
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: SRC, startedAt: { gte: new Date(Number(stamp) - 1000) } } });
    await prisma.sourceDiscoveryProgress.deleteMany({ where: { sourceKey: SRC } });
    board = Array.from({ length: 200 }, (_, i) => 1000 - i); // 200 postings = 40 pages, newest first
    await due();
  });

  it('bounded runs keep going beyond the same head pages: reconciliation, then deep segments from the stored cursor, across a restart, until the traversal completes', async () => {
    expect((await tick()).result).toBe('PARTIAL'); // run 1: head reconciliation, 12 pages
    expect(optionsSeen[0]).toMatchObject(RECONCILIATION_BUDGET_BOARDS);
    expect(lastAsked()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await stored()).toBe(60);
    expect((await progress())!).toMatchObject({ cursor: { kind: 'page', page: 13 }, segments: 0, listedInGeneration: 60, headReachedEnd: false });
    expect((await progress())!.anchors).toHaveLength(10);
    const generation = (await progress())!.generation;

    await due({ nextRunAt: null });
    expect((await tick()).result).toBe('PARTIAL'); // run 2: DEEP, resumed from the cursor (one page earlier)
    expect(optionsSeen[1]).toMatchObject({ ...DEEP_BUDGET_BOARDS, resume: { kind: 'page', page: 13 } });
    expect(lastAsked()[0]).toBe(12);
    expect(lastAsked().slice(-1)[0]).toBe(23);
    expect(await stored()).toBe(115); // pages 13-23 are new (page 12 was the overlap)
    expect((await progress())!).toMatchObject({ cursor: { kind: 'page', page: 24 }, segments: 1, generation });

    const restarted = await makeScheduler(); // a new process: the cursor is in the database
    await due({ nextRunAt: null });
    await restarted.scheduler.tick(new Date());
    expect(optionsSeen[2]).toMatchObject({ resume: { kind: 'page', page: 24 } });
    expect(await stored()).toBe(170);
    await due({ nextRunAt: null });
    await restarted.scheduler.tick(new Date());
    expect(await stored()).toBe(200); // every posting of the board is stored: nothing was left to the head pages
    expect((await progress())!).toMatchObject({ cursor: null, segments: 0 });
    expect((await progress())!.lastDeepCompletedAt).not.toBeNull();
    await restarted.module.close();

    // Not one of the deep segments could close anything, and each said it was a segment.
    const all = await runs();
    expect(all.slice(1).every((r) => r.closureSkipped === 'resumed_segment' && r.closed === 0)).toBe(true);
    expect(await active()).toBe(200);
  });

  it('the head is refreshed frequently and cheaply, separately from the deep traversal', async () => {
    await tick(); // reconciliation head, seeds the traversal: this board does not fit one run
    expect((await progress())!.headReachedEnd).toBe(false);
    for (let i = 0; i < 4; i++) { await due({ nextRunAt: null }); await tick(); } // deep segments until complete
    expect((await progress())!.cursor).toBeNull();
    const headDue = () => prisma.sourceDiscoveryProgress.update({ where: { sourceKey: SRC }, data: { lastHeadAt: new Date(Date.now() - 25 * 3_600_000) } });
    await headDue(); // the head refresh is due; a finished traversal lets the next head run find out whether the board now fits
    await due({ nextRunAt: null });
    await tick();
    expect((await progress())!.headReachedEnd).toBe(false); // it still does not fit
    board = [2000, 2001, ...board];
    await headDue();
    await due({ nextRunAt: null });
    const before = asked.length;
    await tick();
    expect(optionsSeen[before]).toMatchObject(INCREMENTAL_BUDGET_BOARDS); // cheap, frequent: not the deep budget, not a resume
    expect(optionsSeen[before].resume).toBeUndefined();
    expect(asked[before]).toEqual([1, 2, 3, 4]); // only the head pages
    expect(await prisma.job.count({ where: { externalId: { in: [id(2000), id(2001)] } } })).toBe(2); // and the new head postings were found
  });

  it('an interrupted segment stores nothing: the cursor stays, the run is closed as failed, and nothing is closed or lost', async () => {
    await tick();
    const before = await progress();
    behaviour = { throwAtPage: 16 };
    await due({ nextRunAt: null });
    expect((await tick()).result).toBe('FAILED');
    const after = await progress();
    expect(after!.cursor).toEqual(before!.cursor); // still page 13
    expect(after!.segments).toBe(before!.segments);
    expect((await runs()).pop()).toMatchObject({ status: 'FAILED' });
    expect(await active()).toBe(await stored()); // nothing closed
    behaviour = {};
    await due({ nextRunAt: null });
    expect((await tick()).result).toBe('PARTIAL');
    expect(optionsSeen.pop()).toMatchObject({ resume: { kind: 'page', page: 13 } }); // resumed from the same place
  });

  it('with real-sized pages the resumed segment still recognises its anchors (found by the live trial: it used to call every resume a shifted listing and restart for ever)', async () => {
    PAGE = 50; // a real board page; the anchors (the last postings of the previous segment) sit well beyond the first 40 postings of the page the segment resumes on
    board = Array.from({ length: 1200 }, (_, i) => 5000 - i);
    await tick(); // head reconciliation: bounded by 200 jobs, i.e. four 50-posting pages
    const first = await progress();
    expect(first!.cursor).toMatchObject({ kind: 'page' });
    await due({ nextRunAt: null });
    await tick();
    const second = await progress();
    expect(optionsSeen[1]).toHaveProperty('resume');
    expect(second!.restartReason).toBeNull(); // not "listing_shifted"
    expect(second!.segments).toBe(1);
    expect(second!.generation).toBe(first!.generation); // the same traversal, continued
    await due({ nextRunAt: null });
    await tick();
    expect((await progress())!).toMatchObject({ segments: 2, restartReason: null });
  });

  it('a small shift of the listing is absorbed by the overlap; a large one is detected and the traversal restarts instead of trusting the stale page', async () => {
    await tick();
    await due({ nextRunAt: null });
    board = [3000, 3001, 3002, ...board]; // three new postings at the head: everything moves down three places
    await tick();
    expect((await progress())!).toMatchObject({ segments: 1, restartReason: null }); // the overlap page still contained what was read before

    await due({ nextRunAt: null });
    board = Array.from({ length: 150 }, (_, i) => 5000 + i).concat(board); // 150 new postings: the anchors moved out of everything this segment can read; the stored cursor points into different postings
    await tick();
    const shifted = await progress();
    expect(shifted).toMatchObject({ cursor: null, segments: 0, restartReason: 'listing_shifted' });
    expect((await runs()).pop()!.closureSkipped).toBe('resumed_segment');

    await due({ nextRunAt: null });
    await tick(); // the restart: a fresh traversal begins at the head
    expect(optionsSeen.pop().resume).toBeUndefined();
    expect((await progress())!.restartReason).toBeNull();
  });

  it('postings removed ahead of the cursor also shift the listing: that is detected too', async () => {
    await tick();
    board = board.slice(40); // the 40 newest postings vanished: everything moved up eight pages
    await due({ nextRunAt: null });
    await tick();
    expect((await progress())!).toMatchObject({ cursor: null, restartReason: 'listing_shifted' });
  });

  it('a resumed segment can never close postings, even if the collector wrongly claims a complete listing', async () => {
    await tick();
    const victims = await prisma.job.findMany({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } }, take: 5 });
    await prisma.job.updateMany({ where: { id: { in: victims.map((v) => v.id) } }, data: { lastSeenAt: new Date(Date.now() - 86_400_000 * 3), missedImports: 1 } });
    behaviour = { claimComplete: true }; // a buggy collector
    board = board.filter((n) => !victims.some((v) => v.externalId === id(n)));
    await due({ nextRunAt: null });
    expect((await tick()).result).toBe('PARTIAL');
    expect((await runs()).pop()).toMatchObject({ closureSkipped: 'resumed_segment', closed: 0, listingComplete: false });
    expect(await prisma.job.count({ where: { id: { in: victims.map((v) => v.id) }, status: 'ACTIVE' } })).toBe(5);
  });

  describe('revalidation: known postings are not skipped for ever', () => {
    it('a bounded number of old stored postings are fetched again per run, oldest first, and their check time is refreshed', async () => {
      board = Array.from({ length: 30 }, (_, i) => 1000 - i);
      await tick(); // everything stored; detail time = now
      const old = new Date(Date.now() - REVALIDATE_AFTER_MS - 86_400_000);
      await prisma.job.updateMany({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } }, data: { detailFetchedAt: old } });
      await prisma.job.updateMany({ where: { externalId: id(1000) }, data: { description: 'Outdated text that the source has since changed', contentHash: 'stale' } }); // the source's text differs
      await due({ nextRunAt: null });
      await prisma.sourceDiscoveryProgress.update({ where: { sourceKey: SRC }, data: { lastHeadAt: new Date(Date.now() - 25 * 3_600_000) } });
      await tick();
      const summary = scheduler.summaries.get(SRC)!;
      expect(summary.revalidated.fetchedAgain).toBe(REVALIDATE_PER_RUN.incremental); // the quota, not all 30
      expect(summary.revalidated.changed).toBeGreaterThanOrEqual(1); // the changed posting was refreshed
      const refreshed = await prisma.job.count({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` }, detailFetchedAt: { gt: old } } });
      expect(refreshed).toBe(REVALIDATE_PER_RUN.incremental);
      expect((await prisma.job.findFirstOrThrow({ where: { externalId: id(1000) } })).description).toBe('Public description v1'); // the stale text was replaced
      // The next run takes the next batch, until all have been checked again.
      await due({ nextRunAt: null });
      await tick();
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` }, detailFetchedAt: { gt: old } } })).toBe(2 * REVALIDATE_PER_RUN.incremental);
    });

    it('new postings record when their detail was fetched', async () => {
      board = [1000, 999];
      await tick();
      const rows = await prisma.job.findMany({ where: { externalId: { startsWith: `${SRC}:cov${stamp}-` } } });
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.detailFetchedAt).not.toBeNull();
    });
  });

  it('operators can see how far the traversal has got', async () => {
    await tick();
    const row = (await sourceHealth(prisma)).find((h) => h.key === SRC)!;
    expect(row.discovery).toMatchObject({ traversalInProgress: true, segments: 0, listedInGeneration: 60, headReachedEnd: false, restartReason: null });
    expect(row.discovery!.lastHeadAt).toBeInstanceOf(Date);
  });

  it('an employer source keeps no traversal state', async () => {
    expect(await prisma.sourceDiscoveryProgress.count({ where: { sourceKey: { notIn: [SRC] } } })).toBe(await prisma.sourceDiscoveryProgress.count({ where: { sourceKey: { notIn: [SRC] } } }));
    const row = await prisma.jobSource.findUnique({ where: { key: 'xsolla' } });
    if (row) expect(await prisma.sourceDiscoveryProgress.findUnique({ where: { sourceKey: 'xsolla' } })).toBeNull();
  });
});
