import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { foldText } from '../jobs/job-location.util';
import { groupCompanies, isObservedCompanyId, monogramOf, observedCompanyId, observedCompanyKey, type GroupedCompany } from './observed-company.util';

const DEFAULT_LIMIT = 24;

const intOption = (value: string | undefined, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new BadRequestException('Yanlış səhifələmə parametri');
  return Number(value);
};

/**
 * Public pages for OBSERVED companies: employers named by imported postings. They are not registered AISE employers and nothing here claims they are
 * (no contact details, no vacancies of their own, no "verified employer" mark). Counts are distinct open postings (not hidden, not a cross-source
 * repeat, deadline not passed); the listing says where each posting was collected from so the source can be credited.
 */
@Injectable()
export class ObservedCompaniesService {
  constructor(private prisma: PrismaService, private storage: LocalStorageService) {}

  /** Open imported postings per (spelling, source). The only place the open-posting rule for company pages is written down. */
  private async openRows(now: Date) {
    return this.prisma.$queryRaw<{ company: string; source: string; count: number; lastSeenAt: Date }[]>(Prisma.sql`
      SELECT j.company, split_part(j."externalId", ':', 1) AS source, COUNT(*)::int AS count, MAX(j."lastSeenAt") AS "lastSeenAt"
      FROM "Job" j WHERE j.status = 'ACTIVE' AND j."hiddenAt" IS NULL AND j."duplicateOfId" IS NULL AND (j.deadline IS NULL OR j.deadline >= ${now})
      GROUP BY 1, 2`);
  }

  private async knownKeys() {
    const rows = await this.prisma.$queryRaw<{ company: string }[]>(Prisma.sql`SELECT DISTINCT company FROM "Job" WHERE "hiddenAt" IS NULL`);
    return new Set(rows.map((r) => observedCompanyKey(r.company)).filter(Boolean));
  }

  private async profiles(keys: string[]) {
    const rows = await this.prisma.observedCompanyProfile.findMany({ where: { companyKey: { in: keys } } });
    return new Map(rows.map((r) => [r.companyKey, r]));
  }

  private logoOf(id: string, profile?: { logoFile: string | null; logoSource: string | null; logoSourceUrl: string | null; logoVerifiedAt: Date | null }) {
    // Shown only with complete provenance; anything less falls back to the monogram.
    if (!profile?.logoFile || !profile.logoSource || !profile.logoSourceUrl || !profile.logoVerifiedAt) return null;
    return { url: `/public/companies/${id}/logo`, source: profile.logoSource, sourceUrl: profile.logoSourceUrl, verifiedAt: profile.logoVerifiedAt };
  }

  private async sourceNames(keys: string[]) {
    const rows = await this.prisma.jobSource.findMany({ where: { key: { in: keys } }, select: { key: true, name: true, homepageUrl: true } });
    return new Map(rows.map((r) => [r.key, r]));
  }

  private present(c: GroupedCompany, profile: Awaited<ReturnType<ObservedCompaniesService['profiles']>> extends Map<string, infer P> ? P | undefined : never, sources: Map<string, { name: string; homepageUrl: string }>) {
    return {
      id: c.id, name: c.name, openCount: c.openCount, lastObservedAt: c.lastObservedAt,
      sources: c.sources.map((s) => ({ key: s.key, name: sources.get(s.key)?.name ?? s.key, count: s.count })),
      logo: this.logoOf(c.id, profile), monogram: monogramOf(c.name, c.key),
      registered: false as const,
    };
  }

