import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminApplicationsPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/applications',
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
  permissions: ['ops.read', 'applications.read'],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('admin applications page', () => {
  const nativeApps = [
    {
      id: 'a1',
      status: 'REVIEWING',
      updatedAt: '2026-10-02T10:00:00Z',
      user: { email: 'cand1@example.com' },
      vacancy: { title: 'Designer', company: { name: 'Studio MMC' } },
    },
  ];

  const externalApps = [
    {
      id: 'a2',
      status: 'DELIVERY_UNCONFIRMED',
      destinationHost: 'jobs.external.az',
      needsReconciliation: true,
      updatedAt: '2026-10-02T11:00:00Z',
      user: { email: 'cand2@example.com' },
      match: { job: { title: 'DevOps Engineer', company: 'Global IT' } },
    },
  ];

  it('switches between native and external applications and shows delivery warning', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.includes('kind=native')) return json({ data: nativeApps, meta: { total: 1, totalPages: 1 } });
      if (url.includes('kind=external')) return json({ data: externalApps, meta: { total: 1, totalPages: 1 } });
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminApplicationsPage />);
    });

    const cand1 = await screen.findAllByText('cand1@example.com');
    expect(cand1.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Designer').length).toBeGreaterThan(0);
    expect(screen.queryByText(/DELIVERY_UNCONFIRMED/)).not.toBeInTheDocument();

    const externalTab = screen.getByRole('tab', { name: /Xarici sayt/ });
    await act(async () => {
      fireEvent.click(externalTab);
    });

    const cand2 = await screen.findAllByText('cand2@example.com');
    expect(cand2.length).toBeGreaterThan(0);
    expect(screen.getAllByText('DevOps Engineer').length).toBeGreaterThan(0);
    expect(screen.getByText(/heç vaxt avtomatik təkrar göndərilmir/)).toBeInTheDocument();
  });
});
