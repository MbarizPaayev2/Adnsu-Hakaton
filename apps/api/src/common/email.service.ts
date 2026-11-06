import { Injectable } from '@nestjs/common';
import { appendFileSync } from 'fs';
import { Resend } from 'resend';

const DEFAULT_FROM = 'AISE <noreply@aisehr.com>';
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_DELIVERY_RECORDS = 100;

export class EmailDeliveryError extends Error {
  readonly code: string;

  constructor(code: string, message = 'Email delivery failed') {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = code;
  }
}

export type EmailSendResult = {
  id: string;
  mock: boolean;
};

export type EmailDeliveryRecord = {
  at: string;
  outcome: 'mock' | 'sent' | 'failed';
  attempts: number;
  errorCode?: string;
};

export type CapturedEmail = {
  to: string;
  subject: string;
  html: string;
  mock: boolean;
};

const MAX_CAPTURED_EMAILS = 50;

export type EmailSender = {
  emails: {
    send: (payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }, options?: { idempotencyKey?: string }) => Promise<{
      data: { id?: string } | null;
      error: { message?: string; name?: string } | null;
    }>;
  };
};

export type EmailServiceOptions = {
  apiKey?: string;
  nodeEnv?: string;
  from?: string;
  sender?: EmailSender;
  maxAttempts?: number;
  retryDelayMs?: number;
};

const MISSING_PRODUCTION_CONFIG_LOG =
  '[EMAIL CONFIG] NODE_ENV=production but RESEND_API_KEY is missing or a placeholder: verification and password-reset emails will NOT be sent.';

function isMockKey(apiKey: string | undefined): boolean {
  return !apiKey || apiKey.includes('mock');
}

function redactRecipient(to: string): string {
  const at = to.lastIndexOf('@');
  if (at <= 0) return '(redacted)';
  return `***@${to.slice(at + 1)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class EmailService {
  private sender: EmailSender | null = null;
  private isMock = true;
  private isProduction = false;
  private from = DEFAULT_FROM;
  private maxAttempts = DEFAULT_MAX_ATTEMPTS;
  private retryDelayMs = 0;
  private readonly deliveryRecords: EmailDeliveryRecord[] = [];
  private readonly capturedEmails: CapturedEmail[] = [];

  constructor() {
    this.configure({});
  }

  static forTests(options: EmailServiceOptions): EmailService {
    const service = new EmailService();
    service.configure(options);
    return service;
  }

  private configure(options: EmailServiceOptions): void {
    const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? '';
    this.isProduction = (options.nodeEnv ?? process.env.NODE_ENV) === 'production';
    this.isMock = isMockKey(apiKey);
    this.from = options.from ?? DEFAULT_FROM;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? 0;
    const resend = this.isMock ? null : new Resend(apiKey);
    this.sender = options.sender ?? (resend ? { emails: { send: async (payload, request) => {
      if (!request?.idempotencyKey) return resend.emails.send(payload);
      // The pinned SDK predates idempotency headers. Use the documented HTTP endpoint for digests only.
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.idempotencyKey },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000),
      });
      const body = await response.json();
      return response.ok ? { data: { id: body.id }, error: null } : { data: null, error: { name: body.name || `http_${response.status}` } };
    } } } : null);
    if (this.isProduction && this.isMock) {
      // Signup and password-reset responses stay generic when mail fails, so
      // without this line a missing/placeholder key on the host drops every
      // verification email with nothing in the logs.
      console.error(MISSING_PRODUCTION_CONFIG_LOG);
    }
  }

  getDeliveryRecords(): EmailDeliveryRecord[] {
    return [...this.deliveryRecords];
  }

  getCapturedEmails(): CapturedEmail[] {
    return this.capturedEmails.map((entry) => ({ ...entry }));
  }

  clearCapturedEmails(): void {
    this.capturedEmails.length = 0;
  }

  async send(to: string, subject: string, html: string, options?: { idempotencyKey?: string }): Promise<EmailSendResult> {
    if (this.isProduction && this.isMock) {
      this.record({ outcome: 'failed', attempts: 0, errorCode: 'missing_production_config' });
      console.error(`[EMAIL ERROR] Not sent to ${redactRecipient(to)} (missing_production_config)`);
      throw new EmailDeliveryError('missing_production_config', 'Email provider is not configured');
    }

    if (this.isMock || !this.sender) {
      const result: EmailSendResult = { id: `mock_${Date.now()}`, mock: true };
      this.record({ outcome: 'mock', attempts: 1 });
      this.capture({ to, subject, html, mock: true });
      console.log(`[EMAIL MOCK] Explicit mock delivery to ${redactRecipient(to)}: "${subject}"`);
      return result;
    }

    let lastError: EmailDeliveryError = new EmailDeliveryError('unknown');
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const { data, error } = await this.sender.emails.send({
          from: this.from,
          to,
          subject,
          html,
        }, options);

        if (error) {
          lastError = new EmailDeliveryError(
            error.name || 'provider_error',
            error.message || 'Email provider returned an error',
          );
        } else if (!data?.id) {
          lastError = new EmailDeliveryError('empty_provider_result', 'Email provider returned no message id');
        } else {
          this.record({ outcome: 'sent', attempts: attempt });
          this.capture({ to, subject, html, mock: false });
          return { id: data.id, mock: false };
        }
      } catch (error) {
        if (error instanceof EmailDeliveryError) {
          lastError = error;
        } else {
          lastError = new EmailDeliveryError('provider_exception', 'Email provider call failed');
        }
      }

      if (attempt < this.maxAttempts && this.retryDelayMs > 0) {
        await sleep(this.retryDelayMs);
      }
    }

    this.record({
      outcome: 'failed',
      attempts: this.maxAttempts,
      errorCode: lastError.code,
    });
    console.error(
      `[EMAIL ERROR] Failed to send email to ${redactRecipient(to)} after ${this.maxAttempts} attempt(s) (${lastError.code})`,
    );
    throw lastError;
  }

  private record(entry: Omit<EmailDeliveryRecord, 'at'>): void {
    this.deliveryRecords.push({ at: new Date().toISOString(), ...entry });
    if (this.deliveryRecords.length > MAX_DELIVERY_RECORDS) {
      this.deliveryRecords.shift();
    }
  }

  private capture(entry: CapturedEmail): void {
    if (this.isProduction) {
      return;
    }
    this.capturedEmails.push(entry);
    if (this.capturedEmails.length > MAX_CAPTURED_EMAILS) {
      this.capturedEmails.shift();
    }
    const sinkPath = process.env.EMAIL_SINK_PATH;
    if (!sinkPath) {
      return;
    }
    try {
      appendFileSync(sinkPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    } catch {
      // Sink is best-effort local/test tooling; delivery already succeeded.
    }
  }
}
