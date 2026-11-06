import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BusinessApplicationsPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('BusinessApplicationsPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders application list with candidate names, status pills, and counts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'app-1',
            candidateName: 'Rauf Əliyev',
            vacancyTitle: 'Frontend Developer',
            status: 'APPLIED',
            createdAt: '2026-10-02T10:00:00.000Z',
          },
          {
            id: 'app-2',
            candidateName: 'Nigar Qasımova',
            vacancyTitle: 'UX Designer',
            status: 'REVIEWING',
            createdAt: '2026-10-01T15:30:00.000Z',
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 'vac-1', title: 'Frontend Developer' },
          { id: 'vac-2', title: 'UX Designer' },
        ]),
      ),
    );

    await act(async () => {
      render(<BusinessApplicationsPage />);
    });

    expect(await screen.findByText('Cəmi: 2 müraciət')).toBeInTheDocument();
    expect((await screen.findAllByText('Rauf Əliyev')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Nigar Qasımova')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Müraciət etdi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nəzərdən keçirilir').length).toBeGreaterThan(0);
  });

  it('filters applications by status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'app-1',
            candidateName: 'Rauf Əliyev',
            vacancyTitle: 'Frontend Developer',
            status: 'APPLIED',
            createdAt: '2026-10-02T10:00:00.000Z',
          },
          {
            id: 'app-2',
            candidateName: 'Nigar Qasımova',
            vacancyTitle: 'UX Designer',
            status: 'REVIEWING',
            createdAt: '2026-10-01T15:30:00.000Z',
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([])));

    await act(async () => {
      render(<BusinessApplicationsPage />);
    });

    expect((await screen.findAllByText('Rauf Əliyev')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Nigar Qasımova')).length).toBeGreaterThan(0);

    const statusFilter = screen.getByRole('combobox', { name: 'Statusa görə filter' });
    await act(async () => {
      fireEvent.change(statusFilter, { target: { value: 'REVIEWING' } });
    });

    expect(screen.queryByText('Rauf Əliyev')).not.toBeInTheDocument();
    expect(screen.getAllByText('Nigar Qasımova').length).toBeGreaterThan(0);
    expect(screen.getByText(/Tapılan müraciət sayı:/)).toHaveTextContent('1');
  });

  it('filters applications by search query', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'app-1',
            candidateName: 'Rauf Əliyev',
            vacancyTitle: 'Frontend Developer',
            status: 'APPLIED',
            createdAt: '2026-10-02T10:00:00.000Z',
          },
          {
            id: 'app-2',
            candidateName: 'Nigar Qasımova',
            vacancyTitle: 'UX Designer',
            status: 'REVIEWING',
            createdAt: '2026-10-01T15:30:00.000Z',
          },
        ]),
      ),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([])));

    await act(async () => {
      render(<BusinessApplicationsPage />);
    });

    expect((await screen.findAllByText('Rauf Əliyev')).length).toBeGreaterThan(0);

    const searchInput = screen.getByPlaceholderText('Namizəd və ya vəzifə axtar...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Nigar' } });
    });

    expect(screen.queryByText('Rauf Əliyev')).not.toBeInTheDocument();
    expect(screen.getAllByText('Nigar Qasımova').length).toBeGreaterThan(0);
  });

  it('renders honest empty state when no applications exist', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([])));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([])));

    await act(async () => {
      render(<BusinessApplicationsPage />);
    });

    expect(await screen.findByText('Hələ heç bir müraciət yoxdur')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vakansiya yerləşdir' })).toHaveAttribute(
      'href',
      '/business/vacancies/new',
    );
  });
});
