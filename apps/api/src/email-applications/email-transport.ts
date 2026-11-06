import type { EmailApplyConfig } from './email-apply.config';

export interface OutgoingAttachment { filename: string; content: Buffer; contentType: string }

/** One message with the approved attachments: the CV, and optionally the approved motivation letter. */
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo: string;
  bcc?: string;
  subject: string;
  text: string;
  attachments: OutgoingAttachment[];
  /** Provider tag used to correlate webhook events; an application id (no personal data). */
  applicationTag: string;
  /** Same for every retry of one approval so the provider can recognise a repeat. */
  idempotencyKey: string;
}

/**
 * What is known about the message after one call. `rejected` and `retryable`
 * mean the provider did not take it; `ambiguous` means it may have been taken
 * and must never be re-sent automatically.
 */
export type TransportResult =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'rejected'; code: string; status: number }
  | { kind: 'retryable'; code: string; status?: number; retryAfterMs?: number }
  | { kind: 'ambiguous'; code: string; status?: number };

export interface EmailTransport {
  send(message: OutgoingEmail): Promise<TransportResult>;
}

const PROVIDER_HOST = 'https://api.resend.com';
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_RESPONSE_BYTES = 64 * 1024;

const codeFrom = (name: unknown, status: number) => (typeof name === 'string' && /^[a-z][a-z_]{2,60}$/.test(name) ? name : `http_${status}`);

/** Resend's HTTP API (or a local capture server speaking the same protocol in sink mode). */
export class ResendTransport implements EmailTransport {
  constructor(private cfg: EmailApplyConfig, private timeoutMs = 30_000) {}

  private get base(): string {
    return this.cfg.transport === 'live' ? PROVIDER_HOST : this.cfg.sinkUrl.replace(/\/$/, '');
  }

  async send(message: OutgoingEmail): Promise<TransportResult> {
    const body = {
      from: message.from,
      to: [message.to],
      reply_to: message.replyTo,
      ...(message.bcc ? { bcc: [message.bcc] } : {}),
      subject: message.subject,
      text: message.text,
      attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
      tags: [{ name: 'application', value: message.applicationTag }],
    };
    let response: Response;
    try {
      response = await fetch(`${this.base}/emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.transport === 'live' ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      // No connection was ever made: nothing can have been accepted.
      if (code && CONNECT_ERRORS.has(code)) return { kind: 'retryable', code: `network_${code.toLowerCase()}` };
      // Timeout, reset or anything after the request may have left: the outcome is unknown.
      return { kind: 'ambiguous', code: (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError' ? 'timeout' : 'network_error' };
    }

    const status = response.status;
    let parsed: { id?: unknown; name?: unknown } = {};
    try {
      const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
      const json = JSON.parse(text);
      if (json && typeof json === 'object') parsed = json;
    } catch {
      /* A body we cannot read says nothing; the status code decides. */
    }

    if (status >= 200 && status < 300) {
      // Accepted but unreadable: it may well have been sent.
      return typeof parsed.id === 'string' && parsed.id ? { kind: 'accepted', messageId: parsed.id } : { kind: 'ambiguous', code: 'unreadable_acceptance', status };
    }
    if (status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return { kind: 'retryable', code: codeFrom(parsed.name, status), status, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: Math.min(retryAfter, 3600) * 1000 } : {}) };
    }
    if (status === 409) {
      // Another request with this key is still being processed: it may succeed.
      return parsed.name === 'concurrent_idempotent_requests' ? { kind: 'ambiguous', code: 'concurrent_idempotent_requests', status } : { kind: 'rejected', code: 'idempotency_conflict', status };
    }
    if (status === 401 || status === 403) return { kind: 'rejected', code: 'provider_auth', status };
    if (status >= 400 && status < 500) return { kind: 'rejected', code: codeFrom(parsed.name, status), status };
    return { kind: 'ambiguous', code: `http_${status}`, status };
  }
}
