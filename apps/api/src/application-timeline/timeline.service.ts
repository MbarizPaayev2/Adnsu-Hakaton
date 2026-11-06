import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { OutcomeKind } from '@prisma/client';
import { PrismaService } from '../database/database.service';

export type Evidence = 'SYSTEM' | 'PROVIDER' | 'EMPLOYER_CONFIRMED' | 'CANDIDATE_REPORTED';
export interface Stage { key: 'DRAFT' | 'APPROVED' | 'PROVIDER_ACCEPTED' | 'DELIVERED' | 'REPLY_RECEIVED' | 'IN_REVIEW' | 'INTERVIEW' | 'OFFER' | 'HIRED'; at: Date | null; evidence: Evidence; note?: string }
export interface NextAction { key: string; href?: string; note?: string }
export interface TimelineEntry {
  id: string; channel: 'email' | 'native' | 'external' | 'browser'; applicationId: string; title: string; company: string; createdAt: Date;
  documentKind: 'base' | 'tailored' | null; stages: Stage[]; current: Stage['key'];
  /** Terminal or problem states that are not progress: BOUNCED, COMPLAINED, FAILED, UNCERTAIN, CANCELLED, REJECTED, WITHDRAWN, UNCONFIRMED, EXPIRED. */
  problem: { key: string; at: Date | null; evidence: Evidence } | null;
  dryRun: boolean; nextActions: NextAction[];
}

