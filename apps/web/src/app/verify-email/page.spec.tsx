import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import VerifyEmailPage from '@/app/verify-email/page';
import { resetVerifyOnceCache } from '@/lib/verify-once';

const searchParams = new URLSearchParams();

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

describe('VerifyEmailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    searchParams.delete('token');
    resetVerifyOnceCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://127.0.0.1:4010');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts the token from the verification URL to the candidate API once on remount', async () => {
    searchParams.set('token', 'from-captured-mail');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'E-poçt uğurla təsdiqləndi.' }), { status: 200 }),
    );
    const { unmount } = render(<VerifyEmailPage />);
    await screen.findByText('E-poçt uğurla təsdiqləndi.');
    unmount();
    render(<VerifyEmailPage />);
    expect(await screen.findByText('E-poçt uğurla təsdiqləndi.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4010/auth/verify-email');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'from-captured-mail' });
  });

  it('shows an error for a missing or consumed link', async () => {
    render(<VerifyEmailPage />);
    expect(await screen.findByText('Təsdiq linki yanlışdır.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not POST again for an expired token after remount', async () => {
    searchParams.set('token', 'expired-token');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Təsdiq linki etibarsızdır və ya vaxtı bitib.' }), {
        status: 400,
      }),
    );
    const { unmount } = render(<VerifyEmailPage />);
    await screen.findByText('Təsdiq linki etibarsızdır və ya vaxtı bitib.');
    unmount();
    render(<VerifyEmailPage />);
    await screen.findByText('Təsdiq linki etibarsızdır və ya vaxtı bitib.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Yenidən cəhd et' })).not.toBeInTheDocument();
  });

  it('retries after a temporary failure without duplicating an in-flight request', async () => {
    searchParams.set('token', 'flaky-token');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'xidmət' }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'E-poçt uğurla təsdiqləndi.' }), { status: 200 }),
      );
    render(<VerifyEmailPage />);
    await screen.findByText('xidmət');
    fireEvent.click(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('E-poçt uğurla təsdiqləndi.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('posts the new token when the link changes', async () => {
    searchParams.set('token', 'first-token');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'ok-1' }), { status: 200 }));
    const { rerender } = render(<VerifyEmailPage />);
    await screen.findByText('ok-1');
    searchParams.set('token', 'second-token');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'ok-2' }), { status: 200 }));
    rerender(<VerifyEmailPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ token: 'second-token' });
  });
});
