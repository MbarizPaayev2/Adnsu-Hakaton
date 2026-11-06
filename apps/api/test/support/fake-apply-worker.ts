import * as http from 'http';
import { AddressInfo } from 'net';

/**
 * Loopback stand-in for apps/apply-worker's HTTP contract. It never opens a
 * browser or contacts any destination; each route's reply is scripted by the
 * test so AISE's claim/settle logic can be driven through timeouts, resets,
 * forged replies and receipts. Every request is recorded (bodies included:
 * they hold synthetic data only).
 */
export interface Recorded {
  method: string;
  path: string;
  body: any;
}

type Handler = (req: Recorded, res: http.ServerResponse) => void | Promise<void>;

export class FakeApplyWorker {
  readonly calls: Recorded[] = [];
  readonly live = new Set<string>();
  handlers: Partial<Record<'create' | 'answers' | 'confirm' | 'otp', Handler>> = {};
  private server?: http.Server;
  private sockets = new Set<import('net').Socket>();

  constructor(private readonly token: string) {}

  static json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  count(route: 'confirm-submit' | 'otp' | 'answers' | 'create') {
    return this.calls.filter((c) => (route === 'create' ? c.method === 'POST' && c.path === '/sessions' : c.path.endsWith(`/${route}`))).length;
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', async () => {
        if (req.headers.authorization !== `Bearer ${this.token}`) return FakeApplyWorker.json(res, 401, { message: 'Unauthorized' });
        const path = (req.url || '').split('?')[0];
        const recorded = { method: req.method || '', path, body: raw ? JSON.parse(raw) : undefined };
        this.calls.push(recorded);
        const id = decodeURIComponent(path.split('/')[2] || '');
        try {
          if (req.method === 'POST' && path === '/sessions') {
            if (this.handlers.create) return await this.handlers.create(recorded, res);
            this.live.add(recorded.body.applicationId);
            return FakeApplyWorker.json(res, 201, { status: 'READY_FOR_REVIEW', previewData: { line_0: 'Sintetik icmal' }, missingFields: [] });
          }
          if (req.method === 'GET' && path === '/sessions') return FakeApplyWorker.json(res, 200, { liveIds: [...this.live] });
          if (req.method === 'GET' && path.endsWith('/screenshot')) {
            if (!this.live.has(id)) return FakeApplyWorker.json(res, 404, {});
            res.writeHead(200, { 'Content-Type': 'image/png' });
            return res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
          }
          if (req.method === 'DELETE') {
            this.live.delete(id);
            return FakeApplyWorker.json(res, 200, { ok: true });
          }
          if (!this.live.has(id)) {
            if (path.endsWith('/answers')) return FakeApplyWorker.json(res, 404, {});
            return FakeApplyWorker.json(res, 200, { attemptId: recorded.body?.attemptId, outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' });
          }
          if (path.endsWith('/answers')) {
            if (this.handlers.answers) return await this.handlers.answers(recorded, res);
            return FakeApplyWorker.json(res, 200, { status: 'READY_FOR_REVIEW', previewData: { line_0: 'Yenilənmiş icmal' }, missingFields: [] });
          }
          if (path.endsWith('/confirm-submit')) {
            if (this.handlers.confirm) return await this.handlers.confirm(recorded, res);
            this.live.delete(id);
            return FakeApplyWorker.json(res, 200, { attemptId: recorded.body.attemptId, outcome: 'SENT_OBSERVED', observation: { url: 'https://jobs.glorri.com/done', text: 'Təşəkkürlər' } });
          }
          if (path.endsWith('/otp')) {
            if (this.handlers.otp) return await this.handlers.otp(recorded, res);
            this.live.delete(id);
            return FakeApplyWorker.json(res, 200, { attemptId: recorded.body.attemptId, outcome: 'SENT_OBSERVED' });
          }
          FakeApplyWorker.json(res, 404, {});
        } catch {
          if (!res.headersSent) FakeApplyWorker.json(res, 500, {});
        }
      });
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
