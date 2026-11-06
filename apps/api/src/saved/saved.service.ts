import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { ProductService } from '../billing/product.service';
import { normalizeCompany } from '../jobs/job-dedup.util';
import { defaultSearchName, normalizeSearchCriteria, searchFingerprint } from './search-criteria';

type Kind = 'imported' | 'native';

function parseRef(ref: string): { kind: Kind; id: string } {
  const m = /^(imported|native):([A-Za-z0-9_-]{1,64})$/.exec(ref || '');
  if (!m) throw new BadRequestException('Vakansiya istinadı yanlışdır');
  return { kind: m[1] as Kind, id: m[2] };
}

const LIMIT_MESSAGE = 'Planınızın limiti dolub. Köhnə qeydlərdən birini silin.';

/**
 * Owner-scoped saved jobs, saved searches and company follows. Every query carries the caller's userId; a foreign id behaves exactly like a
 * missing one (404). Limits come from the entitlement spec (ProductService), checked under a per-user advisory lock so concurrent requests
 * cannot overshoot.
 */
@Injectable()
export class SavedService {
  constructor(private prisma: PrismaService, private products: ProductService) {}

  private async limitFor(userId: string, feature: string): Promise<number | null> {
    const grant = await this.products.grantForUser(userId, feature);
    if (!grant?.enabled) throw new BadRequestException('Bu imkan planınıza daxil deyil');
    return grant.limit ?? null;
  }

