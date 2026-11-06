import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailApplyCta } from './email-apply-cta';

const { apiFetch, push, useSession, capture } = vi.hoisted(() => ({ apiFetch: vi.fn(), push: vi.fn(), useSession: vi.fn(), capture: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({ useSession }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('./posthog-provider', () => ({ captureFunnelEvent: capture }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function respond(eligibility: unknown, enabled = true) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/email-applications/capabilities') return json({ enabled });
    if (path.startsWith('/email-applications/eligibility/')) return json(eligibility);
    throw new Error(`unexpected ${path}`);
  });
}

describe('e-mail application call to action', () => {
  beforeEach(() => { apiFetch.mockReset(); push.mockReset(); capture.mockReset(); useSession.mockReturnValue({ status: 'authenticated' }); });

  it('asks a visitor to sign in, returning to the vacancy, and calls the API for nothing', async () => {
    useSession.mockReturnValue({ status: 'unauthenticated' });
    render(<EmailApplyCta jobId="j1" loginHref="/login?next=%2Fjobs%2Fimported%2Fj1" />);
    expect(screen.getByRole('link', { name: 'Daxil olun' })).toHaveAttribute('href', '/login?next=%2Fjobs%2Fimported%2Fj1');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('prepares a review (sending nothing) and goes to the review page', async () => {
    respond({ eligible: true });
    apiFetch.mockImplementationOnce(async () => json({ enabled: true })).mockImplementationOnce(async () => json({ eligible: true }));
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/email-applications/prepare') { expect(JSON.parse(String(init?.body))).toEqual({ jobId: 'j1' }); return json({ id: 'ea-9' }); }
      throw new Error(`unexpected ${path}`);
    });
    await act(async () => { render(<EmailApplyCta jobId="j1" loginHref="/login" />); });
    const button = await screen.findByRole('button', { name: 'Müraciəti hazırla və yoxla' });
    expect(screen.getByText(/siz təsdiq etməyincə heç nə göndərilmir/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/email-applications/ea-9'));
    expect(capture).toHaveBeenCalledWith('email_apply_prepared', { jobId: 'j1', source: 'job_detail' });
  });

  it('points to the existing application instead of preparing another', async () => {
    respond({ eligible: true, existing: { id: 'ea-3', deliveryState: 'PROVIDER_ACCEPTED' } });
    await act(async () => { render(<EmailApplyCta jobId="j1" loginHref="/login" />); });
    expect(await screen.findByRole('link', { name: 'Müraciətə bax' })).toHaveAttribute('href', '/dashboard/email-applications/ea-3');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a suppressed recipient and offers nothing when the feature is off', async () => {
    respond({ eligible: false, reason: 'RECIPIENT_SUPPRESSED' });
    const { unmount } = render(<EmailApplyCta jobId="j1" loginHref="/login" />);
    expect(await screen.findByText(/göndərmək mümkün deyil/)).toBeInTheDocument();
    unmount();
    respond({ eligible: true }, false);
    const { container } = render(<EmailApplyCta jobId="j1" loginHref="/login" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('records the funnel "viewed" event with no personal data', async () => {
    respond({ eligible: true });
    await act(async () => { render(<EmailApplyCta jobId="j1" loginHref="/login" />); });
    expect(capture).toHaveBeenCalledWith('email_apply_job_viewed', { jobId: 'j1', source: 'job_detail' });
  });
});
