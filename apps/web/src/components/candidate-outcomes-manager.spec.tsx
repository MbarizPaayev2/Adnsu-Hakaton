import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CandidateOutcomesManager, CandidateOutcomeItem } from './candidate-outcomes-manager';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

describe('CandidateOutcomesManager', () => {
  const mockOutcomes: CandidateOutcomeItem[] = [
    {
      id: 'out_1',
      outcomeType: 'INTERVIEW',
      occurredAt: '2026-10-15T10:00:00.000Z',
      jobTitle: 'Junior Data Analyst',
      companyName: 'Pasha Bank',
      verificationStatus: 'STUDENT_ATTESTED',
      provenance: 'CANDIDATE_REPORTED',
      note: 'First technical interview went well',
      shareWithAcademy: true,
      withdrawnAt: null,
      isWithdrawn: false,
      createdAt: '2026-10-15T11:00:00.000Z',
    },
    {
      id: 'out_2',
      outcomeType: 'JOB_STARTED',
      occurredAt: '2026-10-20T09:00:00.000Z',
      jobTitle: 'Backend Engineer',
      companyName: 'AzInTelecom',
      verificationStatus: 'EMPLOYER_CONFIRMED',
      provenance: 'CANDIDATE_REPORTED',
      note: 'Contract signed',
      shareWithAcademy: false,
      withdrawnAt: null,
      isWithdrawn: false,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', () => true);
  });

  it('renders reported outcomes with verification badges and company details', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string) => {
      if (url === '/academies/my-enrollments') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockOutcomes), { status: 200 }));
    });

    render(<CandidateOutcomesManager />);

    // Header and notice
    expect(screen.getByText('Karyera Nəticələrim')).toBeDefined();
    expect(screen.getByText(/Məxfilik və Yoxlama Qaydası/)).toBeDefined();

    // Outcome 1
    expect(await screen.findByText('Junior Data Analyst')).toBeDefined();
    expect(screen.getByText('Pasha Bank')).toBeDefined();
    expect(screen.getByText('Müsahibə')).toBeDefined();
    expect(screen.getByText('Tələbə bəyanı')).toBeDefined();

    // Outcome 2
    expect(screen.getByText('Backend Engineer')).toBeDefined();
    expect(screen.getByText('AzInTelecom')).toBeDefined();
    expect(screen.getByText('İşə başlandı')).toBeDefined();
    expect(screen.getByText('İşəgötürən təsdiqi')).toBeDefined();
    expect(screen.getByText('Akademiyadan gizli')).toBeDefined();
  });

  it('renders empty state when no outcomes exist', async () => {
    vi.mocked(apiFetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );

    render(<CandidateOutcomesManager />);

    expect(await screen.findByText('Hələ heç bir karyera nəticəsi qeyd edilməyib.')).toBeDefined();
  });

  it('allows candidate to report a new outcome', async () => {
    let outcomeList: any[] = [];
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (url === '/academies/my-enrollments') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url === '/candidate/outcomes' && opts?.method === 'POST') {
        outcomeList = [
          {
            id: 'out_new',
            outcomeType: 'OFFER_RECEIVED',
            occurredAt: '2026-10-24T00:00:00.000Z',
            jobTitle: 'QA Engineer',
            companyName: 'Kapital Bank',
            verificationStatus: 'STUDENT_ATTESTED',
            provenance: 'CANDIDATE_REPORTED',
            shareWithAcademy: false,
            isWithdrawn: false,
            createdAt: '2026-10-24T10:00:00.000Z',
          },
        ];
        return Promise.resolve(new Response(JSON.stringify(outcomeList[0]), { status: 201 }));
      }
      return Promise.resolve(new Response(JSON.stringify(outcomeList), { status: 200 }));
    });

    render(<CandidateOutcomesManager />);

    // Open modal
    const openBtn = await screen.findByRole('button', { name: /Yeni nəticə bildir/i });
    fireEvent.click(openBtn);

    expect(screen.getByText('Yeni karyera nəticəsi bildir')).toBeDefined();

    // Fill form
    const jobTitleInput = screen.getByPlaceholderText('məs. Junior Data Analyst');
    const companyInput = screen.getByPlaceholderText('məs. Pasha Bank');
    fireEvent.change(jobTitleInput, { target: { value: 'QA Engineer' } });
    fireEvent.change(companyInput, { target: { value: 'Kapital Bank' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: 'Nəticəni bildir' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/candidate/outcomes',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"shareWithAcademy":false'),
        }),
      );
    });
  });

  it('defaults shareWithAcademy to false (opt-in), and sends true when affirmatively selected', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (url === '/academies/my-enrollments') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'enr_1', status: 'ACTIVE', consentActive: true, academy: { name: 'Holberton Baku' }, cohort: { name: 'Batch 2026' } },
            ]),
            { status: 200 },
          ),
        );
      }
      if (url === '/candidate/outcomes' && opts?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'out_shared', shareWithAcademy: true }), { status: 201 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    render(<CandidateOutcomesManager />);

    const openBtn = await screen.findByRole('button', { name: /Yeni nəticə bildir/i });
    fireEvent.click(openBtn);

    // Verify checkbox is unchecked by default
    const optInCheckbox = screen.getByRole('checkbox');
    expect((optInCheckbox as HTMLInputElement).checked).toBe(false);

    // Candidate affirmatively opts in
    fireEvent.click(optInCheckbox);
    expect((optInCheckbox as HTMLInputElement).checked).toBe(true);

    const submitBtn = screen.getByRole('button', { name: 'Nəticəni bildir' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/candidate/outcomes',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"shareWithAcademy":true'),
        }),
      );
    });
  });

  it('allows candidate to withdraw an outcome', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (url === '/academies/my-enrollments') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes('/withdraw')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockOutcomes), { status: 200 }));
    });

    render(<CandidateOutcomesManager />);

    const withdrawBtns = await screen.findAllByRole('button', { name: /Geri götür/i });
    fireEvent.click(withdrawBtns[0]);

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/candidate/outcomes/out_1/withdraw',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('allows candidate to delete an outcome', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (url === '/academies/my-enrollments') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (opts?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockOutcomes), { status: 200 }));
    });

    render(<CandidateOutcomesManager />);

    const deleteBtns = await screen.findAllByRole('button', { name: /Sil/i });
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/candidate/outcomes/out_1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
