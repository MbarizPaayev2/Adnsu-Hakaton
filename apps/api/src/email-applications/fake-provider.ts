import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { createHash, randomUUID } from 'crypto';
import { signSvix } from './svix-verify';

/**
 * A local stand-in for the e-mail provider's HTTP API, used as the "local email
 * sink" for development and in tests. It speaks the same request/response shapes
 * as the real provider for sending, honours Idempotency-Key, can misbehave on
 * demand, and can sign and deliver webhook events. It binds to loopback only
 * and never sends anything anywhere.
 */
export type FakeBehavior =
  | 'ok'
  | { status: number; body?: Record<string, unknown>; headers?: Record<string, string> }
  | 'record-then-hang' // message captured, no response (client times out) -> ambiguous
  | 'hang' // nothing captured, no response
  | 'record-then-reset' // captured, connection reset
  | 'garbled-accept'; // 200 without a usable id

export interface CapturedMessage {
  id: string;
  idempotencyKey: string;
  receivedAt: string;
  from: string;
  to: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  text: string;
  tags: Record<string, string>;
  attachments: { filename: string; contentType: string; bytes: number; sha256: string; content: Buffer }[];
}

export class FakeProvider {
  readonly messages: CapturedMessage[] = [];
  readonly requests: { idempotencyKey: string | undefined; authorization: string | undefined; ok: boolean }[] = [];
  private behaviors: FakeBehavior[] = [];
  private seen = new Map<string, { hash: string; id: string }>();
  private server!: Server;
  private sockets = new Set<import('net').Socket>();
  url = '';
  /** Where `POST /control/emit` delivers signed webhook events (set by the standalone sink). */
  webhook?: { url: string; secret: string };

  /** Next responses, consumed in order; when empty the server behaves normally. */
  queue(...behaviors: FakeBehavior[]) { this.behaviors.push(...behaviors); }

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    await new Promise<void>((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(this.page());
    }
    const attachment = /^\/messages\/([^/]+)\/attachment\/(\d+)$/.exec(req.url ?? '');
    if (req.method === 'GET' && attachment) {
      const file = this.messages.find((m) => m.id === attachment[1])?.attachments[Number(attachment[2])];
      if (!file) return send(404, { name: 'not_found' });
      res.writeHead(200, { 'content-type': file.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"` });
      return void res.end(file.content);
    }
    if (req.method === 'POST' && req.url === '/control/behavior') {
      try { this.queue(...(JSON.parse(raw.toString('utf8')).behaviors ?? [])); return send(200, { queued: this.behaviors.length }); } catch { return send(400, { name: 'invalid_json' }); }
    }
    if (req.method === 'POST' && req.url === '/control/reset') { this.messages.length = 0; this.requests.length = 0; this.behaviors = []; this.seen.clear(); return send(200, { ok: true }); }
    if (req.method === 'POST' && req.url === '/control/emit') {
      if (!this.webhook) return send(409, { name: 'no_webhook_configured' });
      try {
        const { type, messageId, applicationTag, data } = JSON.parse(raw.toString('utf8'));
        return send(200, await this.emit(this.webhook.url, this.webhook.secret, { type, messageId, applicationTag, data }));
      } catch { return send(400, { name: 'invalid_json' }); }
    }
    if (req.method === 'GET' && req.url === '/messages') {
      return send(200, this.messages.map((m) => ({ ...m, attachments: m.attachments.map(({ content: _c, ...rest }) => rest) })));
    }
    if (req.method !== 'POST' || req.url !== '/emails') return send(404, { name: 'not_found', message: 'no such route' });

    const behavior = this.behaviors.shift() ?? 'ok';
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (behavior === 'hang') { this.requests.push({ idempotencyKey, authorization: req.headers.authorization, ok: false }); return; }
    if (typeof behavior === 'object') {
      this.requests.push({ idempotencyKey, authorization: req.headers.authorization, ok: false });
      return send(behavior.status, behavior.body ?? { name: 'provider_error', message: 'synthetic' }, behavior.headers);
    }

    let body: any;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(400, { name: 'invalid_json', message: 'bad body' }); }
    const hash = createHash('sha256').update(raw).digest('hex');
    if (idempotencyKey && this.seen.has(idempotencyKey)) {
      const prior = this.seen.get(idempotencyKey)!;
      this.requests.push({ idempotencyKey, authorization: req.headers.authorization, ok: true });
      return prior.hash === hash ? send(200, { id: prior.id }) : send(409, { name: 'invalid_idempotent_request', message: 'different payload' });
    }
    const id = `fake_${randomUUID()}`;
    const attachments = (body.attachments ?? []).map((a: any) => {
      const content = Buffer.from(String(a.content ?? ''), 'base64');
      return { filename: a.filename, contentType: a.content_type ?? '', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), content };
    });
    this.messages.push({
      id, idempotencyKey: idempotencyKey ?? '', receivedAt: new Date().toISOString(), from: body.from, to: body.to ?? [], bcc: body.bcc ?? [], replyTo: body.reply_to ?? '',
      subject: body.subject, text: body.text ?? '', tags: Object.fromEntries((body.tags ?? []).map((t: any) => [t.name, t.value])), attachments,
    });
    if (idempotencyKey) this.seen.set(idempotencyKey, { hash, id });
    this.requests.push({ idempotencyKey, authorization: req.headers.authorization, ok: true });
    if (behavior === 'record-then-hang') return;
    if (behavior === 'record-then-reset') return void req.socket.destroy();
    if (behavior === 'garbled-accept') return send(200, { ok: true });
    return send(200, { id });
  }

