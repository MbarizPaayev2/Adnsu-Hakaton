import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminSourcesPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } })); // a stable object: the header hook depends on it
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/sources', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const me = (permissions: string[]) => ({ id: 'a1', email: 'ops@example.com', name: null, role: 'ADMIN', mfaEnabled: false, permissions, environment: 'production' });
const source = (over: Record<string, unknown> = {}) => ({
  key: 'work', name: 'Work.az', employer: null, collectionMethod: 'api', scope: 'board', accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING', accessNote: null, enabled: true, scheduled: true,
  schedule: { mode: 'scheduled', intervalMinutes: 1440, nextRunAt: null, consecutiveFailures: 0, staleness: 'fresh', isPaused: false, leaseUntil: null },
  operationalStatus: 'HEALTHY', recommendedAction: 'Kollektor normal işləyir.',
  lastRunAt: null, lastRunStatus: 'SUCCEEDED', lastSuccessAt: null, lastCompleteListingAt: null, lastError: null, lastRun: null,
  counts: { open: 401, total: 812, closed: 0, expiredByDeadline: 411, hidden: 0, duplicates: 0, emailApplicable: 100 }, ...over,
});
const coverage = (sources: unknown[]) => ({ registeredEmployerTargets: 10, employerTargetsWithAdapter: 5, sourcesWithOpenPostings: 1, openPostings: 401, openPostingsWithEmailApplication: 100, sources, caveats: [] });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const routes = (perms: string[], sources: unknown[], extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) => async (url: string, init?: RequestInit) => {
  if (url === '/api/admin/auth/me') return json(me(perms));
  const handled = extra(url, init);
  if (handled) return handled;
  if (url === '/api/admin/ops/sources') return json(coverage(sources));
  throw new Error(`${url} ${init?.method}`);
};

