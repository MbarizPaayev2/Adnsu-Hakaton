import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from './page';

const { apiFetch, redirect } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Leyla Əliyeva' } }, status: 'authenticated' }),
}));

vi.mock('@/lib/api', () => ({ apiFetch }));

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

describe('Dashboard truthfulness and recommendations', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('excludes closed, non-actionable, and expired jobs from recommendations', async () => {
    const pastDate = new Date(Date.now() - 1000 * 3600 * 24).toISOString();
    const futureDate = new Date(Date.now() + 1000 * 3600 * 48).toISOString();

    const summaryData = {
      user: { name: 'Leyla Əliyeva', email: 'leyla@example.az' },
      plan: 'FREE',
      stats: { totalMatches: 3, newMatches: 1, totalResumes: 1 },
      recentMatches: [
        {
          id: 'match-closed',
          score: 0.95,
          status: 'NEW',
          actionable: false, // Non-actionable!
          createdAt: '2026-10-01T00:00:00Z',
          job: { id: 'j-1', title: 'Closed Job Title', company: 'Closed Corp', location: 'Bakı', status: 'CLOSED' },
        },
        {
          id: 'match-expired',
          score: 0.92,
          status: 'NEW',
          actionable: true,
          createdAt: '2026-10-01T00:00:00Z',
          job: { id: 'j-2', title: 'Expired Job Title', company: 'Expired Corp', location: 'Bakı', deadline: pastDate },
        },
        {
          id: 'match-actionable',
          score: 0.88,
          status: 'NEW',
          actionable: true,
          createdAt: '2026-10-01T00:00:00Z',
          job: { id: 'j-3', title: 'Active Lead Engineer', company: 'Real Innovation MMC', location: 'Bakı', deadline: futureDate },
        },
      ],
    };

    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/dashboard/summary') return jsonResponse(summaryData);
      if (path === '/applications/timeline') return jsonResponse([]);
      return jsonResponse({});
    });

    const jsx = await DashboardPage();
    render(jsx);

    // The review recommendation must pick the ACTIVE job and exclude closed/expired ones
    expect(screen.getAllByText('Active Lead Engineer').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Closed Job Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired Job Title')).not.toBeInTheDocument();
  });

  const summary = (recentMatches: unknown[] = []) => ({
    user: { name: 'Leyla Əliyeva', email: 'leyla@example.az' },
    plan: 'FREE',
    stats: { totalMatches: recentMatches.length, newMatches: 0, totalResumes: 1 },
    recentMatches,
  });
  const serve = (timeline: () => Response | Promise<Response>, extra: Record<string, unknown> = {}) =>
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/dashboard/summary') return jsonResponse(summary());
      if (path === '/applications/timeline') return timeline();
      return jsonResponse(extra[path] ?? {});
    });

  it('counts applications from the authoritative timeline, not from recent matches, and ignores dry runs', async () => {
    serve(() => jsonResponse([
      { id: 'email:1', channel: 'email', dryRun: false, stages: [{ key: 'DELIVERED', evidence: 'PROVIDER' }], problem: null },
      { id: 'native:2', channel: 'native', dryRun: false, stages: [{ key: 'DELIVERED', evidence: 'SYSTEM' }], problem: null },
      { id: 'external:3', channel: 'external', dryRun: true, stages: [], problem: null },
    ]));
    render(await DashboardPage());
    expect(screen.getByText('2 müraciət cədvəlində')).toBeInTheDocument();
    expect(screen.getByText('Təsdiqlənmiş cavab yoxdur')).toBeInTheDocument();
  });

  it('shows reply evidence by source and never turns unread notifications into employer replies', async () => {
    serve(() => jsonResponse([
      { id: 'native:1', channel: 'native', dryRun: false, stages: [{ key: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED' }], problem: null },
      { id: 'email:2', channel: 'email', dryRun: false, stages: [{ key: 'INTERVIEW', evidence: 'CANDIDATE_REPORTED' }], problem: null },
      { id: 'email:3', channel: 'email', dryRun: false, stages: [{ key: 'REPLY_RECEIVED', evidence: 'SYSTEM' }], problem: null },
    ]), { '/notifications': [{ id: 'n-1', message: 'x', read: false }, { id: 'n-2', message: 'y', read: false }] });
    render(await DashboardPage());
    expect(screen.getByText(/işəgötürən AISE-də status dəyişib \(işəgötürən təsdiqi\)/)).toBeInTheDocument();
    expect(screen.getByText(/sizin qeyd etdiyiniz cavab və ya nəticə/)).toBeInTheDocument();
    expect(screen.getByText(/cavab ünvanına məktub daxil olub/)).toBeInTheDocument();
    expect(screen.queryByText(/yeni bildiriş/)).not.toBeInTheDocument();
  });

  it('flags applications that need attention', async () => {
    serve(() => jsonResponse([{ id: 'email:1', channel: 'email', dryRun: false, stages: [], problem: { key: 'BOUNCED' } }]));
    render(await DashboardPage());
    expect(screen.getByText(/1 müraciət diqqət tələb edir/)).toBeInTheDocument();
  });

  it('a failed timeline request is unavailable, never zero applications or zero replies', async () => {
    serve(() => new Response('Unavailable', { status: 503 }));
    render(await DashboardPage());
    expect(screen.getAllByText('Məlumat əlçatan deyil').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Hələ müraciətiniz yoxdur')).not.toBeInTheDocument();
    expect(screen.queryByText('Təsdiqlənmiş cavab yoxdur')).not.toBeInTheDocument();
  });

  it('a thrown timeline request is also unavailable', async () => {
    serve(() => Promise.reject(new Error('offline')));
    render(await DashboardPage());
    expect(screen.getAllByText('Məlumat əlçatan deyil').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a Premium plan label', async () => {
    apiFetch.mockImplementation(async (path: string) => (path === '/dashboard/summary' ? jsonResponse({ ...summary(), plan: 'PREMIUM' }) : jsonResponse([])));
    render(await DashboardPage());
    expect(screen.getByText('Premium')).toBeInTheDocument();
  });
});
