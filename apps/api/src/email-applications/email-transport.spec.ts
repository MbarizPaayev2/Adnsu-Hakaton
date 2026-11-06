import { FakeProvider } from './fake-provider';
import { ResendTransport, type OutgoingEmail } from './email-transport';
import { loadEmailApplyConfig } from './email-apply.config';

const message = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  from: 'AISE <applications@aise.example>', to: 'jobs@employer.example', replyTo: 'candidate@example.com', subject: 'Application - Analyst', text: 'Hello',
  attachments: [{ filename: 'cv.pdf', content: Buffer.from('%PDF-synthetic'), contentType: 'application/pdf' }], applicationTag: 'app_1', idempotencyKey: 'aise-ea:app_1:1', ...over,
});

describe('provider transport and outcome classification', () => {
  const provider = new FakeProvider();
  let transport: ResendTransport;
  beforeAll(async () => {
    const url = await provider.start();
    transport = new ResendTransport(loadEmailApplyConfig({ EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_SINK_URL: url } as never), 400);
  });
  afterAll(() => provider.stop());
  beforeEach(() => { provider.messages.length = 0; provider.requests.length = 0; });

  it('sends the approved bytes, reply-to, tag and idempotency key, and reads the message id', async () => {
    const result = await transport.send(message({ bcc: 'candidate@example.com' }));
    expect(result).toMatchObject({ kind: 'accepted', messageId: expect.stringMatching(/^fake_/) });
    const [captured] = provider.messages;
    expect(captured).toMatchObject({ to: ['jobs@employer.example'], bcc: ['candidate@example.com'], replyTo: 'candidate@example.com', subject: 'Application - Analyst', tags: { application: 'app_1' }, idempotencyKey: 'aise-ea:app_1:1' });
    expect(captured.attachments[0].content.equals(Buffer.from('%PDF-synthetic'))).toBe(true);
    expect(provider.requests[0].authorization).toBeUndefined(); // sink mode never carries the provider key
  });

  it('a repeat with the same key is recognised and not captured twice', async () => {
    const key = `aise-ea:repeat:${Date.now()}`;
    const first = await transport.send(message({ idempotencyKey: key }));
    const again = await transport.send(message({ idempotencyKey: key }));
    expect(again).toEqual(first);
    expect(provider.messages).toHaveLength(1);
    expect(await transport.send(message({ idempotencyKey: key, subject: 'Changed' }))).toMatchObject({ kind: 'rejected', code: 'idempotency_conflict' });
  });

  it.each([
    [{ status: 422, body: { name: 'validation_error' } }, { kind: 'rejected', code: 'validation_error' }],
    [{ status: 401 }, { kind: 'rejected', code: 'provider_auth' }],
    [{ status: 403 }, { kind: 'rejected', code: 'provider_auth' }],
    [{ status: 429, body: { name: 'rate_limit_exceeded' }, headers: { 'retry-after': '2' } }, { kind: 'retryable', code: 'rate_limit_exceeded', retryAfterMs: 2000 }],
    [{ status: 500 }, { kind: 'ambiguous', code: 'http_500' }],
    [{ status: 503 }, { kind: 'ambiguous', code: 'http_503' }],
    [{ status: 409, body: { name: 'concurrent_idempotent_requests' } }, { kind: 'ambiguous', code: 'concurrent_idempotent_requests' }],
  ] as const)('classifies %j as %j', async (behavior, expected) => {
    provider.queue(behavior as never);
    expect(await transport.send(message())).toMatchObject(expected);
  });

  it('treats a timeout, a reset and an unreadable acceptance as ambiguous (never as safe to resend)', async () => {
    provider.queue('record-then-hang');
    expect(await transport.send(message({ idempotencyKey: 'k-hang' }))).toMatchObject({ kind: 'ambiguous', code: 'timeout' });
    provider.queue('record-then-reset');
    expect(await transport.send(message({ idempotencyKey: 'k-reset' }))).toMatchObject({ kind: 'ambiguous' });
    provider.queue('garbled-accept');
    expect(await transport.send(message({ idempotencyKey: 'k-garbled' }))).toMatchObject({ kind: 'ambiguous', code: 'unreadable_acceptance' });
  });

  it('treats a refused connection as safe to retry because nothing could have been accepted', async () => {
    const closed = new FakeProvider(); const closedUrl = await closed.start(); await closed.stop();
    const dead = new ResendTransport(loadEmailApplyConfig({ EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_SINK_URL: closedUrl } as never), 400);
    expect(await dead.send(message())).toMatchObject({ kind: 'retryable', code: 'network_econnrefused' });
  });
});