  private page(): string {
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const rows = this.messages.map((m) => `<article><h2>${esc(m.subject)}</h2><p>To: ${esc(m.to.join(', '))} &middot; Reply-To: ${esc(m.replyTo)}${m.bcc.length ? ` &middot; Bcc: ${esc(m.bcc.join(', '))}` : ''}</p>
<p>id <code>${esc(m.id)}</code> &middot; application <code>${esc(m.tags.application ?? '')}</code> &middot; idempotency <code>${esc(m.idempotencyKey)}</code></p>
<pre>${esc(m.text)}</pre>${m.attachments.map((a, i) => `<p>Attachment: <a href="/messages/${encodeURIComponent(m.id)}/attachment/${i}">${esc(a.filename)}</a> (${a.bytes} bytes, sha256 <code>${a.sha256}</code>)</p>`).join('')}</article>`).join('');
    return `<!doctype html><meta charset="utf-8"><title>Local e-mail sink</title><style>body{font:16px system-ui;margin:2rem;max-width:60rem}article{border:1px solid #888;padding:1rem;margin:1rem 0;border-radius:.5rem}pre{white-space:pre-wrap}</style>
<h1>Local e-mail sink</h1><p>Messages captured here never leave this machine. ${this.messages.length} captured.</p>${rows || '<p>No messages yet.</p>'}`;
  }

  /** Signs and delivers one webhook event to the API under test. */
  async emit(webhookUrl: string, secret: string, event: { type: string; messageId: string; applicationTag?: string; createdAt?: string; to?: string[]; data?: Record<string, unknown> }, svixId = `msg_${randomUUID()}`, opts: { tamper?: boolean; timestampSeconds?: number } = {}) {
    const payload = JSON.stringify({ type: event.type, created_at: event.createdAt ?? new Date().toISOString(), data: { email_id: event.messageId, from: 'AISE <applications@aise.example>', to: event.to ?? [], subject: 'synthetic', tags: event.applicationTag ? { application: event.applicationTag } : {}, ...(event.data ?? {}) } });
    const headers = signSvix(secret, svixId, payload, opts.timestampSeconds);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-id': headers.id, 'svix-timestamp': headers.timestamp, 'svix-signature': headers.signature },
      body: opts.tamper ? payload.replace('email.', 'email.x') : payload,
    });
    return { status: response.status, svixId };
  }
}
