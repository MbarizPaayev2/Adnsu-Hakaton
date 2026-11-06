import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminEmployerPurchasesPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/employer-purchases', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

const me = (permissions: string[]) => ({ id: 'a1', email: 'ops@example.com', name: null, role: 'ADMIN', mfaEnabled: true, permissions });
const rows = [
  { id: 'cmpurchase00000001', kind: 'SINGLE_30D', status: 'PAID', amountMinor: 2000, currency: 'AZN', createdAt: '2026-10-11T08:00:00.000Z', paidAt: '2026-10-11T08:01:00.000Z', refundedAt: null, refundReason: null, company: { id: 'c1', name: 'Nümunə MMC', status: 'APPROVED' }, credit: { status: 'AVAILABLE', consumedVacancyId: null, consumedAt: null } },
];

describe('AdminEmployerPurchasesPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());
  const wire = (permissions: string[]) => fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/auth/me')) return new Response(JSON.stringify(me(permissions)), { status: 200 });
    if (url.includes('/refund')) return new Response(JSON.stringify({ purchaseId: 'x', outcome: 'employer_refund_pending' }), { status: 201 });
    if (url.includes('employer-purchases')) return new Response(JSON.stringify(rows), { status: 200 });
    return new Response('{}', { status: 200 });
  });

  it('shows the amount in AZN (2000 qəpik = 20.00 AZN) and sends a refund only with a reason', async () => {
    wire(['self', 'companies.read', 'payments.refund']);
    await act(async () => { render(<AdminEmployerPurchasesPage />); });
    expect(await screen.findByText(/Nümunə MMC · 20\.00 AZN/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Geri ödə/ })); });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Geri ödə' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText('Səbəbi daxil edin...'), { target: { value: 'İstifadə olunmamış kredit, tələb olundu' } });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/employer-purchases/cmpurchase00000001/refund', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u]) => String(u).includes('/refund'))![1] as RequestInit).body));
    expect(body).toEqual({ reason: 'İstifadə olunmamış kredit, tələb olundu', endListing: false });
  });

  it('offers no refund button without the refund permission', async () => {
    wire(['self', 'companies.read']);
    await act(async () => { render(<AdminEmployerPurchasesPage />); });
    await screen.findByText(/Nümunə MMC/);
    expect(screen.queryByRole('button', { name: /Geri ödə/ })).toBeNull();
  });
});