  // ── saved jobs ───────────────────────────────────────────────────────────────────────────────────────
  async listJobs(userId: string) {
    const rows = await this.prisma.savedJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { job: true, vacancy: { include: { company: true } } },
    });
    const now = Date.now();
    return rows.map((r) => {
      if (r.job) {
        const closed = r.job.status !== 'ACTIVE' || !!r.job.hiddenAt || !!r.job.duplicateOfId;
        const expired = !!r.job.deadline && r.job.deadline.getTime() < now;
        return { id: r.id, ref: `imported:${r.job.id}`, kind: 'imported' as const, title: r.job.title, company: r.job.company, location: r.job.location || null, postedAt: r.job.postedAt, deadline: r.job.deadline, state: closed ? 'closed' : expired ? 'expired' : 'open', savedAt: r.createdAt };
      }
      const v = r.vacancy!;
      const closed = v.status !== 'ACTIVE' || v.company.status !== 'APPROVED';
      const expired = (!!v.deadline && v.deadline.getTime() < now) || (!!v.expiresAt && v.expiresAt.getTime() <= now);
      return { id: r.id, ref: `native:${v.id}`, kind: 'native' as const, title: v.title, company: v.company.name, location: v.location || null, postedAt: v.createdAt, deadline: v.deadline, state: closed ? 'closed' : expired ? 'expired' : 'open', savedAt: r.createdAt };
    });
  }

  async saveJob(userId: string, ref: string) {
    const { kind, id } = parseRef(ref);
    let target: { jobId?: string; vacancyId?: string };
    if (kind === 'imported') {
      const job = await this.prisma.job.findUnique({ where: { id } });
      // A posting the public catalogue would not show cannot be saved; a duplicate is saved as its canonical original.
      if (!job || job.status !== 'ACTIVE' || job.hiddenAt) throw new NotFoundException('Vakansiya tapılmadı');
      target = { jobId: job.duplicateOfId ?? job.id };
    } else {
      const vacancy = await this.prisma.vacancy.findUnique({ where: { id }, include: { company: true } });
      if (!vacancy || vacancy.status !== 'ACTIVE' || vacancy.company.status !== 'APPROVED' || (vacancy.expiresAt && vacancy.expiresAt <= new Date())) throw new NotFoundException('Vakansiya tapılmadı');
      target = { vacancyId: vacancy.id };
    }
    const limit = await this.limitFor(userId, 'saved.jobs');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`saved-jobs:${userId}`}))`;
      const existing = await tx.savedJob.findFirst({ where: { userId, ...target } });
      if (existing) return { id: existing.id, created: false };
      if (limit !== null && (await tx.savedJob.count({ where: { userId } })) >= limit) throw new ConflictException(LIMIT_MESSAGE);
      const row = await tx.savedJob.create({ data: { userId, ...target } });
      return { id: row.id, created: true };
    });
  }

  async unsaveJob(userId: string, ref: string) {
    const { kind, id } = parseRef(ref);
    const where = kind === 'imported' ? { userId, jobId: id } : { userId, vacancyId: id };
    const r = await this.prisma.savedJob.deleteMany({ where });
    return { removed: r.count > 0 };
  }

  // ── saved searches ───────────────────────────────────────────────────────────────────────────────────
  listSearches(userId: string) {
    return this.prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, criteria: true, alertsEnabled: true, createdAt: true, updatedAt: true } });
  }

  async createSearch(userId: string, body: { name?: unknown; criteria?: unknown; alertsEnabled?: unknown }) {
    const criteria = normalizeSearchCriteria(body?.criteria);
    const name = body?.name === undefined || body.name === '' ? defaultSearchName(criteria) : this.cleanName(body.name);
    const fingerprint = searchFingerprint(criteria);
    const limit = await this.limitFor(userId, 'saved.searches');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`saved-searches:${userId}`}))`;
      const existing = await tx.savedSearch.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
      if (existing) return { id: existing.id, created: false };
      if (limit !== null && (await tx.savedSearch.count({ where: { userId } })) >= limit) throw new ConflictException(LIMIT_MESSAGE);
      const row = await tx.savedSearch.create({ data: { userId, name, criteria: criteria as object, fingerprint, alertsEnabled: body?.alertsEnabled === false ? false : true } });
      return { id: row.id, created: true };
    });
  }

  async updateSearch(userId: string, id: string, body: { name?: unknown; alertsEnabled?: unknown }) {
    const data: { name?: string; alertsEnabled?: boolean } = {};
    if (body?.name !== undefined) data.name = this.cleanName(body.name);
    if (body?.alertsEnabled !== undefined) {
      if (typeof body.alertsEnabled !== 'boolean') throw new BadRequestException('Bildiriş seçimi yanlışdır');
      data.alertsEnabled = body.alertsEnabled;
    }
    const r = await this.prisma.savedSearch.updateMany({ where: { id, userId }, data });
    if (!r.count) throw new NotFoundException('Axtarış tapılmadı');
    return { id, ...data };
  }

  async deleteSearch(userId: string, id: string) {
    const r = await this.prisma.savedSearch.deleteMany({ where: { id, userId } });
    return { removed: r.count > 0 };
  }

  private cleanName(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException('Ad yanlışdır');
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80) throw new BadRequestException('Ad 1-80 simvol olmalıdır');
    return name;
  }

  // ── company follows ──────────────────────────────────────────────────────────────────────────────────
  listFollows(userId: string) {
    return this.prisma.companyFollow.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, companyKey: true, displayName: true, companyId: true, createdAt: true } });
  }

  async follow(userId: string, body: { company?: unknown; ref?: unknown; companyId?: unknown }) {
    let displayName = '';
    let companyId: string | null = null;
    if (typeof body?.companyId === 'string') {
      // A registered employer has a stable id; it is followed by that id and never merged with another employer by name.
      const company = await this.prisma.company.findFirst({ where: { id: body.companyId, status: 'APPROVED' }, select: { id: true, name: true } });
      if (!company) throw new NotFoundException('Şirkət tapılmadı');
      displayName = company.name; companyId = company.id;
    } else if (typeof body?.ref === 'string') {
      const { kind, id } = parseRef(body.ref);
      if (kind === 'imported') {
        const job = await this.prisma.job.findUnique({ where: { id }, select: { company: true, status: true, hiddenAt: true } });
        if (!job || job.status !== 'ACTIVE' || job.hiddenAt) throw new NotFoundException('Vakansiya tapılmadı');
        displayName = job.company;
      } else {
        const v = await this.prisma.vacancy.findUnique({ where: { id }, include: { company: true } });
        if (!v || v.status !== 'ACTIVE' || v.company.status !== 'APPROVED') throw new NotFoundException('Vakansiya tapılmadı');
        displayName = v.company.name;
        companyId = v.company.id;
      }
    } else if (typeof body?.company === 'string') {
      displayName = body.company.replace(/\s+/g, ' ').trim();
    }
    // Imported postings have no company id: their identity is the canonical normalised name. Registered employers: their id.
    const companyKey = companyId ? `company:${companyId}` : normalizeCompany(displayName);
    if (!displayName || displayName.length > 120 || !companyKey) throw new BadRequestException('Şirkət adı yanlışdır');
    const limit = await this.limitFor(userId, 'follows.companies');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`follows:${userId}`}))`;
      const existing = await tx.companyFollow.findUnique({ where: { userId_companyKey: { userId, companyKey } } });
      if (existing) return { id: existing.id, companyKey, displayName: existing.displayName, companyId: existing.companyId, created: false };
      if (limit !== null && (await tx.companyFollow.count({ where: { userId } })) >= limit) throw new ConflictException(LIMIT_MESSAGE);
      const row = await tx.companyFollow.create({ data: { userId, companyKey, displayName, companyId } });
      return { id: row.id, companyKey, displayName, companyId, created: true };
    });
  }

  async unfollow(userId: string, id: string) {
    const r = await this.prisma.companyFollow.deleteMany({ where: { id, userId } });
    return { removed: r.count > 0 };
  }
}
