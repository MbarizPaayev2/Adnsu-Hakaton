import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import OperationsPage from './operations/page';
import UsersPage from './users/page';
import SystemPage from './system/page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/operations', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const me = (permissions: string[]) => ({ id: 'a1', email: 'ops@example.com', name: null, role: 'ADMIN', mfaEnabled: false, permissions, environment: 'production' });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('operations page', () => {
  const routes = (perms: string[]) => async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/auth/me') return json(me(perms));
    if (url === '/api/admin/ops/overview') return json({ features: [{ key: 'external_apply.submissions', label: 'Avtomatik xarici müraciətlər', paused: false, reason: null, updatedAt: null }] });
    if (url === '/api/admin/ops/imports') return json({ runs: [{ id: 'r1', status: 'PARTIAL', startedAt: '2026-09-28T10:00:00Z', finishedAt: null, listed: 50, created: 2, updated: 1, closed: 0, detailFailures: 3, error: null }], paused: false });
    if (url === '/api/admin/ops/queues') return json({ counts: [{ name: 'job-ingested', waiting: 0, active: 0, delayed: 0, failed: 1, retryable: true }], failed: [
      { queue: 'job-ingested', id: '7', name: 'process-match', attemptsMade: 3, failedAt: null, reason: 'timeout', retryable: true },
      { queue: 'resume-tailor', id: '9', name: 'tailor', attemptsMade: 3, failedAt: null, reason: '[gizli]', retryable: false },
    ] });
    if (url === '/api/admin/ops/features/external_apply.submissions') return json([]);
    if (url.endsWith('/retry')) return json({ retried: true });
    throw new Error(`${url} ${init?.method}`);
  };

  it('pauses a feature only with a reason and retries only safe jobs', async () => {
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control']));
    await act(async () => { render(<OperationsPage />); });
    expect(await screen.findByText('Canlı (production)')).toBeInTheDocument();
    expect(screen.getByText('3 detal alınmadı')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dayandır' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Dayandır' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Səbəb/), { target: { value: 'Synthetic incident' } });
    await act(async () => { fireEvent.click(confirm); });
    const put = fetchMock.mock.calls.find(([u]) => u === '/api/admin/ops/features/external_apply.submissions')!;
    expect(put[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ paused: true, reason: 'Synthetic incident' }) });

    expect(screen.getAllByRole('button', { name: 'Təkrarla' })).toHaveLength(1);
    expect(screen.getByText('Buradan təkrarlanmır')).toBeInTheDocument();
  });

  it('shows read-only operators no control buttons', async () => {
    fetchMock.mockImplementation(routes(['ops.read']));
    await act(async () => { render(<OperationsPage />); });
    await screen.findByText('3 detal alınmadı');
    expect(screen.queryByRole('button', { name: 'Dayandır' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'İndi idxal et' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Təkrarla' })).not.toBeInTheDocument();
  });
});

describe('users page', () => {
  it('grants a time-limited plan override with a reason, separate from the payment subscription', async () => {
    const user = { id: 'u1', email: 'cand@example.com', name: null, emailVerified: '2026-09-01', createdAt: '2026-09-01', suspendedAt: null, suspendedReason: null, subscription: { plan: 'FREE', status: 'active' }, planOverrides: [], _count: { resumes: 1, matches: 2, applications: 0 } };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/me') return json(me(['users.read', 'users.plan', 'users.suspend']));
      if (url.startsWith('/api/admin/users?')) return json({ data: [user], meta: { total: 1, totalPages: 1 } });
      if (url === '/api/admin/users/u1/plan-overrides' && (!init || !init.method || init.method === 'GET')) return json({ subscription: { plan: 'FREE', status: 'active', currentPeriodEnd: null, providerManaged: false }, overrides: [] });
      if (url === '/api/admin/users/u1/plan-overrides') return json({ id: 'o1' }, 201);
      throw new Error(url);
    });
    await act(async () => { render(<UsersPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /cand@example\.com/ })); });
    expect(screen.getByText(/Ödəniş müqaviləsi buradan dəyişdirilmir/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hesabı sil' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gün (1–365)'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Səbəb'), { target: { value: 'Pilot partner' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'İstisna ver' })); });
    const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/admin/users/u1/plan-overrides' && i?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ plan: 'Limitsiz', reason: 'Pilot partner', days: 14 });
    expect(await screen.findByRole('status')).toHaveTextContent('14 gün');
  });
});

describe('system page', () => {
  it('says it does not deploy and never reports an unknown backup as healthy', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(me(['ops.read']));
      if (url === '/api/admin/ops/health') return json({ environment: 'production', release: { sha: 'abcdef1234567890', builtAt: null }, uptimeSeconds: 600, services: { database: { ok: true, ms: 2 }, redis: { ok: true, ms: 1 }, matching: { ok: false, ms: 3000, error: 'HTTP 503' }, applyWorker: { ok: true, ms: 5 } }, backup: { known: false, reason: 'BACKUP_STATUS_FILE qurulmayıb' } });
      throw new Error(url);
    });
    await act(async () => { render(<SystemPage />); });
    expect(await screen.findByText(/kodu yerləşdirmir/)).toBeInTheDocument();
    expect(screen.getByText('abcdef123456')).toBeInTheDocument();
    expect(screen.getByText('Əlçatmaz')).toBeInTheDocument();
    expect(screen.getByText(/“yaxşı” sayılmır/)).toBeInTheDocument();
  });
});
