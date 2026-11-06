import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OnboardingWizard from './OnboardingWizard';
import { apiFetch } from '@/lib/api';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('onboarding LinkedIn import', () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(apiFetch).mockReset(); });

  it('passes optional public-reader consent only when selected for the submitted URL', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Controlled failure' }), { status: 400 }));
    render(<OnboardingWizard />);
    fireEvent.change(screen.getByLabelText('LinkedIn profil mətni'), { target: { value: 'linkedin.com/in/ada-synthetic' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Jina AI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keçiddən çıxar' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/resumes/import-text', expect.objectContaining({ body: JSON.stringify({ text: 'linkedin.com/in/ada-synthetic', allowPublicReader: true }) })));
    await screen.findByText('Controlled failure');
    fireEvent.click(screen.getByRole('button', { name: 'Keçiddən çıxar' }));
    await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith('/resumes/import-text', expect.objectContaining({ body: JSON.stringify({ text: 'linkedin.com/in/ada-synthetic', allowPublicReader: false }) })));
  });

  it('is available before uploading a CV and brings a text import into review', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ parsedContent: {
      personalInfo: { name: 'Synthetic Candidate' }, headline: 'Data Analyst', skills: ['SQL'],
      workExperience: [{ title: 'Analyst', company: 'Example', description: 'Created reports.' }], education: [],
      careerSuggestions: [{ kind: 'PROJECT', title: 'Risk dashboard', description: 'Built a dashboard.', precision: 'YEAR' }],
    } }), { status: 200 }));
    render(<OnboardingWizard />);
    expect(screen.getByRole('heading', { name: 'LinkedIn profilindən əlavə edin' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('LinkedIn profil mətni'), { target: { value: 'Experience\nExample\nAnalyst\nJanuary 2024 - Present\nCreated reports.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mətni oxu' }));
    // A preview first: nothing is in the form until the candidate adds it.
    await waitFor(() => expect(screen.getByTestId('import-preview')).toBeDefined());
    expect(screen.queryByDisplayValue('Analyst')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profilə əlavə et' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' })).toBeDefined());
    expect(screen.getByDisplayValue('Synthetic Candidate')).toBeDefined();
    expect(screen.getByDisplayValue('Analyst')).toBeDefined();
    expect(screen.getByDisplayValue('Risk dashboard')).toBeDefined();
    expect(screen.getByText('Təsdiq gözləyir')).toBeDefined();
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/resumes/import-text', expect.objectContaining({ method: 'POST' }));
  });

  it('reads a LinkedIn PDF for review without replacing the stored CV, and shows what was unclear', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ parsedContent: {
      personalInfo: { name: 'Synthetic Candidate' }, headline: 'Analyst', skills: [],
      workExperience: [{ title: 'Freelancer', company: 'Self-employed', startDate: '2019-01-01T00:00:00.000Z', endDate: '2020-01-01T00:00:00.000Z', startPrecision: 'YEAR', endPrecision: 'YEAR', description: '' }],
      education: [{ institution: 'Coursera', degree: '', fieldOfStudy: 'Data Science', startDate: null, endDate: null, uncertain: ['startDate'], source: 'Coursera\nData Science' }],
      careerSuggestions: [],
    } }), { status: 200 }));
    render(<OnboardingWizard />);
    const input = screen.getAllByLabelText('LinkedIn PDF-i yüklə')[0];
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'Profile.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByTestId('import-preview')).toBeDefined());
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/resumes/import-file', expect.objectContaining({ method: 'POST' }));
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalledWith('/resumes', expect.anything());
    expect(screen.getByText('2019 – 2020 · yeni')).toBeDefined();
    expect(screen.getByText(/Yoxlayın: başlama tarixi/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Profilə əlavə et' }));
    await waitFor(() => expect(screen.getByDisplayValue('Coursera')).toBeDefined());
    // The year-only dates stay years in the form.
    expect(screen.getByDisplayValue('2019')).toBeDefined();
  });
});
