import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CandidatePreparationSheet } from './candidate-preparation-sheet';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('CandidatePreparationSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Real catalogue response shape: skill is a string!
  const mockRealSkillsGuidance = {
    matchId: 'match-1',
    hasProfile: true,
    evidenced: [
      { skill: 'SQL', via: 'skills' },
      { skill: 'Excel', via: 'experience' },
    ],
    missingRequired: [
      { skill: 'Power BI', level: 'required', requirement: 'Power BI ilə hesabatlar' },
      { skill: 'DAX', level: 'required', requirement: 'DAX sorğuları' },
    ],
    missingPreferred: [
      { skill: 'Python', level: 'preferred', requirement: 'Python bilikləri' },
    ],
    other: [{ text: 'İqtisadiyyat üzrə ali təhsil', kind: 'degree', level: 'required' }],
    guidedPrompts: [
      {
        id: 'skill_power_bi',
        title: 'Power BI tələbi',
        description: 'Elanda bu bacarıq tələb olunur, amma profilinizdə göstərilməyib. Sahib olduğunuz bacarıqları seçərək profilinizə əlavə edin.',
        section: 'skills' as const,
        link: '/dashboard/profile?matchId=match-1&returnTo=%2Fdashboard%2Fresumes%3FmatchId%3Dmatch-1#skills',
      },
      {
        id: 'other_1',
        title: 'İqtisadiyyat üzrə ali təhsil',
        description: 'Elanda təhsil tələbi qeyd olunub. Təhsil bölməsinə daxil olaraq dərəcənizi və ixtisasınızı dəqiqləşdirin.',
        section: 'education' as const,
        link: '/dashboard/profile?matchId=match-1&returnTo=%2Fdashboard%2Fresumes%3FmatchId%3Dmatch-1#education',
      },
    ],
  };

  it('renders real catalogue response shape where skill is a string', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockRealSkillsGuidance,
    });

    render(<CandidatePreparationSheet matchId="match-1" kind="RESUME" language="az" />);

    // Shows evidenced skills
    await waitFor(() => {
      expect(screen.getByText('SQL')).toBeInTheDocument();
      expect(screen.getByText('Excel')).toBeInTheDocument();
    });

    // Exact copy requirement
    expect(
      screen.getByText(/Elanda bu bacarıqlar tələb olunur, amma profilinizdə göstərilməyib\. Sahib olduğunuz bacarıqları seçərək profilinizə əlavə edin\. Bu, təcrübənizi daha düzgün təqdim etməyə kömək edir; işə qəbul zəmanəti deyil\./i)
    ).toBeInTheDocument();

    // Renders missing required and preferred skills
    expect(screen.getByText('Power BI')).toBeInTheDocument();
    expect(screen.getByText('DAX')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();

    // Prompts build query before fragment
    const promptLink = screen.getByText('Power BI tələbi').closest('a');
    expect(promptLink).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/dashboard\/profile\?.*#skills$/)
    );
  });

  it('notifies parent of mutation state via onMutationChange', async () => {
    let resolvePost: (value: any) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    mockApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockRealSkillsGuidance,
      })
      .mockImplementationOnce(() => postPromise);

    const onMutationChange = vi.fn();
    render(<CandidatePreparationSheet matchId="match-1" onMutationChange={onMutationChange} />);

    await waitFor(() => {
      expect(screen.getByText('Power BI')).toBeInTheDocument();
    });

    // Select skill
    const powerBiBtn = screen.getByText('Power BI');
    fireEvent.click(powerBiBtn);

    const bulkBtn = screen.getByText('Seçilən bacarıqlar məndə var — profilə əlavə et');
    fireEvent.click(bulkBtn);

    // Parent must be notified that save is in progress
    expect(onMutationChange).toHaveBeenCalledWith(true);

    // Resolve POST
    resolvePost!({
      ok: true,
      json: async () => ({ addedCount: 1, addedSkills: ['Power BI'], skills: ['SQL', 'Power BI'] }),
    });

    await waitFor(() => {
      expect(onMutationChange).toHaveBeenCalledWith(false);
    });
  });

  it('preserves candidate selections on mutation failure and offers retry and skip buttons', async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockRealSkillsGuidance,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Şəbəkə xətası baş verdi' }),
      });

    const onMutationChange = vi.fn();
    render(<CandidatePreparationSheet matchId="match-1" onMutationChange={onMutationChange} />);

    await waitFor(() => {
      expect(screen.getByText('Power BI')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Power BI'));
    const bulkBtn = screen.getByText('Seçilən bacarıqlar məndə var — profilə əlavə et');
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      expect(screen.getByText('Şəbəkə xətası baş verdi')).toBeInTheDocument();
      expect(onMutationChange).toHaveBeenCalledWith(false);
    });

    // Choices must be preserved, retry and skip visible
    expect(screen.getByText('Yenidən cəhd et')).toBeInTheDocument();
    expect(screen.getAllByText('Əlavə etmədən davam et').length).toBeGreaterThanOrEqual(1);
    // Power BI checkbox is still present
    expect(screen.getByText('Power BI')).toBeInTheDocument();
  });

  it('guards against out-of-order responses when switching vacancies', async () => {
    let resolveFirst: (v: any) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('match-1')) {
        return firstPromise;
      }
      if (url.includes('match-2')) {
        return {
          ok: true,
          json: async () => ({
            ...mockRealSkillsGuidance,
            matchId: 'match-2',
            missingRequired: [{ skill: 'Tableau', level: 'required' }],
          }),
        };
      }
      return { ok: true, json: async () => mockRealSkillsGuidance };
    });

    const { rerender } = render(<CandidatePreparationSheet matchId="match-1" />);

    // Switch to match-2 before match-1 finishes
    rerender(<CandidatePreparationSheet matchId="match-2" />);

    await waitFor(() => {
      expect(screen.getByText('Tableau')).toBeInTheDocument();
    });

    // Now match-1 arrives late
    resolveFirst!({
      ok: true,
      json: async () => mockRealSkillsGuidance,
    });

    // Stale match-1 response must NOT overwrite match-2 state
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Tableau')).toBeInTheDocument();
    expect(screen.queryByText('Power BI')).not.toBeInTheDocument();
  });

  it('allows dismissing missing skills via skip options while keeping evidenced skills visible', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockRealSkillsGuidance,
    });

    render(<CandidatePreparationSheet matchId="match-1" />);

    await waitFor(() => {
      expect(screen.getByText('Power BI')).toBeInTheDocument();
    });

    const skipBtn = screen.getByText('Əlavə etmədən davam et');
    fireEvent.click(skipBtn);

    // Missing skills checkboxes are collapsed
    expect(screen.queryByText('Power BI')).not.toBeInTheDocument();
    // But evidenced skills remain visible
    expect(screen.getByText('SQL')).toBeInTheDocument();
    expect(screen.getByText('Bacarıq hazırlığı addımı keçildi.')).toBeInTheDocument();
  });

  it('renders motivation suggestions for letters and allows 1-click adoption, editing, rejecting, and skipping', async () => {
    const onMotivationConfirmed = vi.fn();
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...mockRealSkillsGuidance,
        motivationSuggestions: [
          {
            id: 'sug_role',
            type: 'role',
            title: 'Vəzifəyə maraq',
            field: 'whyRole',
            text: 'Proseslərin avtomatlaşdırılması üzrə analitik kimi praktiki iş proseslərini icra etmək istəyirəm.',
          },
          {
            id: 'sug_company',
            type: 'company',
            title: 'Müəssisə seçimi',
            field: 'whyCompany',
            text: 'ABB tərəfindən elan olunmuş bu vakansiya maraqlarıma uyğundur.',
          },
        ],
      }),
    });

    render(
      <CandidatePreparationSheet
        matchId="match-1"
        kind="LETTER"
        onMotivationConfirmed={onMotivationConfirmed}
      />
    );

    // Header and suggestions visible
    await waitFor(() => {
      expect(screen.getByText('Motivasiyanızı dəqiqləşdirin')).toBeInTheDocument();
      expect(screen.getByText('Proseslərin avtomatlaşdırılması üzrə analitik kimi praktiki iş proseslərini icra etmək istəyirəm.')).toBeInTheDocument();
    });

    // 1-click adoption: "Mənə uyğundur — əlavə et"
    const adoptButtons = screen.getAllByText('Mənə uyğundur — əlavə et');
    fireEvent.click(adoptButtons[0]);

    // Parent notified with confirmed motivation
    expect(onMotivationConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        whyRole: 'Proseslərin avtomatlaşdırılması üzrə analitik kimi praktiki iş proseslərini icra etmək istəyirəm.',
      })
    );
    expect(screen.getByText('Əlavə edildi')).toBeInTheDocument();
  });

  it('renders expandable complete requirements detail with Hamısını göstər toggle', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockRealSkillsGuidance,
    });

    render(<CandidatePreparationSheet matchId="match-1" kind="RESUME" />);

    await waitFor(() => {
      expect(screen.getByText(/Hamısını göstər \(1 mənbə tələbi\)/)).toBeInTheDocument();
    });

    // Click toggle to expand
    fireEvent.click(screen.getByText(/Hamısını göstər \(1 mənbə tələbi\)/));
    expect(screen.getByText('Daha az göstər')).toBeInTheDocument();
    expect(screen.getAllByText(/İqtisadiyyat üzrə ali təhsil/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders relevant candidate projects, awards and activities with 1-sentence relevance and toggle controls', async () => {
    const mockGuidanceWithEvidence = {
      ...mockRealSkillsGuidance,
      candidateEvidenceItems: [
        {
          id: 'proj-1',
          kind: 'PROJECT' as const,
          title: 'Bank Prosesləri Portalı',
          organization: 'ABB Hackathon',
          explanation: 'Vakansiyada tələb olunan sahəvi tələblərə uyğun praktiki layihə hazırlığınızı göstərir.',
        },
        {
          id: 'award-1',
          kind: 'AWARD' as const,
          title: 'Fəal Töhfəçi Sertifikatı',
          organization: 'ABB',
          explanation: 'ABB tərəfindən verilmiş nailiyyətinizi təsdiqləyən təltifdir.',
        },
      ],
    };

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockGuidanceWithEvidence,
    });

    const onEvidenceToggled = vi.fn();

    render(
      <CandidatePreparationSheet
        matchId="match-1"
        kind="RESUME"
        onEvidenceToggled={onEvidenceToggled}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Əlaqəli layihələr, təltiflər və fəaliyyətlər:')).toBeInTheDocument();
      expect(screen.getByText('Bank Prosesləri Portalı')).toBeInTheDocument();
      expect(screen.getByText('Layihə')).toBeInTheDocument();
      expect(screen.getByText('Vakansiyada tələb olunan sahəvi tələblərə uyğun praktiki layihə hazırlığınızı göstərir.')).toBeInTheDocument();
      expect(screen.getByText('Fəal Töhfəçi Sertifikatı')).toBeInTheDocument();
      expect(screen.getByText('Təltif')).toBeInTheDocument();
    });

    // Both are initially checked (2/2 seçilib)
    expect(screen.getByText('2/2 seçilib')).toBeInTheDocument();

    // Click on first item to uncheck
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bank Prosesləri Portalı seçin' }));
    expect(screen.getByText('1/2 seçilib')).toBeInTheDocument();
    expect(onEvidenceToggled).toHaveBeenCalledWith(['award-1']);
  });

  it('clears confirmed motivation when changing target and when skipping', async () => {
    const confirmed = vi.fn();
    const suggestions = [{ id: 'role', type: 'role', field: 'whyRole', title: 'Maraq', text: 'SQL hesabatları hazırlamaq istəyirəm.' }];
    mockApiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ ...mockRealSkillsGuidance, motivationSuggestions: suggestions }) }));
    const { rerender } = render(<CandidatePreparationSheet matchId="match-1" kind="LETTER" onMotivationConfirmed={confirmed} />);
    fireEvent.click(await screen.findByText('Mənə uyğundur — əlavə et'));
    expect(confirmed).toHaveBeenLastCalledWith({ whyRole: suggestions[0].text });
    fireEvent.click(screen.getAllByText('Əlavə etmədən davam et')[0]);
    expect(confirmed).toHaveBeenLastCalledWith({});
    rerender(<CandidatePreparationSheet matchId="match-2" kind="LETTER" onMotivationConfirmed={confirmed} />);
    await screen.findByText('Mənə uyğundur — əlavə et');
    expect(screen.queryByText('Əlavə edildi')).not.toBeInTheDocument();
    expect(confirmed).toHaveBeenLastCalledWith({});
  });

  it('keeps intentionally excluded evidence excluded after adding a skill reloads guidance', async () => {
    const changed = vi.fn();
    const guidance = { ...mockRealSkillsGuidance, candidateEvidenceItems: [{ id: 'p', kind: 'PROJECT', title: 'SQL project', explanation: 'Confirmed' }] };
    mockApiFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url === '/profile/skills/bulk' ? {} : guidance }));
    render(<CandidatePreparationSheet matchId="match-1" onEvidenceToggled={changed} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'SQL project seçin' }));
    fireEvent.click(screen.getByText('Power BI'));
    fireEvent.click(screen.getByText('Seçilən bacarıqlar məndə var — profilə əlavə et'));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'SQL project seçin' })).toHaveAttribute('aria-checked', 'false'));
    expect(changed).toHaveBeenLastCalledWith([]);
  });

});
