import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminListingsPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/listings',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const adminMe = {
  id: 'a1',
  email: 'admin@example.test',
  name: null,
  role: 'ADMIN',
  mfaEnabled: true,
  permissions: ['ops.read', 'listings.read', 'listings.moderate'],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('admin listings page', () => {
  const listings = [
    {
      id: 'l1',
      source: 'glorri',
      title: 'Senior Frontend Developer',
      company: 'ABB Bank',
      url: 'https://example.test/vacancy/1',
      status: 'ACTIVE',
      deadline: '2026-11-01T00:00:00Z',
      lastSeenAt: '2026-10-02T10:00:00Z',
      closedReason: null,
      hiddenAt: null,
      hiddenReason: null,
      _count: { matches: 15 },
    },
    {
      id: 'l2',
      source: 'glorri',
      title: 'Backend Engineer',
      company: 'Kapital Bank',
      url: 'https://example.test/vacancy/2',
      status: 'ACTIVE',
      deadline: '2026-11-01T00:00:00Z',
      lastSeenAt: '2026-10-02T10:00:00Z',
      closedReason: null,
      hiddenAt: '2026-10-02T12:00:00Z',
      hiddenReason: 'Dublikat',
      _count: { matches: 8 },
    },
  ];

  it('renders listings and hides a listing with reason', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/listings?')) return json({ data: listings, meta: { total: 2, totalPages: 1 } });
      if (url === '/api/admin/listings/l1/hide' && init?.method === 'POST') return json({ success: true });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminListingsPage />);
    });

    const frontendJobs = await screen.findAllByText('Senior Frontend Developer');
    expect(frontendJobs.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Backend Engineer').length).toBeGreaterThan(0);

    const hideButtons = screen.getAllByRole('button', { name: /Gizlət/ });
    await act(async () => {
      fireEvent.click(hideButtons[0]);
    });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Gizlət' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText('Səbəbi daxil edin...'), {
      target: { value: 'Spam və ya yanlış məlumat' },
    });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    const hideCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/listings/l1/hide');
    expect(hideCall).toBeDefined();
    expect(JSON.parse(hideCall![1].body)).toEqual({ reason: 'Spam və ya yanlış məlumat' });
  });

  it('restores a hidden listing', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/listings?')) return json({ data: listings, meta: { total: 2, totalPages: 1 } });
      if (url === '/api/admin/listings/l2/restore' && init?.method === 'POST') return json({ success: true });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminListingsPage />);
    });

    const backendJobs = await screen.findAllByText('Backend Engineer');
    expect(backendJobs.length).toBeGreaterThan(0);

    const restoreButtons = screen.getAllByRole('button', { name: /Bərpa et/ });
    await act(async () => {
      fireEvent.click(restoreButtons[0]);
    });

    const restoreCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/listings/l2/restore');
    expect(restoreCall).toBeDefined();
    expect(restoreCall![1]).toMatchObject({ method: 'POST' });
  });
});
