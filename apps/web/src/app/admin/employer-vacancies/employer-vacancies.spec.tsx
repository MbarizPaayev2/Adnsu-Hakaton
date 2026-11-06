import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminEmployerVacanciesPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/employer-vacancies', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

const me = { id: 'a1', email: 'ops@example.com', name: null, role: 'ADMIN', mfaEnabled: true, permissions: ['self', 'listings.read', 'listings.moderate'] };
const pending = [{
  id: 'v1', title: 'Baş mühasib', description: 'Hesabatların hazırlanması', requirements: 'Ali təhsil', responsibilities: null, location: 'Bakı', deadline: null,
  submittedAt: '2026-10-11T08:00:00.000Z', company: { id: 'c1', name: 'Nümunə MMC', status: 'APPROVED', website: 'nümunə.az' }, checks: ['SPAM_TERMS'],
}];

describe('AdminEmployerVacanciesPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/me') || url.includes('/me')) return new Response(JSON.stringify(me), { status: 200 });
      if (url.endsWith('employer-vacancies/pending')) return new Response(JSON.stringify(pending), { status: 200 });
      if (url.endsWith('/api/admin/vacancies')) return new Response(JSON.stringify([{ id: 'v9', title: 'Satış meneceri', status: 'ACTIVE', createdAt: '2026-10-10T08:00:00.000Z', deadline: null, company: { name: 'Nümunə MMC' } }]), { status: 200 });
      if (url.includes('/vacancies/v9/remove')) return new Response(JSON.stringify({ removed: true }), { status: 201 });
      if (url.includes('/approve')) return new Response(JSON.stringify({ id: 'v1', status: 'APPROVED' }), { status: 200 });
      if (url.includes('/reject')) return new Response(JSON.stringify({ id: 'v1', status: 'REJECTED' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists submitted vacancies with the automatic check findings and approves one without any payment wording', async () => {
    await act(async () => { render(<AdminEmployerVacanciesPage />); });
    expect(await screen.findByText('Baş mühasib')).toBeInTheDocument();
    expect(screen.getByText('Spam və ya aldadıcı ifadələr')).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Təsdiqlə/ })); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/employer-vacancies/v1/approve', expect.objectContaining({ method: 'PATCH' })));
  });

  it('lets an operator with the removal permission take a vacancy off the platform only after a confirmation with a reason', async () => {
    const withRemove = { ...me, permissions: [...me.permissions, 'vacancies.remove'] };
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me') || url.includes('/me')) return new Response(JSON.stringify(withRemove), { status: 200 });
      if (url.endsWith('employer-vacancies/pending')) return new Response('[]', { status: 200 });
      if (url.endsWith('/api/admin/vacancies')) return new Response(JSON.stringify([{ id: 'v9', title: 'Satış meneceri', status: 'ACTIVE', createdAt: '2026-10-10T08:00:00.000Z', deadline: null, company: { name: 'Nümunə MMC' } }]), { status: 200 });
      return new Response(JSON.stringify({ removed: true }), { status: 201 });
    });
    await act(async () => { render(<AdminEmployerVacanciesPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Sil$|Sil$/ })); });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/remove'), expect.anything());
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Sil' });
    expect(confirm).toBeDisabled(); // a reason is required
    await act(async () => { fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Saxta elan' } }); });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Sil' })); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/vacancies/v9/remove', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Saxta elan' }) })));
  });
});
