import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SiteNav } from '@/components/landing/site-nav';
import DashboardNav from '@/components/dashboard-nav';
import ApplicationsPage from '@/app/dashboard/applications/page';
import JobsPage from '@/app/jobs/page';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }), signOut: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));

const json = (body: unknown) => new Response(JSON.stringify(body));

describe('icons do not depend on a web font', () => {
  it('renders the landing menu toggle as an SVG with an accessible name and no ligature text', () => {
    render(<SiteNav />);
    const toggle = screen.getByRole('button', { name: 'Menyunu aç' });
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(toggle).not.toHaveTextContent(/menu|close/);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Menyunu bağla' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.innerHTML).not.toMatch(/material-symbols/);
  });
});

describe('signed-in navigation', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue(json({})));

  it('opens the mobile menu as a named dialog and closes it with Escape', () => {
    render(<DashboardNav unreadNotificationsCount={0} user={{ name: 'Sintetik', email: 'ux@example.com' }}><p>Məzmun</p></DashboardNav>);
    fireEvent.click(screen.getByRole('button', { name: 'Menyunu aç' }));
    expect(screen.getByRole('dialog', { name: 'Menyu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menyunu bağla' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Müraciətlərim keeps native, external and self-reported applications apart', () => {
  const external = (patch: Record<string, unknown>) => ({
    id: 'ext', status: 'SUBMITTED', dryRun: false, createdAt: '2026-09-20T10:00:00Z', submittedAt: '2026-09-20T10:05:00Z',
    receiptConfirmed: false, receiptReference: null, destinationName: 'Glorri', matchId: 'm-ext', vacancy: { title: 'Xarici vakansiya', company: 'Sintetik MMC' }, ...patch,
  });

  async function renderPage(ext: unknown[], matches: unknown[] = [], emailApps: unknown[] = []) {
    apiFetch.mockReset().mockImplementation(async (path: string) => {
      if (path === '/dashboard/applications') return json([{ id: 'n1', status: 'APPLIED', createdAt: '2026-09-19T10:00:00Z', vacancyId: 'v1', vacancy: { title: 'Daxili vakansiya', companyId: 'c1', company: { name: 'AISE işəgötürən' } } }]);
      if (path === '/external-applications/mine') return json(ext);
      if (path === '/matches') return json(matches);
      if (path === '/email-applications') return json(emailApps);
      return json([]);
    });
    render(await ApplicationsPage());
  }

  it('says "received" only for a validated receipt and warns not to resend an unconfirmed delivery', async () => {
    await renderPage([
      external({ id: 'a', receiptConfirmed: true, receiptReference: 'FX-0001', matchId: 'm1' }),
      external({ id: 'b', matchId: 'm2' }),
      external({ id: 'c', status: 'DELIVERY_UNCONFIRMED', matchId: 'm3' }),
    ]);
    const section = screen.getByRole('region', { name: 'Xarici saytlarda — AISE vasitəsilə' });
    expect(within(section).getByText('Qəbul təsdiqləndi · FX-0001')).toBeInTheDocument();
    expect(within(section).getByText('Göndərildi — qəbul təsdiqi yoxdur')).toBeInTheDocument();
    expect(within(section).getByText('Çatdırılma təsdiqlənməyib')).toBeInTheDocument();
    expect(within(section).getByText(/Təkrar göndərməyin/)).toBeInTheDocument();
    expect(within(section).getAllByText(/^Qəbul təsdiqləndi ·/)).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'AISE-də göndərilənlər' })).toHaveTextContent('Daxili vakansiya');
  });

  it('shows clear one-line contextual notes explaining QUEUED, SENDING, and SENT/PROVIDER_ACCEPTED email states without overstating them', async () => {
    await renderPage([], [], [
      { id: 'ea1', jobTitle: 'Növbədə olan vakansiya', jobCompany: 'Şirkət 1', deliveryState: 'QUEUED', recruitmentState: 'NOT_SENT', createdAt: '2026-09-20T10:00:00Z' },
      { id: 'ea2', jobTitle: 'Göndərilən vakansiya', jobCompany: 'Şirkət 2', deliveryState: 'SENDING', recruitmentState: 'NOT_SENT', createdAt: '2026-09-20T10:00:00Z' },
      { id: 'ea3', jobTitle: 'Xidmət qəbul edən vakansiya', jobCompany: 'Şirkət 3', deliveryState: 'PROVIDER_ACCEPTED', recruitmentState: 'SENT', createdAt: '2026-09-20T10:00:00Z' },
    ]);
    const section = screen.getByRole('region', { name: 'E-poçtla göndərilənlər' });
    expect(within(section).getByText('Göndəriş növbəsindədir — təsdiqlənib, hələ göndərilməyib.')).toBeInTheDocument();
    expect(within(section).getByText('Mesaj e-poçt xidmətinə təhvil verilir.')).toBeInTheDocument();
    expect(within(section).getByText('E-poçt xidmətinə təhvil verildi; çatdırılma təsdiqi yoxdur və bu, işəgötürənin baxdığı və ya qəbul etdiyi demək deyil.')).toBeInTheDocument();
    // Verify badge preserves exact wording "E-poçt xidməti qəbul etdi" and does not claim "HR received"
    expect(within(section).getByText('E-poçt xidməti qəbul etdi')).toBeInTheDocument();
    expect(within(section).queryByText(/HR received|işəgötürən qəbul etdi|müsahibə təmin edildi/i)).not.toBeInTheDocument();
  });

  it('lists a listing the candidate marked as applied as self-reported, not as sent by AISE', async () => {
    await renderPage([external({ matchId: 'm-ext' })], [
      { id: 'm-self', status: 'APPLIED', job: { title: 'Özüm müraciət etdim', company: 'Mənbə MMC', url: 'https://jobs.glorri.com/vacancies/x/y' } },
      { id: 'm-ext', status: 'APPLIED', job: { title: 'Xarici vakansiya', company: 'Sintetik MMC' } },
      { id: 'm-new', status: 'NEW', job: { title: 'Yeni', company: 'X' } },
    ]);
    const section = screen.getByRole('region', { name: 'Özünüz qeyd etdikləriniz' });
    expect(within(section).getByText('Özüm müraciət etdim')).toBeInTheDocument();
    expect(within(section).getByText('Siz qeyd etdiniz')).toBeInTheDocument();
    expect(within(section).queryByText('Xarici vakansiya')).not.toBeInTheDocument();
    expect(within(section).queryByText('Yeni')).not.toBeInTheDocument();
  });

  it('offers a retry when nothing could be loaded', async () => {
    apiFetch.mockReset().mockResolvedValue(new Response('{}', { status: 500 }));
    render(await ApplicationsPage());
    expect(screen.getByRole('heading', { name: 'Müraciətlər yüklənmədi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Yenidən yüklə' })).toHaveAttribute('href', '/dashboard/applications');
  });
});

