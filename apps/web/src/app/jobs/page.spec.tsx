import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import JobsPage from './page';
import JobDetailPage from './[kind]/[id]/page';
import { catalogueQuery, catalogueDate, externalJobUrl } from '@/lib/job-catalogue';

vi.mock('@/components/landing/site-nav', () => ({ SiteNav: () => <nav>Navigation</nav> }));
vi.mock('@/components/landing/site-footer', () => ({ SiteFooter: () => <footer>Footer</footer> }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }));
const item = { id: 'job-one', kind: 'imported', source: 'glorri', category: 'technology', categoryLabel: 'IT və texnologiya', title: 'Backend developer', company: 'Synthetic Labs', companyId: null, location: 'Bakı', postedAt: '2026-09-30T20:00:00Z', deadline: null, workArrangement: null, experienceLevel: 'Junior', applicationMethod: 'EXTERNAL_SITE', checkedAt: '2026-10-02T08:00:00Z' };
const catalogue = { data: [item], meta: { total: 22, totalOpen: 1147, page: 1, limit: 20, totalPages: 2 }, sources: [{ source: 'glorri', count: 1147 }], categories: [{ key: 'technology', label: 'IT və texnologiya', count: 22 }, { key: 'other', label: 'Digər', count: 0 }],
  workArrangements: [{ value: 'Remote', count: 2 }, { value: 'Hybrid', count: 0 }, { value: 'On-site', count: 0 }, { value: 'unknown', count: 20 }], experienceLevels: [{ value: 'Junior', count: 1 }, { value: 'unknown', count: 21 }], companies: [{ company: 'Synthetic Labs', count: 22 }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(catalogue))); });

describe('all vacancies and personal matches are separate', () => {
  it('shows a live catalogue count, accessible filters and a separate matching link', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Ümumi 1.147 açıq vakansiya')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Uyğunluqlarımı gör/ })).toHaveAttribute('href', '/dashboard/matches');
    expect(screen.getByLabelText('Vəzifə və ya şirkət')).toBeInTheDocument();
    expect(screen.getByLabelText('Kateqoriya')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Backend developer' })).toHaveAttribute('href', '/jobs/imported/job-one');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/jobs?'), expect.objectContaining({ cache: 'no-store' }));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers).toBeUndefined();
  });
  it('offers company, work-format and experience filters and shows unknown facts as unknown', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({ work: 'unknown', company: 'Synthetic Labs' }) }));
    expect(screen.getByLabelText('Şirkət')).toHaveValue('Synthetic Labs');
    expect(screen.getByLabelText('İş formatı')).toHaveValue('unknown');
    expect(screen.getByRole('option', { name: 'Məlum deyil (20)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Təcrübə səviyyəsi')).toBeInTheDocument();
    expect(screen.getByText(/İş formatı: Məlum deyil · Təcrübə: Başlanğıc \(Junior\)/)).toBeInTheDocument();
    const next = new URL(screen.getByRole('link', { name: 'Növbəti səhifə' }).getAttribute('href')!, 'http://local');
    expect(Object.fromEntries(next.searchParams)).toMatchObject({ work: 'unknown', company: 'Synthetic Labs', page: '2' });
  });
  it('preserves filters in pagination and uses a GET form that resets the page', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({ q: 'developer', category: 'technology', location: 'Bakı', source: 'glorri' }) }));
    const next = new URL(screen.getByRole('link', { name: 'Növbəti səhifə' }).getAttribute('href')!, 'http://local');
    expect(Object.fromEntries(next.searchParams)).toMatchObject({ q: 'developer', category: 'technology', location: 'Bakı', source: 'glorri', page: '2' });
    const form = screen.getByRole('button', { name: 'Axtar' }).closest('form')!;
    expect(form).toHaveAttribute('method', 'get'); expect(form.querySelector('[name="page"]')).toBeNull();
  });
  it('shows API failures as unavailable rather than falsely claiming zero vacancies', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    render(await JobsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('yüklənə bilmir');
    expect(screen.queryByText(/Ümumi .* açıq vakansiya/)).toBeNull();
  });
  it('offers a clear empty result and reset without hiding the global catalogue count', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ...catalogue, data: [], meta: { ...catalogue.meta, total: 0, totalPages: 0 } }));
    render(await JobsPage({ searchParams: Promise.resolve({ category: 'other' }) }));
    expect(screen.getByText('Bu filtrlərlə vakansiya tapılmadı')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bütün vakansiyalara bax' })).toHaveAttribute('href', '/jobs');
  });
});

