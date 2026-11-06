import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BusinessVacanciesPage from './page';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: any }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('BusinessVacanciesPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders vacancies with status, deadline, and application counts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'vac-1',
            title: 'Fullstack Engineer',
            location: 'Bakı',
            workArrangement: 'Hybrid',
            status: 'ACTIVE',
            deadline: '2026-12-31T23:59:59.000Z',
            views: 45,
            _count: { applications: 7 },
          },
          {
            id: 'vac-2',
            title: 'Junior QA Tester',
            location: 'Sumqayıt',
            workArrangement: 'On-site',
            status: 'PAUSED',
            deadline: null,
            views: 12,
            _count: { applications: 2 },
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'comp-1', name: 'Tech MMC', status: 'APPROVED' })),
    );

    await act(async () => {
      render(<BusinessVacanciesPage />);
    });

    const fullstackTitles = await screen.findAllByText('Fullstack Engineer');
    expect(fullstackTitles.length).toBeGreaterThan(0);
    const qaTitles = await screen.findAllByText('Junior QA Tester');
    expect(qaTitles.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aktiv').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dayandırılmış').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/7 müraciət/).length).toBeGreaterThan(0);
  });

  it('highlights expired deadlines when active', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'vac-expired',
            title: 'Data Analyst',
            location: 'Bakı',
            status: 'ACTIVE',
            deadline: '2026-01-01T00:00:00.000Z', // Past date
            views: 20,
            _count: { applications: 3 },
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'comp-1', name: 'Data MMC', status: 'APPROVED' })),
    );

    await act(async () => {
      render(<BusinessVacanciesPage />);
    });

    const dataAnalystTitles = await screen.findAllByText('Data Analyst');
    expect(dataAnalystTitles.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Müddət(i)? bitib/).length).toBeGreaterThan(0);
  });

  it('updates vacancy status when pause button is clicked', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'vac-active',
            title: 'DevOps Specialist',
            status: 'ACTIVE',
            deadline: null,
            views: 5,
            _count: { applications: 1 },
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'comp-1', status: 'APPROVED' })),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await act(async () => {
      render(<BusinessVacanciesPage />);
    });

    const pauseBtns = await screen.findAllByRole('button', { name: /DevOps Specialist — dayandır/ });
    await act(async () => {
      fireEvent.click(pauseBtns[0]);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/business/vacancies/vac-active/pause',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(await screen.findAllByText('Dayandırılmış')).toBeDefined();
  });
});