describe('admin sources page: operational status and controls', () => {
  it('shows each source\'s state and what to do about it', async () => {
    fetchMock.mockImplementation(routes(['ops.read'], [source({ key: 'boss', name: 'Boss.az', operationalStatus: 'BLOCKED', recommendedAction: 'Mənbə 403 Forbidden qaytarır.' })]));
    await act(async () => { render(<AdminSourcesPage />); });
    const cell = await screen.findByTestId('source-ops-boss');
    expect(cell).toHaveTextContent('Bloklanıb');
    expect(cell).toHaveTextContent('Mənbə 403 Forbidden qaytarır.');
  });

  it('explains whether the latest source run was complete, bounded, or unavailable', async () => {
    fetchMock.mockImplementation(routes(['ops.read'], [source({ lastRun: { discovered: 20, accepted: 18, rejected: 0, skipped: 2, expired: 0, closed: 0, listingComplete: false, closureSkipped: null, outcome: 'BOUNDED_PROGRESS' } })]));
    await act(async () => { render(<AdminSourcesPage />); });
    expect(await screen.findByText(/Məhdud həcmdə yenilənib/)).toBeInTheDocument();
  });

  it('restricted and overdue sources are labelled as such, never as healthy, and a restricted one offers no run button', async () => {
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control'], [
      source({ key: 'ejob', name: 'eJob', accessReview: 'RESTRICTED', operationalStatus: 'RESTRICTED', recommendedAction: 'Mənbədə məhdudiyyət qeyd olunub.' }),
      source({ key: 'abb', name: 'ABB', operationalStatus: 'OVERDUE', recommendedAction: 'Cədvəl üzrə sonuncu icra gecikib.' }),
    ]));
    await act(async () => { render(<AdminSourcesPage />); });
    expect(await screen.findByTestId('source-ops-ejob')).toHaveTextContent('Məhdudiyyət var');
    expect(screen.getByTestId('source-ops-ejob')).not.toHaveTextContent('Sağlam');
    expect(screen.getByTestId('source-ops-ejob')).not.toHaveTextContent('İndi işlət');
    expect(screen.getByTestId('source-ops-abb')).toHaveTextContent('Gecikib');
    expect(screen.getByTestId('source-ops-abb')).not.toHaveTextContent('Sağlam');
  });

  it('read-only operators get no controls', async () => {
    fetchMock.mockImplementation(routes(['ops.read'], [source()]));
    await act(async () => { render(<AdminSourcesPage />); });
    await screen.findByTestId('source-ops-work');
    expect(screen.queryByRole('button', { name: 'İndi işlət' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cədvəli/ })).not.toBeInTheDocument();
  });

  it('run-now starts the run, says it is in the background and refreshes; the server\'s refusal is shown as is', async () => {
    let refused = false;
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control'], [source()], (url, init) => {
      if (url === '/api/admin/ops/sources/work/run-now') return refused ? json({ message: 'Mənbə hal-hazırda başqa proses tərəfindən icra olunur' }, 409) : json({ key: 'work', status: 'STARTED' }, 202);
    }));
    await act(async () => { render(<AdminSourcesPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'İndi işlət' })); });
    expect(await screen.findByText(/icra başladıldı/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/admin/ops/sources/work/run-now')!;
    expect(post[1]).toMatchObject({ method: 'POST' });
    refused = true;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'İndi işlət' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('başqa proses tərəfindən icra olunur');
  });

  it('a running source cannot be started again from the page, and a paused schedule can be resumed', async () => {
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control'], [
      source({ key: 'work', schedule: { mode: 'scheduled', intervalMinutes: 1440, nextRunAt: null, consecutiveFailures: 0, staleness: 'fresh', isPaused: false, leaseUntil: new Date(Date.now() + 600_000).toISOString() } }),
      source({ key: 'boss', name: 'Boss.az', operationalStatus: 'PAUSED', schedule: { mode: 'paused', intervalMinutes: 1440, nextRunAt: null, consecutiveFailures: 0, staleness: 'fresh', isPaused: true, leaseUntil: null } }),
    ], (url) => (url === '/api/admin/ops/sources/boss/schedule' ? json({}) : undefined)));
    await act(async () => { render(<AdminSourcesPage />); });
    const work = await screen.findByTestId('source-ops-work');
    expect(work).toHaveTextContent('İcra olunur…');
    expect(within(work).getByRole('button', { name: 'İndi işlət' })).toBeDisabled();
    const boss = screen.getByTestId('source-ops-boss');
    await act(async () => { fireEvent.click(within(boss).getByRole('button', { name: 'Cədvəli davam etdir' })); });
    const put = fetchMock.mock.calls.find(([u]) => u === '/api/admin/ops/sources/boss/schedule')!;
    expect(put[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ paused: false }) });
  });

  it('never offers controls for Glorri, a restricted or a disabled source, and points to the global switch', async () => {
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control'], [source({ key: 'glorri', name: 'Glorri' }), source({ key: 'x', name: 'X', accessReview: 'RESTRICTED' }), source({ key: 'y', name: 'Y', enabled: false })]));
    await act(async () => { render(<AdminSourcesPage />); });
    await screen.findByTestId('source-ops-glorri');
    expect(screen.queryAllByRole('button', { name: 'İndi işlət' })).toHaveLength(0);
    const note = screen.getByText(/Bütün cədvəlli idxalı birdən dayandırmaq/);
    expect(within(note).getByRole('link', { name: 'Əməliyyatlar' })).toHaveAttribute('href', '/admin/operations');
  });

  it('shows a source in cooldown with its reason, offers recovery instead of run-now, and the server\'s answer is shown', async () => {
    const cooling = source({ key: 'boss', name: 'Boss.az', operationalStatus: 'COOLING_DOWN', recommendedAction: 'Mənbə soyutma rejimindədir.', schedule: { mode: 'scheduled', intervalMinutes: 1440, nextRunAt: null, consecutiveFailures: 5, staleness: 'fresh', isPaused: false, leaseUntil: null, cooldownUntil: new Date(Date.now() + 86_400_000).toISOString(), cooldownReason: 'BLOCKED: 403 Forbidden', cooldownCount: 1 } });
    fetchMock.mockImplementation(routes(['ops.read', 'ops.control'], [cooling], (url, init) => (url === '/api/admin/ops/sources/boss/recover' ? json({ key: 'boss', reset: true, run: (JSON.parse(String(init?.body)) as { run?: boolean }).run ? { key: 'boss', status: 'STARTED' } : null }) : undefined)));
    await act(async () => { render(<AdminSourcesPage />); });
    const cell = await screen.findByTestId('source-ops-boss');
    expect(cell).toHaveTextContent('Soyutma rejimində');
    expect(screen.getByTestId('cooldown-boss')).toHaveTextContent('BLOCKED: 403 Forbidden');
    expect(within(cell).getByRole('button', { name: 'İndi işlət' })).toBeDisabled(); // no hammering a cooling source
    await act(async () => { fireEvent.click(within(cell).getByRole('button', { name: 'Bərpa et' })); });
    expect(await screen.findByText(/soyutma və xəta sayğacı sıfırlandı/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(screen.getByTestId('source-ops-boss')).getByRole('button', { name: 'Bərpa et və işlət' })); });
    const posts = fetchMock.mock.calls.filter(([u]) => u === '/api/admin/ops/sources/boss/recover');
    expect(posts.map(([, init]) => JSON.parse(String(init.body)))).toEqual([{}, { run: true }]);
  });

  it('offers no recovery to read-only operators', async () => {
    fetchMock.mockImplementation(routes(['ops.read'], [source({ operationalStatus: 'COOLING_DOWN', schedule: { mode: 'scheduled', intervalMinutes: 1440, nextRunAt: null, consecutiveFailures: 5, staleness: 'fresh', isPaused: false, leaseUntil: null, cooldownUntil: new Date(Date.now() + 3_600_000).toISOString(), cooldownReason: 'x', cooldownCount: 1 } })]));
    await act(async () => { render(<AdminSourcesPage />); });
    await screen.findByTestId('source-ops-work');
    expect(screen.queryByRole('button', { name: /Bərpa et/ })).not.toBeInTheDocument();
  });
});
