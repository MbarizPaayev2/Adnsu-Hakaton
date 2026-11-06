import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmployerPlansService } from '../employer-plans/employer-plans.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { AccountDeletionService } from '../accounts/account-deletion.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { FOUNDER_EMAIL } from './permissions';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private postHogService: PostHogService,
    private accountDeletion: AccountDeletionService,
    private employerPlans: EmployerPlansService,
    private storage: LocalStorageService,
  ) {}

  private readonly logger = new Logger(AdminService.name);

  async listCompanies(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    
    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where: status ? { status: status as any } : {},
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { business: { select: { email: true } } },
      }),
      this.prisma.company.count({
        where: status ? { status: status as any } : {}
      })
    ]);

    return {
      data: items.map(({ business, ...company }) => ({ ...company, email: business.email })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { business: true }
    });

    if (!company) throw new NotFoundException('Şirkət tapılmadı');

    // Same hash-stripping as getUser() below — `business` carries
    // hashedPassword and nothing else on this path removes it before the
    // response goes out.
    const { business, ...rest } = company;
    const { hashedPassword: _hashedPassword, ...safeBusiness } = business;
    return { ...rest, business: safeBusiness };
  }

  async approveCompany(id: string, adminUserId: string) {
    const company = await this.prisma.company.update({
      where: { id },
      data: { status: 'APPROVED', rejectionReason: null }
    }).catch((error) => {
      if (error?.code === 'P2025') throw new NotFoundException('Şirkət tapılmadı');
      throw error;
    });

    await this.recordAudit(adminUserId, 'COMPANY_APPROVED', 'Company', id);
    this.postHogService.capture(adminUserId, 'company_approved', { companyId: id });
    return company;
  }

  async rejectCompany(id: string, reason: string, adminUserId: string) {
    const company = await this.prisma.company.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason }
    }).catch((error) => {
      if (error?.code === 'P2025') throw new NotFoundException('Şirkət tapılmadı');
      throw error;
    });

    await this.recordAudit(adminUserId, 'COMPANY_REJECTED', 'Company', id, { reason });
    this.postHogService.capture(adminUserId, 'company_rejected', { companyId: id, reason });
    return company;
  }

  private async recordAudit(adminUserId: string, action: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
    await this.prisma.adminAuditLog.create({
      data: { adminUserId, action, targetType, targetId, metadata: metadata as any },
    });
  }

  async listUsers(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          createdAt: true,
          suspendedAt: true,
          suspendedReason: true,
          subscription: { select: { plan: true, status: true } },
          planOverrides: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { plan: true, expiresAt: true }, take: 1, orderBy: { createdAt: 'desc' } },
          _count: { select: { resumes: true, matches: true, applications: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUser(id: string, viewerRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' = 'SUPPORT', viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        subscription: true,
        profile: { include: { experiences: true, education: true } },
        _count: { select: { resumes: true, matches: true, applications: true, externalApplications: true } },
      },
    });
    if (!user) throw new NotFoundException('İstifadəçi tapılmadı');
    // Opening a candidate's full record is sensitive-record access: audited.
    if (viewerId) await this.recordAudit(viewerId, 'USER_RECORD_VIEWED', 'User', id);

    const { hashedPassword: _hashedPassword, ...safeUser } = user;
    // Read-only support staff do not get identity-document references.
    if (viewerRole === 'SUPPORT' && safeUser.profile) {
      return { ...safeUser, profile: { ...safeUser.profile, idDocumentUrl: safeUser.profile.idDocumentUrl ? '(hidden)' : null } };
    }
    return safeUser;
  }


  // One deletion path for self-service and operators: billing is stopped
  // first, the rows go before the files, and the audit entry survives.
  async deleteUser(id: string, adminUserId: string) {
    // The founder's own address (and any operator's) is never removed by accident through the candidate-account path.
    const target = await this.prisma.user.findUnique({ where: { id }, select: { email: true } });
    if (target) {
      const isOperator = await this.prisma.adminUser.findFirst({ where: { email: { equals: target.email, mode: 'insensitive' }, disabledAt: null }, select: { id: true } });
      if (target.email.toLowerCase() === FOUNDER_EMAIL || isOperator) {
        throw new ConflictException('Bu e-poçt aktiv operatora və ya təsisçiyə məxsusdur və buradan silinə bilməz. Əvvəlcə operatoru "Operatorlar" bölməsindən çıxarın.');
      }
    }
    return this.accountDeletion.deleteUser(id, { kind: 'admin', adminUserId });
  }

  /**
   * Deletes an employer account: stops its Business subscription at the provider first (nothing is deleted when that cannot be confirmed), then removes the
   * business, company profile, vacancies, their applications and the logo; the audit entry survives. Candidates' own accounts are untouched.
   */
  async deleteCompany(id: string, adminUserId: string, reason?: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, logo: true, businessId: true, business: { select: { email: true } }, _count: { select: { vacancies: true } } },
    });
    if (!company) throw new NotFoundException('Şirkət tapılmadı');
    const operator = await this.prisma.adminUser.findFirst({ where: { email: { equals: company.business.email, mode: 'insensitive' } }, select: { id: true } });
    if (operator || company.business.email.toLowerCase() === FOUNDER_EMAIL) throw new ConflictException('Bu hesab operatora və ya təsisçiyə məxsusdur və silinə bilməz.');

    await this.employerPlans.cancelBusinessForDeletion(company.id);
    const apps = await this.prisma.application.findMany({
      where: { vacancy: { companyId: company.id } },
      select: { files: { select: { fileUrl: true } }, answers: { select: { fileUrl: true } } },
    });
    const applications = apps.length;
    const fileUrls = [...new Set(apps.flatMap((a) => [...a.files.map((f) => f.fileUrl), ...a.answers.map((f) => f.fileUrl)]).filter((u): u is string => !!u))];
    await this.prisma.$transaction(async (tx) => {
      // An answer restricts deleting its question, so answers go first (the rest cascades from the business).
      await tx.applicationAnswer.deleteMany({ where: { question: { vacancy: { companyId: company.id } } } });
      await tx.business.delete({ where: { id: company.businessId } });
      await tx.adminAuditLog.create({
        data: { adminUserId, action: 'COMPANY_DELETED', targetType: 'Company', targetId: company.id, metadata: { name: company.name, vacancies: company._count.vacancies, applications, reason } },
      });
    });
    await Promise.all(fileUrls.map((url) => this.storage.deleteFile(url).catch(() => undefined)));
    if (company.logo) await this.storage.deleteFile(company.logo).catch(() => this.logger.warn(`Company ${company.id} deleted; its logo file could not be removed`));
    try { this.postHogService.capture(adminUserId, 'company_deleted', { vacancies: company._count.vacancies }); } catch { /* analytics is best effort */ }
    return { deleted: true, vacancies: company._count.vacancies, applications };
  }

  /** Takes an employer vacancy off the platform. Soft: the row and its applications stay (the employer keeps its inbox); candidates stop seeing it. */
  async removeVacancy(id: string, reason: string, adminUserId: string) {
    const v = await this.prisma.vacancy.findUnique({ where: { id }, select: { id: true, status: true, title: true, companyId: true } });
    if (!v) throw new NotFoundException('Vakansiya tapılmadı');
    if (v.status === 'DELETED') throw new ConflictException('Vakansiya artıq silinib');
    await this.prisma.$transaction([
      this.prisma.vacancy.update({ where: { id }, data: { status: 'DELETED' } }),
      this.prisma.adminAuditLog.create({ data: { adminUserId, action: 'VACANCY_REMOVED', targetType: 'Vacancy', targetId: id, metadata: { previousStatus: v.status, reason: reason.trim().slice(0, 300), title: v.title } } }),
    ]);
    return { removed: true };
  }

  /** The employer-plan moderation queue: vacancies that employers submitted and nobody has decided yet (oldest first). */
  async listPendingEmployerVacancies() {
    const rows = await this.prisma.vacancy.findMany({
      where: { status: 'PENDING_REVIEW' },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      select: { id: true, title: true, description: true, requirements: true, responsibilities: true, location: true, deadline: true, submittedAt: true, company: { select: { id: true, name: true, status: true, website: true } } },
    });
    // The same automatic checks that would block auto-approval, shown to the reviewer so they know where to look (a person still decides).
    return Promise.all(rows.map(async (r) => ({ ...r, checks: await this.employerPlans.automaticChecks(r.id) })));
  }

  async listEmployerPurchases(status?: string) {
    return this.employerPlans.listPurchases(status && /^[A-Z_]{3,20}$/.test(status) ? status : undefined);
  }

  /** A refund moves money: the operator, the purchase and the reason are written to the audit log whatever the outcome. */
  async refundEmployerPurchase(id: string, reason: string, endListing: boolean, adminUserId: string) {
    try {
      const result = await this.employerPlans.refund(id, { reason, adminUserId, endListing });
      await this.recordAudit(adminUserId, 'EMPLOYER_PURCHASE_REFUND_REQUESTED', 'EmployerPurchase', id, { reason, endListing });
      return result;
    } catch (e) {
      await this.recordAudit(adminUserId, 'EMPLOYER_PURCHASE_REFUND_REFUSED', 'EmployerPurchase', id, { reason, endListing }).catch(() => undefined);
      throw e;
    }
  }

  async moderateEmployerVacancy(id: string, decision: 'APPROVE' | 'REJECT', note: string, adminUserId: string) {
    const v = await this.employerPlans.moderate(id, decision, note);
    await this.recordAudit(adminUserId, decision === 'APPROVE' ? 'VACANCY_APPROVED' : 'VACANCY_REJECTED', 'Vacancy', id);
    return v;
  }

  async listVacancies() {
    return this.prisma.vacancy.findMany({
      include: { company: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async listAuditLog(limit = 50) {
    return this.prisma.adminAuditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { id: true, email: true, name: true } } },
    });
  }
}