describe('job catalogue active filter pills', () => {
  const catalogue = {
    data: [], meta: { total: 0, totalOpen: 500, page: 1, limit: 20, totalPages: 0 },
    sources: [{ source: 'glorri', count: 500 }],
    categories: [{ key: 'technology', label: 'IT və texnologiya', count: 10 }],
    workArrangements: [{ value: 'Remote', count: 5 }],
    experienceLevels: [{ value: 'Junior', count: 3 }],
    companies: [{ company: 'Synthetic Labs', count: 2 }],
  };

  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogue)))));
  afterEach(() => vi.unstubAllGlobals());

  it('shows no filter pills when no filters are active', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('navigation', { name: /Aktiv filtrlər/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filtrini sil/)).not.toBeInTheDocument();
  });

  it('shows a removable pill for each active filter with accessible label', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({ q: 'mühasib', category: 'technology' }) }));
    const region = screen.getByLabelText('Aktiv filtrlər');
    // Text filter pill
    expect(within(region).getByLabelText('"mühasib" filtrini sil')).toBeInTheDocument();
    // Category filter pill
    expect(within(region).getByLabelText('IT və texnologiya filtrini sil')).toBeInTheDocument();
    // Global reset link
    expect(within(region).getByRole('link', { name: 'Hamısını sıfırla' })).toHaveAttribute('href', '/jobs');
  });

  it('highlights the reset button when filters are active', async () => {
    render(await JobsPage({ searchParams: Promise.resolve({ q: 'proqramçı' }) }));
    const resetLink = screen.getByRole('link', { name: /Filtrləri sıfırla \(1 aktiv\)/ });
    expect(resetLink).toHaveAttribute('href', '/jobs');
    expect(resetLink.className).toMatch(/border-accent/);
  });
});

