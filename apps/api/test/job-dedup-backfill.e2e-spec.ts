import { execFileSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../src/database/database.service';
import { backfillAllDedupKeys, backfillDedupKeysBatch } from '../src/jobs/job-dedup-backfill';
import { canonicalizeUrl, normalizeCompany } from '../src/jobs/job-dedup.util';

/**
 * The operator backfill of deduplication comparison keys, against a real database (isolated local test database
 * only): it fills exactly the missing keys in batches, changes nothing else, deletes nothing, can be repeated, and
 * cannot overwrite what the live importer wrote while it ran.
 */
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
const API_DIR = path.resolve(__dirname, '..');

describe('dedup key backfill against a real database', () => {
  const stamp = `bf-${Date.now()}`;
  const prefix = `bf:${stamp}-`;
  const N = 1203;
  const PRESET = 25; // every 50th row already has (deliberately odd) keys
  let prisma: PrismaService;
  let userId: string;
  const companies = ['Alfa Holding MMC', 'ALFA holding', 'Əlifba Texnologiya ASC', 'MMC', 'Beta-Group Ltd.', 'Гамма ООО', 'Delta'];

  /** The importer-facing view of the table restricted to this test's rows, so exact counts are stable. */
  const scoped = (afterFirstRead?: (rows: Array<{ id: string }>) => Promise<void>) => {
    let first = true;
    return {
      job: {
        findMany: async (args: any) => {
          const rows = await prisma.job.findMany({ ...args, where: { ...args.where, externalId: { startsWith: prefix } } });
          if (first && afterFirstRead) { first = false; await afterFirstRead(rows); }
          return rows;
        },
        updateMany: (args: any) => prisma.job.updateMany(args),
        count: (args: any) => prisma.job.count({ ...args, where: { ...args.where, externalId: { startsWith: prefix } } }),
      },
    } as any;
  };
  const rows = () => prisma.job.findMany({ where: { externalId: { startsWith: prefix } }, orderBy: { externalId: 'asc' } });
  const stripKeys = (list: Array<Record<string, unknown>>) => JSON.stringify(list.map(({ companyKey: _k, canonicalUrl: _u, ...rest }) => rest));
  const whole = (list: unknown) => JSON.stringify(list);
  const unkey = () => prisma.job.updateMany({ where: { externalId: { startsWith: prefix }, NOT: { companyKey: 'preset-key' } }, data: { companyKey: null, canonicalUrl: null } });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    prisma = new PrismaService();
    await prisma.$connect();
    const data = Array.from({ length: N }, (_, i) => ({
      externalId: `${prefix}${i}`,
      title: `Vakansiya ${i}`,
      company: companies[i % companies.length],
      description: `Təsvir ${i}`,
      location: 'Bakı, Azərbaycan',
      url: i % 11 === 0 ? 'not a url' : i % 5 === 0 ? `https://www.Site.az/vac/${i}/?utm_source=x&id=${i}` : `https://site.az/vac/${i}`,
      postedAt: new Date('2026-09-10T00:00:00Z'),
      ...(i % 50 === 0 ? { companyKey: 'preset-key', canonicalUrl: 'https://preset.example/x' } : {}),
      ...(i % 13 === 0 ? { status: 'CLOSED' as const, closedAt: new Date('2026-09-20T00:00:00Z'), closedReason: 'not listed' } : {}),
      ...(i % 17 === 0 ? { hiddenAt: new Date('2026-09-21T00:00:00Z'), hiddenReason: 'moderation' } : {}),
    }));
    await prisma.job.createMany({ data });
    const primary = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}1` } });
    await prisma.job.updateMany({ where: { externalId: { in: [2, 21, 40, 59].map((i) => `${prefix}${i}`) } }, data: { duplicateOfId: primary.id, duplicateReason: 'same_posting' } });
    const user = await prisma.user.create({ data: { email: `${stamp}@example.com`, hashedPassword: 'x' } });
    userId = user.id;
    const withMatches = await prisma.job.findMany({ where: { externalId: { in: [3, 4, 5, 6, 7].map((i) => `${prefix}${i}`) } } });
    await prisma.match.createMany({ data: withMatches.map((j) => ({ userId, jobId: j.id, score: 0.5 })) });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
      await prisma.job.updateMany({ where: { externalId: { startsWith: prefix } }, data: { duplicateOfId: null } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: prefix } } });
      await prisma.$disconnect();
    }
  });

  const cli = (...args: string[]) =>
    execFileSync('npx', ['ts-node', '-r', 'tsconfig-paths/register', 'src/scripts/backfill-dedup-keys.ts', ...args], {
      cwd: API_DIR, env: { ...process.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('a dry run through the real script counts and changes nothing', async () => {
    const before = whole(await rows());
    const out = cli();
    expect(out).toMatch(/\d+ posting\(s\) have no comparison keys yet\./);
    expect(out).toContain('Dry run: nothing changed');
    expect(whole(await rows())).toBe(before);
  }, 60_000);

  it('refuses an unknown option before touching anything', async () => {
    const before = whole(await rows());
    let failure = '';
    try { cli('--aply'); } catch (error: any) { failure = String(error.stderr || error.message); }
    expect(failure).toContain('Unknown option --aply');
    expect(whole(await rows())).toBe(before);
  }, 60_000);

  it('fills exactly the missing keys, in batches, and changes nothing else', async () => {
    const before = await rows();
    const matchesBefore = await prisma.match.count({ where: { userId } });
    const missing = before.filter((j) => j.companyKey === null);
    expect(missing).toHaveLength(N - PRESET);

    const batches: number[] = [];
    const result = await backfillAllDedupKeys(scoped(), { batchSize: 100, onBatch: (b) => batches.push(b.scanned) });
    expect(result).toEqual({ filled: N - PRESET, skipped: 0, remaining: 0, passes: 1 });
    expect(batches).toEqual([...Array(11).fill(100), 78]); // 1178 rows in batches of 100: nothing read twice

    const after = await rows();
    // Every missing key is the importer's own rule applied to the row's own text.
    for (const j of after.filter((r) => missing.some((m) => m.id === r.id))) {
      expect(j.companyKey).toBe(normalizeCompany(j.company) || '-');
      expect(j.canonicalUrl).toBe(canonicalizeUrl(j.url));
    }
    expect(after.filter((j) => j.companyKey === '-').length).toBeGreaterThan(0); // the "MMC" rows: empty name -> '-'
    expect(after.some((j) => j.url === 'not a url' && j.canonicalUrl === null)).toBe(true); // unparseable -> no URL key
    // Rows that already had keys keep exactly what they had.
    for (const j of after.filter((r) => r.externalId.endsWith('0') && Number(r.externalId.slice(prefix.length)) % 50 === 0)) {
      expect([j.companyKey, j.canonicalUrl]).toEqual(['preset-key', 'https://preset.example/x']);
    }
    // Nothing but the two key columns differs: lifecycle, moderation, links, content, hashes, dates.
    expect(stripKeys(after as any)).toBe(stripKeys(before as any));
    expect(after).toHaveLength(N);
    expect(await prisma.match.count({ where: { userId } })).toBe(matchesBefore);
    expect(await prisma.job.count({ where: { externalId: { startsWith: prefix }, status: 'CLOSED' } })).toBe(before.filter((j) => j.status === 'CLOSED').length);
    expect(await prisma.job.count({ where: { externalId: { startsWith: prefix }, hiddenAt: { not: null } } })).toBe(before.filter((j) => j.hiddenAt).length);
    expect(await prisma.job.count({ where: { externalId: { startsWith: prefix }, duplicateOfId: { not: null } } })).toBe(4);
  }, 120_000);

  it('can be repeated: a second run finds nothing and changes nothing', async () => {
    const before = whole(await rows());
    const result = await backfillAllDedupKeys(scoped(), { batchSize: 100 });
    expect(result).toEqual({ filled: 0, skipped: 0, remaining: 0, passes: 1 });
    expect(whole(await rows())).toBe(before);
  });

  describe('next to the live importer', () => {
    const importerWrites = async (id: string, company: string) =>
      prisma.job.update({ where: { id }, data: { company, companyKey: normalizeCompany(company) || null } }); // what upsertJob does on a content change

    async function arrange() {
      await unkey();
      // Each test starts from the rows' original text, whatever an earlier test's simulated importer wrote.
      for (const i of [101, 102, 103]) await prisma.job.update({ where: { externalId: `${prefix}${i}` }, data: { company: companies[i % companies.length] } });
      const picks = await prisma.job.findMany({ where: { externalId: { in: [101, 102, 103].map((i) => `${prefix}${i}`) } }, orderBy: { externalId: 'asc' } });
      return { a: picks[0], b: picks[1], c: picks[2] };
    }

    it('never overwrites a key the importer wrote between the read and the write, and retries a row that changed', async () => {
      const { a, b, c } = await arrange();
      const result = await backfillAllDedupKeys(scoped(async () => {
        await importerWrites(a.id, 'Yeni Şirkət MMC'); // importer sets a new company AND its key
        await importerWrites(b.id, 'MMC');             // importer sets a company whose key is empty -> null
      }), { batchSize: 5000 }); // one batch holds every keyless row, so the importer's writes land between the read and the writes
      const [fa, fb, fc] = await Promise.all([a, b, c].map((j) => prisma.job.findUniqueOrThrow({ where: { id: j.id } })));
      expect(fa.companyKey).toBe('yeni sirket');           // the importer's key survives; not the stale one for the old name
      expect(fa.company).toBe('Yeni Şirkət MMC');
      expect(fb.companyKey).toBe('-');                     // skipped once (changed), then filled on the next pass
      expect(fc.companyKey).toBe(normalizeCompany(c.company) || '-');
      expect(result.skipped).toBeGreaterThanOrEqual(2);
      expect(result.passes).toBe(2);
      expect(result.remaining).toBe(0);
      // Invariant for every row: its key is the rule applied to its CURRENT text.
      for (const j of await rows()) {
        if (j.companyKey === 'preset-key') continue;
        expect(j.companyKey).toBe(normalizeCompany(j.company) || '-');
      }
    }, 60_000);

    it('control: the original unguarded algorithm writes a stale key in the same situation', async () => {
      const { a } = await arrange();
      const db = scoped(async () => { await importerWrites(a.id, 'Yeni Şirkət MMC'); });
      const stale = await db.job.findMany({ where: { companyKey: null }, select: { id: true, company: true, url: true }, take: 5000 });
      for (const row of stale) { // exactly what backfill-dedup-keys.ts did before: update by id only
        await prisma.job.update({ where: { id: row.id }, data: { companyKey: normalizeCompany(row.company) || '-', canonicalUrl: canonicalizeUrl(row.url) } });
      }
      const fa = await prisma.job.findUniqueOrThrow({ where: { id: a.id } });
      expect(a.company).not.toBe('Yeni Şirkət MMC'); // the text that was read is stale by the time of the write
      expect(fa.company).toBe('Yeni Şirkət MMC');
      expect(fa.companyKey).toBe(normalizeCompany(a.company) || '-'); // the key now describes the OLD name...
      expect(fa.companyKey).not.toBe('yeni sirket');                  // ...and the importer's key is lost
    }, 60_000);

    it('one batch of the importer-side method also respects the guard and returns what it filled', async () => {
      await unkey();
      const filled = await backfillDedupKeysBatch(scoped(), { limit: 10 });
      expect(filled).toMatchObject({ scanned: 10, filled: 10, skipped: 0 });
      expect(filled.lastId).toEqual(expect.any(String));
    });
  });

  it('the real script applies the backfill end to end and leaves only the two key columns different', async () => {
    await unkey();
    const before = await rows();
    const out = cli('--apply');
    expect(out).toMatch(/Filled \d+ posting\(s\) in \d+ batch\(es\)/);
    const after = await rows();
    expect(after.filter((j) => j.companyKey === null)).toHaveLength(0);
    expect(stripKeys(after as any)).toBe(stripKeys(before as any));
    expect(after).toHaveLength(N);
    const again = cli('--apply');
    expect(again).toMatch(/Filled 0 posting\(s\)/);
  }, 180_000);
});
