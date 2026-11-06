import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PublicCompaniesPage from './page';
import CompanyDetailPage from './[id]/page';

const mockCompaniesResponse = {
  page: 1,
  limit: 24,
  total: 1,
  totals: {
    companies: 154,
    openPostings: 1391,
    postingsWithoutUsableCompanyName: 12,
  },
  companies: [
    {
      id: 'oc_1234567890abcdef',
      name: 'ABB Bank ASC',
      openCount: 56,
      lastObservedAt: '2026-10-03T18:00:00Z',
      sources: [{ key: 'ats_abb', name: 'ABB Karyera', count: 56 }],
      logo: null,
      monogram: { text: 'AB', color: '#1d4ed8' },
      registered: false,
    },
  ],
};

const mockCompanyDetail = {
  id: 'oc_1234567890abcdef',
  name: 'ABB Bank ASC',
  openCount: 2,
  lastObservedAt: '2026-10-03T18:00:00Z',
  sources: [{ key: 'ats_abb', name: 'ABB Karyera', count: 2 }],
  logo: null,
  monogram: { text: 'AB', color: '#1d4ed8' },
  registered: false,
  aliases: ['ABB Bank ASC', 'ABB Bank'],
  website: 'https://abb-bank.az',
  followKey: 'company:abb-bank-asc',
  attribution: {
    statement: 'Bu səhifədəki vakansiyalar ictimai mənbələrdən toplanıb və işəgötürənin rəsmi qeydiyyatını bildirmir.',
    sources: [{ key: 'ats_abb', name: 'ABB Karyera', homepageUrl: 'https://jobs.abb-bank.az', count: 2 }],
  },
  total: 2,
  jobs: [
    {
      id: 'job-abb-1',
      kind: 'imported',
      title: 'Senior Frontend Mühəndis',
      location: 'Bakı',
      postedAt: '2026-10-01T10:00:00Z',
      deadline: '2026-10-31T20:00:00Z',
      applicationMethod: 'EXTERNAL_SITE',
      checkedAt: '2026-10-03T18:00:00Z',
      source: 'ABB Karyera',
    },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/public/companies/oc_1234567890abcdef')) {
      return Promise.resolve(json(mockCompanyDetail));
    }
    return Promise.resolve(json(mockCompaniesResponse));
  }));
});

describe('Public Companies Directory Page', () => {
  it('renders company listing with totals and disclaimer', async () => {
    render(await PublicCompaniesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Şirkətlər və ictimai mənbələr')).toBeInTheDocument();
    expect(screen.getByText('154')).toBeInTheDocument();
    expect(screen.getByText('1.391')).toBeInTheDocument();
    expect(screen.getByText('ABB Bank ASC')).toBeInTheDocument();
    expect(screen.getByText('56 aktiv vakansiya')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument(); // Monogram text
    expect(screen.getAllByText('İctimai mənbə').length).toBeGreaterThan(0);
  });

  it('renders search form with GET method and retains query', async () => {
    render(await PublicCompaniesPage({ searchParams: Promise.resolve({ q: 'ABB' }) }));

    const searchInput = screen.getByLabelText('Şirkət axtarışı');
    expect(searchInput).toHaveValue('ABB');
  });
});

describe('Public Company Detail Page', () => {
  it('renders company detail with monogram, attribution, and jobs', async () => {
    render(await CompanyDetailPage({
      params: Promise.resolve({ id: 'oc_1234567890abcdef' }),
      searchParams: Promise.resolve({}),
    }));

    expect(screen.getByRole('heading', { level: 1, name: 'ABB Bank ASC' })).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument(); // Monogram
    expect(screen.getByText(/Bu səhifədəki vakansiyalar ictimai mənbələrdən toplanıb/)).toBeInTheDocument();
    expect(screen.getByText('Senior Frontend Mühəndis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bütün şirkətlər/ })).toHaveAttribute('href', '/companies');
  });
});
