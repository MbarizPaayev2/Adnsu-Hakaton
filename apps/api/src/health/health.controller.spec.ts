import { HealthController } from './health.controller';

describe('HealthController', () => {
  const res = () => ({ status: jest.fn() });
  const make = (db: () => Promise<unknown>, ping: () => Promise<string>) =>
    new HealthController({ $queryRaw: db } as any, { client: Promise.resolve({ ping }) } as any);

  afterEach(() => { delete process.env.RELEASE_SHA; });

  it('is ready when the database and Redis answer, and names only the short release', async () => {
    process.env.RELEASE_SHA = '9e9b83f0123456789abcdef';
    const r = res();
    const body = await make(async () => 1, async () => 'PONG').ready(r as any);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' }, release: '9e9b83f01234' });
  });

  it('returns 503 without error details when a dependency fails', async () => {
    const r = res();
    const body = await make(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'); }, async () => 'PONG').ready(r as any);
    expect(r.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ status: 'unavailable', checks: { database: 'fail', redis: 'ok' }, release: null });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
  });

  it('treats a hung dependency as not ready', async () => {
    jest.useFakeTimers();
    const r = res();
    const pending = make(() => new Promise(() => undefined), async () => 'PONG').ready(r as any);
    jest.advanceTimersByTime(2100);
    await expect(pending).resolves.toMatchObject({ status: 'unavailable' });
    jest.useRealTimers();
  });
});
