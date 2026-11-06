import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type EmailApplication, type EmailDeliveryEvent } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { EMAIL_APPLY_CONFIG } from './email-apply.tokens';
import type { EmailApplyConfig } from './email-apply.config';
import { verifySvixSignature, WebhookSignatureError, type SvixHeaders } from './svix-verify';
import { EVIDENCE_STATES, stateFromEvidence } from './email-application-state';
import { InboundReplyService } from './inbound-reply.service';

export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored' | 'unmatched';

// Only events that carry evidence about a message AISE sent. Opens and clicks are
// neither stored nor acted on: they are not proof that anyone reviewed anything.
const DELIVERY_EVENTS = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed']);

interface ParsedEvent {
  type: string;
  occurredAt: Date;
  messageId: string | null;
  applicationTag: string | null;
  detail: string | null;
  /** Addresses the provider says the event is about (lower-cased); empty when the payload has none. */
  to: string[];
}

const short = (value: unknown, max = 40) => (typeof value === 'string' && /^[A-Za-z0-9_. -]{1,80}$/.test(value) ? value.slice(0, max) : null);

export function parseEvent(raw: Buffer): ParsedEvent & { received?: unknown } {
  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid webhook body');
  }
  if (!body || typeof body !== 'object' || typeof body.type !== 'string' || !body.data || typeof body.data !== 'object') throw new BadRequestException('Invalid webhook body');
  const occurredAt = new Date(typeof body.created_at === 'string' ? body.created_at : NaN);
  const tags = body.data.tags && typeof body.data.tags === 'object' && !Array.isArray(body.data.tags) ? body.data.tags : {};
  const bounce = body.data.bounce && typeof body.data.bounce === 'object' ? body.data.bounce : null;
  return {
    type: body.type.slice(0, 40),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    messageId: typeof body.data.email_id === 'string' && body.data.email_id.length <= 128 ? body.data.email_id : null,
    applicationTag: typeof tags.application === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(tags.application) ? tags.application : null,
    // A short machine code (e.g. the bounce type), never a provider message or an address.
    detail: bounce ? short(bounce.type) : null,
    to: Array.isArray(body.data.to) ? body.data.to.filter((v: unknown): v is string => typeof v === 'string').map((v: string) => v.toLowerCase().replace(/^.*<([^>]+)>$/, '$1')).slice(0, 50) : [],
    received: body.type === 'email.received' ? body.data : undefined,
  };
}

/**
 * Turns verified provider events into delivery evidence. Events are de-duplicated
 * by the provider's event id, may arrive in any order, and only ever add
 * evidence: the delivery state is derived from everything known, so a late
 * "delivered" cannot undo a "bounced".
 */
@Injectable()
export class DeliveryEvidenceService {
  private readonly logger = new Logger(DeliveryEvidenceService.name);

  constructor(private prisma: PrismaService, @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig, private inbound: InboundReplyService) {}

  verify(rawBody: Buffer, headers: SvixHeaders, nowMs = Date.now()) {
    if (!this.cfg.enabled) throw new ServiceUnavailableException('Webhook receiver is disabled');
    if (!this.cfg.webhookSecret) throw new ServiceUnavailableException('Webhook signing secret is not configured');
    try {
      verifySvixSignature(this.cfg.webhookSecret, headers, rawBody, nowMs);
    } catch (error) {
      if (error instanceof WebhookSignatureError) throw new UnauthorizedException('Invalid webhook signature');
      throw error;
    }
  }

