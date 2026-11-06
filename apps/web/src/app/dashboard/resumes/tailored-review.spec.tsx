import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TailoredReview from './tailored-review';

const { apiFetch, downloadAuthedFile } = vi.hoisted(() => ({ apiFetch: vi.fn(), downloadAuthedFile: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch, downloadAuthedFile }));

const draft = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  status,
  statusError: null,
  version: 2,
  fileUrl: status === 'READY' ? '/uploads/cv.pdf' : null,
  reviewedAt: status === 'READY' ? '2026-09-28T10:00:00Z' : null,
  posting: { title: 'Backend Developer', company: 'Synthetic Co', actionable: true },
  reviewNotes: {
    issues: [
      { code: 'invented_skill', severity: 'error', section: 'skills', detail: 'Kubernetes' },
      { code: 'changed_period', severity: 'warning', section: 'experience:Qafqaz Labs', detail: '2015 → Jan 2022 - Present' },
    ],
  },
  content: {
    basics: { name: 'Leyla Hüseynova', headline: 'Backend mühəndisi', email: 'leyla@example.com', location: 'Gəncə' },
    summary: 'NestJS mühəndisi.',
    experience: [{ company: 'Qafqaz Labs', position: 'Backend Engineer', period: 'Jan 2022 - Present', location: 'Gəncə', highlights: ['REST API hazırladı.', 'İş yükünü 30% azaltdı.'] }],
    education: [{ school: 'Azərbaycan Texniki Universiteti', degree: 'Bakalavr', area: 'Kompüter elmləri', period: 'Sep 2015 - Jun 2019' }],
    skills: [{ keywords: ['NestJS', 'PostgreSQL'] }],
  },
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('tailored CV review', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    downloadAuthedFile.mockReset();
  });

  it('shows what the fact check removed, keeps identity facts read-only and offers no PDF before approval', async () => {
    apiFetch.mockResolvedValue(json(draft('NEEDS_REVIEW')));
    render(<TailoredReview id="r1" onClose={() => {}} />);
    expect(await screen.findByText('Faktların yoxlanışı: çıxarılanlar')).toBeInTheDocument();
    expect(screen.getByText(/Profildə olmayan bacarıq çıxarıldı/).closest('li')).toHaveTextContent('Kubernetes');
    expect(screen.getByRole('status')).toHaveTextContent('Təsdiqlənməmiş CV yüklənə bilməz');
    expect(screen.getByText('Backend Engineer — Qafqaz Labs')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Qafqaz/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PDF-i yüklə/ })).not.toBeInTheDocument();
  });

  it('keeps removals and notes apart: a warning is not "removed", and each note says what the candidate can do', async () => {
    apiFetch.mockResolvedValue(json(draft('NEEDS_REVIEW', { reviewNotes: { issues: [
      { code: 'invented_skill', severity: 'error', section: 'skills', detail: 'Kubernetes' },
      { code: 'dropped_metric', severity: 'warning', section: 'experience:Qafqaz Labs', reason: 'NO_ROOM', detail: '30 · İş yükünü 30% azaltdı.' },
      { code: 'filler_phrase', severity: 'warning', section: 'experience:Qafqaz Labs', detail: '"responsible for": Responsible for APIs.' },
    ] } })));
    render(<TailoredReview id="r1" onClose={() => {}} />);
    const removed = (await screen.findByText('Faktların yoxlanışı: çıxarılanlar')).closest('section')!;
    expect(removed).toHaveTextContent('Kubernetes');
    expect(removed).not.toHaveTextContent(/İş yükünü 30%/);
    const notes = screen.getByTestId('review-notes');
    expect(notes).toHaveTextContent('Bunlar çıxarılmayıb');
    expect(notes).toHaveTextContent(/Sizin yazdığınız rəqəm bəndlərdə yer almadı/);
    expect(notes).toHaveTextContent(/bu sənəddə ona yer qalmadı/);
    expect(notes).toHaveTextContent(/İş yükünü 30% azaltdı/);
    expect(notes).toHaveTextContent(/Lazımdırsa, aşağıdakı müvafiq bəndə özünüz əlavə edin/);
    expect(notes).toHaveTextContent(/Daha konkret yazın/);
  });

  it('tells the candidate when the document is longer than its kind should be, without hiding anything', async () => {
    apiFetch.mockResolvedValue(json(draft('NEEDS_REVIEW', { kind: 'RESUME', layout: { pages: 2, expectedMaxPages: 1, status: 'LONGER_THAN_EXPECTED' } })));
    render(<TailoredReview id="r1" onClose={() => {}} />);
    const notice = await screen.findByTestId('layout-notice');
    expect(notice).toHaveTextContent('2 səhifədir (gözlənilən: ən çox 1)');
    expect(notice).toHaveTextContent(/Heç nə kəsilmədi/);
  });

  it('shows no length notice for a document of the expected length', async () => {
    apiFetch.mockResolvedValue(json(draft('NEEDS_REVIEW', { layout: { pages: 1, expectedMaxPages: 1, status: 'OK' } })));
    render(<TailoredReview id="r1" onClose={() => {}} />);
    await screen.findByText('Faktların yoxlanışı: çıxarılanlar');
    expect(screen.queryByTestId('layout-notice')).not.toBeInTheDocument();
  });

  it('saves edits (one bullet per line, unchecked skills removed) before approving, then offers the PDF', async () => {
    let state = draft('NEEDS_REVIEW');
    const calls: { path: string; body?: any }[] = [];
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/resumes/r1/approve') state = draft('READY');
      return json(state);
    });
    render(<TailoredReview id="r1" onClose={() => {}} />);
    const bullets = await screen.findByLabelText(/Bəndlər/);
    fireEvent.change(bullets, { target: { value: 'Birinci bənd\n\n  İkinci bənd  ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'PostgreSQL' }));
    fireEvent.click(screen.getByRole('button', { name: /təsdiqlə və PDF yarat/ }));
    await screen.findByRole('button', { name: /PDF-i yüklə/ });
    const review = calls.find((c) => c.path === '/resumes/r1/review')!;
    expect(review.body).toMatchObject({ experience: [{ highlights: ['Birinci bənd', 'İkinci bənd'] }], skills: ['NestJS'] });
    expect(calls.map((c) => c.path)).toEqual(['/resumes/r1', '/resumes/r1/review', '/resumes/r1', '/resumes/r1/approve', '/resumes/r1']);
    fireEvent.click(screen.getByRole('button', { name: /PDF-i yüklə/ }));
    expect(downloadAuthedFile).toHaveBeenCalledWith('/uploads/cv.pdf', 'cv-v2.pdf');
  });

  it('does not approve when saving the edits is refused, and shows why', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === '/resumes/r1/review' ? json({ message: 'skill not in saved profile: Kubernetes' }, 400) : json(draft('NEEDS_REVIEW')),
    );
    render(<TailoredReview id="r1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /təsdiqlə və PDF yarat/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('skill not in saved profile');
    expect(apiFetch.mock.calls.some(([p]) => p === '/resumes/r1/approve')).toBe(false);
  });

  it('shows a failure with its reason and no editing controls', async () => {
    apiFetch.mockResolvedValue(json(draft('FAILED', { content: null, reviewNotes: null, statusError: 'Süni intellekt xidməti vaxtında cavab vermədi. (PROVIDER_TIMEOUT)' })));
    render(<TailoredReview id="r1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('(PROVIDER_TIMEOUT)'));
    expect(screen.queryByRole('button', { name: /Yadda saxla/ })).not.toBeInTheDocument();
  });

  it('allows approving partially untranslated CV with explicit acknowledgement submitting the fresh post-patch revision (4 -> 5)', async () => {
    let state = draft('NEEDS_REVIEW', {
      untranslated: [{ path: 'summary', text: 'Financial summary in English.', section: 'summary' }],
      reviewNotes: { revision: 4, issues: [{ code: 'not_translated', severity: 'warning', section: 'summary', detail: '...' }] },
    });
    const calls: { path: string; body?: any }[] = [];
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/resumes/r1/review') {
        state = draft('NEEDS_REVIEW', {
          untranslated: [{ path: 'summary', text: 'Financial summary in English.', section: 'summary' }],
          reviewNotes: { revision: 5, issues: [{ code: 'not_translated', severity: 'warning', section: 'summary', detail: '...' }] },
        });
      }
      if (path === '/resumes/r1/approve') {
        state = draft('READY', {
          untranslated: [{ path: 'summary', text: 'Financial summary in English.', section: 'summary' }],
          reviewNotes: { revision: 5, untranslatedAcknowledged: true },
        });
      }
      return json(state);
    });

    render(<TailoredReview id="r1" onClose={() => {}} />);
    const notice = await screen.findByTestId('untranslated-notice');
    expect(notice).toHaveTextContent('Bəzi hissələr tərcümə olunmayıb. Mətnləri yoxlayaraq sənədi bu formada təsdiqləyə bilərsiniz.');

    const approveAckBtn = screen.getByRole('button', { name: /Bu formada təsdiqlə və PDF yüklə/ });
    fireEvent.click(approveAckBtn);

    await screen.findByRole('button', { name: /PDF-i yüklə/ });
    const approveCall = calls.find((c) => c.path === '/resumes/r1/approve')!;
    expect(approveCall.body).toEqual({
      acknowledgeUntranslated: true,
      reviewedRevision: 5,
    });
  });

  it('rejects approval when concurrent change occurs and displays conflict error', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/resumes/r1') {
        return json(
          draft('NEEDS_REVIEW', {
            untranslated: [{ path: 'summary', text: 'Financial summary in English.', section: 'summary' }],
            reviewNotes: { revision: 4 },
          }),
        );
      }
      if (path === '/resumes/r1/review') {
        return json(
          draft('NEEDS_REVIEW', {
            untranslated: [{ path: 'summary', text: 'Financial summary in English.', section: 'summary' }],
            reviewNotes: { revision: 5 },
          }),
        );
      }
      if (path === '/resumes/r1/approve') {
        return json({ message: 'Sənəd dəyişdirildi. Zəhmət olmasa yenilənmiş versiyanı yoxlayın.' }, 409);
      }
      return json({});
    });

    render(<TailoredReview id="r1" onClose={() => {}} />);
    const approveAckBtn = await screen.findByRole('button', { name: /Bu formada təsdiqlə və PDF yüklə/ });
    fireEvent.click(approveAckBtn);

    expect(await screen.findByText('Sənəd dəyişdirildi. Zəhmət olmasa yenilənmiş versiyanı yoxlayın.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PDF-i yüklə/ })).not.toBeInTheDocument();
  });

  it('renders vacancy priorities panel with target role and requirements', async () => {
    apiFetch.mockResolvedValue(
      json(
        draft('NEEDS_REVIEW', {
          reviewNotes: {
            revision: 1,
            vacancyAnalysis: {
              targetRole: 'Data Platform Engineer',
              statedSeniority: 'senior',
              priorities: [
                { id: 'p1', category: 'responsibility', sourceText: 'Build real-time ETL pipelines with Kafka', weight: 1 },
                { id: 'p2', category: 'tool', sourceText: 'Proficiency in Go and PostgreSQL', weight: 0.9 },
              ],
            },
          },
        }),
      ),
    );

    render(<TailoredReview id="r1" onClose={() => {}} />);
    const panel = await screen.findByTestId('vacancy-priorities-panel');
    expect(panel).toHaveTextContent('Vakansiya üzrə prioritetlər və seçilmiş faktlar');
    expect(panel).toHaveTextContent('Data Platform Engineer');
    expect(panel).toHaveTextContent('senior səviyyə');
    expect(panel).toHaveTextContent('Build real-time ETL pipelines with Kafka');
    expect(panel).toHaveTextContent('Süni intellekt uyğunluq balı (ATS score) uydurulmur');
  });

  it('renders and edits categorized skill groups', async () => {
    let savedBody: any = null;
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resumes/r1/review') savedBody = JSON.parse(String(init?.body));
      return json(
        draft('NEEDS_REVIEW', {
          content: {
            ...draft('NEEDS_REVIEW').content,
            skills: [
              { name: 'Texniki alətlər və sistemlər', keywords: ['Go', 'Docker'] },
              { name: 'Sahəvi biliklər və metodologiyalar', keywords: ['Mikroservislər', 'Agile'] },
            ],
          },
        }),
      );
    });

    render(<TailoredReview id="r1" onClose={() => {}} />);
    expect(await screen.findByText('Texniki alətlər və sistemlər')).toBeInTheDocument();
    expect(screen.getByText('Sahəvi biliklər və metodologiyalar')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Go' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Agile' })).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Agile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));

    await waitFor(() => expect(savedBody).not.toBeNull());
    expect(savedBody.skills).toEqual([
      { name: 'Texniki alətlər və sistemlər', keywords: ['Go', 'Docker'] },
      { name: 'Sahəvi biliklər və metodologiyalar', keywords: ['Mikroservislər'] },
    ]);
  });
});
