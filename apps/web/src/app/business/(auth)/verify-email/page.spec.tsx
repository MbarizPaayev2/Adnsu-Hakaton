import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BusinessVerifyEmailPage from '@/app/business/(auth)/verify-email/page';
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

describe('BusinessVerifyEmailPage', () => {
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

  it('posts once to the business API and reuses the result on remount', async () => {
    searchParams.set('token', 'biz-token');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'E-poçt uğurla təsdiqləndi.' }), { status: 200 }),
    );
    const { unmount } = render(<BusinessVerifyEmailPage />);
    await screen.findByText('E-poçt uğurla təsdiqləndi.');
    unmount();
    render(<BusinessVerifyEmailPage />);
    await screen.findByText('E-poçt uğurla təsdiqləndi.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4010/business/auth/verify-email');
  });

  it('retries a temporary business verify failure', async () => {
    searchParams.set('token', 'biz-flaky');
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'ok' }), { status: 200 }));
    render(<BusinessVerifyEmailPage />);
    await screen.findByRole('button', { name: 'Yenidən cəhd et' });
    fireEvent.click(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
