import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';

/** Real Postgres (isolated local test database only), fake queue. */
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
const TEXT =
  'Şirkətin mühasibat uçotuna rəhbərlik etmək vergi hesabatlarını hazırlamaq ilkin sənədləri yoxlamaq əmək haqqı hesablanması 1C proqramında işləmək maliyyə hesabatlarını təqdim etmək və komanda ilə əlaqə saxlamaq';

describe('cross-source deduplication against a real database', () => {
  const stamp = `dedup-${Date.now()}`;
  const company = `Dedup Holding ${stamp} MMC`;
  let prisma: PrismaService;
  let jobs: JobsService;
  let queued: string[];
  const queue = { add: jest.fn(async (_name: string, data: { jobId: string }) => { queued.push(data.jobId); return {}; }) };

  const posting = (source: string, id: string, over: Record<string, unknown> = {}) => ({
    externalId: `${source}:${stamp}-${id}`,
    title: 'Baş mühasib',
    company: `${company} ${id.charAt(0)}`,
    description: TEXT,
    location: 'Bakı, Azərbaycan',
    url: `https://${source}.example/vacancy/${stamp}-${id}`,
    postedAt: '2026-09-10T00:00:00Z',
    ...over,
  });
  const row = (source: string, id: string) => prisma.job.findUniqueOrThrow({ where: { externalId: `${source}:${stamp}-${id}` } });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    prisma = new PrismaService();
    await prisma.$connect();
    jobs = new JobsService(prisma, queue as any);
  });
  beforeEach(() => { queued = []; queue.add.mockClear(); });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
    await prisma.job.deleteMany({ where: { externalId: { contains: stamp } } });
    await prisma.$disconnect();
  });

  it('links the second source to the first, keeps both rows, and queues matching only for the primary', async () => {
    const first = (await jobs.upsertJob(posting('glorri', 'a'))).job;
    const second = (await jobs.upsertJob(posting('hellojob', 'a'))).job;
    expect(second.duplicateOfId).toBe(first.id);
    expect(second.duplicateReason).toMatch(/same_posting/);
    expect((await row('glorri', 'a')).duplicateOfId).toBeNull();
    expect(queued).toEqual([expect.stringContaining(first.id)]);
    expect(await prisma.job.count({ where: { externalId: { contains: `${stamp}-a` } } })).toBe(2);
  });

  it('a repeated import changes nothing: no new rows, no re-link churn, no extra matching work', async () => {
    const before = await row('hellojob', 'a');
    const again = await jobs.upsertJob(posting('hellojob', 'a'));
    expect(again.outcome).toBe('unchanged');
    expect(again.job.duplicateOfId).toBe(before.duplicateOfId);
    expect(queued).toEqual([]); // the duplicate is not actionable
    await jobs.upsertJob(posting('glorri', 'a'));
    expect(await prisma.job.count({ where: { externalId: { contains: `${stamp}-a` } } })).toBe(2);
  });

  it('does not link distinct openings: other address, other title, same-source repost', async () => {
    await jobs.upsertJob(posting('glorri', 'b1', { location: 'Port Baku Towers, Bakı' }));
    const otherAddress = (await jobs.upsertJob(posting('hellojob', 'b2', { location: '55 Rəşid Behbudov küçəsi, Bakı' }))).job;
    expect(otherAddress.duplicateOfId).toBeNull();
    const otherTitle = (await jobs.upsertJob(posting('hellojob', 'b3', { title: 'Mühasib köməkçisi', location: 'Port Baku Towers, Bakı' }))).job;
    expect(otherTitle.duplicateOfId).toBeNull();
    const sameSource = (await jobs.upsertJob(posting('glorri', 'b4', { location: 'Port Baku Towers, Bakı' }))).job;
    expect(sameSource.duplicateOfId).toBeNull(); // same source: its own ids are authoritative
    for (const j of [otherAddress, otherTitle, sameSource]) expect(queued.some((q) => q.startsWith(j.id))).toBe(true);
  });

  it('keeps matches and history of a duplicate and releases it when its primary closes', async () => {
    const primary = await row('glorri', 'a');
    const dup = await row('hellojob', 'a');
    const user = await prisma.user.create({ data: { email: `${stamp}-u@example.com`, hashedPassword: 'x' } });
    const match = await prisma.match.create({ data: { userId: user.id, jobId: dup.id, score: 0.6 } });

    await prisma.job.update({ where: { id: primary.id }, data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'source_removed' } });
    expect(await jobs.releaseOrphanedDuplicates()).toBeGreaterThanOrEqual(1);
    const released = await row('hellojob', 'a');
    expect(released.duplicateOfId).toBeNull();
    expect(released.duplicateReason).toBeNull();
    expect(queued.some((q) => q.startsWith(dup.id))).toBe(true); // scored again now that it is the only open listing
    expect(await prisma.match.findUnique({ where: { id: match.id } })).not.toBeNull();
    expect(await jobs.releaseOrphanedDuplicates()).toBe(0); // idempotent
  });

  it('releases a duplicate when an operator hides its primary, and hiding survives a reimport', async () => {
    const p = (await jobs.upsertJob(posting('glorri', 'e'))).job;
    const d = (await jobs.upsertJob(posting('hellojob', 'e'))).job;
    expect(d.duplicateOfId).toBe(p.id);
    await prisma.job.update({ where: { id: p.id }, data: { hiddenAt: new Date(), hiddenReason: 'spam' } });
    await jobs.releaseOrphanedDuplicates();
    expect((await row('hellojob', 'e')).duplicateOfId).toBeNull();
    await jobs.upsertJob(posting('glorri', 'e', { description: TEXT + ' yenilənib' }));
    expect((await row('glorri', 'e')).hiddenAt).not.toBeNull();
    // A source-closed then reopened posting stays moderated.
    await prisma.job.update({ where: { id: p.id }, data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'source_removed' } });
    const reopened = await jobs.upsertJob(posting('glorri', 'e', { description: TEXT + ' yenilənib' }), new Date());
    expect(reopened.outcome).toBe('reopened');
    expect(reopened.job.hiddenAt).not.toBeNull();
  });

  it('backfills comparison keys for rows imported before deduplication without changing content', async () => {
    const created = (await jobs.upsertJob(posting('glorri', 'f'))).job;
    await prisma.job.update({ where: { id: created.id }, data: { companyKey: null, canonicalUrl: null } });
    expect(await jobs.backfillDedupKeys()).toBeGreaterThanOrEqual(1);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.companyKey).toBeTruthy();
    expect(after.canonicalUrl).toContain('https://glorri.example/vacancy/');
    expect(after.contentHash).toBe(created.contentHash);
  });
});
