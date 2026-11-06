import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JobSkillGuidance } from './job-skill-guidance';

const { apiFetch, useSession } = vi.hoisted(() => ({ apiFetch: vi.fn(), useSession: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));
vi.mock('next-auth/react', () => ({ useSession }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const guidance = {
  hasProfile: true,
  evidenced: [{ skill: 'SQL', level: 'required', requirement: 'Strong SQL', via: 'experience', where: 'Analyst, Acme' }],
  missingRequired: [{ skill: 'Tableau', level: 'required', requirement: 'Experience with Tableau dashboards' }],
  missingPreferred: [{ skill: 'Azure', level: 'preferred', requirement: 'Azure is a plus' }],
  other: [{ kind: 'degree', text: "Bachelor's degree in Economics", level: 'required' }, { kind: 'experience', text: '2+ years of experience', level: 'required' }],
};

describe('job skill guidance', () => {
  beforeEach(() => { apiFetch.mockReset(); useSession.mockReturnValue({ status: 'authenticated' }); });

  it('asks a visitor to sign in and calls nothing', () => {
    useSession.mockReturnValue({ status: 'unauthenticated' });
    render(<JobSkillGuidance kind="imported" id="j1" loginHref="/login?next=x" />);
    expect(screen.getByRole('link', { name: 'daxil olun' })).toHaveAttribute('href', '/login?next=x');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('separates evidenced, required and preferred, quotes the posting and keeps degree and years apart', async () => {
    apiFetch.mockResolvedValue(json(guidance));
    await act(async () => { render(<JobSkillGuidance kind="imported" id="j1" loginHref="/login" />); });
    expect(await screen.findByText('Profilinizdə artıq göstərilənlər')).toBeInTheDocument();
    expect(screen.getByText(/təcrübənizdə \(Analyst, Acme\)/)).toBeInTheDocument();
    expect(screen.getByText('Tələb olunur və profilinizdə göstərilməyib')).toBeInTheDocument();
    expect(screen.getByText(/Elanda: “Experience with Tableau dashboards”/)).toBeInTheDocument();
    expect(screen.getByText('Üstünlük sayılır və profilinizdə göstərilməyib')).toBeInTheDocument();
    expect(screen.getAllByText('Profilinizdə göstərilməyib')).toHaveLength(2);
    expect(screen.getByText(/Bachelor's degree in Economics/)).toBeInTheDocument();
    // never phrased as "you lack"
    expect(document.body.textContent).not.toMatch(/bacarığınız yoxdur|çatışmır|çatışmazlıq/i);
  });

  it('adds a skill only after the explicit confirmation, once, then reloads', async () => {
    let posts = 0;
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/profile/skills') { posts++; expect(JSON.parse(String(init?.body))).toEqual({ skill: 'Tableau', confirmed: true }); return json({ added: true }); }
      return json(posts ? { ...guidance, missingRequired: [], evidenced: [...guidance.evidenced, { skill: 'Tableau', level: 'required', requirement: 'x', via: 'skills' }] } : guidance);
    });
    await act(async () => { render(<JobSkillGuidance kind="imported" id="j1" loginHref="/login" />); });
    const [first] = await screen.findAllByRole('button', { name: 'Bu bacarığım var — profilə əlavə et' });
    await act(async () => { fireEvent.click(first); });
    expect(posts).toBe(0); // the button only opens the confirmation
    const confirm = screen.getByRole('button', { name: 'Təsdiqləyirəm, əlavə et' });
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(posts).toBe(1));
    expect(await screen.findByText(/“Tableau” profilinizə əlavə olundu/)).toBeInTheDocument();
  });

  it('says plainly when the posting names no skills', async () => {
    apiFetch.mockResolvedValue(json({ hasProfile: true, evidenced: [], missingRequired: [], missingPreferred: [], other: [] }));
    await act(async () => { render(<JobSkillGuidance kind="imported" id="j1" loginHref="/login" />); });
    expect(await screen.findByText(/Bu elan konkret bacarıq adları göstərmir/)).toBeInTheDocument();
  });
});
