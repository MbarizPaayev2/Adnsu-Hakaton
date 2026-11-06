import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminBusinessesPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/businesses',
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
  permissions: ['ops.read', 'companies.read', 'companies.moderate'],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('admin businesses page', () => {
  const companies = [
    {
      id: 'c1',
      name: 'Kapital Bank ASC',
      email: 'hr@kapitalbank.az',
      status: 'PENDING',
      rejectionReason: null,
      createdAt: '2026-10-01T10:00:00Z',
    },
    {
      id: 'c2',
      name: 'Paşa Həyat ASC',
      email: 'jobs@pashalife.az',
      status: 'APPROVED',
      rejectionReason: null,
      createdAt: '2026-09-20T10:00:00Z',
    },
  ];

  it('renders companies and approves a pending company', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      console.log('FETCH URL:', url);
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/companies')) return json({ data: companies, meta: { totalPages: 1, total: 2 } });
      if (url === '/api/admin/companies/c1/approve' && init?.method === 'PATCH') return json({ success: true });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminBusinessesPage />);
    });

    const kapital = await screen.findAllByText('Kapital Bank ASC');
    expect(kapital.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paşa Həyat ASC').length).toBeGreaterThan(0);

    const approveButtons = screen.getAllByRole('button', { name: /Təsdiqlə/ });
    await act(async () => {
      fireEvent.click(approveButtons[0]);
    });

    const approveCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/companies/c1/approve');
    expect(approveCall).toBeDefined();
    expect(approveCall![1]).toMatchObject({ method: 'PATCH' });
  });

  it('requires a reason to reject a company', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/companies?')) return json({ data: companies, meta: { totalPages: 1, total: 2 } });
      if (url === '/api/admin/companies/c1/reject' && init?.method === 'PATCH') return json({ success: true });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminBusinessesPage />);
    });

    const kapital = await screen.findAllByText('Kapital Bank ASC');
    expect(kapital.length).toBeGreaterThan(0);

    const rejectButtons = screen.getAllByRole('button', { name: /Rədd et/ });
    await act(async () => {
      fireEvent.click(rejectButtons[0]);
    });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Rədd et' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText('Səbəbi daxil edin...'), {
      target: { value: 'Sənədlər natamamdır' },
    });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    const rejectCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/companies/c1/reject');
    expect(rejectCall).toBeDefined();
    expect(JSON.parse(rejectCall![1].body)).toEqual({ reason: 'Sənədlər natamamdır' });
  });

  it('suspends an approved company with a reason and confirms suspension', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/companies?')) return json({ data: companies, meta: { totalPages: 1, total: 2 } });
      if (url === '/api/admin/companies/c2/suspend' && init?.method === 'POST') return json({ success: true });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminBusinessesPage />);
    });

    const pasha = await screen.findAllByText('Paşa Həyat ASC');
    expect(pasha.length).toBeGreaterThan(0);

    const suspendButtons = screen.getAllByRole('button', { name: /Dayandır/ });
    await act(async () => {
      fireEvent.click(suspendButtons[0]);
    });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Dayandır' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText('Səbəbi daxil edin...'), {
      target: { value: 'Müqavilə müddəti bitib' },
    });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    const suspendCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/companies/c2/suspend');
    expect(suspendCall).toBeDefined();
    expect(JSON.parse(suspendCall![1].body)).toEqual({ reason: 'Müqavilə müddəti bitib' });
  });
});