const DAY = 86_400_000;
const REPORTABLE: readonly OutcomeKind[] = ['INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
const rank = (k: Stage['key']) => ['DRAFT', 'APPROVED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'REPLY_RECEIVED', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED'].indexOf(k);

/**
 * One read model over the three application channels (e-mail, native, external). It adds no state of its own for e-mail; for native and external
 * outcomes it reads ApplicationOutcomeEvent. Interview and offer stages exist ONLY with explicit evidence: the employer's own status change in AISE
 * (EMPLOYER_CONFIRMED) or what the candidate entered or confirmed (CANDIDATE_REPORTED). Nothing is inferred from delivery, opens or tracking.
 */
@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  async timeline(userId: string, now = new Date(), limit: number | null = 200): Promise<TimelineEntry[]> {
    const [emails, natives, externals, outcomes, browsers] = await Promise.all([
      this.prisma.emailApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit ?? undefined, include: { statusEvents: { orderBy: { createdAt: 'asc' } }, inbound: { select: { receivedAt: true }, orderBy: { receivedAt: 'asc' }, take: 1 } } }),
      this.prisma.application.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit ?? undefined, include: { vacancy: { include: { company: true } } } }),
      this.prisma.externalApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit ?? undefined, include: { match: { include: { job: true, vacancy: { include: { company: true } } } } } }),
      this.prisma.applicationOutcomeEvent.findMany({ where: { userId }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.agentApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit ?? undefined, include: { job: { select: { title: true, company: true } } } }),
    ]);
    const out: TimelineEntry[] = [];
    for (const e of emails) out.push(this.email(e, now));
    for (const n of natives) out.push(this.native(n, outcomes.filter((o) => o.channel === 'native' && o.applicationId === n.id), now));
    for (const x of externals) out.push(this.external(x, outcomes.filter((o) => o.channel === 'external' && o.applicationId === x.id), now));
    for (const b of browsers) out.push(this.browser(b, outcomes.filter((o) => o.channel === 'browser' && o.applicationId === b.id), now));
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private finish(entry: Omit<TimelineEntry, 'current'>): TimelineEntry {
    const stages = [...entry.stages].sort((a, b) => rank(a.key) - rank(b.key) || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    return { ...entry, stages, current: stages.reduce((m, s) => (rank(s.key) >= rank(m) ? s.key : m), 'DRAFT' as Stage['key']) };
  }

  private email(e: any, now: Date): TimelineEntry {
    const stages: Stage[] = [{ key: 'DRAFT', at: e.createdAt, evidence: 'SYSTEM' }];
    if (e.approvedAt) stages.push({ key: 'APPROVED', at: e.approvedAt, evidence: 'SYSTEM', note: 'candidate approved the exact message and CV' });
    if (e.providerAcceptedAt) stages.push({ key: 'PROVIDER_ACCEPTED', at: e.providerAcceptedAt, evidence: 'PROVIDER', note: 'handed to the e-mail service; not proof of delivery or reading' });
    if (e.deliveredAt) stages.push({ key: 'DELIVERED', at: e.deliveredAt, evidence: 'PROVIDER', note: 'the recipient\'s mail server accepted it' });
    const ev = e.statusEvents as { toState: string; evidence: string; createdAt: Date; note: string | null }[];
    const cand = (x: { evidence: string }): Evidence => 'CANDIDATE_REPORTED' as Evidence;
    const firstTo = (...states: string[]) => ev.find((x) => states.includes(x.toState));
    const reply = firstTo('ACKNOWLEDGED');
    const inbound = e.inbound?.[0]?.receivedAt as Date | undefined;
    if (inbound) stages.push({ key: 'REPLY_RECEIVED', at: inbound, evidence: 'SYSTEM', note: 'a message arrived at the reply address' });
    else if (reply) stages.push({ key: 'REPLY_RECEIVED', at: reply.createdAt, evidence: cand(reply), note: 'entered or confirmed by the candidate' });
    const interview = firstTo('INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED');
    if (interview) stages.push({ key: 'INTERVIEW', at: interview.createdAt, evidence: cand(interview), note: 'entered or confirmed by the candidate' });
    const offer = firstTo('OFFER');
    if (offer) stages.push({ key: 'OFFER', at: offer.createdAt, evidence: cand(offer), note: 'entered or confirmed by the candidate' });
    const hired = firstTo('HIRED');
    if (hired) stages.push({ key: 'HIRED', at: hired.createdAt, evidence: cand(hired), note: 'entered or confirmed by the candidate' });
    let problem: TimelineEntry['problem'] = null;
    const bad: [string, Date | null][] = [['COMPLAINED', e.complainedAt], ['BOUNCED', e.bouncedAt], ['FAILED', e.failedAt ?? e.providerFailedAt], ['UNCERTAIN', e.uncertainAt], ['CANCELLED', e.cancelledAt]];
    const hit = bad.find(([k]) => e.deliveryState === k);
    if (hit) problem = { key: hit[0], at: hit[1], evidence: hit[0] === 'CANCELLED' ? 'SYSTEM' : 'PROVIDER' };
    const closing = e.recruitmentState === 'REJECTED' || e.recruitmentState === 'WITHDRAWN' ? ev.slice().reverse().find((x) => x.toState === e.recruitmentState) : null;
    if (closing) problem = { key: e.recruitmentState, at: closing.createdAt, evidence: 'CANDIDATE_REPORTED' };
    const id = e.id as string;
    const next: NextAction[] = [];
    const age = (d: Date | null) => (d ? (now.getTime() - d.getTime()) / DAY : 0);
    if (e.deliveryState === 'AWAITING_APPROVAL' || e.deliveryState === 'DRAFT') next.push({ key: 'review_and_approve', href: `/dashboard/email-applications/${id}`, note: 'nothing is sent until you approve' });
    if (e.deliveryState === 'UNCERTAIN') next.push({ key: 'check_before_deciding', href: `/dashboard/email-applications/${id}`, note: 'the outcome is unknown; AISE never re-sends automatically' });
    if (e.deliveryState === 'BOUNCED') next.push({ key: 'check_recipient_address', href: `/dashboard/email-applications/${id}` });
    if (!problem && (e.deliveryState === 'PROVIDER_ACCEPTED' || e.deliveryState === 'DELIVERED') && !interview && !offer && age(e.providerAcceptedAt) >= 7) {
      next.push({ key: 'report_outcome', href: `/dashboard/email-applications/${id}`, note: 'if you heard back, record it; AISE sends nothing to the employer for you' });
    }
    return this.finish({ id: `email:${id}`, channel: 'email', applicationId: id, title: e.jobTitle, company: e.jobCompany, createdAt: e.createdAt, documentKind: e.cvKind === 'tailored' ? 'tailored' : 'base', stages, problem, dryRun: false, nextActions: next });
  }

  private native(a: any, events: any[], now: Date): TimelineEntry {
    const stages: Stage[] = [{ key: 'DELIVERED', at: a.createdAt, evidence: 'SYSTEM', note: 'submitted inside AISE; available to the employer' }];
    if (a.status === 'REVIEWING') stages.push({ key: 'IN_REVIEW', at: null, evidence: 'EMPLOYER_CONFIRMED', note: 'the employer marked it as being reviewed' });
    for (const o of events) {
      const key = o.outcome === 'INTERVIEW' ? 'INTERVIEW' : o.outcome === 'OFFER' ? 'OFFER' : o.outcome === 'HIRED' ? 'HIRED' : null;
      if (key) stages.push({ key, at: o.occurredAt, evidence: o.evidence, note: o.evidence === 'CANDIDATE_REPORTED' ? 'entered by the candidate' : undefined });
    }
    // An employer status set before outcome events existed (or by another path) still counts, once, as the employer's own evidence.
    if (a.status === 'INTERVIEW' && !stages.some((s) => s.key === 'INTERVIEW' && s.evidence === 'EMPLOYER_CONFIRMED')) stages.push({ key: 'INTERVIEW', at: null, evidence: 'EMPLOYER_CONFIRMED' });
    if (a.status === 'HIRED' && !stages.some((s) => s.key === 'HIRED' && s.evidence === 'EMPLOYER_CONFIRMED')) stages.push({ key: 'HIRED', at: null, evidence: 'EMPLOYER_CONFIRMED' });
    const closing = events.slice().reverse().find((o) => o.outcome === 'REJECTED' || o.outcome === 'WITHDRAWN');
    const problem = closing ? { key: closing.outcome as string, at: closing.occurredAt as Date, evidence: closing.evidence as Evidence } : a.status === 'REJECTED' ? { key: 'REJECTED', at: null, evidence: 'EMPLOYER_CONFIRMED' as Evidence } : null;
    const next: NextAction[] = [];
    if (!problem && !stages.some((s) => ['INTERVIEW', 'OFFER', 'HIRED'].includes(s.key))) next.push({ key: (now.getTime() - a.createdAt.getTime()) / DAY >= 14 ? 'report_outcome' : 'wait_for_employer', note: 'AISE sends nothing to the employer for you' });
    return this.finish({ id: `native:${a.id}`, channel: 'native', applicationId: a.id, title: a.vacancy.title, company: a.vacancy.company.name, createdAt: a.createdAt, documentKind: null, stages, problem, dryRun: false, nextActions: next });
  }

  private external(x: any, events: any[], now: Date): TimelineEntry {
    const m = x.match;
    const title = m?.job?.title || m?.vacancy?.title || 'Vakansiya';
    const company = m?.job?.company || m?.vacancy?.company?.name || '';
    const stages: Stage[] = [{ key: 'DRAFT', at: x.createdAt, evidence: 'SYSTEM' }];
    let problem: TimelineEntry['problem'] = null;
    const next: NextAction[] = [];
    const dryRun = x.status === 'SUBMITTED_DRY_RUN';
    if (['SUBMITTING', 'SUBMITTED', 'DELIVERY_UNCONFIRMED'].includes(x.status)) stages.push({ key: 'APPROVED', at: x.submittedAt ?? x.updatedAt, evidence: 'SYSTEM', note: 'candidate confirmed the submission' });
    if (x.status === 'SUBMITTED') stages.push({ key: 'DELIVERED', at: x.submittedAt ?? x.updatedAt, evidence: 'PROVIDER', note: 'the destination site confirmed receipt' });
    if (x.status === 'DELIVERY_UNCONFIRMED') { problem = { key: 'UNCONFIRMED', at: x.updatedAt, evidence: 'SYSTEM' }; next.push({ key: 'check_source_site', note: 'receipt was not confirmed: check the source site before applying again' }); }
    if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(x.status)) problem = { key: x.status, at: x.updatedAt, evidence: 'SYSTEM' };
    for (const o of events) {
      const key = o.outcome === 'INTERVIEW' ? 'INTERVIEW' : o.outcome === 'OFFER' ? 'OFFER' : o.outcome === 'HIRED' ? 'HIRED' : null;
      if (key) stages.push({ key, at: o.occurredAt, evidence: o.evidence, note: 'entered by the candidate' });
    }
    const closing = events.slice().reverse().find((o) => o.outcome === 'REJECTED' || o.outcome === 'WITHDRAWN');
    if (closing) problem = { key: closing.outcome, at: closing.occurredAt, evidence: closing.evidence };
    if (x.status === 'SUBMITTED' && !stages.some((s) => ['INTERVIEW', 'OFFER', 'HIRED'].includes(s.key)) && !closing && (now.getTime() - (x.submittedAt ?? x.updatedAt).getTime()) / DAY >= 7) next.push({ key: 'report_outcome', note: 'if you heard back, record it' });
    return this.finish({ id: `external:${x.id}`, channel: 'external', applicationId: x.id, title, company, createdAt: x.createdAt, documentKind: null, stages, problem, dryRun, nextActions: next });
  }

  /** The browser agent: portal-confirmed evidence (the confirmation page AISE captured) is kept apart from what the candidate reports. */
  private browser(x: any, events: any[], now: Date): TimelineEntry {
    const stages: Stage[] = [{ key: 'DRAFT', at: x.createdAt, evidence: 'SYSTEM', note: 'queued by the candidate\'s own campaign' }];
    const next: NextAction[] = [];
    const href = `/dashboard/agent/applications/${x.id}`;
    if (x.approvedAt || x.permitIssuedAt) stages.push({ key: 'APPROVED', at: x.approvedAt ?? x.permitIssuedAt, evidence: 'SYSTEM', note: x.mode === 'ASSISTED' ? 'the candidate approved the exact form and documents' : 'inside the candidate\'s authorised campaign' });
    if (x.state === 'SUBMITTED') stages.push({ key: 'DELIVERED', at: x.submittedAt ?? x.updatedAt, evidence: x.confirmation === 'PORTAL' ? 'PROVIDER' : 'CANDIDATE_REPORTED', note: x.confirmation === 'PORTAL' ? 'the portal\'s confirmation page was captured' : 'reported by the candidate, not confirmed by the portal' });
    for (const o of events) {
      const key = o.outcome === 'INTERVIEW' ? 'INTERVIEW' : o.outcome === 'OFFER' ? 'OFFER' : o.outcome === 'HIRED' ? 'HIRED' : null;
      if (key) stages.push({ key, at: o.occurredAt, evidence: o.evidence, note: 'entered by the candidate' });
    }
    let problem: TimelineEntry['problem'] = null;
    if (x.state === 'UNCERTAIN') problem = { key: 'UNCERTAIN', at: x.uncertainAt ?? x.updatedAt, evidence: 'SYSTEM' };
    if (x.state === 'FAILED' || x.state === 'CANCELLED') problem = { key: x.state, at: x.cancelledAt ?? x.updatedAt, evidence: 'SYSTEM' };
    const closing = events.slice().reverse().find((o) => o.outcome === 'REJECTED' || o.outcome === 'WITHDRAWN');
    if (closing) problem = { key: closing.outcome, at: closing.occurredAt, evidence: closing.evidence };
    if (x.state === 'AWAITING_INPUT') next.push({ key: 'answer_questions', href, note: 'the form asked something your confirmed answers do not cover' });
    if (x.state === 'READY' && x.mode === 'ASSISTED' && x.approvedPlanHash !== x.planHash) next.push({ key: 'review_and_approve', href, note: 'nothing is submitted until you approve' });
    if (x.state === 'UNCERTAIN') next.push({ key: 'check_before_deciding', href, note: 'the outcome is unknown; AISE never retries before you confirm' });
    if (x.state === 'SUBMITTED' && !stages.some((s) => ['INTERVIEW', 'OFFER', 'HIRED'].includes(s.key)) && !closing && (now.getTime() - (x.submittedAt ?? x.updatedAt).getTime()) / DAY >= 7) next.push({ key: 'report_outcome', href });
    return this.finish({ id: `browser:${x.id}`, channel: 'browser', applicationId: x.id, title: x.job.title, company: x.job.company, createdAt: x.createdAt, documentKind: 'base', stages, problem, dryRun: false, nextActions: next });
  }

  // ── candidate-entered outcomes for native and external applications ────────────────────────────────
  async reportOutcome(userId: string, channel: string, id: string, body: { outcome?: unknown; occurredAt?: unknown; note?: unknown }, now = new Date()) {
    if (channel !== 'native' && channel !== 'external' && channel !== 'browser') throw new BadRequestException('E-poçt müraciətləri üçün /email-applications/:id/status istifadə edin');
    if (typeof body?.outcome !== 'string' || !(REPORTABLE as readonly string[]).includes(body.outcome)) throw new BadRequestException('Nəticə yanlışdır');
    const outcome = body.outcome as OutcomeKind;
    let occurredAt = now;
    if (body.occurredAt !== undefined) {
      const t = typeof body.occurredAt === 'string' ? new Date(body.occurredAt) : null;
      if (!t || Number.isNaN(t.getTime()) || t.getTime() > now.getTime() + 60_000) throw new BadRequestException('Tarix yanlışdır');
      occurredAt = t;
    }
    let note: string | null = null;
    if (body.note !== undefined && body.note !== null && body.note !== '') {
      if (typeof body.note !== 'string' || body.note.length > 500) throw new BadRequestException('Qeyd 500 simvoldan çox ola bilməz');
      note = body.note.trim();
    }
    if (channel === 'native') {
      if (!(await this.prisma.application.findFirst({ where: { id, userId }, select: { id: true } }))) throw new NotFoundException('Müraciət tapılmadı');
    } else if (channel === 'browser') {
      const x = await this.prisma.agentApplication.findFirst({ where: { id, userId }, select: { state: true } });
      if (!x) throw new NotFoundException('Müraciət tapılmadı');
      if (x.state !== 'SUBMITTED') throw new BadRequestException('Bu müraciət göndərilməyib, nəticə qeyd etmək olmaz');
    } else {
      const x = await this.prisma.externalApplication.findFirst({ where: { id, userId }, select: { status: true } });
      if (!x) throw new NotFoundException('Müraciət tapılmadı');
      // Only a real submission can have an outcome; a draft, a dry run or a failure cannot.
      if (x.status !== 'SUBMITTED' && x.status !== 'DELIVERY_UNCONFIRMED') throw new BadRequestException('Bu müraciət göndərilməyib, nəticə qeyd etmək olmaz');
    }
    const existing = await this.prisma.applicationOutcomeEvent.findFirst({ where: { channel, applicationId: id, outcome, evidence: 'CANDIDATE_REPORTED' } });
    if (existing) return { id: existing.id, created: false };
    const row = await this.prisma.applicationOutcomeEvent.create({ data: { userId, channel, applicationId: id, outcome, evidence: 'CANDIDATE_REPORTED', occurredAt, note } });
    return { id: row.id, created: true };
  }

  /** Called when the EMPLOYER changes a native application's status in AISE: that, and only that, is employer-confirmed evidence. */
  async recordEmployerStatus(application: { id: string; userId: string }, status: string, now = new Date()) {
    const outcome: OutcomeKind | null = status === 'INTERVIEW' ? 'INTERVIEW' : status === 'HIRED' ? 'HIRED' : status === 'REJECTED' ? 'REJECTED' : null;
    if (!outcome) return;
    await this.prisma.applicationOutcomeEvent.upsert({
      where: { channel_applicationId_outcome_evidence: { channel: 'native', applicationId: application.id, outcome, evidence: 'EMPLOYER_CONFIRMED' } },
      create: { userId: application.userId, channel: 'native', applicationId: application.id, outcome, evidence: 'EMPLOYER_CONFIRMED', occurredAt: now },
      update: {},
    });
  }
}
