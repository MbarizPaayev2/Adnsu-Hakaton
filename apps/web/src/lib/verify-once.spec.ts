import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetVerifyOnceCache, verifyEmailOnce } from './verify-once';

describe('verifyEmailOnce', () => {
  beforeEach(() => {
    resetVerifyOnceCache();
  });

  it('reuses one in-flight POST for the same token', async () => {
    let resolve!: (value: Response) => void;
    const post = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );

    const first = verifyEmailOnce('token-a', post);
    const second = verifyEmailOnce('token-a', post);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    resolve(
      new Response(JSON.stringify({ message: 'E-poçt uğurla təsdiqləndi.' }), { status: 200 }),
    );
    await expect(first).resolves.toMatchObject({ status: 'success', retryable: false });
    await expect(second).resolves.toMatchObject({ status: 'success' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not POST again after a successful or consumed response', async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }));
    await verifyEmailOnce('token-ok', post);
    await verifyEmailOnce('token-ok', post);
    expect(post).toHaveBeenCalledTimes(1);

    resetVerifyOnceCache();
    const consumed = vi.fn(
      async () => new Response(JSON.stringify({ message: 'etibarsız' }), { status: 400 }),
    );
    await verifyEmailOnce('token-dead', consumed);
    await verifyEmailOnce('token-dead', consumed);
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('allows a genuine retry after a temporary failure', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'down' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'ok' }), { status: 200 }));

    await expect(verifyEmailOnce('token-retry', post)).resolves.toMatchObject({
      status: 'error',
      retryable: true,
    });
    await expect(verifyEmailOnce('token-retry', post)).resolves.toMatchObject({
      status: 'success',
      retryable: false,
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('posts separately when the token changes', async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }));
    await verifyEmailOnce('token-one', post);
    await verifyEmailOnce('token-two', post);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('treats network failures as retryable', async () => {
    const post = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(verifyEmailOnce('token-net', post)).resolves.toMatchObject({
      status: 'error',
      retryable: true,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
