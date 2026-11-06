import { Injectable } from '@nestjs/common';
import {
  ConfirmSubmitRequest,
  ConfirmSubmitResponse,
  CreateSessionRequest,
  OtpRequest,
  OtpResponse,
  SessionResponse,
  SubmitAnswersRequest,
} from './external-apply.types';

/**
 * NOT_DELIVERED: the request provably never reached the worker (connection
 *   refused / host not resolvable), so no side effect can have happened.
 * HTTP: the worker answered with a non-2xx status (`status`).
 * UNKNOWN: timeout, reset or unreadable reply — the worker may have acted.
 */
export class ApplyWorkerError extends Error {
  constructor(
    readonly kind: 'NOT_DELIVERED' | 'HTTP' | 'UNKNOWN',
    readonly path: string,
    readonly status?: number,
  ) {
    // Status and route only: response bodies can echo candidate data.
    super(`apply-worker ${path} ${kind}${status ? ` ${status}` : ''}`);
  }
}

const NOT_DELIVERED_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function timeoutMs(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Thin HTTP client for apps/apply-worker. Plain fetch + bearer token.
@Injectable()
export class ApplyWorkerClient {
  private readonly baseUrl = process.env.APPLY_WORKER_URL || 'http://localhost:8100';
  private readonly token = process.env.APPLY_WORKER_TOKEN;

  private async raw(path: string, init: RequestInit, timeout: number): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeout),
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch (err: any) {
      const code = err?.cause?.code ?? err?.code;
      throw new ApplyWorkerError(NOT_DELIVERED_CODES.has(code) ? 'NOT_DELIVERED' : 'UNKNOWN', path);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ApplyWorkerError('HTTP', path, response.status);
    }
    return response;
  }

  private async request<T>(path: string, init: RequestInit, timeout: number): Promise<T> {
    const response = await this.raw(path, init, timeout);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApplyWorkerError('UNKNOWN', path, response.status);
    }
  }

  private get fillTimeout() {
    return timeoutMs('EXTERNAL_APPLY_FILL_TIMEOUT_MS', 180_000);
  }

  /** Final send / OTP: bounded so an attempt cannot stay in flight forever. */
  private get sendTimeout() {
    return timeoutMs('EXTERNAL_APPLY_SEND_TIMEOUT_MS', 120_000);
  }

  createSession(data: CreateSessionRequest): Promise<SessionResponse> {
    return this.request('/sessions', { method: 'POST', body: JSON.stringify(data) }, this.fillTimeout);
  }

  submitAnswers(applicationId: string, data: SubmitAnswersRequest): Promise<SessionResponse> {
    return this.request(`/sessions/${encodeURIComponent(applicationId)}/answers`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, this.fillTimeout);
  }

  confirmSubmit(applicationId: string, data: ConfirmSubmitRequest): Promise<ConfirmSubmitResponse> {
    return this.request(`/sessions/${encodeURIComponent(applicationId)}/confirm-submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, this.sendTimeout);
  }

  submitOtp(applicationId: string, data: OtpRequest): Promise<OtpResponse> {
    return this.request(`/sessions/${encodeURIComponent(applicationId)}/otp`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, this.sendTimeout);
  }

  async getScreenshot(applicationId: string): Promise<Buffer> {
    const response = await this.raw(`/sessions/${encodeURIComponent(applicationId)}/screenshot`, {}, 30_000);
    return Buffer.from(await response.arrayBuffer());
  }

  deleteSession(applicationId: string): Promise<{ ok: boolean }> {
    return this.request(`/sessions/${encodeURIComponent(applicationId)}`, { method: 'DELETE' }, 30_000);
  }

  async listLiveIds(): Promise<string[]> {
    const data = await this.request<{ liveIds: string[] }>('/sessions', { method: 'GET' }, 15_000);
    return Array.isArray(data?.liveIds) ? data.liveIds : [];
  }
}
