import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateDocumentModal } from './create-document-modal';
import { MotivationLetterComposer } from './motivation-letter-composer';
import { DocumentAllowanceCard } from './document-allowance-card';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'usr-1' } }, status: 'authenticated' }),
  getSession: vi.fn().mockResolvedValue({ user: { id: 'usr-1' }, sessionToken: 'tok-123' }),
}));

const mockAllowanceFree = {
  plan: 'free',
  limit: 5,
  used: 2,
  reserved: 0,
  remaining: 3,
  period: '2026-10',
  resetsAt: '2026-11-01T00:00:00.000Z',
  protections: null,
  costs: { perDocument: 1, cvAndLetter: 2 },
};

const mockAllowanceExhausted = {
  plan: 'free',
  limit: 5,
  used: 5,
  reserved: 0,
  remaining: 0,
  period: '2026-10',
  resetsAt: '2026-11-01T00:00:00.000Z',
  protections: null,
  costs: { perDocument: 1, cvAndLetter: 2 },
};

const mockAllowanceUnlimited = {
  plan: 'premium',
  limit: null,
  used: 12,
  reserved: 1,
  remaining: null,
  period: '2026-10',
  resetsAt: '2026-11-01T00:00:00.000Z',
  protections: { concurrent: 3, perHour: 30 },
  costs: { perDocument: 1, cvAndLetter: 2 },
};

const mockMatches = [
  {
    id: 'match-1',
    actionable: true,
    job: {
      title: 'Frontend Developer',
      company: 'Kapital Bank',
      location: 'Bakı',
    },
  },
];

beforeEach(() => {
  mockApiFetch.mockReset();
  // Anything a test does not mock answers like a server that has nothing to say (never an undefined fetch).
  mockApiFetch.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }));
});

describe('DocumentAllowanceCard', () => {
  it('renders plan allowance and transparent rules with active balance', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowanceFree,
    });

    render(<DocumentAllowanceCard />);
    expect(screen.getByTestId('document-allowance-card')).toBeDefined();

    expect(await screen.findByTestId('document-allowance-summary')).toHaveTextContent(/Bu ay 3 sənəd qalıb \(2 \/ 5 istifadə olunub\)/);
    expect(screen.getByText(/1 sənəd = 1 vahid/)).toBeDefined();
    expect(screen.getByText('Balans necə hesablanır')).toBeDefined();
  });

  it('renders exhausted state accurately with Baku reset date and upgrade prompt', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowanceExhausted,
    });

    render(<DocumentAllowanceCard />);
    expect(await screen.findByTestId('document-allowance-summary')).toHaveTextContent(/Bu ayın 5 sənədi istifadə olunub\. Yenilənmə:/);
    expect(screen.getByRole('link', { name: /Planı yüksəlt/i })).toBeDefined();
  });

  it('renders unlimited plan with concurrent and hourly protections', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowanceUnlimited,
    });

    render(<DocumentAllowanceCard />);
    expect(await screen.findByTestId('document-allowance-summary')).toHaveTextContent(/Aylıq limit yoxdur/);
    expect(screen.getByText(/Sabitlik üçün eyni anda ən çox/i)).toBeDefined();
  });

  it('renders honest unavailable state and does not fabricate free allowance on error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<DocumentAllowanceCard />);
    expect(await screen.findByText('Sənəd balansı məlumatı əlçatan deyil')).toBeDefined();
    expect(screen.getByText(/Cari sənəd limiti və qalıq məlumatı müəyyən edilə bilmədi/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Yenidən yoxla/i })).toBeDefined();
  });
});