describe('public detail links', () => {
  it('uses the original source for external applications and escapes source markup', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ...item, description: '<script>bad()</script>', url: 'https://jobs.glorri.com/vacancies/synthetic/job' }));
    render(await JobDetailPage({ params: Promise.resolve({ kind: 'imported', id: item.id }) }));
    expect(screen.getByRole('link', { name: /Mənbədə bax və müraciət et/ })).toHaveAttribute('href', 'https://jobs.glorri.com/vacancies/synthetic/job');
    expect(document.querySelector('article script')).toBeNull();
    expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument();
  });
  it('uses the existing native application journey without claiming an external submission', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ...item, kind: 'native', source: 'aise', companyId: 'company-one', description: 'Native', url: null }));
    render(await JobDetailPage({ params: Promise.resolve({ kind: 'native', id: item.id }) }));
    expect(screen.getByRole('link', { name: 'AISE-də müraciət et' })).toHaveAttribute('href', '/dashboard/companies/company-one/vacancies/job-one/apply');
    expect(screen.queryByRole('link', { name: /Mənbədə bax/ })).toBeNull();
  });
  it('treats a closed/missing job as not found', async () => {
    vi.mocked(fetch).mockResolvedValue(json({}, 404));
    await expect(JobDetailPage({ params: Promise.resolve({ kind: 'imported', id: item.id }) })).rejects.toThrow('NOT_FOUND');
  });
  it.each(['javascript:alert(1)', 'data:text/html,bad', 'https://user:pass@example.com', '/unexpected'])('refuses unsafe source links %s', (value) => expect(externalJobUrl(value)).toBeNull());
  it('renders EmailApplyCta and email instructions when applicationMethod is EMAIL, and external site instructions when EXTERNAL_SITE', async () => {
    const serve = (detail: object, emailApplicationsEnabled: boolean) => vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => (String(input).endsWith('/billing/status') ? json({ paymentsEnabled: false, emailApplicationsEnabled }) : json(detail)));
    // Switched off in this deployment: no promise of an in-app e-mail application, no CTA, the honest alternative instead.
    serve({ ...item, applicationMethod: 'EMAIL', url: 'https://jobs.glorri.com/vacancies/synthetic/job' }, false);
    const off = render(await JobDetailPage({ params: Promise.resolve({ kind: 'imported', id: item.id }) }));
    expect(screen.queryByText(/bu elana e-poçtla müraciət hazırlayın/)).toBeNull();
    expect(screen.queryByText(/E-poçtla müraciət: CV və müşayiət məktubunuzu hazırlayın/)).toBeNull();
    expect(screen.getByText(/AISE vasitəsilə e-poçtla müraciət hələ aktiv deyil/)).toBeInTheDocument();
    off.unmount();

    serve({ ...item, applicationMethod: 'EMAIL', url: 'https://jobs.glorri.com/vacancies/synthetic/job' }, true);
    const { unmount } = render(await JobDetailPage({ params: Promise.resolve({ kind: 'imported', id: item.id }) }));
    expect(screen.getByText(/bu elana e-poçtla müraciət hazırlayın/)).toBeInTheDocument();
    expect(screen.getByText(/E-poçtla müraciət: CV və müşayiət məktubunuzu hazırlayın, nəzərdən keçirin və göndərilməsini təsdiqləyin/)).toBeInTheDocument();
    expect(screen.queryByText('Xarici elana müraciət mənbə saytında tamamlanır.')).toBeNull();
    expect(screen.getByRole('link', { name: /Mənbədə elana bax/ })).toHaveAttribute('href', 'https://jobs.glorri.com/vacancies/synthetic/job');
    unmount();

    serve({ ...item, applicationMethod: 'EXTERNAL_SITE', url: 'https://jobs.glorri.com/vacancies/synthetic/job' }, true);
    render(await JobDetailPage({ params: Promise.resolve({ kind: 'imported', id: item.id }) }));
    expect(screen.queryByText(/bu elana e-poçtla müraciət hazırlayın/)).toBeNull();
    expect(screen.getByText('Xarici elana müraciət mənbə saytında tamamlanır.')).toBeInTheDocument();
    expect(screen.queryByText(/E-poçtla müraciət: CV və müşayiət məktubunuzu hazırlayın/)).toBeNull();
    expect(screen.getByRole('link', { name: /Mənbədə bax və müraciət et/ })).toHaveAttribute('href', 'https://jobs.glorri.com/vacancies/synthetic/job');
  });
  it('keeps Baku dates and query encoding stable', () => {
    expect(catalogueDate('2026-09-30T20:00:00Z')).toBe('01.10.2026');
    expect(new URLSearchParams(catalogueQuery({ q: 'a & b', page: '7', category: 'technology' }, 2)).get('q')).toBe('a & b');
  });
});
