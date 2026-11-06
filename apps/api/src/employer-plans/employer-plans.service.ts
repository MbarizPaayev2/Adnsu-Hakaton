import { TERMINAL_STATUSES } from '../billing/entitlement';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import DodoPayments from 'dodopayments';
import { PrismaService } from '../database/database.service';
import { CHECKOUT_PRESENTATION } from '../billing/checkout-presentation';
import { FAILED_JOB_RETENTION } from '../common/queue-retention';
import { EMPLOYER_PLANS, EMPLOYER_RENEWAL_GRACE_MS, companyDomainKey, companyNameKey, loadEmployerPlansConfig, type EmployerPlansConfig } from './employer-plans.config';

const DAY = 86_400_000;

/** What publishing a vacancy would spend right now (or why it cannot publish). */
export type PublishRoute =
  | { route: 'BUSINESS'; expiresAt: Date }
  | { route: 'CREDIT'; expiresAt: Date }
  | { route: 'TRIAL'; expiresAt: Date }
  | { route: 'NONE'; reason: 'COMPANY_NOT_APPROVED' | 'NO_ENTITLEMENT' };

export interface EmployerOverview {
  gated: boolean;
  checkoutAvailable: boolean;
  prices: { singleAzn: number; singleDays: number; businessAznPerMonth: number; trialDays: number };
  trial: { available: boolean; used: boolean; startedAt: string | null; endsAt: string | null };
  credits: { available: number };
  business: { active: boolean; status: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
  /** What the next publication would use, from the server's point of view. */
  nextPublication: 'BUSINESS' | 'CREDIT' | 'TRIAL' | 'NONE';
}

@Injectable()
export class EmployerPlansService {
  private readonly log = new Logger(EmployerPlansService.name);
  private readonly cfg: EmployerPlansConfig = loadEmployerPlansConfig();
  private dodo: DodoPayments;
  private isMock: boolean;

  constructor(
    private prisma: PrismaService,
    @Optional() @InjectQueue('job-ingested') private jobQueue?: Queue,
    @Optional() @InjectQueue('new-job-alert') private alertQueue?: Queue,
  ) {
    const apiKey = process.env.DODO_PAYMENTS_API_KEY || 'mock_dodo_api_key_aise';
    this.isMock = apiKey.includes('mock');
    this.dodo = new DodoPayments({ bearerToken: apiKey, environment: process.env.DODO_ENV === 'live_mode' ? 'live_mode' : 'test_mode' });
  }

  get gated() { return this.cfg.gated; }

  // ───────────────────────────────────────────────────────────────── state
  private businessActive(sub: { status: string; currentPeriodEnd: Date | null } | null | undefined, now: Date) {
    if (!sub || sub.status !== 'active') return false;
    return !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() + EMPLOYER_RENEWAL_GRACE_MS >= now.getTime();
  }

