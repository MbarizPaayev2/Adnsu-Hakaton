import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import AdminOverviewPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/overview',
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
  permissions: ['ops.read', 'companies.read', 'users.read', 'listings.read', 'applications.read'],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('admin overview page', () => {
  const baseOverview = {
    users: { total: 150, verified: 140, suspended: 2 },
    companies: { APPROVED: 20, PENDING: 3, SUSPENDED: 1 },
    vacancies: { ACTIVE: 12 },
    jobs: { ACTIVE: 80, CLOSED: 10, hidden: 2 },
    applications: { native: { APPLIED: 5, REVIEWING: 2 }, external: { SUBMITTED: 15 } },
    matchesLast24h: 42,
    failures: {
      tailoredCvLast7d: 1,
      externalUnconfirmed: 2,
      queues: [{ name: 'email-delivery', failed: 3 }],
      emailFailuresSinceRestart: 0,
    },
    lastImport: {
      status: 'SUCCEEDED',
      startedAt: '2026-10-02T10:00:00Z',
      finishedAt: '2026-10-02T10:02:00Z',
      listed: 100,
      created: 10,
      error: null,
    },
    features: [{ key: 'tailor_cv', label: 'Fərdi CV tərtibi', paused: true, reason: 'Yenilənmə gedir' }],
  };

  const healthySystem = {
    environment: 'test',
    release: { sha: 'test-sha', builtAt: '2026-10-03T10:00:00Z' },
    uptimeSeconds: 3600,
    services: {
      database: { ok: true, ms: 4 },
      redis: { ok: true, ms: 2 },
      matching: { ok: true, ms: 15 },
      applyWorker: { ok: true, ms: 8 },
    },
    backup: {
      known: true,
      lastBackupAt: '2026-10-03T02:00:00Z',
      lastBackupAgeHours: 8,
      lastBackupFailureAt: null,
      lastOffhostCopyAt: '2026-10-03T03:00:00Z',
      lastOffhostCopyAgeHours: 7,
      lastOffhostResult: 'VERIFIED',
      lastRestoreTestAt: '2026-10-01T03:00:00Z',
      lastRestoreTestAgeHours: 55,
      lastRestoreTestResult: 'PASSED',
    },
  };

  it('renders authoritative metrics, paused feature alert, and attention items', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(baseOverview);
      if (url === '/api/admin/ops/health') return json(healthySystem);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    expect(await screen.findByText('150')).toBeInTheDocument();
    expect(screen.getByText(/140 təsdiqlənmiş/)).toBeInTheDocument();
    expect(screen.getByText('Müvəqqəti dayandırılmış funksiyalar var:')).toBeInTheDocument();
    expect(screen.getByText('Fərdi CV tərtibi')).toBeInTheDocument();
    expect(screen.getByText(/Yenilənmə gedir/)).toBeInTheDocument();
    expect(screen.getByText('Çatdırılması təsdiqlənməmiş xarici müraciətlər')).toBeInTheDocument();
    expect(screen.getByText('Bütün servislər aktiv')).toBeInTheDocument();
  });

  it('displays truthful zero recorded failures reassurance without falsely claiming all services are healthy when health is unknown', async () => {
    const zeroFailuresOverview = {
      ...baseOverview,
      failures: {
        tailoredCvLast7d: 0,
        externalUnconfirmed: 0,
        queues: [],
        emailFailuresSinceRestart: 0,
      },
      lastImport: { ...baseOverview.lastImport, error: null },
      features: [],
    };

    const unknownBackupHealth = {
      ...healthySystem,
      backup: {
        known: false,
        reason: 'Ehtiyat nüsxə məlumatı tapılmadı',
      },
    };

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(zeroFailuresOverview);
      if (url === '/api/admin/ops/health') return json(unknownBackupHealth);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    // Truthful counter statement:
    expect(await screen.findByText(/Bu sayğaclarda heç bir xəta qeydə alınmayıb/)).toBeInTheDocument();
    expect(screen.getByText(/Aktiv növbə, e-poçt və ya CV generasiyası xətası mövcud deyil/)).toBeInTheDocument();

    // Does NOT claim all services/queues are healthy/normal based solely on zero counter:
    expect(screen.queryByText(/Bütün xidmətlər və növbələr normal rejimdə işləyir/)).not.toBeInTheDocument();

    // Health card shows unknown state for backup honestly:
    expect(screen.getByText('Ehtiyat nüsxə məlum deyil')).toBeInTheDocument();
  });

  it('handles multiple failed jobs in one queue without conflating queue counts with failed job totals', async () => {
    const multiJobFailedOverview = {
      ...baseOverview,
      failures: {
        tailoredCvLast7d: 0,
        externalUnconfirmed: 0,
        queues: [{ name: 'email-delivery', failed: 5 }],
        emailFailuresSinceRestart: 0,
      },
      lastImport: null,
      features: [],
    };

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(multiJobFailedOverview);
      if (url === '/api/admin/ops/health') return json(healthySystem);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    // Card shows total failed jobs (5) and affected queues count (1) separately:
    expect(await screen.findByText('5 uğursuz tapşırıq')).toBeInTheDocument();
    expect(screen.getByText('1 aktiv növbədə xəta var')).toBeInTheDocument();

    // Detail section explicitly states failed jobs total and affected queue count:
    expect(screen.getByText(/Cəmi 5 uğursuz tapşırıq, 1 növbə üzrə: email-delivery \(5\)/)).toBeInTheDocument();
  });

  it('handles missing or failed health data honestly without crashing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(baseOverview);
      if (url === '/api/admin/ops/health') return json({ message: 'Internal server error' }, 500);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    // Overview numbers still render correctly:
    expect(await screen.findByText('150')).toBeInTheDocument();

    // System health state displays honest unknown/error state:
    expect(screen.getByText('Məlum deyil')).toBeInTheDocument();
    expect(screen.getAllByText(/Yoxlama xətası: Internal server error/)[0]).toBeInTheDocument();
  });

  it('preserves the distinction between delivery uncertainty and failure', async () => {
    const unconfirmedOnlyOverview = {
      ...baseOverview,
      failures: {
        tailoredCvLast7d: 0,
        externalUnconfirmed: 4,
        queues: [],
        emailFailuresSinceRestart: 0,
      },
      lastImport: null,
      features: [],
    };

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(unconfirmedOnlyOverview);
      if (url === '/api/admin/ops/health') return json(healthySystem);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    // Queue errors card shows 0:
    expect(await screen.findByText('0 uğursuz tapşırıq')).toBeInTheDocument();

    // External applications card notes unconfirmed delivery:
    expect(screen.getAllByText(/4 təsdiq gözləyən/)[0]).toBeInTheDocument();

    // Explains that unconfirmed delivery is not a system failure:
    expect(screen.getByText(/Qeyd: Bu sistem nasazlığı deyil, qəbul edən xarici saytın təsdiq verməməsidir/)).toBeInTheDocument();
  });

  it('renders diagnostic recommendations with severity, reason, and suggested next step', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(baseOverview);
      if (url === '/api/admin/ops/health') return json(healthySystem);
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminOverviewPage />);
    });

    // Section title
    expect(await screen.findByText('Tövsiyə olunan addımlar')).toBeInTheDocument();
    // Failed jobs recommendation
    expect(screen.getByText(/3 uğursuz növbə tapşırığı/)).toBeInTheDocument();
    // Suggested step
    expect(screen.getByText(/Tövsiyə olunan addım: Əməliyyatlar bölməsində xəta səbəblərinə baxın/)).toBeInTheDocument();
  });

  const serve = (overview: unknown, health: unknown | Response) =>
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url === '/api/admin/ops/overview') return json(overview);
      if (url === '/api/admin/ops/health') return health instanceof Response ? health : json(health);
      throw new Error(url);
    });
  const zero = { ...baseOverview, failures: { tailoredCvLast7d: 0, externalUnconfirmed: 0, queues: [], emailFailuresSinceRestart: 0 }, lastImport: null, features: [] };

  it('an unreadable queue is unknown, never "0 failed" and never the zero-failures reassurance', async () => {
    serve({ ...zero, failures: { ...zero.failures, queuesUnavailable: ['email-delivery'] } }, healthySystem);
    await act(async () => { render(<AdminOverviewPage />); });
    expect(await screen.findByText('Oxuna bilməyən növbələr')).toBeInTheDocument();
    expect(screen.queryByText('0 uğursuz tapşırıq')).not.toBeInTheDocument();
    expect(screen.queryByText(/Bu sayğaclarda heç bir xəta qeydə alınmayıb/)).not.toBeInTheDocument();
    expect(screen.getByText(/email-delivery növbəsi oxuna bilmədi/)).toBeInTheDocument();
  });

  it('missing failure counters are unknown, not zero', async () => {
    serve({ ...zero, failures: undefined }, healthySystem);
    await act(async () => { render(<AdminOverviewPage />); });
    expect(await screen.findByText('Xəta sayğacları əlçatan deyil')).toBeInTheDocument();
    expect(screen.queryByText(/Bu sayğaclarda heç bir xəta qeydə alınmayıb/)).not.toBeInTheDocument();
  });

  it('keeps unknown, stale, failed and healthy distinct on the health card', async () => {
    const cases: [object, string][] = [
      [{ ...healthySystem, backup: { ...healthySystem.backup, lastBackupAgeHours: 40 } }, 'Köhnəlmiş sübut'],
      [{ ...healthySystem, backup: { ...healthySystem.backup, lastOffhostResult: 'FAILED' } }, 'Xarici nüsxə uğursuz'],
      [{ ...healthySystem, services: { ...healthySystem.services, redis: { ok: false, ms: 1, error: 'down' } } }, '1 servisdə xəta'],
      [{ ...healthySystem, backup: { ...healthySystem.backup, lastRestoreTestResult: null } }, 'Ehtiyat sübutu natamamdır'],
      [healthySystem, 'Bütün servislər aktiv'],
    ];
    for (const [health, label] of cases) {
      serve(zero, health);
      const { unmount } = render(<AdminOverviewPage />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
