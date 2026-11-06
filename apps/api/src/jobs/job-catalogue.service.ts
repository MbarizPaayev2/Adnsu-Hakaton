import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { foldText } from './job-location.util';
import { JOB_CATEGORIES, categoryLabel } from './job-categories';
import { extractPostingNeeds, skillGuidance } from './job-skills';
import { loadEmailApplyConfig } from '../email-applications/email-apply.config';

export interface CatalogueQuery { page?: string; limit?: string; q?: string; location?: string; source?: string; sort?: string; category?: string; company?: string; work?: string; experience?: string; application?: string }
export interface CatalogueItem { id: string; kind: 'imported' | 'native'; source: string; category: string; title: string; company: string; companyId: string | null; location: string | null; postedAt: Date; deadline: Date | null;
  /** null = the posting does not say (shown as unknown, never guessed). */
  workArrangement: string | null; experienceLevel: string | null; applicationMethod: string; checkedAt: Date | null }
export const WORK_FILTERS = ['Remote', 'Hybrid', 'On-site'] as const;
export const EXPERIENCE_FILTERS = ['Junior', 'Mid-level', 'Senior', 'Lead'] as const;

function numberOption(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new BadRequestException('Yanlış səhifələmə parametri');
  return Number(value);
}
export function catalogueOptions(query: CatalogueQuery) {
  if (Object.values(query).some((value) => value !== undefined && typeof value !== 'string')) throw new BadRequestException('Yanlış axtarış parametri');
  const page = numberOption(query.page, 1, 10_000), limit = numberOption(query.limit, 20, 50);
  const q = (query.q || '').trim(), location = (query.location || '').trim(), source = query.source || 'all', sort = query.sort || 'newest', category = query.category || 'all';
  const company = (query.company || '').trim(), work = query.work || 'all', experience = query.experience || 'all';
  const application = query.application || 'all';
  if (!['all', 'email'].includes(application)) throw new BadRequestException('Yanlış müraciət üsulu');
  if (company.length > 120 || (work !== 'all' && work !== 'unknown' && !(WORK_FILTERS as readonly string[]).includes(work)) || (experience !== 'all' && experience !== 'unknown' && !(EXPERIENCE_FILTERS as readonly string[]).includes(experience))) throw new BadRequestException('Yanlış axtarış parametri');
  if (q.length > 100 || location.length > 80 || !/^(all|[a-z][a-z0-9_-]{0,30})$/.test(source) || !['newest', 'oldest'].includes(sort) || (category !== 'all' && !JOB_CATEGORIES.some((c) => c.key === category))) throw new BadRequestException('Yanlış axtarış parametri');
  return { page, limit, q, location, source, sort, category, company, work, experience, application };
}
const literalLike = (value: string) => `%${foldText(value).replace(/[\\%_]/g, '\\$&')}%`;
const foldColumn = (column: Prisma.Sql) => Prisma.sql`translate(lower(COALESCE(${column}, '')), 'əıöüçşğ', 'eioucsg')`;

/** Known values first, then an explicit "unknown" bucket so missing facts stay visible. */
function facet(known: readonly string[], rows: { value: string | null; count: number }[]) {
  return [...known.map((value) => ({ value, count: rows.find((r) => r.value === value)?.count ?? 0 })), { value: 'unknown', count: rows.filter((r) => r.value === null || !known.includes(r.value)).reduce((n, r) => n + r.count, 0) }];
}

/** One catalogue with global pagination across imported and employer-published jobs.
 * No profile, subscription, match score, raw payload or private company fields. */
