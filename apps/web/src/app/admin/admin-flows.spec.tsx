import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminLoginPage from './page';
import AdminOperatorsPage from './operators/page';
import AdminAccountPage from './account/page';
import { AdminHeader, type AdminMe } from '@/components/admin-header';

const { push, router } = vi.hoisted(() => { const push = vi.fn(); return { push, router: { push } }; });
// Stable like the real Next router.
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/operators', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const superMe = { id: 'u1', email: 'ceo@aisehr.com', name: null, role: 'SUPER_ADMIN', mfaEnabled: true, permissions: ['self', 'companies.read', 'companies.moderate', 'users.read', 'users.plan', 'users.delete', 'vacancies.read', 'audit.read', 'system.restart', 'operators.manage'] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

describe('admin login', () => {
  it('asks for the second factor after the password and only then enters the panel', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/login') return json({ mfaRequired: true });
      if (url === '/api/admin/auth/mfa') return JSON.parse(String(init?.body)).code === '123456' ? json({ success: true }) : json({ message: 'Kod yanlışdır' }, 401);
      throw new Error(url);
    });
    render(<AdminLoginPage />);
    fireEvent.change(screen.getByLabelText('E-poçt'), { target: { value: 'ceo@aisehr.com' } });
    fireEvent.change(screen.getByLabelText('Şifrə'), { target: { value: 'secret-password' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Daxil ol' })); });
    expect(push).not.toHaveBeenCalled();
    const code = screen.getByLabelText(/6 rəqəmli kod/);
    fireEvent.change(code, { target: { value: '000000' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' })); });
    expect(await screen.findByText('Kod yanlışdır')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/6 rəqəmli kod/), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' })); });
    expect(push).toHaveBeenCalledWith('/admin/overview');
  });
});

describe('admin header', () => {
  it('shows only the sections the role may use', () => {
    render(<AdminHeader me={{ ...superMe, role: 'SUPPORT', permissions: ['self', 'companies.read', 'users.read', 'vacancies.read', 'ops.read'] } as AdminMe} />);
    expect(screen.getByRole('link', { name: 'Bizneslər' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hesabım' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Operatorlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Deploy' })).not.toBeInTheDocument();
  });
});

describe('operators page', () => {
  it('explains that a second-factor session is required instead of showing a broken list', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json({ ...superMe, mfaEnabled: false });
      if (url === '/api/admin/operators') return json({ message: 'MFA lazımdır', reason: 'MFA_REQUIRED' }, 403);
      throw new Error(url);
    });
    await act(async () => { render(<AdminOperatorsPage />); });
    expect(await screen.findByRole('alert')).toHaveTextContent('iki mərhələli təsdiq tələb olunur');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('invites, changes a role after confirmation and never offers actions against oneself', async () => {
    const operators = [
      { id: 'u1', email: 'ceo@aisehr.com', name: null, role: 'SUPER_ADMIN', disabledAt: null, mfaEnabled: true, lastLoginAt: null, createdAt: '2026-09-01' },
      { id: 'u2', email: 'ops@example.com', name: 'Ops', role: 'ADMIN', disabledAt: null, mfaEnabled: false, lastLoginAt: null, createdAt: '2026-09-02' },
    ];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(superMe);
      if (url === '/api/admin/operators' && (!init || init.method === 'GET')) return json({ operators, invitations: [] });
      if (url === '/api/admin/operators/invitations') return json({ id: 'i1', deliveryStatus: 'SENT' }, 201);
      if (url === '/api/admin/operators/u2/role') return json({ id: 'u2', role: 'SUPPORT' });
      throw new Error(url);
    });
    await act(async () => { render(<AdminOperatorsPage />); });
    await screen.findByText('ops@example.com');
    const ownRow = screen.getByText(/ceo@aisehr\.com \(siz\)/).closest('tr')!;
    expect(ownRow.querySelectorAll('button')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('E-poçt'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'SUPPORT' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dəvət göndər' })); });
    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/admin/operators/invitations')![1].body)).toEqual({ email: 'new@example.com', role: 'SUPPORT' });
    expect(await screen.findByRole('status')).toHaveTextContent('dəvət göndərildi');

    await act(async () => { fireEvent.change(screen.getByLabelText('ops@example.com rolu'), { target: { value: 'SUPPORT' } }); });
    expect(window.confirm).toHaveBeenCalled();
    const roleCall = fetchMock.mock.calls.find(([u]) => u === '/api/admin/operators/u2/role')!;
    expect(roleCall[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ role: 'SUPPORT' }) });
  });
});

describe('account page', () => {
  it('enrols MFA with a code and shows the recovery codes once', async () => {
    let enabled = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json({ ...superMe, mfaEnabled: enabled });
      if (url === '/api/admin/account/sessions') return json([{ id: 's1', createdAt: '2026-09-28', lastSeenAt: null, expires: '2026-10-05', userAgent: 'Chrome', mfaVerified: false, current: true }]);
      if (url === '/api/admin/account/mfa/setup') return json({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' });
      if (url === '/api/admin/account/mfa/enable') { enabled = true; return json({ recoveryCodes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'] }); }
      throw new Error(url);
    });
    await act(async () => { render(<AdminAccountPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Quraşdırmağa başla' })); });
    expect(screen.getByLabelText('Açar')).toHaveTextContent('JBSW Y3DP');
    fireEvent.change(screen.getByLabelText('Tətbiqdəki 6 rəqəmli kod'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə və aktivləşdir' })); });
    expect(screen.getByRole('list', { name: 'Bərpa kodları' })).toHaveTextContent('aaaa-bbbb-cccc');
    fireEvent.click(screen.getByRole('button', { name: 'Saxladım, gizlət' }));
    await waitFor(() => expect(screen.queryByText('aaaa-bbbb-cccc')).not.toBeInTheDocument());
    expect(screen.getByText(/Aktivdir/)).toBeInTheDocument();
  });
});
