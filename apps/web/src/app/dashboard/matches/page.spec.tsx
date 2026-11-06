import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MatchesPage from './page';
const { apiFetch, params } = vi.hoisted(() => ({ apiFetch: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/lib/api', () => ({ apiFetch, downloadAuthedFile: vi.fn() }));
const match = (id: string, title: string, location: string, actionable = true) => ({ id, status: actionable ? 'NEW' : 'APPLIED', actionable, score: .8, createdAt: '2026-09-01', details: { matchedKeywords: ['TypeScript'], gaps: [] }, job: { title, company: 'Fixture Company', location, description: 'TypeScript engineer description', externalId: `glorri:${id}`, url: `https://jobs.glorri.com/vacancies/fixture/${id}`, lastSeenAt: '2026-09-01' }, tailoredResumes: [] });
const richMatch = (id: string, title: string, company: string, location: string, keywords: string[], status = 'NEW') => ({ id, status, actionable: true, score: .7, createdAt: '2026-09-01', details: { matchedKeywords: keywords, gaps: [] }, job: { title, company, location, description: 'Təsvir', externalId: `glorri:${id}`, url: `https://jobs.glorri.com/vacancies/fixture/${id}`, lastSeenAt: '2026-09-01' }, tailoredResumes: [] });
describe('matches screen', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı'), match('b','Engineer Gəncə','Gəncə'), match('c','Closed history','Bakı',false)])));
  });
  it('searches visible matches and combines the location filter with an honest empty state', async () => {
    render(<MatchesPage />);
    await screen.findByRole('heading', { name: 'Engineer Bakı' });
    fireEvent.click(screen.getByRole('button', { name: /Əlavə filtrlər/ }));
    fireEvent.change(screen.getByLabelText('Yer (elanda yazıldığı kimi)'), { target: { value: 'Gəncə' } });
    expect(screen.queryByRole('heading', { name: 'Engineer Bakı' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Engineer Gəncə' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'absent' } });
    expect(screen.getByText(/Görünən uyğunluqlarda bu meyarlara uyğun nəticə yoxdur/)).toBeInTheDocument();
  });
  it('filters by title/skill and company together, keeps company options stable, and clears everything', async () => {
    apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(path === '/resumes' ? [] : [
      richMatch('1', 'Backend Developer', 'Azərcell Telekom MMC', 'Bakı, Nərimanov', ['TypeScript', 'PostgreSQL']),
      richMatch('2', 'Frontend Developer', 'Azərcell Telekom MMC', 'Gəncə', ['TypeScript', 'React']),
      richMatch('3', 'İdarəetmə mühasibi', 'Kapital Bank', 'Bakı', ['Excel', 'İFRS']),
      richMatch('4', 'Satış meneceri', 'ASAN Xidmət', 'Sumqayıt', ['CRM'], 'APPLIED'),
    ])));
    render(<MatchesPage />);
    await screen.findByRole('heading', { name: 'Backend Developer' });
    const company = screen.getByLabelText('Şirkət') as HTMLSelectElement;
    expect([...company.options].map((o) => o.textContent)).toEqual(['Bütün şirkətlər', 'ASAN Xidmət', 'Azərcell Telekom MMC', 'Kapital Bank']);
    fireEvent.change(company, { target: { value: 'Azərcell Telekom MMC' } });
    // Selecting one company must not erase the other options.
    expect([...(screen.getByLabelText('Şirkət') as HTMLSelectElement).options]).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'REACT' } });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Frontend Developer']);
    expect(screen.getByRole('button', { name: 'Azərcell Telekom MMC filtrini sil' })).toBeInTheDocument();
    expect(screen.getByText('4 görünən uyğunluqdan 1-i göstərilir')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hamısını sıfırla/ }));
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
    expect((screen.getByLabelText('Vəzifə və ya bacarıq') as HTMLInputElement).value).toBe('');
  });
  it('matches Azerbaijani casing and status pills combine with the other criteria', async () => {
    apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(path === '/resumes' ? [] : [
      richMatch('3', 'İdarəetmə mühasibi', 'Kapital Bank', 'Bakı', ['Excel']),
      richMatch('4', 'İdarəetmə meneceri', 'Kapital Bank', 'Bakı', ['CRM'], 'APPLIED'),
    ])));
    render(<MatchesPage />);
    await screen.findByRole('heading', { name: 'İdarəetmə mühasibi' });
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'İDARƏETMƏ' } });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Müraciət edilib' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['İdarəetmə meneceri']);
  });
  it('filters locally: no extra request per keystroke or filter change, and quota is never bypassed', async () => {
    render(<MatchesPage />);
    await screen.findByRole('heading', { name: 'Engineer Bakı' });
    const before = apiFetch.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'e' } });
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText('Şirkət'), { target: { value: 'Fixture Company' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yeni' }));
    expect(apiFetch.mock.calls.length).toBe(before);
    expect(apiFetch.mock.calls.filter(([p]) => String(p).startsWith('/matches')).every(([p]) => !String(p).includes('?'))).toBe(true);
    expect(screen.getByText(/Görünən uyğunluqlarda axtar/)).toBeInTheDocument();
  });
  it('expands a deep-linked match once and does not re-open it after the candidate closes it', async () => {
    params.set('id', 'b');
    try {
      render(<MatchesPage />);
      const heading = await screen.findByRole('heading', { name: 'Engineer Gəncə' });
      await waitFor(() => expect(heading.closest('[role="button"]')).toHaveAttribute('aria-expanded', 'true'));
      fireEvent.click(heading.closest('[role="button"]')!);
      expect(heading.closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Yenilə' }));
      await waitFor(() => expect(apiFetch.mock.calls.filter(([p]) => p === '/matches').length).toBe(2));
      expect(heading.closest('[role="button"]')).toHaveAttribute('aria-expanded', 'false');
    } finally { params.delete('id'); }
  });
  it('opens details with keyboard access, displays provenance, and disables actions for closed history', async () => {
    render(<MatchesPage />);
    const heading = await screen.findByRole('heading', { name: 'Closed history' });
    fireEvent.keyDown(heading.closest('[role="button"]')!, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('artıq aktiv deyil');
    expect(screen.getByRole('button', { name: 'CV-ni Fərdiləşdir' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Glorri-də bax' })).not.toBeInTheDocument();
    expect(screen.getByText('Profilinizdə sübutu olan:')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });
  it('offers automated application only where the server reports it available, and keeps the assisted route otherwise', async () => {
    const caps = {
      a: { available: true, reason: null, message: null },
      b: { available: false, reason: 'NOTICE_NOT_CAPTURED', message: 'Bəyanat qeydə alınmayıb.' },
    };
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/external-applications/capabilities')) {
        expect(path).toBe('/external-applications/capabilities?matchIds=a,b');
        return new Response(JSON.stringify(caps));
      }
      if (path === '/external-applications' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'ext-9' }), { status: 201 });
      if (path.startsWith('/matches/')) return new Response('{}');
      return new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı'), match('b','Engineer Gəncə','Gəncə'), match('c','Closed history','Bakı',false)]));
    });
    render(<MatchesPage />);
    fireEvent.click((await screen.findByRole('heading', { name: 'Engineer Gəncə' })).closest('[role="button"]')!);
    expect(screen.queryByText(/Avtomatik müraciət/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Avtomatik müraciət hazırla/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Glorri-də bax/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('heading', { name: 'Engineer Bakı' }).closest('[role="button"]')!);
    const start = screen.getByRole('button', { name: /Avtomatik müraciət hazırla/ });
    // Opening the card marks it viewed first; the action is enabled after that.
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    // Starting creates a draft only; consent and sending happen on the apply page.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/external-applications', { method: 'POST', body: JSON.stringify({ matchId: 'a' }) }));
    expect(apiFetch.mock.calls.some(([p]) => /consent|confirm-submit/.test(p))).toBe(false);
  });
  it('says why automation is unavailable for a destination vacancy, and warns when a send could not be confirmed', async () => {
    const glorri = { key: 'glorri', displayName: 'Glorri (jobs.glorri)', preparation: 'NOTICE_NOT_CAPTURED', receipt: 'NOT_VERIFIABLE', rejection: 'NOT_DETECTABLE', identityDocumentRequired: true };
    const caps = {
      a: { available: true, reason: null, message: null, destination: { ...glorri, preparation: 'AVAILABLE' }, applyYourselfUrl: 'https://jobs.glorri.com/vacancies/fixture/a' },
      b: { available: false, reason: 'NOTICE_NOT_CAPTURED', message: 'Bəyanat qeydə alınmayıb.', destination: glorri, applyYourselfUrl: 'https://jobs.glorri.com/vacancies/fixture/b' },
    };
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/external-applications/capabilities')) return new Response(JSON.stringify(caps));
      if (path.startsWith('/matches/')) return new Response('{}');
      return new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı'), match('b','Engineer Gəncə','Gəncə')]));
    });
    render(<MatchesPage />);

    // Unavailable: the server's reason, and the existing routes rather than new links.
    fireEvent.click((await screen.findByRole('heading', { name: 'Engineer Gəncə' })).closest('[role="button"]')!);
    const note = screen.getByTestId('apply-yourself');
    expect(note).toHaveTextContent('Avtomatik müraciət mövcud deyil. Bəyanat qeydə alınmayıb.');
    expect(note).toHaveTextContent('«Müraciət etdim» ilə qeyd edin');
    expect(screen.queryByRole('button', { name: /Avtomatik müraciət hazırla/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Glorri-də bax/ })).toHaveLength(1);

    // Available but unconfirmable: said before the candidate even starts.
    fireEvent.click(screen.getByRole('heading', { name: 'Engineer Bakı' }).closest('[role="button"]')!);
    expect(screen.getByRole('button', { name: /Avtomatik müraciət hazırla/ })).toBeInTheDocument();
    expect(screen.getByTestId('receipt-unverifiable')).toHaveTextContent('Qəbul təsdiqlənə bilməz');
    expect(screen.getByTestId('receipt-unverifiable')).toHaveTextContent('«Çatdırılma təsdiqlənməyib»');
  });
  it.each(['PLAN_REQUIRED', 'LIVE_GATE_OFF', 'NOT_PILOT', 'OPERATOR_PAUSED'])('stays silent about automation for an account or rollout reason (%s)', async (reason) => {
    const glorri = { key: 'glorri', displayName: 'Glorri (jobs.glorri)', preparation: 'NOTICE_NOT_CAPTURED', receipt: 'NOT_VERIFIABLE', rejection: 'NOT_DETECTABLE', identityDocumentRequired: true };
    const caps = { a: { available: false, reason, message: 'Avtomatik xarici müraciətlər yalnız Limitsiz planında əlçatandır. Zəhmət olmasa planınızı yüksəldin.', destination: glorri, applyYourselfUrl: 'https://jobs.glorri.com/vacancies/fixture/a' } };
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/external-applications/capabilities')) return new Response(JSON.stringify(caps));
      if (path.startsWith('/matches/')) return new Response('{}');
      return new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı')]));
    });
    render(<MatchesPage />);
    fireEvent.click((await screen.findByRole('heading', { name: 'Engineer Bakı' })).closest('[role="button"]')!);
    await waitFor(() => expect(apiFetch.mock.calls.some(([p]) => String(p).startsWith('/external-applications/capabilities'))).toBe(true));
    expect(screen.queryByTestId('apply-yourself')).not.toBeInTheDocument();
    expect(screen.queryByText(/planınızı yüksəldin/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Avtomatik müraciət hazırla/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Glorri-də bax/ })).toBeInTheDocument();
  });
  it('shows no receipt warning where the destination has a receipt contract', async () => {
    const caps = { a: { available: true, reason: null, message: null, destination: { key: 'glorri', displayName: 'Glorri', preparation: 'AVAILABLE', receipt: 'VERIFIED_BY_CONTRACT', rejection: 'DETECTED_BY_CONTRACT', identityDocumentRequired: true } } };
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/external-applications/capabilities')) return new Response(JSON.stringify(caps));
      if (path.startsWith('/matches/')) return new Response('{}');
      return new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı')]));
    });
    render(<MatchesPage />);
    fireEvent.click((await screen.findByRole('heading', { name: 'Engineer Bakı' })).closest('[role="button"]')!);
    expect(screen.getByRole('button', { name: /Avtomatik müraciət hazırla/ })).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-unverifiable')).not.toBeInTheDocument();
  });
  it('links an existing possibly-sent automated application instead of offering another', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/external-applications/capabilities')) {
        return new Response(JSON.stringify({ a: { available: false, reason: 'ALREADY_SENT', message: null, applicationId: 'ext-1', applicationStatus: 'DELIVERY_UNCONFIRMED' } }));
      }
      if (path.startsWith('/matches/')) return new Response('{}');
      return new Response(JSON.stringify(path === '/resumes' ? [] : [match('a','Engineer Bakı','Bakı')]));
    });
    render(<MatchesPage />);
    fireEvent.click((await screen.findByRole('heading', { name: 'Engineer Bakı' })).closest('[role="button"]')!);
    expect(screen.getByRole('link', { name: /Avtomatik müraciətin vəziyyəti/ })).toHaveAttribute('href', '/dashboard/apply/ext-1');
    expect(screen.queryByRole('button', { name: /Avtomatik müraciət hazırla/ })).not.toBeInTheDocument();
  });
  it('allows recovery from a failed fetch without retaining an obsolete error banner', async () => {
    apiFetch.mockRejectedValueOnce(new Error('temporary failure'));
    render(<MatchesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('temporary failure');
    fireEvent.click(screen.getByRole('button', { name: 'Yenilə' }));
    await screen.findByRole('heading', { name: 'Engineer Bakı' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('renders 3 skeleton cards while matches are loading', () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    render(<MatchesPage />);
    const skeletons = screen.getAllByTestId('match-skeleton');
    expect(skeletons).toHaveLength(3);
    skeletons.forEach((s) => expect(s.className).toMatch(/animate-pulse/));
  });
  it('offers a reset filters button when search yields no results and clicking it restores visible matches', async () => {
    render(<MatchesPage />);
    await screen.findByRole('heading', { name: 'Engineer Bakı' });
    fireEvent.change(screen.getByLabelText('Vəzifə və ya bacarıq'), { target: { value: 'nonexistent-query' } });
    expect(screen.getByText('Filtrlərə uyğun vakansiya tapılmadı')).toBeInTheDocument();
    const resetBtn = screen.getByRole('button', { name: 'Filtrləri sıfırlayın' });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(screen.getByRole('heading', { name: 'Engineer Bakı' })).toBeInTheDocument();
  });
  it('shows profile link CTA when no matches exist globally', async () => {
    apiFetch.mockImplementation(async () => new Response(JSON.stringify([])));
    render(<MatchesPage />);
    expect(await screen.findByText('Meyarlarınıza uyğun vakansiya tapılmadı')).toBeInTheDocument();
    const profileLink = screen.getByRole('link', { name: 'Hədəf rolları və üstünlükləri tənzimləyin' });
    expect(profileLink).toHaveAttribute('href', '/dashboard/profile');
  });
  it('lets a new candidate explicitly select an immediate ranked first batch from already scored jobs', async () => {
    let published = false;
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/matches/selection-status') return new Response(JSON.stringify({ cadence: 'weekly', pendingCount: 7, nextSelectionAt: '2026-11-02T00:10:00.000Z', firstBatchAvailable: !published }));
      if (path === '/matches/first-batch' && init?.method === 'POST') {
        published = true;
        return new Response(JSON.stringify({ status: 'published', published: 3 }));
      }
      return new Response(JSON.stringify(path === '/resumes' ? [] : []));
    });
    render(<MatchesPage />);
    const button = await screen.findByRole('button', { name: 'İlk uyğunluqları indi seç' });
    expect(screen.getByText(/7 uyğun vakansiya sıralanıb/)).toBeInTheDocument();
    fireEvent.click(button);
    await screen.findByText('3 uyğun vakansiya seçildi.');
    expect(apiFetch).toHaveBeenCalledWith('/matches/first-batch', { method: 'POST' });
  });
});