@Injectable()
export class JobCatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  private openRows(now: Date, emailOnly = false) {
    const emailFilter = emailOnly ? Prisma.sql`
      AND j."applicationMethod"='EMAIL' AND NULLIF(btrim(j."applicationEmail"), '') IS NOT NULL
      AND j."applicationEmailEvidence" IS NOT NULL AND j."applicationEmailEvidence" <> 'null'::jsonb
      AND j."lastSeenAt" >= ${new Date(now.getTime() - loadEmailApplyConfig().listingMaxAgeDays * 86_400_000)}
      AND NOT EXISTS (SELECT 1 FROM "EmailSuppression" s WHERE s.email = lower(btrim(j."applicationEmail")))` : Prisma.empty;
    const base = Prisma.sql`
      SELECT j.id, 'imported'::text AS kind, split_part(j."externalId", ':', 1) AS source,
        j.title, j.company, NULL::text AS "companyId", j.location, j."postedAt", j.deadline,
        j."workArrangement", j."experienceLevel", j."applicationMethod"::text AS "applicationMethod", j."lastSeenAt" AS "checkedAt"
      FROM "Job" j WHERE j.status='ACTIVE' AND j."hiddenAt" IS NULL AND j."duplicateOfId" IS NULL
        AND (j.deadline IS NULL OR j.deadline>=${now}) ${emailFilter}
      UNION ALL
      SELECT v.id, 'native'::text AS kind, 'aise'::text AS source,
        v.title, c.name AS company, v."companyId", v.location, COALESCE(v."publishedAt", v."createdAt") AS "postedAt", v.deadline,
        v."workArrangement", v."experienceLevel", 'NATIVE'::text AS "applicationMethod", NULL::timestamp AS "checkedAt"
      FROM "Vacancy" v JOIN "Company" c ON c.id=v."companyId"
      WHERE v.status='ACTIVE' AND c.status='APPROVED' AND (v.deadline IS NULL OR v.deadline>${now})
        AND (v."expiresAt" IS NULL OR v."expiresAt">${now}) AND ${!emailOnly}`;
    const cases = JOB_CATEGORIES.filter((c) => c.pattern).map((c) => Prisma.sql`WHEN ${foldColumn(Prisma.sql`title`)} ~ ${c.pattern} THEN ${c.key}`);
    return Prisma.sql`SELECT *, CASE ${Prisma.join(cases, ' ')} ELSE 'other' END AS category FROM (${base}) postings`;
  }

  async list(query: CatalogueQuery) {
    const options = catalogueOptions(query);
    const { page, limit, q, location, source, sort, category, company, work, experience } = options;
    const rows = this.openRows(new Date(), options.application === 'email');
    const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q) filters.push(Prisma.sql`(${foldColumn(Prisma.sql`title`)} LIKE ${literalLike(q)} OR ${foldColumn(Prisma.sql`company`)} LIKE ${literalLike(q)})`);
    if (location) {
      const folded = foldText(location);
      const terms = ['baki', 'baku', 'баку'].includes(folded) ? ['baki', 'baku', 'баку'] : [location];
      filters.push(Prisma.sql`(${Prisma.join(terms.map((term) => Prisma.sql`${foldColumn(Prisma.sql`location`)} LIKE ${literalLike(term)}`), ' OR ')})`);
    }
    if (source !== 'all') filters.push(Prisma.sql`source=${source}`);
    if (category !== 'all') filters.push(Prisma.sql`category=${category}`);
    if (company) filters.push(Prisma.sql`${foldColumn(Prisma.sql`company`)} = ${foldText(company)}`);
    if (work !== 'all') filters.push(work === 'unknown' ? Prisma.sql`"workArrangement" IS NULL` : Prisma.sql`"workArrangement" = ${work}`);
    if (experience !== 'all') filters.push(experience === 'unknown' ? Prisma.sql`"experienceLevel" IS NULL` : Prisma.sql`"experienceLevel" = ${experience}`);
    const where = Prisma.join(filters, ' AND ');
    const order = sort === 'oldest' ? Prisma.sql`"postedAt" ASC, kind ASC, id ASC` : Prisma.sql`"postedAt" DESC, kind ASC, id ASC`;
    const [data, counts, sources, categoryCounts, workCounts, experienceCounts, companies] = await this.prisma.$transaction([
      this.prisma.$queryRaw<CatalogueItem[]>(Prisma.sql`SELECT * FROM (${rows}) catalogue WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS total FROM (${rows}) catalogue WHERE ${where}`),
      this.prisma.$queryRaw<{ source: string; count: number }[]>(Prisma.sql`SELECT source, COUNT(*)::int AS count FROM (${rows}) catalogue GROUP BY source ORDER BY source`),
      this.prisma.$queryRaw<{ category: string; count: number }[]>(Prisma.sql`SELECT category, COUNT(*)::int AS count FROM (${rows}) catalogue GROUP BY category ORDER BY category`),
      this.prisma.$queryRaw<{ value: string | null; count: number }[]>(Prisma.sql`SELECT "workArrangement" AS value, COUNT(*)::int AS count FROM (${rows}) catalogue GROUP BY 1`),
      this.prisma.$queryRaw<{ value: string | null; count: number }[]>(Prisma.sql`SELECT "experienceLevel" AS value, COUNT(*)::int AS count FROM (${rows}) catalogue GROUP BY 1`),
      this.prisma.$queryRaw<{ company: string; count: number }[]>(Prisma.sql`SELECT min(company) AS company, COUNT(*)::int AS count FROM (${rows}) catalogue GROUP BY ${foldColumn(Prisma.sql`company`)} ORDER BY count DESC, 1 LIMIT 40`),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const total = counts[0].total;
    return { data: data.map((item) => ({ ...item, categoryLabel: categoryLabel(item.category) })), meta: { total, totalOpen: sources.reduce((n, s) => n + s.count, 0), page, limit, totalPages: Math.ceil(total / limit) }, sources,
      workArrangements: facet(WORK_FILTERS, workCounts), experienceLevels: facet(EXPERIENCE_FILTERS, experienceCounts), companies,
      categories: JOB_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: categoryCounts.find((r) => r.category === c.key)?.count ?? 0 })) };
  }

  /** The public catalogue row for one posting, or null when it is not open (closed, hidden, duplicate, expired, unapproved). Same view the listing uses. */
  async openItem(kind: 'imported' | 'native', id: string): Promise<CatalogueItem | null> {
    const rows = await this.prisma.$queryRaw<CatalogueItem[]>(Prisma.sql`SELECT * FROM (${this.openRows(new Date())}) catalogue WHERE kind=${kind} AND id=${id}`);
    return rows[0] ?? null;
  }

  async detail(kind: string, id: string) {
    if (!['imported', 'native'].includes(kind) || !id || id.length > 128) throw new NotFoundException('Vakansiya tapılmadı');
    const rows = await this.prisma.$queryRaw<CatalogueItem[]>(Prisma.sql`SELECT * FROM (${this.openRows(new Date())}) catalogue WHERE kind=${kind} AND id=${id}`);
    const item = rows[0];
    if (!item) throw new NotFoundException('Vakansiya tapılmadı');
    if (kind === 'imported') {
      const { rawPayload, ...content } = await this.prisma.job.findUniqueOrThrow({ where: { id }, select: { description: true, url: true, rawPayload: true } });
      // Only a yes/no leaves the payload: the source's own deadline statements disagreed.
      const deadlineConflict = !!(rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) && (rawPayload as Record<string, unknown>).deadlineConflict);
      return { ...item, ...content, deadlineConflict, categoryLabel: categoryLabel(item.category) };
    }
    const content = await this.prisma.vacancy.findUniqueOrThrow({ where: { id }, select: { description: true, requirements: true, responsibilities: true, employmentType: true, workArrangement: true, salaryMin: true, salaryMax: true } });
    return { ...item, ...content, url: null, categoryLabel: categoryLabel(item.category) };
  }

  /**
   * What this posting asks for set against the signed-in candidate's own profile: skills already evidenced (in the skills list or in role text), required
   * and preferred skills the profile does not mention, and the degree/experience lines kept apart. Read-only: nothing is ever added from here.
   */
  async skillGuidance(userId: string, kind: string, id: string) {
    if (!['imported', 'native'].includes(kind) || !id || id.length > 128) throw new NotFoundException('Vakansiya tapılmadı');
    const item = await this.openItem(kind as 'imported' | 'native', id);
    if (!item) throw new NotFoundException('Vakansiya tapılmadı');
    const posting =
      kind === 'imported'
        ? await this.prisma.job.findUniqueOrThrow({ where: { id }, select: { title: true, description: true } })
        : await this.prisma.vacancy.findUniqueOrThrow({ where: { id }, select: { title: true, description: true, requirements: true, skills: true } });
    const needs = extractPostingNeeds({
      title: posting.title,
      description: posting.description ?? '',
      requirements: 'requirements' in posting ? posting.requirements : null,
      skills: 'skills' in posting ? posting.skills : null,
    });
    const [profile, career] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId }, select: { skills: true, experiences: { select: { title: true, company: true, description: true } } } }),
      this.prisma.careerEntry.findMany({ where: { userId, status: 'CONFIRMED' }, select: { kind: true, title: true, description: true, result: true } }),
    ]);
    const guidance = skillGuidance(needs, {
      skills: profile?.skills ?? [],
      experiences: profile?.experiences ?? [],
      career: career.filter((c) => c.kind !== 'LANGUAGE'),
      languages: career.filter((c) => c.kind === 'LANGUAGE').map((c) => ({ title: c.title })),
    });
    return { hasProfile: !!profile, ...guidance };
  }
}