  async handle(rawBody: Buffer, headers: SvixHeaders, nowMs = Date.now()): Promise<WebhookOutcome> {
    this.verify(rawBody, headers, nowMs);
    const event = parseEvent(rawBody);
    if (event.type === 'email.received') return (await this.inbound.handle(event.received as Record<string, unknown>)) === 'stored' ? 'applied' : 'ignored';
    if (!DELIVERY_EVENTS.has(event.type)) return 'ignored';

    let stored: EmailDeliveryEvent;
    try {
      stored = await this.prisma.emailDeliveryEvent.create({
        data: { svixId: headers.id!, type: event.type, occurredAt: event.occurredAt, providerMessageId: event.messageId, detail: event.detail },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'duplicate';
      throw error;
    }
    return this.apply(stored, event.applicationTag, event.to);
  }

  /**
   * Finds the application an event is about, by the provider's message id and by the tag we attached when sending.
   * Both must agree: evidence about one message is never applied to another application.
   */
  private async locate(messageId: string | null, tag: string | null): Promise<{ row: EmailApplication | null; inconsistent: boolean }> {
    const byMessage = messageId ? await this.prisma.emailApplication.findUnique({ where: { providerMessageId: messageId } }) : null;
    const byTag = tag ? await this.prisma.emailApplication.findUnique({ where: { id: tag } }) : null;
    if (byMessage && byTag && byMessage.id !== byTag.id) return { row: null, inconsistent: true };
    const row = byMessage ?? byTag;
    // Matched only by tag: the stored message id, if there is one, must be the event's.
    if (row && !byMessage && row.providerMessageId && messageId && row.providerMessageId !== messageId) return { row: null, inconsistent: true };
    return { row, inconsistent: false };
  }

  async apply(event: EmailDeliveryEvent, applicationTag: string | null = null, to: string[] = []): Promise<WebhookOutcome> {
    const { row: target, inconsistent } = await this.locate(event.providerMessageId, applicationTag);
    if (inconsistent) {
      await this.prisma.emailDeliveryEvent.update({ where: { id: event.id }, data: { detail: 'inconsistent_correlation' } });
      return 'ignored';
    }
    if (!target) return 'unmatched'; // kept; reconciled when the message id is stored (see reconcile)
    // An event about someone else (for example the candidate's own copy) is not evidence about the employer's message.
    if (to.length && !to.includes(target.recipient.toLowerCase())) {
      await this.prisma.emailDeliveryEvent.update({ where: { id: event.id }, data: { emailApplicationId: target.id, detail: 'recipient_mismatch' } });
      return 'ignored';
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EmailApplication" WHERE id = ${target.id} FOR UPDATE`;
      const row = await tx.emailApplication.findUniqueOrThrow({ where: { id: target.id } });
      // A definite failure before the provider ever took the message has no message to report on.
      const neverSent = row.deliveryState === 'FAILED' && !row.providerAcceptedAt && !row.providerFailedAt;
      if (!EVIDENCE_STATES.includes(row.deliveryState) || neverSent) {
        // An event for something never sent (or cancelled) proves nothing here.
        await tx.emailDeliveryEvent.update({ where: { id: event.id }, data: { emailApplicationId: row.id } });
        return 'ignored' as const;
      }
      const facts = {
        providerAcceptedAt: row.providerAcceptedAt, deliveredAt: row.deliveredAt, bouncedAt: row.bouncedAt, complainedAt: row.complainedAt, providerFailedAt: row.providerFailedAt,
      };
      const at = event.occurredAt;
      const data: Prisma.EmailApplicationUpdateInput = {};
      switch (event.type) {
        case 'email.sent': facts.providerAcceptedAt ??= at; data.providerAcceptedAt = facts.providerAcceptedAt; break;
        case 'email.delivered': facts.deliveredAt ??= at; facts.providerAcceptedAt ??= at; data.deliveredAt = facts.deliveredAt; data.providerAcceptedAt = facts.providerAcceptedAt; break;
        case 'email.bounced': facts.bouncedAt ??= at; data.bouncedAt = facts.bouncedAt; break;
        case 'email.complained': facts.complainedAt ??= at; data.complainedAt = facts.complainedAt; break;
        case 'email.failed': facts.providerFailedAt ??= at; data.providerFailedAt = facts.providerFailedAt; break;
        default: break; // delivery_delayed: recorded only
      }
      if (!row.providerMessageId && event.providerMessageId) data.providerMessageId = event.providerMessageId;
      const state = stateFromEvidence(facts, row.deliveryState);
      if (state !== row.deliveryState) data.deliveryState = state;

      // The recruitment stage follows delivery evidence, and only in the ways delivery can speak to it.
      let toRecruitment: 'SENT' | 'NOT_SENT' | null = null;
      if (row.recruitmentState === 'NOT_SENT' && (state === 'PROVIDER_ACCEPTED' || state === 'DELIVERED')) toRecruitment = 'SENT';
      if (row.recruitmentState === 'SENT' && (state === 'BOUNCED' || state === 'COMPLAINED' || state === 'FAILED')) toRecruitment = 'NOT_SENT';
      if (toRecruitment) data.recruitmentState = toRecruitment;
      await tx.emailApplication.update({ where: { id: row.id }, data });
      if (toRecruitment) {
        await tx.applicationStatusEvent.create({ data: { emailApplicationId: row.id, fromState: row.recruitmentState, toState: toRecruitment, evidence: 'PROVIDER_EVENT', note: event.type } });
      }
      // Suppression comes from provider evidence about THIS application's recipient, never from event contents.
      if (event.type === 'email.complained' || (event.type === 'email.bounced' && event.detail !== 'Transient')) {
        await tx.emailSuppression.upsert({
          where: { email: row.recipient.toLowerCase() },
          create: { email: row.recipient.toLowerCase(), reason: event.type === 'email.complained' ? 'COMPLAINT' : 'BOUNCE', sourceEventId: event.svixId },
          update: {},
        });
      }
      await tx.emailDeliveryEvent.update({ where: { id: event.id }, data: { emailApplicationId: row.id, applied: true } });
      return 'applied' as const;
    });
  }

  /** Applies events that arrived before the application's message id was stored. Safe to repeat. */
  async reconcile(providerMessageId: string): Promise<number> {
    const orphans = await this.prisma.emailDeliveryEvent.findMany({ where: { providerMessageId, emailApplicationId: null }, orderBy: { occurredAt: 'asc' } });
    let applied = 0;
    for (const event of orphans) if ((await this.apply(event)) === 'applied') applied++;
    return applied;
  }
}