  async overview(companyId: string, now = new Date()): Promise<EmployerOverview> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { employerTrial: true, employerSubscription: true } });
    if (!company) throw new NotFoundException('Şirkət tapılmadı');
    const credits = await this.prisma.employerCredit.count({ where: { companyId, status: 'AVAILABLE' } });
    const active = this.businessActive(company.employerSubscription, now);
    const trialKeyTaken = !company.employerTrial && (await this.trialKeyTaken(company.name, company.website, companyId));
    const trialAvailable = !company.employerTrial && !trialKeyTaken;
    const checkoutAvailable = this.cfg.gated && this.cfg.checkoutEnabled && !!(this.cfg.singleProductId || this.cfg.businessProductId);
    return {
      gated: this.cfg.gated,
      checkoutAvailable,
      prices: { singleAzn: EMPLOYER_PLANS.single.priceAzn, singleDays: EMPLOYER_PLANS.single.days, businessAznPerMonth: EMPLOYER_PLANS.business.priceAznPerMonth, trialDays: EMPLOYER_PLANS.trial.days },
      trial: { available: trialAvailable, used: !trialAvailable, startedAt: company.employerTrial?.startedAt.toISOString() ?? null, endsAt: company.employerTrial?.endsAt.toISOString() ?? null },
      credits: { available: credits },
      business: { active, status: company.employerSubscription?.status ?? null, currentPeriodEnd: company.employerSubscription?.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: !!company.employerSubscription?.cancelAtPeriodEnd },
      nextPublication: active ? 'BUSINESS' : credits > 0 ? 'CREDIT' : trialAvailable ? 'TRIAL' : 'NONE',
    };
  }

  private async trialKeyTaken(name: string, website: string | null, exceptCompanyId: string) {
    const nameKey = companyNameKey(name); const domainKey = companyDomainKey(website);
    const clash = await this.prisma.employerTrial.findFirst({ where: { companyId: { not: exceptCompanyId }, OR: [{ nameKey }, ...(domainKey ? [{ domainKey }] : [])] }, select: { id: true } });
    return !!clash;
  }

  // ───────────────────────────────────────────────────────── moderation
  /** Checks that need no human: a vacancy that fails them can never be auto-approved (a person still decides). */
  async automaticChecks(vacancyId: string): Promise<string[]> {
    const v = await this.prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!v) return ['NOT_FOUND'];
    const problems: string[] = [];
    const text = `${v.title}\n${v.description ?? ''}\n${v.requirements ?? ''}\n${v.responsibilities ?? ''}`;
    if (text.replace(/\s+/g, ' ').trim().length < 60) problems.push('TOO_SHORT');
    if ((text.match(/https?:\/\//gi) ?? []).length > 3) problems.push('TOO_MANY_LINKS');
    if (/\b(pul\s*qazan|tez\s*zəngin|investisiya\s*qoy|kripto|piramid|referral\s*link|whatsapp\s*qrupu)\b/i.test(text)) problems.push('SPAM_TERMS');
    const dup = await this.prisma.vacancy.count({
      where: { companyId: v.companyId, id: { not: v.id }, title: { equals: v.title, mode: 'insensitive' }, status: { in: ['ACTIVE', 'PENDING_REVIEW', 'APPROVED'] }, createdAt: { gt: new Date(Date.now() - 30 * DAY) } },
    });
    if (dup) problems.push('DUPLICATE_OF_OPEN_LISTING');
    return problems;
  }

  async submitForReview(companyId: string, vacancyId: string, now = new Date()) {
    const v = await this.ownVacancy(companyId, vacancyId);
    if (!['DRAFT', 'REJECTED'].includes(v.status)) throw new ConflictException('Yalnız qaralama və ya rədd edilmiş vakansiya yoxlamaya göndərilə bilər');
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (company?.status !== 'APPROVED') throw new ForbiddenException('Şirkət təsdiqlənməyib');
    const updated = await this.prisma.vacancy.update({ where: { id: v.id }, data: { status: 'PENDING_REVIEW', submittedAt: now, moderationNote: null } });
    if (this.cfg.autoApprove && !(await this.automaticChecks(v.id)).length) return this.moderate(v.id, 'APPROVE', 'automatic', now);
    return updated;
  }

  /** Operator decision (or the automatic approval above). A paid entitlement is never consumed by this step. */
  async moderate(vacancyId: string, decision: 'APPROVE' | 'REJECT', note: string, now = new Date()) {
    const v = await this.prisma.vacancy.findUnique({ where: { id: vacancyId } });
    if (!v) throw new NotFoundException('Vakansiya tapılmadı');
    if (decision === 'APPROVE') {
      if (v.status !== 'PENDING_REVIEW') throw new ConflictException('Vakansiya yoxlama gözləmir');
      return this.prisma.vacancy.update({ where: { id: v.id }, data: { status: 'APPROVED', moderatedAt: now, moderationNote: note || null } });
    }
    if (!['PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED'].includes(v.status)) throw new ConflictException('Bu vakansiya rədd edilə bilməz');
    return this.prisma.vacancy.update({ where: { id: v.id }, data: { status: 'REJECTED', moderatedAt: now, moderationNote: note || null } });
  }

  // ───────────────────────────────────────────────────────── publication
  private async ownVacancy(companyId: string, vacancyId: string) {
    const v = await this.prisma.vacancy.findFirst({ where: { id: vacancyId, companyId } });
    if (!v) throw new NotFoundException('Vakansiya tapılmadı');
    return v;
  }

  private durationEnd(now: Date, days: number, deadline: Date | null) {
    const end = new Date(now.getTime() + days * DAY);
    return deadline && deadline < end ? deadline : end;
  }

  /**
   * Publishes an approved vacancy under the company's entitlement: an active Business subscription, else an available paid credit, else the one-time trial.
   * One transaction holds a lock on the company row, so two concurrent requests cannot spend the same credit or start two trials.
   */
  async publish(companyId: string, vacancyId: string, now = new Date()) {
    if (!this.cfg.gated) throw new ServiceUnavailableException('Vakansiya planları hələ aktiv deyil');
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select id from "Company" where id = ${companyId} for update`;
      const company = await tx.company.findUnique({ where: { id: companyId }, include: { employerSubscription: true, employerTrial: true } });
      if (!company) throw new NotFoundException('Şirkət tapılmadı');
      if (company.status !== 'APPROVED') throw new ForbiddenException('Şirkət təsdiqlənməyib və ya dayandırılıb');
      const v = await tx.vacancy.findFirst({ where: { id: vacancyId, companyId } });
      if (!v) throw new NotFoundException('Vakansiya tapılmadı');
      if (v.status === 'ACTIVE' && v.expiresAt && v.expiresAt > now) return { vacancy: v, fresh: false };
      if (!['APPROVED', 'EXPIRED'].includes(v.status)) throw new ConflictException('Vakansiya yayımlanmağa hazır deyil: əvvəlcə yoxlamadan keçməlidir');
      if (v.status === 'EXPIRED' && !v.moderatedAt) throw new ConflictException('Vakansiya yoxlamadan keçməyib');
      if (v.deadline && v.deadline <= now) throw new ConflictException('Vakansiyanın son tarixi keçib');

      let plan: 'BUSINESS' | 'SINGLE' | 'TRIAL';
      let expiresAt: Date;
      if (this.businessActive(company.employerSubscription, now)) {
        plan = 'BUSINESS';
        expiresAt = this.durationEnd(now, EMPLOYER_PLANS.business.reconfirmDays, v.deadline);
        const periodEnd = company.employerSubscription?.currentPeriodEnd;
        if (periodEnd && periodEnd < expiresAt) expiresAt = periodEnd;
      } else {
        const credit = await tx.employerCredit.findFirst({ where: { companyId, status: 'AVAILABLE' }, orderBy: { createdAt: 'asc' } });
        if (credit) {
          const won = await tx.employerCredit.updateMany({ where: { id: credit.id, status: 'AVAILABLE' }, data: { status: 'CONSUMED', consumedVacancyId: v.id, consumedAt: now } });
          if (won.count !== 1) throw new ConflictException('Kredit artıq istifadə edilib, yenidən cəhd edin');
          plan = 'SINGLE';
          expiresAt = this.durationEnd(now, EMPLOYER_PLANS.single.days, v.deadline);
        } else if (!company.employerTrial && !(await this.trialKeyTakenTx(tx, company.name, company.website, companyId))) {
          try {
            await tx.employerTrial.create({
              data: { companyId, vacancyId: v.id, nameKey: companyNameKey(company.name), domainKey: companyDomainKey(company.website), startedAt: now, endsAt: new Date(now.getTime() + EMPLOYER_PLANS.trial.days * DAY) },
            });
          } catch (e: any) {
            if (e?.code === 'P2002') throw new ForbiddenException('Bu şirkət üçün ödənişsiz sınaq artıq istifadə olunub');
            throw e;
          }
          plan = 'TRIAL';
          expiresAt = this.durationEnd(now, EMPLOYER_PLANS.trial.days, v.deadline);
        } else {
          throw new ForbiddenException({ code: 'ENTITLEMENT_REQUIRED', message: 'Yayımlamaq üçün Tək vakansiya ödənişi və ya Biznes abunəliyi lazımdır' });
        }
      }
      const vacancy = await tx.vacancy.update({ where: { id: v.id }, data: { status: 'ACTIVE', publishedAt: now, expiresAt, publicationPlan: plan, expiryReason: null, reconfirmedAt: null } });
      return { vacancy, fresh: true };
    });
    if (published.fresh) await this.announce(published.vacancy.id, now);
    return published.vacancy;
  }

  private async trialKeyTakenTx(tx: Prisma.TransactionClient, name: string, website: string | null, exceptCompanyId: string) {
    const nameKey = companyNameKey(name); const domainKey = companyDomainKey(website);
    const clash = await tx.employerTrial.findFirst({ where: { companyId: { not: exceptCompanyId }, OR: [{ nameKey }, ...(domainKey ? [{ domainKey }] : [])] }, select: { id: true } });
    return !!clash;
  }

  /** Another 30 days for a listing, only by explicitly spending a paid credit. Business listings are reconfirmed instead. */
  async extend(companyId: string, vacancyId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select id from "Company" where id = ${companyId} for update`;
      const v = await tx.vacancy.findFirst({ where: { id: vacancyId, companyId } });
      if (!v) throw new NotFoundException('Vakansiya tapılmadı');
      if (!['ACTIVE', 'EXPIRED'].includes(v.status) || !v.publishedAt) throw new ConflictException('Yalnız yayımlanmış vakansiya uzadıla bilər');
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (company?.status !== 'APPROVED') throw new ForbiddenException('Şirkət təsdiqlənməyib və ya dayandırılıb');
      if (v.deadline && v.deadline <= now) throw new ConflictException('Vakansiyanın son tarixi keçib');
      const credit = await tx.employerCredit.findFirst({ where: { companyId, status: 'AVAILABLE' }, orderBy: { createdAt: 'asc' } });
      if (!credit) throw new ForbiddenException({ code: 'ENTITLEMENT_REQUIRED', message: 'Uzatmaq üçün əlavə 30 günlük ödəniş lazımdır' });
      const base = v.status === 'ACTIVE' && v.expiresAt && v.expiresAt > now ? v.expiresAt : now;
      const end = this.durationEnd(base, EMPLOYER_PLANS.single.days, v.deadline);
      // A deadline that is sooner than the current end leaves nothing to buy: refuse before spending anything.
      if (v.status === 'ACTIVE' && v.expiresAt && end <= v.expiresAt) throw new ConflictException('Vakansiyanın son tarixi mövcud müddətdən əvvəldir, uzatmağa ehtiyac yoxdur');
      const won = await tx.employerCredit.updateMany({ where: { id: credit.id, status: 'AVAILABLE' }, data: { status: 'CONSUMED', consumedVacancyId: v.id, consumedAt: now } });
      if (won.count !== 1) throw new ConflictException('Kredit artıq istifadə edilib, yenidən cəhd edin');
      return tx.vacancy.update({ where: { id: v.id }, data: { status: 'ACTIVE', expiresAt: end, publicationPlan: 'SINGLE', expiryReason: null } });
    });
  }

  /** Business listings carry no hidden count cap; they must be reconfirmed, so a forgotten posting does not stay up forever. */
  async reconfirm(companyId: string, vacancyId: string, now = new Date()) {
    const v = await this.ownVacancy(companyId, vacancyId);
    if (v.publicationPlan !== 'BUSINESS' || v.status !== 'ACTIVE') throw new ConflictException('Yalnız aktiv Biznes elanı təsdiqlənə bilər');
    const sub = await this.prisma.employerSubscription.findUnique({ where: { companyId } });
    if (!this.businessActive(sub, now)) throw new ForbiddenException('Biznes abunəliyi aktiv deyil');
    let expiresAt = this.durationEnd(now, EMPLOYER_PLANS.business.reconfirmDays, v.deadline);
    if (sub?.currentPeriodEnd && sub.currentPeriodEnd < expiresAt) expiresAt = sub.currentPeriodEnd;
    return this.prisma.vacancy.update({ where: { id: v.id }, data: { expiresAt, reconfirmedAt: now } });
  }

  private async announce(vacancyId: string, now: Date) {
    await this.jobQueue?.add('process-match', { vacancyId }, { removeOnComplete: true, removeOnFail: FAILED_JOB_RETENTION }).catch((e) => this.log.error(`matching enqueue failed for ${vacancyId}`, e));
    await this.alertQueue?.add('fan-out', { vacancyId }, { jobId: `alert-vacancy-${vacancyId}-${now.getTime()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86_400, count: 1000 }, removeOnFail: FAILED_JOB_RETENTION }).catch((e) => this.log.error(`alert enqueue failed for ${vacancyId}`, e));
  }

  // ───────────────────────────────────────────────────────── sweeper
  /**
   * Expires what has run out, and re-opens listings that lapsed only because the subscription did, once it is active again. Idempotent; safe to run often.
   * Applications, answers and the employer's data are never touched.
   */
  async sweep(now = new Date()) {
    const out = { expired: 0, lapsed: 0, restored: 0 };
    const due = await this.prisma.vacancy.findMany({ where: { status: 'ACTIVE', expiresAt: { not: null, lte: now } }, select: { id: true, publicationPlan: true, deadline: true } });
    for (const v of due) {
      const reason = v.deadline && v.deadline <= now ? 'DEADLINE' : v.publicationPlan === 'TRIAL' ? 'TRIAL_ENDED' : 'DURATION';
      const r = await this.prisma.vacancy.updateMany({ where: { id: v.id, status: 'ACTIVE' }, data: { status: 'EXPIRED', expiryReason: reason } });
      out.expired += r.count;
    }
    // Business listings of a company whose subscription is no longer in force.
    const lapsed = await this.prisma.vacancy.findMany({ where: { status: 'ACTIVE', publicationPlan: 'BUSINESS' }, select: { id: true, companyId: true } });
    if (lapsed.length) {
      const subs = await this.prisma.employerSubscription.findMany({ where: { companyId: { in: [...new Set(lapsed.map((l) => l.companyId))] } } });
      const byCompany = new Map(subs.map((s) => [s.companyId, s]));
      for (const l of lapsed) {
        if (this.businessActive(byCompany.get(l.companyId), now)) continue;
        const r = await this.prisma.vacancy.updateMany({ where: { id: l.id, status: 'ACTIVE', publicationPlan: 'BUSINESS' }, data: { status: 'EXPIRED', expiryReason: 'SUBSCRIPTION_LAPSED', expiresAt: now } });
        out.lapsed += r.count;
      }
    }
    // Reactivated subscriptions bring back what lapsed because of them, within the listing's own deadline.
    const reopenable = await this.prisma.vacancy.findMany({ where: { status: 'EXPIRED', expiryReason: 'SUBSCRIPTION_LAPSED', OR: [{ deadline: null }, { deadline: { gt: now } }] }, select: { id: true, companyId: true, deadline: true } });
    if (reopenable.length) {
      const subs = await this.prisma.employerSubscription.findMany({ where: { companyId: { in: [...new Set(reopenable.map((l) => l.companyId))] } }, include: { company: { select: { status: true } } } });
      const byCompany = new Map(subs.map((s) => [s.companyId, s]));
      for (const l of reopenable) {
        const s = byCompany.get(l.companyId);
        if (!s || s.company.status !== 'APPROVED' || !this.businessActive(s, now)) continue;
        let expiresAt = this.durationEnd(now, EMPLOYER_PLANS.business.reconfirmDays, l.deadline);
        if (s.currentPeriodEnd && s.currentPeriodEnd < expiresAt) expiresAt = s.currentPeriodEnd;
        const r = await this.prisma.vacancy.updateMany({ where: { id: l.id, status: 'EXPIRED', expiryReason: 'SUBSCRIPTION_LAPSED' }, data: { status: 'ACTIVE', expiresAt, expiryReason: null } });
        out.restored += r.count;
      }
    }
    return out;
  }

  // ───────────────────────────────────────────────────────── checkout
  private checkoutReady() {
    if (!this.cfg.gated || !this.cfg.checkoutEnabled) throw new ServiceUnavailableException('Ödəniş hələ aktiv deyil');
    if (process.env.PAYMENTS_ENABLED !== 'true' && !this.isMock) throw new ServiceUnavailableException('Ödənişlər hazırda aktiv deyil');
  }

  /** Starts (or returns) the checkout for ONE 30-day listing. Repeating the request with the same key returns the same purchase and never a second one. */
  async startSingleCheckout(business: { id: string; email: string; name?: string | null; company: { id: string; status: string } }, idempotencyKey: string, targetVacancyId?: string) {
    this.checkoutReady();
    if (!this.cfg.singleProductId && !this.isMock) throw new ServiceUnavailableException('Bu təklif hələ satışda deyil');
    if (business.company.status !== 'APPROVED') throw new ForbiddenException('Şirkət təsdiqlənməyib və ya dayandırılıb');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) throw new BadRequestException('Sorğu açarı yanlışdır');
    if (targetVacancyId) await this.ownVacancy(business.company.id, targetVacancyId);
    const key = `single:${business.company.id}:${idempotencyKey}`;
    let purchase = await this.prisma.employerPurchase.findUnique({ where: { idempotencyKey: key } });
    if (!purchase) {
      try {
        purchase = await this.prisma.employerPurchase.create({
          data: { companyId: business.company.id, kind: 'SINGLE_30D', status: 'PENDING', amountMinor: EMPLOYER_PLANS.single.priceAzn * 100, currency: 'AZN', idempotencyKey: key, purchasedByBusiness: business.id, targetVacancyId: targetVacancyId ?? null },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        purchase = await this.prisma.employerPurchase.findUniqueOrThrow({ where: { idempotencyKey: key } });
      }
    }
    if (purchase.status === 'PAID') return { purchaseId: purchase.id, alreadyPaid: true, url: null };
    if (this.isMock) return { purchaseId: purchase.id, url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/billing?checkout=success&mock=1` };
    if (purchase.checkoutSessionId) return { purchaseId: purchase.id, url: null, pending: true };
    try {
      const session = await this.dodo.checkoutSessions.create({
        product_cart: [{ product_id: this.cfg.singleProductId!, quantity: 1 }],
        customer: { email: business.email, name: business.name || undefined },
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/billing?checkout=return&purchase=${purchase.id}`,
        // Observability and mapping only: what is granted is decided from the provider's own payment record, never from this.
        metadata: { aise: 'employer', kind: 'SINGLE_30D', purchaseId: purchase.id, companyId: business.company.id },
        ...CHECKOUT_PRESENTATION,
      });
      if (!session.checkout_url) throw new Error('no checkout url');
      await this.prisma.employerPurchase.update({ where: { id: purchase.id }, data: { checkoutSessionId: session.session_id ?? 'created' } });
      return { purchaseId: purchase.id, url: session.checkout_url };
    } catch (e: any) {
      throw new ServiceUnavailableException('Ödəniş səhifəsi yaradıla bilmədi, bir az sonra yenidən cəhd edin');
    }
  }

  async startBusinessCheckout(business: { id: string; email: string; name?: string | null; company: { id: string; status: string } }) {
    this.checkoutReady();
    if (!this.cfg.businessProductId && !this.isMock) throw new ServiceUnavailableException('Bu təklif hələ satışda deyil');
    if (business.company.status !== 'APPROVED') throw new ForbiddenException('Şirkət təsdiqlənməyib və ya dayandırılıb');
    const sub = await this.prisma.employerSubscription.findUnique({ where: { companyId: business.company.id } });
    if (this.businessActive(sub, new Date())) throw new ConflictException('Biznes abunəliyi artıq aktivdir');
    if (this.isMock) return { url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/billing?checkout=success&mock=1` };
    try {
      const session = await this.dodo.checkoutSessions.create({
        product_cart: [{ product_id: this.cfg.businessProductId!, quantity: 1 }],
        customer: sub?.dodoCustomerId ? { customer_id: sub.dodoCustomerId } : { email: business.email, name: business.name || undefined },
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/billing?checkout=return`,
        metadata: { aise: 'employer', kind: 'BUSINESS_MONTHLY', companyId: business.company.id },
        ...CHECKOUT_PRESENTATION,
      });
      if (!session.checkout_url) throw new Error('no checkout url');
      return { url: session.checkout_url };
    } catch {
      throw new ServiceUnavailableException('Ödəniş səhifəsi yaradıla bilmədi, bir az sonra yenidən cəhd edin');
    }
  }

  async portalSession(companyId: string) {
    const sub = await this.prisma.employerSubscription.findUnique({ where: { companyId } });
    if (!sub?.dodoCustomerId) throw new BadRequestException('Aktiv abunəlik tapılmadı');
    if (this.isMock) return { url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/billing` };
    const session = await this.dodo.customers.customerPortal.create(sub.dodoCustomerId);
    return { url: session.link };
  }

  /**
   * Stops the company's Business subscription at the provider before the company is deleted. A subscription the provider no longer knows is "nothing left
   * to stop"; any other failure throws so nothing is deleted while a card may still be charged.
   */
  async cancelBusinessForDeletion(companyId: string) {
    const sub = await this.prisma.employerSubscription.findUnique({ where: { companyId } });
    if (this.isMock || !sub?.dodoSubscriptionId || TERMINAL_STATUSES.has(sub.status)) return;
    try {
      const remote = await this.dodo.subscriptions.retrieve(sub.dodoSubscriptionId);
      if (!TERMINAL_STATUSES.has(remote.status)) await this.dodo.subscriptions.update(sub.dodoSubscriptionId, { status: 'cancelled' });
    } catch (error: any) {
      if (error?.status === 404) return;
      throw new ServiceUnavailableException('Şirkətin aktiv abunəliyi ləğv edilə bilmədi. Şirkəti silmədən əvvəl bir az sonra yenidən cəhd edin.');
    }
  }

  // ───────────────────────────────────────────────────────── provider events
  /**
   * Called by the billing webhook AFTER the signature was verified and the delivery id de-duplicated. Returns an outcome string when the event belongs to an
   * employer product, or null when it is not an employer event (the candidate flow then handles it). Everything is decided from the provider's own record.
   */
  async handleProviderEvent(type: string, data: any): Promise<string | null> {
    if (!this.cfg.gated || (!this.cfg.singleProductId && !this.cfg.businessProductId)) return null;
    if (type.startsWith('payment.')) {
      const paymentId: string | undefined = data?.payment_id;
      if (!paymentId) return null;
      let payment: any;
      try { payment = await this.dodo.payments.retrieve(paymentId); } catch (e: any) {
        if (e?.status === 404) return null;
        throw new ServiceUnavailableException('Ödəniş provayderi hazırda cavab vermir');
      }
      const items: { product_id: string }[] = payment?.product_cart ?? [];
      const isSingle = !!this.cfg.singleProductId && items.some((i) => i.product_id === this.cfg.singleProductId);
      if (!isSingle) return null; // candidate payments, subscription payments and everything else stay with their own flows
      return this.applySinglePayment(payment);
    }
    if (type.startsWith('refund.')) {
      const refundId: string | undefined = data?.refund_id;
      if (!refundId) return null;
      let refund: any;
      try { refund = await this.dodo.refunds.retrieve(refundId); } catch (e: any) {
        if (e?.status === 404) return null;
        throw new ServiceUnavailableException('Ödəniş provayderi hazırda cavab vermir');
      }
      return this.applyRefundState(refund);
    }
    if (type.startsWith('subscription.')) {
      const subscriptionId: string | undefined = data?.subscription_id;
      if (!subscriptionId) return null;
      let state: any;
      try { state = await this.dodo.subscriptions.retrieve(subscriptionId); } catch (e: any) {
        if (e?.status === 404) return null;
        throw new ServiceUnavailableException('Ödəniş provayderi hazırda cavab vermir');
      }
      if (!this.cfg.businessProductId || state?.product_id !== this.cfg.businessProductId) return null;
      return this.applyBusinessSubscription(subscriptionId, state);
    }
    return null;
  }

  private async applySinglePayment(payment: any): Promise<string> {
    // The purchase is found by the id we put in the checkout metadata; if the provider did not carry metadata onto the payment, by the checkout
    // session id we stored when we created the session. Both are our own records; the payload is never the authority.
    const purchaseId: string | undefined = payment?.metadata?.purchaseId;
    const sessionId: string | undefined = payment?.checkout_session_id ?? undefined;
    if (!purchaseId && !sessionId) return 'employer_unmapped';
    const purchase = purchaseId
      ? await this.prisma.employerPurchase.findUnique({ where: { id: purchaseId } })
      : await this.prisma.employerPurchase.findFirst({ where: { checkoutSessionId: sessionId } });
    if (!purchase) return 'employer_unknown_purchase';
    if (payment.metadata?.companyId && payment.metadata.companyId !== purchase.companyId) return 'employer_company_mismatch';
    const status = String(payment.status ?? '');
    if (status === 'failed' || status === 'cancelled') {
      await this.prisma.employerPurchase.updateMany({ where: { id: purchase.id, status: 'PENDING' }, data: { status: 'FAILED', failedAt: new Date() } });
      return 'employer_payment_failed';
    }
    if (status !== 'succeeded') return `employer_payment_${status || 'pending'}`;
    // The amount and currency the PROVIDER charged must be the price of this product; a mismatch grants nothing.
    if (Number(payment.total_amount) !== purchase.amountMinor || String(payment.currency).toUpperCase() !== purchase.currency) return 'employer_amount_mismatch';
    const granted = await this.prisma.$transaction(async (tx) => {
      const first = await tx.employerPurchase.updateMany({ where: { id: purchase.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PAID', paidAt: new Date(), providerPaymentId: payment.payment_id } });
      if (first.count !== 1) return false; // already granted: a duplicate or out-of-order delivery
      await tx.employerCredit.create({ data: { companyId: purchase.companyId, purchaseId: purchase.id } });
      return true;
    }).catch((e: any) => { if (e?.code === 'P2002') return false; throw e; });
    return granted ? 'employer_credit_granted' : 'employer_duplicate';
  }

  private async applyBusinessSubscription(subscriptionId: string, state: any): Promise<string> {
    const companyId: string | undefined = state?.metadata?.companyId;
    if (!companyId) return 'employer_unmapped';
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) return 'employer_unknown_company';
    const existing = await this.prisma.employerSubscription.findUnique({ where: { companyId } });
    const status = String(state.status || 'pending');
    // An older subscription's late events never overwrite a newer contract unless the older one is the active one.
    if (existing?.dodoSubscriptionId && existing.dodoSubscriptionId !== subscriptionId && status !== 'active') return 'employer_stale_subscription';
    const data = {
      dodoCustomerId: state.customer?.customer_id ?? existing?.dodoCustomerId ?? null,
      dodoSubscriptionId: subscriptionId,
      status,
      currentPeriodEnd: state.next_billing_date ? new Date(state.next_billing_date) : existing?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: !!state.cancel_at_next_billing_date,
      providerSyncedAt: new Date(),
    };
    await this.prisma.employerSubscription.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
    return `employer_subscription:${status}`;
  }

  // ───────────────────────────────────────────────────────── refunds
  // Operational handling of docs/employer-refund-policy-2026-10-11.md. The money moves only at the provider; this code keeps the entitlement in step with it:
  // an unused credit is voided BEFORE the refund is requested (so it cannot be spent meanwhile), a refused refund restores it, and a refund of a delivered
  // listing (platform failure) also ends that listing. Nothing here decides whether a refund is owed: an operator does, with a reason.

  async listPurchases(status?: string, take = 100) {
    return this.prisma.employerPurchase.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      select: {
        id: true, kind: true, status: true, amountMinor: true, currency: true, createdAt: true, paidAt: true, refundedAt: true, refundReason: true, providerPaymentId: true,
        company: { select: { id: true, name: true, status: true } },
        credit: { select: { status: true, consumedVacancyId: true, consumedAt: true } },
      },
    });
  }

  async refund(purchaseId: string, input: { reason: string; adminUserId: string; endListing?: boolean }) {
    const reason = String(input.reason ?? '').trim();
    if (reason.length < 5) throw new BadRequestException('Geri ödəniş səbəbi yazılmalıdır');
    const purchase = await this.prisma.employerPurchase.findUnique({ where: { id: purchaseId }, include: { credit: true } });
    if (!purchase) throw new NotFoundException('Ödəniş tapılmadı');
    if (purchase.status === 'REFUND_PENDING' || purchase.status === 'REFUNDED') return { purchaseId, status: purchase.status, alreadyRequested: true };
    if (purchase.status !== 'PAID' || !purchase.providerPaymentId) throw new ConflictException('Yalnız ödənilmiş alış geri qaytarıla bilər');
    const consumed = purchase.credit?.status === 'CONSUMED';
    if (consumed && !input.endListing) {
      throw new ConflictException({ code: 'LISTING_DELIVERED', message: 'Kredit artıq vakansiyada istifadə olunub. Platforma xətası səbəbindən geri qaytarmaq üçün elanın dayandırılması təsdiqlənməlidir' });
    }
    // Reserve first, so two operators (or a double click) cannot send two refunds and an unspent credit cannot be spent while the refund is open.
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employerPurchase.updateMany({
        where: { id: purchase.id, status: 'PAID' },
        data: { status: 'REFUND_PENDING', refundReason: reason.slice(0, 500), refundedBy: input.adminUserId, refundRequestedAt: new Date() },
      });
      if (r.count !== 1) throw new ConflictException('Geri ödəniş artıq başlanıb');
      if (!consumed) {
        const c = await tx.employerCredit.updateMany({ where: { purchaseId: purchase.id, status: 'AVAILABLE' }, data: { status: 'VOIDED' } });
        if (c.count !== 1) throw new ConflictException('Kredit bu arada istifadə olunub; yenidən yoxlayın');
      }
    });
    let refund: any;
    try {
      refund = this.isMock
        ? { refund_id: `mock_refund_${purchase.id}`, status: 'succeeded', payment_id: purchase.providerPaymentId }
        : await this.dodo.refunds.create({ payment_id: purchase.providerPaymentId, reason: reason.slice(0, 500), metadata: { aise: 'employer', purchaseId: purchase.id } });
    } catch (e: any) {
      await this.revertRefund(purchase.id);
      this.log.error(`refund request failed for purchase ${purchase.id}: ${e?.status ?? ''} ${String(e?.message ?? '').slice(0, 80)}`);
      throw new ServiceUnavailableException('Geri ödəniş provayderə göndərilə bilmədi; heç nə dəyişmədi');
    }
    await this.prisma.employerPurchase.update({ where: { id: purchase.id }, data: { refundId: refund.refund_id ?? null } });
    const outcome = await this.applyRefundState({ ...refund, payment_id: purchase.providerPaymentId }, { endListing: !!input.endListing });
    return { purchaseId, refundId: refund.refund_id ?? null, outcome };
  }

  /** The refund did not happen: the purchase is paid again and an unspent credit is usable again. */
  private async revertRefund(purchaseId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.employerPurchase.updateMany({ where: { id: purchaseId, status: 'REFUND_PENDING' }, data: { status: 'PAID', refundId: null } });
      await tx.employerCredit.updateMany({ where: { purchaseId, status: 'VOIDED' }, data: { status: 'AVAILABLE' } });
    });
  }

  /** Applies the provider's own state of one refund (from the create response or a re-fetched webhook). Idempotent. */
  private async applyRefundState(refund: any, opts: { endListing?: boolean } = {}): Promise<string | null> {
    const paymentId: string | undefined = refund?.payment_id;
    const refundId: string | undefined = refund?.refund_id;
    const purchase = await this.prisma.employerPurchase.findFirst({
      where: { OR: [...(refundId ? [{ refundId }] : []), ...(paymentId ? [{ providerPaymentId: paymentId }] : [])] },
      include: { credit: true },
    });
    if (!purchase) return null; // not an employer single-listing payment (a candidate or subscription payment): other flows own it
    const status = String(refund?.status ?? '');
    if (status === 'failed') {
      if (purchase.status === 'REFUND_PENDING') await this.revertRefund(purchase.id);
      return 'employer_refund_failed';
    }
    if (status !== 'succeeded') {
      if (purchase.status === 'PAID' && refundId) await this.prisma.employerPurchase.updateMany({ where: { id: purchase.id, status: 'PAID' }, data: { status: 'REFUND_PENDING', refundId } });
      return `employer_refund_${status || 'pending'}`;
    }
    if (purchase.status === 'REFUNDED') return 'employer_refund_duplicate';
    await this.prisma.$transaction(async (tx) => {
      await tx.employerPurchase.update({ where: { id: purchase.id }, data: { status: 'REFUNDED', refundId: refundId ?? purchase.refundId, refundedAt: new Date() } });
      if (purchase.credit?.status === 'AVAILABLE') await tx.employerCredit.update({ where: { id: purchase.credit.id }, data: { status: 'VOIDED' } });
      // The money for a delivered listing came back (platform failure, or a refund made in the provider's dashboard): the listing is withdrawn, its applications stay.
      if (purchase.credit?.status === 'CONSUMED' && purchase.credit.consumedVacancyId && (opts.endListing !== false)) {
        await tx.vacancy.updateMany({ where: { id: purchase.credit.consumedVacancyId, status: 'ACTIVE' }, data: { status: 'EXPIRED', expiryReason: 'REFUNDED', expiresAt: new Date() } });
      }
    });
    return 'employer_refunded';
  }

  // ───────────────────────────────────────────────────────── helper used by the apply path
  /** True when the vacancy accepts applications right now by the plan rules (status alone is not enough once the clock has run out). */
  static isOpen(v: { status: string; expiresAt?: Date | null; deadline?: Date | null }, now = new Date()): boolean {
    if (v.status !== 'ACTIVE') return false;
    if (v.expiresAt && v.expiresAt <= now) return false;
    if (v.deadline && v.deadline <= now) return false;
    return true;
  }
}