describe('dashboard nav uses distinct icons for vacancies vs matches', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders Uyğunluqlar and Bütün vakansiyalar as different nav items with different SVG icons', () => {
    render(<DashboardNav unreadNotificationsCount={0} user={{ name: 'Test', email: 'test@example.com' }}><p>Məzmun</p></DashboardNav>);
    // Both links must be present
    const vacancyLink = screen.getAllByRole('link', { name: 'Bütün vakansiyalar' })[0];
    const matchesLink = screen.getAllByRole('link', { name: 'Uyğunluqlar' })[0];
    expect(vacancyLink).toBeInTheDocument();
    expect(matchesLink).toBeInTheDocument();
    // Their SVG icons must be distinct (different path data means different icons)
    const vacancySvg = vacancyLink.querySelector('svg');
    const matchesSvg = matchesLink.querySelector('svg');
    expect(vacancySvg).not.toBeNull();
    expect(matchesSvg).not.toBeNull();
    expect(vacancySvg!.innerHTML).not.toBe(matchesSvg!.innerHTML);
  });
});

describe('job catalogue responsive layout and overflow audit', () => {
  const catalogue = {
    data: [{
      id: 'job-overflow-test',
      kind: 'imported',
      source: 'glorri',
      category: 'technology',
      categoryLabel: 'İnformasiya texnologiyaları və telekommunikasiya sistemləri',
      title: 'Senior Full Stack Software Development Lead Engineer with Long Title',
      company: 'Very Long Company Name International Caspian Energy Services MMC',
      companyId: null,
      location: 'Bakı şəhəri, Nərimanov rayonu, Heydər Əliyev prospekti 123',
      postedAt: '2026-09-30T20:00:00Z',
      deadline: '2026-10-31T20:00:00Z',
      workArrangement: 'Remote',
      experienceLevel: 'Senior',
      applicationMethod: 'EXTERNAL_SITE',
      checkedAt: '2026-10-02T08:00:00Z',
    }],
    meta: { total: 1, totalOpen: 500, page: 1, limit: 20, totalPages: 1 },
    sources: [{ source: 'glorri', count: 500 }],
    categories: [{ key: 'technology', label: 'İnformasiya texnologiyaları və telekommunikasiya', count: 10 }],
    workArrangements: [{ value: 'Remote', count: 5 }],
    experienceLevels: [{ value: 'Senior', count: 3 }],
    companies: [{ company: 'Very Long Company Name International Caspian Energy Services MMC', count: 1 }],
  };

  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogue)))));
  afterEach(() => vi.unstubAllGlobals());

  it.each([390, 768, 1440])('ensures overflow-safe sizing classes (min-w-0, max-w-full, truncate) on all form controls and active filter pills at %ipx viewport', async (viewportWidth) => {
    window.innerWidth = viewportWidth;
    window.dispatchEvent(new Event('resize'));

    const { container } = render(await JobsPage({ searchParams: Promise.resolve({ q: 'a very long search phrase exceeding small screen width', category: 'technology' }) }));
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.className).toMatch(/min-w-0/);

    // Check all input and select controls inside form have min-w-0 and max-w-full
    const controls = form!.querySelectorAll('input, select');
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach((el) => {
      expect(el.className).toMatch(/max-w-full/);
      expect(el.className).toMatch(/min-w-0/);
    });

    // Check all labels inside form have min-w-0
    const labels = form!.querySelectorAll('label');
    labels.forEach((label) => {
      expect(label.className).toMatch(/min-w-0/);
    });

    // Check active filters container
    const filterRegion = screen.getByLabelText('Aktiv filtrlər');
    expect(filterRegion.className).toMatch(/min-w-0/);
    const pills = filterRegion.querySelectorAll('a[aria-label$="filtrini sil"]');
    pills.forEach((pill) => {
      expect(pill.className).toMatch(/max-w-full/);
      const textSpan = pill.querySelector('span');
      expect(textSpan?.className).toMatch(/truncate/);
    });
  });
});


