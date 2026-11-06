import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BusinessDashboardPage from './page';

vi.mock('@/lib/business-api', () => ({
  businessApiFetch: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: any }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { businessApiFetch } from '@/lib/business-api';

describe('BusinessDashboardPage', () => {
  beforeEach(() => {
    vi.mocked(businessApiFetch).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders pending status card when company status is PENDING', async () => {
    vi.mocked(businessApiFetch).mockImplementation(async (path: string) => {
      if (path === '/business/company') {
        return new Response(JSON.stringify({ id: 'c-1', name: 'StartUp MMC', status: 'PENDING' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const jsx = await BusinessDashboardPage();
    render(jsx);

    expect(screen.getByText('HESAB TƏSDİQİ GÖZLƏNİLİR')).toBeInTheDocument();
    expect(screen.getByText('Xoş gəldiniz, StartUp MMC')).toBeInTheDocument();
    expect(screen.getByText('Hesabınız yoxlanılır')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dəstək ilə əlaqə' })).toBeInTheDocument();
  });

  it('renders rejected status card when company status is REJECTED', async () => {
    vi.mocked(businessApiFetch).mockImplementation(async (path: string) => {
      if (path === '/business/company') {
        return new Response(
          JSON.stringify({
            id: 'c-1',
            name: 'Old MMC',
            status: 'REJECTED',
            rejectionReason: 'VÖEN məlumatları uyğun deyil',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const jsx = await BusinessDashboardPage();
    render(jsx);

    expect(screen.getByText('QEYDİYYAT STATUSU')).toBeInTheDocument();
    expect(screen.getByText('Müraciət təsdiqlənmədi')).toBeInTheDocument();
    expect(screen.getByText('VÖEN məlumatları uyğun deyil')).toBeInTheDocument();
  });

  it('renders authoritative stats, recent applications, and shortcuts for APPROVED company', async () => {
    vi.mocked(businessApiFetch).mockImplementation(async (path: string) => {
      if (path === '/business/company') {
        return new Response(
          JSON.stringify({ id: 'c-1', name: 'Aise Global MMC', status: 'APPROVED' }),
          { status: 200 },
        );
      }
      if (path === '/business/applications') {
        return new Response(
          JSON.stringify([
            {
              id: 'app-1',
              candidateName: 'Zaur Həsənov',
              vacancyTitle: 'Senior React Developer',
              status: 'APPLIED',
              createdAt: '2026-10-02T10:00:00.000Z',
            },
          ]),
          { status: 200 },
        );
      }
      if (path === '/business/vacancies') {
        return new Response(
          JSON.stringify([
            {
              id: 'vac-1',
              title: 'Senior React Developer',
              status: 'ACTIVE',
              deadline: '2026-11-15T00:00:00.000Z',
              _count: { applications: 1 },
            },
            {
              id: 'vac-2',
              title: 'DevOps Engineer',
              status: 'PAUSED',
              deadline: null,
              _count: { applications: 0 },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const jsx = await BusinessDashboardPage();
    render(jsx);

    expect(screen.getByText('Xoş gəldiniz, Aise Global MMC')).toBeInTheDocument();
    expect(screen.getByText('Cəmi vakansiyalar')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aktiv vakansiyalar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText('Daxil olan müraciətlər')).toBeInTheDocument();
    expect(screen.getByText('Zaur Həsənov')).toBeInTheDocument();
    expect(screen.getAllByText('Vakansiya yerləşdir').length).toBeGreaterThan(0);
  });
});