describe('CreateDocumentModal', () => {
  it('renders rezüme vs CV distinction truthfully with approved terminology', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({
            units: 1,
            affordable: true,
            refusal: null,
            remainingAfter: 2,
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-1"
      />,
    );

    // Options exist and use "rezüme" consistently
    expect(await screen.findByText('Rezüme (Resume)')).toBeDefined();
    expect(screen.getByText('Geniş CV')).toBeDefined();
    expect(screen.getByText('Motivasiya məktubu')).toBeDefined();

    // No confusing "xülasə"
    expect(screen.queryByText('Xülasə (Resume)')).toBeNull();

    // Explains difference truthfully
    expect(screen.getByText(/Fərq nədədir\?/i)).toBeDefined();

    // Quoted cost displayed
    expect(await screen.findByText(/1 generasiya/i)).toBeDefined();
  });

  it('triggers letter flow when Motivation Letter is selected and submitted', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    const startLetterFlow = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={onClose}
        baseResumeId="base-1"
        initialMatchId="match-1"
        onStartLetterFlow={startLetterFlow}
      />,
    );

    // Click Motivation Letter option
    fireEvent.click(await screen.findByText('Motivasiya məktubu'));

    const submitBtn = await screen.findByRole('button', { name: /Məktub axınına keç/i });
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    // Submit form
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(startLetterFlow).toHaveBeenCalledWith({
        matchId: 'match-1',
        title: 'Frontend Developer',
        company: 'Kapital Bank',
        language: 'az',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('submits CV generation and only calls onSuccess on real 201 server document', async () => {
    let generatePayload: any = null;
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/matches/match-1/skills') return { ok: true, json: async () => ({ evidenced: [], missingRequired: [], missingPreferred: [], other: [], guidedPrompts: [], candidateEvidenceItems: [
        { id: 'project', kind: 'PROJECT', title: 'SQL project', explanation: 'Confirmed' },
        { id: 'award', kind: 'AWARD', title: 'Prize', explanation: 'Confirmed' },
      ] }) };
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        generatePayload = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            bundleId: 'bundle-xyz',
            created: 1,
            unitsReserved: 1,
            documents: [{ id: 'doc-real-1', docKind: 'RESUME', status: 'NEEDS_REVIEW' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={onClose}
        baseResumeId="base-1"
        initialMatchId="match-1"
        onSuccess={onSuccess}
      />,
    );

    // Wait for quote to finish and button to become enabled
    const submitBtn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'SQL project seçin' }));
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-real-1', docKind: 'RESUME' }),
      );
      expect(onClose).toHaveBeenCalled();
    });

    // Check payload passed idempotency key
    expect(generatePayload).toMatchObject({
      matchId: 'match-1',
      items: [{ kind: 'RESUME', language: 'az' }],
      expectedUnits: 1,
      selectedCareerEntryIds: ['award'],
    });
    expect(generatePayload.requestId).toBeDefined();
  });

  it('shows error and does not call onSuccess when server generation fails', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        return {
          ok: false,
          status: 402,
          json: async () => ({ message: 'Aylıq generasiya kvotanız bitib.' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    const onSuccess = vi.fn();

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-1"
        onSuccess={onSuccess}
      />,
    );

    const submitBtn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Aylıq generasiya kvotanız bitib/i)).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('rejects malformed quote responses and disables submit', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: 'yes-affordable' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-1"
      />,
    );

    expect(await screen.findByText(/Serverdən etibarlı qiymət məlumatı alına bilmədi/i)).toBeDefined();
    const submitBtn = screen.getByRole('button', { name: /Sənədi hazırla/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables document generation and letter handoff while skill save is pending', async () => {
    let resolveBulk: (val: any) => void;
    const bulkPromise = new Promise((resolve) => {
      resolveBulk = resolve;
    });

    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      }
      if (url === '/matches/match-1/skills') {
        return {
          ok: true,
          json: async () => ({
            matchId: 'match-1',
            hasProfile: true,
            evidenced: [],
            missingRequired: [{ skill: 'Power BI', level: 'required' }],
            missingPreferred: [],
            other: [],
            guidedPrompts: [],
          }),
        };
      }
      if (url === '/profile/skills/bulk') {
        return bulkPromise;
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-1"
        initialKind="RESUME"
      />,
    );

    const submitBtn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    // Select missing skill and click bulk add
    const skillCheckbox = await screen.findByText('Power BI');
    fireEvent.click(skillCheckbox);
    const bulkAddBtn = screen.getByText('Seçilən bacarıqlar məndə var — profilə əlavə et');
    fireEvent.click(bulkAddBtn);

    // While save is pending, submit button MUST be disabled
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve save
    resolveBulk!({
      ok: true,
      json: async () => ({ addedCount: 1, addedSkills: ['Power BI'], skills: ['Power BI'] }),
    });

    // After save resolves, submit button is re-enabled
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('restores initialKind and initialLanguage when opened from return context', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches };
      }
      if (url === '/documents/quote') {
        return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-1"
        initialKind="LETTER"
        initialLanguage="en"
      />,
    );

    // Initial kind LETTER is selected
    const letterActionBtn = await screen.findByRole('button', { name: /Məktub axınına keç/i });
    expect(letterActionBtn).toBeInTheDocument();

    // Initial language English is active
    const englishBtn = screen.getByRole('button', { name: 'English' });
    expect(englishBtn).toHaveClass('bg-primary');
  });

  it('saved job with no recommendation: open preparation → edit profile → return → confirm the original target → generate (uses exact match)', async () => {
    let generatedBody: any = null;

    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      // /matches only contains standard recommendations, excluding unscored saved jobs
      if (url === '/matches') {
        return { ok: true, json: async () => mockMatches }; // contains match-1
      }
      if (url === '/saved-jobs') {
        return {
          ok: true,
          json: async () => [
            { ref: 'imported:job-99', title: 'Data Lead', company: 'DataLead MMC', state: 'open' },
          ],
        };
      }
      if (url === '/documents/saved-job-match') {
        return {
          ok: true,
          json: async () => ({
            matchId: 'match-saved-99',
            title: 'Data Lead',
            company: 'DataLead MMC',
          }),
        };
      }
      if (url === '/matches/match-saved-99') {
        return {
          ok: true,
          json: async () => ({
            id: 'match-saved-99',
            actionable: true,
            ref: 'imported:job-99',
            job: { id: 'job-99', title: 'Data Lead', company: 'DataLead MMC' },
          }),
        };
      }
      if (url === '/matches/match-saved-99/skills') {
        return {
          ok: true,
          json: async () => ({
            matchId: 'match-saved-99',
            hasProfile: true,
            evidenced: [],
            missingRequired: [{ skill: 'SQL', level: 'required' }],
            missingPreferred: [],
            other: [],
            guidedPrompts: [
              {
                id: 'p1',
                title: 'SQL',
                description: 'SQL təcrübəsini təsvir edin',
                section: 'skills',
                link: '/dashboard/profile?matchId=match-saved-99&savedRef=imported:job-99&kind=RESUME&lang=az&returnTo=%2Fdashboard%2Fresumes#skills',
              },
            ],
          }),
        };
      }
      if (url === '/documents/quote') {
        return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      }
      if (url === '/documents/generate') {
        generatedBody = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            bundleId: 'bnd-99',
            created: true,
            documents: [{ id: 'doc-99', kind: 'RESUME', status: 'PENDING' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    // 1. Candidate opens preparation for a saved job
    const { unmount } = render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="saved:imported:job-99"
      />,
    );

    // Wait for saved job match resolution and prompt link
    const promptDesc = await screen.findByText('SQL təcrübəsini təsvir edin');
    expect(promptDesc).toBeInTheDocument();
    const promptAnchor = promptDesc.closest('a');
    expect(promptAnchor).toHaveAttribute('href', expect.stringContaining('matchId=match-saved-99'));
    expect(promptAnchor).toHaveAttribute('href', expect.stringContaining('savedRef=imported%3Ajob-99'));
    unmount();

    // 2. Candidate returns after profile editing with matchId=match-saved-99, savedRef=imported:job-99, kind=RESUME, lang=az
    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="match-saved-99"
        initialSavedRef="imported:job-99"
        initialKind="RESUME"
        initialLanguage="az"
      />,
    );

    // Modal restores the owned target using authenticated match-resolution path
    const select = (await screen.findByLabelText(/Hədəf vakansiya uyğunluğu/i)) as HTMLSelectElement;
    await waitFor(() => {
      // Must be restored to match-saved-99, NEVER silently replaced with mockMatches[0].id ('match-1')
      expect(select.value).toBe('match-saved-99');
    });

    // Confirm submit button is ready and click generate
    const submitBtn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(submitBtn);

    // Assert the generated request uses that EXACT match
    await waitFor(() => {
      expect(generatedBody).not.toBeNull();
      expect(generatedBody.matchId).toBe('match-saved-99');
      expect(generatedBody.items).toEqual([{ kind: 'RESUME', language: 'az' }]);
    });
  });

  it('shows clear recoverable state and never silently generates for another vacancy when target cannot be resolved', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/saved-jobs') return { ok: true, json: async () => [] };
      if (url === '/matches/unresolvable-match-id') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: false, json: async () => ({}) };
    });

    render(
      <CreateDocumentModal
        isOpen={true}
        onClose={vi.fn()}
        baseResumeId="base-1"
        initialMatchId="unresolvable-match-id"
      />,
    );

    // Recoverable error is displayed
    const errorNotice = await screen.findByText('Seçilmiş vakansiya bərpa edilə bilmədi');
    expect(errorNotice).toBeInTheDocument();
    expect(
      screen.getByText('Seçilmiş vakansiya tapılmadı və ya artıq aktiv deyil. Zəhmət olmasa siyahıdan başqa bir vakansiya seçin.'),
    ).toBeInTheDocument();

    // Submit button is disabled: never silently generates for another vacancy
    const submitBtn = screen.getByRole('button', { name: /Sənədi hazırla/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    const select = screen.getByLabelText(/Hədəf vakansiya uyğunluğu/i) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('keeps the same requestId only while an identical request has no answer, and starts a new one after any answer or a new session', async () => {
    const ids: string[] = [];
    let attempt = 0;

    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      if (url === '/documents/generate') {
        ids.push(JSON.parse(String(init?.body)).requestId);
        attempt++;
        // 1: the answer never arrives (network error) · 2: the server answers 500 · 3: success
        if (attempt === 1) throw new TypeError('Failed to fetch');
        if (attempt === 2) return { ok: false, status: 500, json: async () => ({ message: 'Temporary failure' }) };
        return { ok: true, status: 201, json: async () => ({ bundleId: 'b', created: true, documents: [{ id: 'doc-retry-1', kind: 'RESUME', status: 'PENDING' }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    const { rerender } = render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    const submit = async () => {
      const btn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
      await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(btn);
    };

    // No answer → the candidate is told the outcome is unknown, and the retry is the SAME request (replayed by the server, never charged twice).
    await submit();
    expect(await screen.findByText(/cavab alınmadı/i)).toBeDefined();
    await submit();
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[1]).toBe(ids[0]);

    // An HTTP answer (here 500) ends that attempt: the next press must be a new request, never a replay of the old outcome.
    expect(await screen.findByText(/Temporary failure/i)).toBeDefined();
    await submit();
    await waitFor(() => expect(ids).toHaveLength(3));
    expect(ids[2]).not.toBe(ids[1]);

    // A reopened modal is a new session.
    rerender(<CreateDocumentModal isOpen={false} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    rerender(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    await submit();
    await waitFor(() => expect(ids).toHaveLength(4));
    expect(ids[3]).not.toBe(ids[2]);
  });

  it('starts a new requestId when the language changes between attempts', async () => {
    const ids: string[] = [];
    let first = true;
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      if (url === '/documents/generate') {
        ids.push(JSON.parse(String(init?.body)).requestId);
        if (first) { first = false; throw new TypeError('Failed to fetch'); }
        return { ok: true, status: 201, json: async () => ({ documents: [{ id: 'd', status: 'PENDING' }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    let btn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText(/cavab alınmadı/i);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    btn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('words a short protection as a protection that clears itself, never as a used-up month or a reason to upgrade; and a used-up month with its reset', async () => {
    const quoteWith = (refusal: object | null) => async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: false, refusal }) };
      return { ok: false, json: async () => ({}) };
    };
    mockApiFetch.mockImplementation(quoteWith({ code: 'CONCURRENCY_LIMIT', concurrent: 3, running: 3 }));
    const { unmount } = render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="b" initialMatchId="match-1" />);
    expect(await screen.findByText(/aylıq limit deyil/i)).toBeDefined();
    expect(screen.queryByText(/planınızı yüksəldin/i)).toBeNull();
    unmount();

    mockApiFetch.mockImplementation(quoteWith({ code: 'ALLOWANCE_EXHAUSTED', limit: 5, remaining: 0, resetsAt: '2026-10-31T20:00:00.000Z' }));
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="b" initialMatchId="match-1" />);
    expect(await screen.findByText(/noyabr/i)).toBeDefined();
    expect(screen.getByText(/ödənişsizdir/i)).toBeDefined();
  });

  it('labels the vacancy with the match\'s real company and offers no section checklist that the server never receives', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      return { ok: false, json: async () => ({}) };
    });
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    expect(await screen.findByRole('option', { name: /Frontend Developer — Kapital Bank/ })).toBeDefined();
    expect(screen.queryByText('Daxil Ediləcək Əlavə Bölmələr')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('never shows or uses the previous quote while a new one is being fetched', async () => {
    let release: (v: unknown) => void = () => {};
    let calls = 0;
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') {
        calls++;
        if (calls === 2) await new Promise((r) => { release = r; });
        return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null, remainingAfter: calls === 1 ? 4 : 3 }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="b" initialMatchId="match-1" />);
    expect(await screen.findByText('4 ədəd')).toBeDefined();
    fireEvent.click(screen.getByText('Geniş CV'));
    await screen.findByText('Hesablanır...');
    expect(screen.queryByText('4 ədəd')).toBeNull();
    expect((screen.getByRole('button', { name: /Sənədi hazırla/i }) as HTMLButtonElement).disabled).toBe(true);
    release(undefined);
    expect(await screen.findByText('3 ədəd')).toBeDefined();
  });

  it('treats a success status whose body never arrived as an unknown outcome and repeats the same request', async () => {
    const ids: string[] = [];
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      if (url === '/documents/generate') {
        ids.push(JSON.parse(String(init?.body)).requestId);
        if (ids.length === 1) return { ok: true, status: 201, json: async () => { throw new TypeError('network error'); } };
        return { ok: true, status: 201, json: async () => ({ documents: [{ id: 'd1', kind: 'RESUME', status: 'PENDING' }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const onSuccess = vi.fn();
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="b" initialMatchId="match-1" onSuccess={onSuccess} />);
    const press = async () => {
      const btn = await screen.findByRole('button', { name: /Sənədi hazırla/i });
      await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(btn);
    };
    await press();
    expect(await screen.findByText(/cavab alınmadı/i)).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
    await press();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(ids[1]).toBe(ids[0]);
  });

  it('moves focus into the dialog, keeps Tab inside it in both directions, closes on Escape and returns focus to the opener', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      return { ok: false, json: async () => ({}) };
    });
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <button type="button">Fon düyməsi</button>
          <CreateDocumentModal isOpen={open} onClose={() => setOpen(false)} baseResumeId="b" initialMatchId="match-1" />
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Aç' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 30; i++) {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // Focus pushed outside (a click behind the dialog, a script) is brought back.
    screen.getByRole('button', { name: 'Fon düyməsi' }).focus();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('does not show a cost it does not have', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/matches') return { ok: true, json: async () => mockMatches };
      if (url === '/documents/quote') return { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
      return { ok: false, json: async () => ({}) };
    });
    render(<CreateDocumentModal isOpen={true} onClose={vi.fn()} baseResumeId="base-1" initialMatchId="match-1" />);
    expect(await screen.findByText('boom')).toBeDefined();
    expect(screen.queryByText(/^1 generasiya$/)).toBeNull();
  });
});

describe('MotivationLetterComposer', () => {
  it('passes a full proposed sentence through candidate confirmation into the real generation request', async () => {
    let generated: any;
    const sentence = 'SQL ilə məlumatların təhlilini məhsul qərarlarının hazırlanmasına tətbiq etmək istəyirəm.';
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/matches/match-proposal/skills') return { ok: true, json: async () => ({ motivationSuggestions: [{ id: 'role', field: 'whyRole', title: 'Vəzifəyə maraq', text: sentence }] }) };
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      if (url === '/documents/generate') { generated = JSON.parse(String(init?.body)); return { ok: true, status: 201, json: async () => ({ documents: [{ id: 'proposed-letter', status: 'PENDING' }] }) }; }
      return { ok: false, json: async () => ({}) };
    });
    render(<MotivationLetterComposer initialJob={{ matchId: 'match-proposal', title: 'Business Analyst', company: 'Synthetic Payments' }} candidateName="Synthetic Candidate" onClose={vi.fn()} />);
    const accept = await screen.findByRole('button', { name: 'Məni ifadə edir — əlavə et' });
    expect((screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i) as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(accept);
    expect((screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i) as HTMLTextAreaElement).value).toBe(sentence);
    const generate = screen.getByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect(generate).not.toBeDisabled());
    fireEvent.click(generate);
    await waitFor(() => expect(generated?.letter.motivation).toBe(sentence));
    expect(generated.matchId).toBe('match-proposal');
  });

  const mockJob = {
    title: 'Senior Product Designer',
    company: 'ABB Bank',
  };

  it('strictly excludes unconfirmed evidence from factual inputs', () => {
    const candidateEvidence = {
      projects: [
        { id: 'p1', name: 'Təsdiqlənmiş layihə', confirmed: true, description: 'İstifadəçi interfeysi', period: '', source: 'USER' as const },
        { id: 'p2', name: 'Qondarma layihə', confirmed: false, description: 'Təsdiqlənməyib', period: '', source: 'USER' as const },
      ],
      volunteering: [
        { id: 'v1', role: 'Könüllü mentor', organization: 'Code Academy', confirmed: true, description: '', period: '', source: 'USER' as const },
        { id: 'v2', role: 'Gizli könüllü', organization: 'Yox', confirmed: false, description: '', period: '', source: 'USER' as const },
      ],
      certifications: [
        { id: 'c1', title: 'Təsdiqli Sertifikat', issuer: 'Google', confirmed: true, date: '', source: 'USER' as const },
        { id: 'c2', title: 'Qaralama Sertifikat', issuer: 'Meta', confirmed: false, date: '', source: 'USER' as const },
      ],
      languages: [],
      awards: [],
    };

    render(
      <MotivationLetterComposer
        initialJob={mockJob}
        candidateName="Elmir Quliyev"
        candidateEvidence={candidateEvidence}
        onClose={vi.fn()}
      />,
    );

    // Confirmed items must be visible as selectable buttons
    expect(screen.getByRole('button', { name: /Təsdiqlənmiş layihə/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Könüllü mentor/i })).toBeDefined();

    // Unconfirmed items must be completely excluded from generation inputs
    expect(screen.queryByText('Qondarma layihə')).toBeNull();
    expect(screen.queryByText('Gizli könüllü')).toBeNull();
    expect(screen.queryByText('Qaralama Sertifikat')).toBeNull();
  });

  it('offers short answer options that fill the box (editable), and holds back an unfinished sentence', async () => {
    render(<MotivationLetterComposer initialJob={mockJob} candidateName="Elmir Quliyev" onClose={vi.fn()} />);
    const why = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i) as HTMLTextAreaElement;
    expect(why.value).toBe('');
    // a chip puts its sentence in the box; the box stays free text
    fireEvent.click(screen.getByRole('button', { name: 'Dəqiqlik və səliqə tələb edən işə yaxınlığım var.' }));
    expect(why.value).toBe('Dəqiqlik və səliqə tələb edən işə yaxınlığım var.');
    fireEvent.change(why, { target: { value: 'Dəqiqlik tələb edən işi sevirəm.' } });
    expect(why.value).toBe('Dəqiqlik tələb edən işi sevirəm.');
    // a sentence start is not sent until it is finished
    fireEvent.click(screen.getByRole('button', { name: 'Komandada işləyərkən …' }));
    const formative = screen.getByLabelText(/2\. Hansı təcrübə bu marağı/i) as HTMLTextAreaElement;
    expect(formative.value).toBe('Komandada işləyərkən …');
    fireEvent.click(await screen.findByRole('button', { name: /Qaralamanı hazırla/i }));
    expect(screen.getByText(/cümləsini tamamlayın/i)).toBeDefined();
  });

  it('renders guiding questions and requires confirmed numbers for metrics', () => {
    render(
      <MotivationLetterComposer
        initialJob={mockJob}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    // Question labels
    expect(screen.getByText(/1\. Bu işin sizi konkret nə cəlb edir\?/i)).toBeDefined();
    expect(screen.getByText(/5\. Bu vəzifə ilə bağlı hansı təcrübəniz və ya layihəniz/i)).toBeDefined();
    expect(screen.getByText(/6\. Bu nümunədə şəxsən nə etdiniz və nəticəsi nə oldu\?/i)).toBeDefined();

    // Confirmation checkbox for numbers
    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    expect(numCheckbox).toBeDefined();
    expect((numCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(numCheckbox);
    expect((numCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it('generates editable draft and displays truthful policy notice without false guarantees', () => {
    render(
      <MotivationLetterComposer
        initialJob={mockJob}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    // Proceed to draft review
    fireEvent.click(screen.getByRole('button', { name: /Qaralamanı hazırla/i }));

    // Shows draft editor
    const draftTextarea = screen.getByLabelText(/Məktubun mətni/i);
    expect(draftTextarea).toBeDefined();
    expect((draftTextarea as HTMLTextAreaElement).value).toContain('ABB Bank');
    expect((draftTextarea as HTMLTextAreaElement).value).toContain('Senior Product Designer');

    // Truthful policy check
    expect(
      screen.getByText(/Bu motivasiya məktubu müsahibə və ya işə qəbul vəd etmir/i),
    ).toBeDefined();
  });

  it('offers previous answers without inserting them until explicitly chosen for the new vacancy', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      if (url === '/documents/letter-answers') return { ok: true, json: async () => ({ formative: 'Kafedə işləyərkən müştərini dinləməyin vacibliyini anladım.', contribution: 'Sifarişləri vaxtında təhvil verirəm.', fromDocumentId: 'd1' }) };
      return { ok: true, json: async () => ({}) };
    });
    render(<MotivationLetterComposer initialJob={{ matchId: 'm-reuse', title: 'Kuryer', company: 'Bolt' }} candidateName="Leyla" onClose={vi.fn()} />);
    const formative = (await screen.findByLabelText(/2\. Hansı təcrübə bu marağı/i)) as HTMLTextAreaElement;
    await screen.findByText('Əvvəlki məktubumdakı cavablara bax');
    expect(formative.value).toBe('');
    expect((screen.getByLabelText(/4\. İşəgötürənin nəzərə almasını/i) as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByText('Əvvəlki məktubumdakı cavablara bax'));
    fireEvent.click(screen.getByRole('button', {name:'Əvvəlki təcrübə cavabımı istifadə et'}));
    expect(formative.value).toBe('Kafedə işləyərkən müştərini dinləməyin vacibliyini anladım.');
    expect((screen.getByLabelText(/4\. İşəgötürənin nəzərə almasını/i) as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('reused-answers-note')).toBeDefined();
    // the vacancy-specific questions start empty
    expect((screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/3\. Bu vakansiyada və ya şirkətdə diqqətinizi nə çəkdi/i) as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(formative, { target: { value: 'Yeni cümlə.' } });
    expect(formative.value).toBe('Yeni cümlə.');
  });

  it('prefills all candidate answers when retrying a letter with saved letterInputs', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };
      return { ok: true, json: async () => ({}) };
    });
    render(
      <MotivationLetterComposer
        initialJob={{
          matchId: 'm-retry',
          title: 'Audit Specialist',
          company: 'Deloitte',
          letterInputs: {
            motivation: 'Maliyyə hesabatlılığı və daxili nəzarət sistemləri üzrə işləmək istəyirəm.',
            companyReason: 'Şirkətin peşəkar təlim mühiti və beynəlxalq standartları mənim üçün önəmlidir.',
            formative: 'Universitet layihəsində audit simulyasiyası apararkən bu sahəyə marağım yarandı.',
            contribution: 'Dəqiqlik və analitik yanaşma ilə audit sənədləşməsini vaxtında hazırlayıram.',
          },
        }}
        candidateName="Fizuli"
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i) as HTMLTextAreaElement).value).toBe(
      'Maliyyə hesabatlılığı və daxili nəzarət sistemləri üzrə işləmək istəyirəm.',
    );
    expect((screen.getByLabelText(/2\. Hansı təcrübə bu marağı/i) as HTMLTextAreaElement).value).toBe(
      'Universitet layihəsində audit simulyasiyası apararkən bu sahəyə marağım yarandı.',
    );
    expect((screen.getByLabelText(/3\. Bu vakansiyada və ya şirkətdə diqqətinizi nə çəkdi/i) as HTMLTextAreaElement).value).toBe(
      'Şirkətin peşəkar təlim mühiti və beynəlxalq standartları mənim üçün önəmlidir.',
    );
    expect((screen.getByLabelText(/4\. İşəgötürənin nəzərə almasını/i) as HTMLTextAreaElement).value).toBe(
      'Dəqiqlik və analitik yanaşma ilə audit sənədləşməsini vaxtında hazırlayıram.',
    );
  });

  it('persists situation/action/result answers as confirmed STORY entries and passes storyIds with selected language', async () => {
    let capturedStoryPayload: any = null;
    let capturedGeneratePayload: any = null;

    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/profile/career-entries') {
        capturedStoryPayload = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'story-from-answers-123' }),
        };
      }
      if (url === '/documents/generate') {
        capturedGeneratePayload = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            documents: [{ id: 'doc-letter-1', kind: 'LETTER', status: 'PENDING' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <MotivationLetterComposer
        initialJob={{ matchId: 'match-1', title: 'Tech Lead', company: 'Pasha Bank' }}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    // Select language 'en'
    const langSelect = screen.getByLabelText(/Dil:/i);
    fireEvent.change(langSelect, { target: { value: 'en' } });

    // Answer questions
    const whyInput = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i);
    fireEvent.change(whyInput, { target: { value: 'Passionate about Pasha cloud transformation' } });
    fireEvent.change(screen.getByLabelText(/3\. Bu vakansiyada və ya şirkətdə diqqətinizi nə çəkdi\?/i), { target: { value: 'Pasha Bank-ın bulud layihələri mənə yaxındır.' } });
    fireEvent.change(screen.getByLabelText(/2\. Hansı təcrübə bu marağı/i), { target: { value: 'Bulud miqrasiyasında işləyərkən bu işin mənə nə qədər yaxın olduğunu gördüm.' } });
    fireEvent.change(screen.getByLabelText(/4\. İşəgötürənin nəzərə almasını/i), { target: { value: 'Miqrasiyanı sənədləşdirib komandaya təhvil verdim.' } });

    const whatResultInput = screen.getByLabelText(/6\. Bu nümunədə şəxsən nə etdiniz və nəticəsi nə oldu\?/i);
    fireEvent.change(whatResultInput, { target: { value: 'Built event-driven pipeline decreasing latency by 60%' } });

    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    fireEvent.click(numCheckbox);

    // Wait for quote to finish and button to become enabled
    const prepareDraftBtn = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect((prepareDraftBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepareDraftBtn);

    await waitFor(() => {
      expect(capturedStoryPayload).not.toBeNull();
      expect(capturedGeneratePayload).not.toBeNull();
    });

    // Verify STORY payload
    expect(capturedStoryPayload).toMatchObject({
      kind: 'STORY',
      organization: 'Pasha Bank',
      role: 'Tech Lead',
      action: 'Built event-driven pipeline decreasing latency by 60%',
      result: 'Built event-driven pipeline decreasing latency by 60%',
    });

    // Verify generate payload passed storyIds, language 'en', and motivation text
    expect(capturedGeneratePayload).toMatchObject({
      matchId: 'match-1',
      items: [{ kind: 'LETTER', language: 'en' }],
      expectedUnits: 1,
      letter: {
        storyIds: ['story-from-answers-123'],
      },
    });
    expect(capturedGeneratePayload.letter.motivation).toContain('Passionate about Pasha cloud transformation');
    // the employer reason travels as its own field, in the candidate's words, never mixed into the role reason
    expect(capturedGeneratePayload.letter.companyReason).toBe('Pasha Bank-ın bulud layihələri mənə yaxındır.');
    expect(capturedGeneratePayload.letter.motivation).not.toContain('bulud layihələri');
    expect(capturedGeneratePayload.letter.formative).toBe('Bulud miqrasiyasında işləyərkən bu işin mənə nə qədər yaxın olduğunu gördüm.');
    expect(capturedGeneratePayload.letter.contribution).toBe('Miqrasiyanı sənədləşdirib komandaya təhvil verdim.');
  });

  it('keeps pending document pending without substituting local text, and polls until READY', async () => {
    let pollCount = 0;
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            documents: [{ id: 'doc-delayed-1', docKind: 'LETTER', status: 'PENDING' }],
          }),
        };
      }
      if (url === '/documents/doc-delayed-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'doc-delayed-1',
            status: 'READY',
            content: { text: 'Server generated final motivation letter text' },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <MotivationLetterComposer
        initialJob={{ matchId: 'match-delayed', title: 'Security Engineer', company: 'Azercell' }}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    const whyInput = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i);
    fireEvent.change(whyInput, { target: { value: 'Azercell telecom security' } });

    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    fireEvent.click(numCheckbox);

    const prepareDraftBtn = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect((prepareDraftBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepareDraftBtn);

    // Must show pending state and NOT jump to draft editor with dummy local text
    expect(await screen.findByText(/Motivasiya məktubu serverdə hazırlanır/i)).toBeDefined();
    expect(screen.queryByLabelText(/Məktubun mətni/i)).toBeNull();

    // After poll finishes, transitions to review step with real server text
    expect(await screen.findByText('Server generated final motivation letter text', {}, { timeout: 5000 })).toBeDefined();
  }, 15000);

  it('displays failed generation state distinctly with 0 units deducted notice', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            documents: [{ id: 'doc-failed-1', docKind: 'LETTER', status: 'PENDING' }],
          }),
        };
      }
      if (url === '/documents/doc-failed-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'doc-failed-1',
            status: 'FAILED',
            statusError: 'LLM xətası: server cavab vermədi',
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <MotivationLetterComposer
        initialJob={{ matchId: 'match-fail', title: 'Data Scientist', company: 'SOCAR' }}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    const whyInput = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i);
    fireEvent.change(whyInput, { target: { value: 'SOCAR analytics' } });

    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    fireEvent.click(numCheckbox);

    const prepareDraftBtn2 = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect((prepareDraftBtn2 as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepareDraftBtn2);

    // Failed screen
    const failElements = await screen.findAllByText(/LLM xətası: server cavab vermədi/i, {}, { timeout: 4000 });
    expect(failElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Balansınızdan heç bir generasiya vahidi çıxılmayıb/i)).toBeDefined();
  });

  it('halts approval if review save fails and keeps draft open', async () => {
    let approveCalled = false;
    let reviewAttempted = false;

    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            documents: [{ id: 'doc-to-approve-1', kind: 'LETTER', status: 'PENDING' }],
          }),
        };
      }
      if (url === '/documents/doc-to-approve-1' && !init?.method) {
        return {
          ok: true,
          json: async () => ({ id: 'doc-to-approve-1', status: 'NEEDS_REVIEW', content: { paragraphs: [{ id: 'p1', text: 'Hörmətli komanda' }] } }),
        };
      }
      if (url === '/documents/doc-to-approve-1/review' && init?.method === 'PATCH') {
        reviewAttempted = true;
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: 'Redaktə yadda saxlanıla bilmədi' }),
        };
      }
      if (url === '/documents/doc-to-approve-1/approve') {
        approveCalled = true;
        return { ok: true, json: async () => ({ id: 'doc-to-approve-1' }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(
      <MotivationLetterComposer
        initialJob={{ matchId: 'match-review-fail', title: 'DevOps', company: 'Bravo' }}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    const whyInput = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i);
    fireEvent.change(whyInput, { target: { value: 'DevOps automation' } });

    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    fireEvent.click(numCheckbox);

    const prepareDraftBtn = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect((prepareDraftBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepareDraftBtn);

    const approveBtn = await screen.findByRole('button', { name: /Yoxladım, təsdiqləyirəm/i }, { timeout: 6000 });
    fireEvent.click(approveBtn);

    // Review failed error must be shown
    expect(await screen.findByText(/Redaktə yadda saxlanıla bilmədi/i)).toBeDefined();
    expect(reviewAttempted).toBe(true);
    // Approve MUST NOT have been called
    expect(approveCalled).toBe(false);
    // Draft stays open
    expect(screen.getByText('Hörmətli komanda')).toBeDefined();
  });

  it('successfully approves after review save and allows downloading PDF', async () => {
    let reviewSaved = false;
    let approved = false;
    let approvalBody: unknown;

    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/documents/quote') {
        return {
          ok: true,
          json: async () => ({ units: 1, affordable: true, refusal: null }),
        };
      }
      if (url === '/documents/generate') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            documents: [{ id: 'doc-success-1', kind: 'LETTER', status: 'PENDING' }],
          }),
        };
      }
      if (url === '/documents/doc-success-1' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            id: 'doc-success-1', status: 'NEEDS_REVIEW', version: 7,
            reviewNotes: { revision: 7 },
            untranslated: [{ path: 'paragraphs.0.text', section: 'Məktub', text: 'A remaining English phrase.' }],
            content: { paragraphs: [{ id: 'p1', text: 'Uğurlu məktub' }] },
          }),
        };
      }
      if (url === '/documents/doc-success-1/review' && init?.method === 'PATCH') {
        reviewSaved = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'doc-success-1' }),
        };
      }
      if (url === '/documents/doc-success-1/approve' && init?.method === 'POST') {
        approved = true;
        approvalBody = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'doc-success-1', status: 'READY' }),
        };
      }
      if (url === '/documents/doc-success-1/preview') {
        return {
          ok: true,
          blob: async () => new Blob(['fake-pdf'], { type: 'application/pdf' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    const origCreateUrl = window.URL.createObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-pdf-url');

    render(
      <MotivationLetterComposer
        initialJob={{ matchId: 'match-success', title: 'Lead Architect', company: 'ABB' }}
        candidateName="Elmir Quliyev"
        onClose={vi.fn()}
      />,
    );

    const whyInput = screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i);
    fireEvent.change(whyInput, { target: { value: 'Architectural leadership' } });

    const numCheckbox = screen.getByRole('checkbox', {
      name: /Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/i,
    });
    fireEvent.click(numCheckbox);

    const prepareDraftBtn2 = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
    await waitFor(() => expect((prepareDraftBtn2 as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prepareDraftBtn2);

    const approveBtn = await screen.findByRole('button', { name: /Yoxladım, təsdiqləyirəm/i }, { timeout: 6000 });
    expect(approveBtn).toBeDisabled();
    expect(screen.getByText(/A remaining English phrase\./)).toBeDefined();
    fireEvent.click(screen.getByRole('checkbox', { name: /Mətnləri yoxladım və qalan hissələrlə bu formada təsdiq edirəm/i }));
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(reviewSaved).toBe(true);
      expect(approved).toBe(true);
    });
    expect(approvalBody).toEqual({ acknowledgeUntranslated: true, reviewedRevision: 7 });

    expect(await screen.findByRole('button', { name: /Təsdiqləndi/i })).toBeDefined();

    // Test download PDF button
    const downloadPdfBtn = screen.getByRole('button', { name: /PDF yüklə/i });
    fireEvent.click(downloadPdfBtn);

    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

    window.URL.createObjectURL = origCreateUrl;
  });

  describe('integration with the real server contract', () => {
    const answer = () => {
      fireEvent.change(screen.getByLabelText(/1\. Bu işin sizi konkret nə cəlb edir/i), { target: { value: 'Rəqəmsal xidmətlər' } });
      fireEvent.change(screen.getByLabelText(/6\. Bu nümunədə şəxsən nə etdiniz və nəticəsi nə oldu\?/i), { target: { value: 'Hesabat sorğularını sürətləndirdim' } });
    };
    const start = async () => {
      const btn = await screen.findByRole('button', { name: /Qaralamanı hazırla/i });
      await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(btn);
    };
    const quoteOk = { ok: true, json: async () => ({ units: 1, affordable: true, refusal: null }) };

    it('never replaces a failed server generation with a locally written letter', async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === '/documents/quote') return quoteOk;
        if (url === '/profile/career-entries') return { ok: true, status: 201, json: async () => ({ id: 'story-1' }) };
        if (url === '/documents/generate') return { ok: false, status: 500, json: async () => ({ message: 'Provayder əlçatmazdır' }) };
        return { ok: false, json: async () => ({}) };
      });
      render(<MotivationLetterComposer initialJob={{ matchId: 'm1', title: 'Analyst', company: 'ABB' }} candidateName="Leyla" onClose={vi.fn()} />);
      answer();
      await start();
      expect(await screen.findByText('Provayder əlçatmazdır')).toBeDefined();
      // Still on the questions step; no draft, no local text, no approve button.
      expect(screen.queryByLabelText(/Məktubun mətni/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Yoxladım, təsdiqləyirəm/i })).toBeNull();
      expect(screen.getByRole('button', { name: /Qaralamanı hazırla/i })).toBeDefined();
    });

    it('does not generate when the answers could not be saved as a story', async () => {
      let generated = false;
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === '/documents/quote') return quoteOk;
        if (url === '/profile/career-entries') return { ok: false, status: 400, json: async () => ({ message: 'Başlıq çox uzundur' }) };
        if (url === '/documents/generate') { generated = true; return { ok: true, status: 201, json: async () => ({ documents: [{ id: 'd', status: 'PENDING' }] }) }; }
        return { ok: false, json: async () => ({}) };
      });
      render(<MotivationLetterComposer initialJob={{ matchId: 'm1', title: 'Analyst', company: 'ABB' }} candidateName="Leyla" onClose={vi.fn()} />);
      answer();
      await start();
      expect(await screen.findByText('Başlıq çox uzundur')).toBeDefined();
      expect(generated).toBe(false);
    });

    it('offers the candidate\'s confirmed career entries from the career-entries API, and only the confirmed ones', async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === '/profile/career-entries?status=CONFIRMED') {
          return { ok: true, json: async () => ({ entries: [
            { id: 'e1', kind: 'PROJECT', status: 'CONFIRMED', origin: 'EXTRACTED', title: 'Kredit paneli', description: 'Hesabat paneli' },
            { id: 'e2', kind: 'PROJECT', status: 'SUGGESTED', origin: 'EXTRACTED', title: 'Təsdiqsiz layihə' },
            { id: 'e3', kind: 'CERTIFICATION', status: 'CONFIRMED', origin: 'USER_ADDED', title: 'Data analitikası', organization: 'Coursera' },
          ] }) };
        }
        return { ok: false, json: async () => ({}) };
      });
      render(<MotivationLetterComposer initialJob={{ matchId: 'm1', title: 'Analyst', company: 'ABB' }} candidateName="Leyla" onClose={vi.fn()} />);
      expect(await screen.findByRole('button', { name: /Kredit paneli/ })).toBeDefined();
      expect(screen.getByRole('button', { name: /Data analitikası/ })).toBeDefined();
      expect(screen.queryByText(/Təsdiqsiz layihə/)).toBeNull();
    });

    it('retries after an unknown outcome with the same requestId, but after a FAILED document the retry is a new request', async () => {
      const ids: string[] = [];
      mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/documents/quote') return quoteOk;
        if (url === '/profile/career-entries') return { ok: true, status: 201, json: async () => ({ id: 'story-1' }) };
        if (url === '/documents/generate') {
          ids.push(JSON.parse(String(init?.body)).requestId);
          if (ids.length === 1) throw new TypeError('Failed to fetch');
          return { ok: true, status: 201, json: async () => ({ documents: [{ id: `doc-${ids.length}`, kind: 'LETTER', status: 'PENDING' }] }) };
        }
        if (url === '/documents/doc-2') return { ok: true, json: async () => ({ id: 'doc-2', status: 'FAILED', statusError: 'Çıxış yoxlanılmadı (INVALID_OUTPUT)' }) };
        return { ok: false, json: async () => ({}) };
      });
      render(<MotivationLetterComposer initialJob={{ matchId: 'm1', title: 'Analyst', company: 'ABB' }} candidateName="Leyla" onClose={vi.fn()} />);
      answer();
      await start();
      expect(await screen.findByText(/cavab alınmadı/i)).toBeDefined();
      await start();
      await waitFor(() => expect(ids).toHaveLength(2));
      expect(ids[1]).toBe(ids[0]); // same request, replayed by the server, never charged twice

      // The server then reports the document FAILED: the retry must not replay that failure.
      expect(await screen.findByTestId('letter-failed-state', {}, { timeout: 5000 })).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /Yenidən cəhd et/i }));
      await waitFor(() => expect(ids).toHaveLength(3));
      expect(ids[2]).not.toBe(ids[1]);
    }, 15000);
  });
});
