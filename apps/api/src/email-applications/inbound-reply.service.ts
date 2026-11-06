import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { EMAIL_APPLY_CONFIG } from './email-apply.tokens';
import type { EmailApplyConfig } from './email-apply.config';
import { suggestFromSubject } from './reply-suggestion';
import { singleLine } from './email-application-draft';

const MAX_REPLIES_PER_APPLICATION = 50;
const TRACK_ADDRESS = /^track\+([A-Za-z0-9_-]{10,64})@([^@\s>]+)>?$/i;

export type InboundOutcome = 'stored' | 'duplicate' | 'ignored';

/**
 * Optional: an employer's reply forwarded to a per-application address
 * `track+<token>@<inbound domain>`. Only metadata is kept. Bodies and attachments
 * are untrusted and are neither fetched, stored nor opened. The suggested stage
 * is advice for the candidate, never a status change.
 */
@Injectable()
export class InboundReplyService {
  constructor(private prisma: PrismaService, @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig) {}

  async handle(data: Record<string, unknown>): Promise<InboundOutcome> {
    if (!this.cfg.enabled || !this.cfg.inboundEnabled || !this.cfg.inboundDomain) return 'ignored';
    const providerEmailId = typeof data.email_id === 'string' && data.email_id.length <= 128 ? data.email_id : null;
    if (!providerEmailId) return 'ignored';
    const token = this.tokenFrom(data.to);
    if (!token) return 'ignored';
    const application = await this.prisma.emailApplication.findUnique({ where: { replyToken: token }, select: { id: true, deliveryState: true } });
    if (!application) return 'ignored';
    if ((await this.prisma.emailInboundMessage.count({ where: { emailApplicationId: application.id } })) >= MAX_REPLIES_PER_APPLICATION) return 'ignored';

    const subject = singleLine(typeof data.subject === 'string' ? data.subject : '').slice(0, 200);
    const from = singleLine(typeof data.from === 'string' ? data.from : '').slice(0, 254);
    const suggestion = suggestFromSubject(subject);
    const receivedAt = new Date(typeof data.created_at === 'string' ? data.created_at : NaN);
    try {
      await this.prisma.emailInboundMessage.create({
        data: {
          providerEmailId, emailApplicationId: application.id, fromAddress: from, subject, receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
          attachmentCount: Array.isArray(data.attachments) ? Math.min(data.attachments.length, 100) : 0,
          suggestedState: suggestion?.state ?? null, suggestionReason: suggestion?.reason ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'duplicate';
      throw error;
    }
    return 'stored';
  }

  private tokenFrom(to: unknown): string | null {
    const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const address = entry.includes('<') ? entry.slice(entry.lastIndexOf('<') + 1) : entry;
      const match = TRACK_ADDRESS.exec(address.trim());
      // Only addresses at the configured inbound domain count.
      if (match && match[2].toLowerCase() === this.cfg.inboundDomain) return match[1];
    }
    return null;
  }
}
