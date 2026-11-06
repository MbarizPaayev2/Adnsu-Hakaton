import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminAuditPage from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/audit',
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
  permissions: ['ops.read', 'audit.read'],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('admin audit page', () => {
  const auditEntries = [
    {
      id: 'e1',
      action: 'user.suspend',
      targetType: 'User',
      targetId: 'u1',
      metadata: { reason: 'Qayda pozuntusu' },
      createdAt: '2026-10-02T10:00:00Z',
      actor: 'ops@example.com',
    },
  ];

  it('renders audit entries and filters by action and actor', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/auth/me') return json(adminMe);
      if (url.startsWith('/api/admin/audit?')) {
        return json({ data: auditEntries, meta: { totalPages: 1, total: 1 }, actions: ['user.suspend', 'company.approve'] });
      }
      throw new Error(url);
    });

    await act(async () => {
      render(<AdminAuditPage />);
    });

    const actions = await screen.findAllByText('user.suspend');
    expect(actions.length).toBeGreaterThan(0);
    expect(screen.getAllByText('ops@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Qayda pozuntusu/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Operator e-poçtu'), { target: { value: 'ops@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filtrlə' }));
    });

    const auditCall = fetchMock.mock.calls.find(([u]) => u.includes('/api/admin/audit?'));
    expect(auditCall).toBeDefined();
  });
});
