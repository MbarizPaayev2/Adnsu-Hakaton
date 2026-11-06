import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProfilePage from './page';

const { mockApiFetch, mockSearchParams } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, update: vi.fn() }),
}));

describe('ProfilePage Return & Section Anchors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.delete('returnTo');
    mockSearchParams.delete('onboarding');
    mockSearchParams.delete('from');

    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === '/profile') {
        return {
          ok: true,
          json: async () => ({
            name: 'Aygün Məmmədova',
            headline: 'Data Analitik',
            location: 'Bakı',
            skills: ['SQL', 'Python'],
            roles: [],
            prefLocations: [],
            prefTypes: [],
            salaryMin: null,
            salaryMax: null,
            experiences: [],
            education: [],
            careerEntries: [],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
  });

  it('renders sticky return banner when returnTo is a safe relative /dashboard/ path', async () => {
    mockSearchParams.set(
      'returnTo',
      '/dashboard/resumes?matchId=m-123&kind=RESUME&lang=az'
    );

    const { container } = render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('Sənəd hazırlığına qayıt')).toBeInTheDocument();
    });

    const returnLink = screen.getByText('Sənəd hazırlığına qayıt').closest('a');
    expect(returnLink).toHaveAttribute(
      'href',
      '/dashboard/resumes?matchId=m-123&kind=RESUME&lang=az'
    );

    // Verify real section anchors exist in the DOM
    expect(container.querySelector('#skills')).toBeInTheDocument();
    expect(container.querySelector('#experience')).toBeInTheDocument();
    expect(container.querySelector('#education')).toBeInTheDocument();
    expect(container.querySelector('#projects')).toBeInTheDocument();
  });

  it('rejects external or malicious returnTo URLs and does NOT render return banner', async () => {
    mockSearchParams.set('returnTo', 'https://attacker.com/steal');
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Aygün Məmmədova')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sənəd hazırlığına qayıt')).not.toBeInTheDocument();
  });

  it('rejects protocol-relative // URLs and does NOT render return banner', async () => {
    mockSearchParams.set('returnTo', '//attacker.com/steal');
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Aygün Məmmədova')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sənəd hazırlığına qayıt')).not.toBeInTheDocument();
  });

  it('rejects non-dashboard paths and does NOT render return banner', async () => {
    mockSearchParams.set('returnTo', '/api/internal');
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Aygün Məmmədova')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sənəd hazırlığına qayıt')).not.toBeInTheDocument();
  });
});