  async list(query: { q?: string; page?: string; limit?: string; sort?: string }) {
    if (Object.values(query).some((v) => v !== undefined && typeof v !== 'string')) throw new BadRequestException('Yanlış axtarış parametri');
    const page = intOption(query.page, 1, 10_000), limit = intOption(query.limit, DEFAULT_LIMIT, 100);
    const q = (query.q ?? '').trim();
    const sort = query.sort ?? 'postings';
    if (q.length > 100 || !['postings', 'name'].includes(sort)) throw new BadRequestException('Yanlış axtarış parametri');
    const { companies, unkeyedPostings } = groupCompanies(await this.openRows(new Date()));
    const needle = foldText(q);
    const matched = companies.filter((c) => !needle || [c.name, ...c.aliases].some((n) => foldText(n).includes(needle)));
    matched.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'az') : (a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name, 'az'));
    const pageRows = matched.slice((page - 1) * limit, page * limit);
    const [profiles, sources] = await Promise.all([this.profiles(pageRows.map((c) => c.key)), this.sourceNames([...new Set(pageRows.flatMap((c) => c.sources.map((s) => s.key)))])]);
    return {
      page, limit, total: matched.length,
      // Every open posting in the collected sources is counted once here, or reported as having no usable company name.
      totals: { companies: companies.length, openPostings: companies.reduce((n, c) => n + c.openCount, 0), postingsWithoutUsableCompanyName: unkeyedPostings },
      companies: pageRows.map((c) => this.present(c, profiles.get(c.key), sources)),
    };
  }

  async detail(id: string, query: { page?: string; limit?: string }) {
    if (!isObservedCompanyId(id)) throw new NotFoundException('Şirkət tapılmadı');
    const page = intOption(query.page, 1, 10_000), limit = intOption(query.limit, 20, 50);
    const now = new Date();
    const { companies } = groupCompanies(await this.openRows(now));
    let company = companies.find((c) => c.id === id);
    let spellings: string[];
    if (company) spellings = [company.name, ...company.aliases];
    else {
      // A company with no open posting right now keeps its page (and id) as long as any visible posting of it exists.
      const rows = await this.prisma.$queryRaw<{ company: string; lastSeenAt: Date; count: number }[]>(Prisma.sql`SELECT company, MAX("lastSeenAt") AS "lastSeenAt", COUNT(*)::int AS count FROM "Job" WHERE "hiddenAt" IS NULL GROUP BY 1`);
      const mine = rows.filter((r) => observedCompanyKey(r.company) && groupCompanies([{ company: r.company, source: 'x', count: 1, lastSeenAt: r.lastSeenAt }]).companies[0]?.id === id);
      if (!mine.length) throw new NotFoundException('Şirkət tapılmadı');
      const g = groupCompanies(mine.map((r) => ({ company: r.company, source: 'closed', count: 0, lastSeenAt: r.lastSeenAt }))).companies[0];
      company = { ...g, openCount: 0, sources: [] };
      spellings = [g.name, ...g.aliases];
    }
    const where = Prisma.sql`j.status = 'ACTIVE' AND j."hiddenAt" IS NULL AND j."duplicateOfId" IS NULL AND (j.deadline IS NULL OR j.deadline >= ${now}) AND j.company IN (${Prisma.join(spellings)})`;
    const [jobs, [profile], sources] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; title: string; location: string | null; postedAt: Date; deadline: Date | null; applicationMethod: string; checkedAt: Date; source: string }[]>(Prisma.sql`
        SELECT j.id, j.title, j.location, j."postedAt", j.deadline, j."applicationMethod"::text AS "applicationMethod", j."lastSeenAt" AS "checkedAt", split_part(j."externalId", ':', 1) AS source
        FROM "Job" j WHERE ${where} ORDER BY j."postedAt" DESC, j.id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.profiles([company.key]).then((m) => [m.get(company!.key)]),
      this.sourceNames(company.sources.map((s) => s.key)),
    ]);
    return {
      ...this.present(company, profile, sources),
      aliases: company.aliases,
      website: profile?.website ?? null,
      // Following uses the same key as company follows and alerts.
      followKey: company.key,
      attribution: {
        statement: 'Bu şirkət AISE-də qeydiyyatdan keçmiş işəgötürən deyil. Vakansiyalar aşağıda göstərilən açıq mənbələrdən toplanıb; hər elanın orijinal səhifəsi ona bağlıdır.',
        sources: company.sources.map((s) => ({ key: s.key, name: sources.get(s.key)?.name ?? s.key, homepageUrl: sources.get(s.key)?.homepageUrl ?? null, count: s.count })),
      },
      page, limit, total: company.openCount,
      jobs: jobs.map((j) => ({ id: j.id, kind: 'imported' as const, title: j.title, location: j.location, postedAt: j.postedAt, deadline: j.deadline, applicationMethod: j.applicationMethod, checkedAt: j.checkedAt, source: j.source })),
    };
  }

  /** The stored logo, only when its provenance is complete. Otherwise 404 (the page shows its monogram). */
  async logo(id: string): Promise<StreamableFile> {
    if (!isObservedCompanyId(id)) throw new NotFoundException();
    const profiles = await this.prisma.observedCompanyProfile.findMany({ where: { logoFile: { not: null }, logoSourceUrl: { not: null }, logoSource: { not: null }, logoVerifiedAt: { not: null } } });
    const profile = profiles.find((p) => observedCompanyId(p.companyKey) === id);
    if (!profile?.logoFile) throw new NotFoundException();
    const bytes = await this.storage.readUpload(profile.logoFile).catch(() => { throw new NotFoundException(); });
    const type = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' ? 'image/webp' : null;
    if (!type) throw new NotFoundException();
    return new StreamableFile(bytes, { type, disposition: 'inline' });
  }
}
