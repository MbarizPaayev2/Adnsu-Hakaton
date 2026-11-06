import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CheckoutReturn } from './checkout-return';
import PricingPage from '@/app/pricing/page';
import SettingsPage from '@/app/dashboard/settings/page';

const { apiFetch, params, push } = vi.hoisted(() => ({ apiFetch: vi.fn(), params: { current: new URLSearchParams() }, push: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.current, useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: {} }, status: 'authenticated' }), signOut: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));
vi.mock('@/lib/retention/api', () => ({
  loadRetentionApi: () => Promise.resolve({ getCatalogue: () => Promise.reject(new Error('unavailable in tests')) }),
  resetRetentionApiForTests: () => {},
  isUnavailable: () => false,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const view = (patch: Record<string, unknown> = {}) => ({
  plan: 'FREE', subscriptionPlan: 'FREE', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false,
  matchesUsedThisPeriod: 0, providerManaged: false, override: null, ...patch,
});

describe('checkout return', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('announces the plan only after the API confirms it', async () => {
    params.current = new URLSearchParams('checkout=success');
    apiFetch
      .mockResolvedValueOnce(json(view()))
      .mockResolvedValueOnce(json(view({ plan: 'STANDARD', subscriptionPlan: 'STANDARD', providerManaged: true })));
    render(<CheckoutReturn />);
    expect(screen.getByRole('status')).toHaveTextContent('Ödənişiniz yoxlanılır');
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ödəniş təsdiqləndi — STANDARD planı aktivdir.'));
    expect(apiFetch).toHaveBeenCalledWith('/billing/subscription');
  });

  it('says honestly when the payment is not confirmed yet, instead of claiming success', async () => {
    params.current = new URLSearchParams('checkout=success');
    apiFetch.mockImplementation(async () => json(view()));
    render(<CheckoutReturn />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ödəniş hələ təsdiqlənməyib'));
    expect(screen.getByRole('status')).toHaveTextContent('ikinci dəfə ödəməyin');
  });

  it('marks a local mock checkout as a test that changed nothing, without polling', () => {
    params.current = new URLSearchParams('checkout=success&mock=1');
    render(<CheckoutReturn />);
    expect(screen.getByRole('status')).toHaveTextContent('Test rejimi');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders nothing on a normal dashboard visit', () => {
    params.current = new URLSearchParams();
    const { container } = render(<CheckoutReturn />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('payment availability', () => {
  beforeEach(() => apiFetch.mockReset());

  it('disables paid plans on the pricing page when the server says payments are off', async () => {
    apiFetch.mockImplementation(async () => json({ paymentsEnabled: false, mode: 'mock' }));
    render(<PricingPage />);
    expect(await screen.findByText(/Ödənişli planlar hələ aktiv deyil/)).toBeInTheDocument();
    const soon = screen.getAllByRole('button', { name: 'Hazırda əlçatan deyil' });
    expect(soon.length).toBeGreaterThanOrEqual(1);
    soon.forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Başla' })).toBeEnabled();
  });

  it('disables paid plans on the pricing page when payment status fails or errors', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Network failure')).mockRejectedValueOnce(new Error('Network failure')); // payment status, then public feature status
    render(<PricingPage />);
    expect(await screen.findByText(/Ödənişli planlar hələ aktiv deyil/)).toBeInTheDocument();
    const soon = screen.getAllByRole('button', { name: 'Hazırda əlçatan deyil' });
    expect(soon.length).toBeGreaterThanOrEqual(1);
    soon.forEach((button) => expect(button).toBeDisabled());
  });

  it('shows no employer price or purchase button the server did not state, and never an invented figure', async () => {
    apiFetch.mockImplementation(async () => json({ paymentsEnabled: false, mode: 'mock' }));
    render(<PricingPage />);
    const employerTab = await screen.findByRole('tab', { name: /İşəgötürənlər üçün/i });
    act(() => {
      employerTab.click();
    });
    // Verify no invented prices (such as 30₼ or 99₼/ay) are rendered
    expect(screen.queryByText('30₼')).not.toBeInTheDocument();
    expect(screen.queryByText('99₼/ay')).not.toBeInTheDocument();
    // The catalogue could not be read here, so no employer price is stated and nothing can be bought.
    expect(screen.queryByText(/\d+ AZN/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kabinetdə seçin' })).not.toBeInTheDocument();
    expect((await screen.findAllByText('Hazırda satışda deyil')).length).toBeGreaterThan(0);
    // The free first vacancy is 14 days (not 7), and every plan lists logo, inbox and stage management.
    expect(screen.getByText(/İlk vakansiyanız üçün 14 gün/)).toBeInTheDocument();
    expect(screen.queryByText(/İlk vakansiyanız üçün 7 gün/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi/i).length).toBeGreaterThanOrEqual(3);
  });

  it('shows the provider status plainly and that a lapsed subscription falls back to free limits', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/billing/status') return json({ paymentsEnabled: true, mode: 'test' });
      return json(view({ plan: 'FREE', subscriptionPlan: 'BASIC', status: 'on_hold', providerManaged: true, currentPeriodEnd: '2026-11-01T00:00:00Z' }));
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Ödəniş alınmadı — dayandırılıb')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ödənişsiz planın limitləri tətbiq olunur');
    expect(screen.getByRole('button', { name: 'Abunəliyi idarə et (Dodo Payments)' })).toBeInTheDocument();
  });

  it('says when a cancelled subscription ends', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/billing/status') return json({ paymentsEnabled: true, mode: 'test' });
      return json(view({ plan: 'BASIC', subscriptionPlan: 'BASIC', status: 'active', providerManaged: true, cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-01T00:00:00Z' }));
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Abunəlik bitir')).toBeInTheDocument();
  });

  it('explains the academy sponsor, expiry and non-stacked daily allowance', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/billing/status') return json({ paymentsEnabled: true, mode: 'test' });
      return json(view({
        plan: 'PREMIUM',
        sponsoredAccess: { academyName: 'Holberton Baku', plan: 'PLUS', expiresAt: '2026-11-30T00:00:00Z', matchesPerDay: 5, matchesRemainingToday: 3 },
      }));
    });
    render(<SettingsPage />);
    expect(await screen.findByText(/Holberton Baku/)).toBeInTheDocument();
    expect(screen.getByText(/30\.11\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/limitləri toplanmır/)).toBeInTheDocument();
  });
});
