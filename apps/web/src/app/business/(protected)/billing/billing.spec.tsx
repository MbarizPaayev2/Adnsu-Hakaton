import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BusinessBillingPage from './page';

const { params } = vi.hoisted(() => ({ params: { current: new URLSearchParams() } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.current }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: any }) => <a href={href} {...rest}>{children}</a>,
}));

const overview = (patch: Record<string, unknown> = {}) => ({
  gated: true,
  checkoutAvailable: true,
  prices: { singleAzn: 20, singleDays: 30, businessAznPerMonth: 100, trialDays: 14 },
  trial: { available: true, used: false, startedAt: null, endsAt: null },
  credits: { available: 0 },
  business: { active: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  nextPublication: 'TRIAL',
  ...patch,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const sdk = vi.hoisted(() => ({ open: vi.fn(), initialize: vi.fn() }));
vi.mock('dodopayments-checkout', () => ({
  DodoPayments: { Initialize: sdk.initialize, Checkout: { open: sdk.open, close: vi.fn(), isOpen: () => false } },
}));

describe('business billing page', () => {
  const fetchMock = vi.fn();
  const assign = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    params.current = new URLSearchParams();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('states the three plans with the server prices, durations and the data promise', async () => {
    fetchMock.mockResolvedValue(json(overview()));
    await act(async () => { render(<BusinessBillingPage />); });
    expect(await screen.findByRole('heading', { name: 'Sınaq' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tək vakansiya' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Biznes' })).toBeInTheDocument();
    expect(screen.getAllByText(/20 AZN/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100 AZN/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Avtomatik yenilənmir və abunəlik yaratmır/)).toBeInTheDocument();
    expect(screen.getByText(/müraciətlər və məlumatlar saxlanılır/)).toBeInTheDocument();
    expect(screen.getByTestId('trial-state')).toHaveTextContent('Hələ istifadə olunmayıb');
  });

  it('keeps purchase buttons disabled, with the reason, when checkout is not available', async () => {
    fetchMock.mockResolvedValue(json(overview({ checkoutAvailable: false })));
    await act(async () => { render(<BusinessBillingPage />); });
    const single = await screen.findByRole('button', { name: /20 AZN ödə/ });
    expect(single).toBeDisabled();
    expect(screen.getByRole('button', { name: /Biznes planına keç/ })).toBeDisabled();
    expect(screen.getAllByText(/Ödəniş hazırda aktiv deyil/).length).toBe(2);
  });

  beforeEach(() => {
    sdk.open.mockClear();
    sdk.initialize.mockClear();
  });

  it('opens the payment form inside the page with one idempotency key and never redirects or charges from the page', async () => {
    const session = 'https://test.checkout.dodopayments.com/session/cks_0123456789012345678901';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/business/plans') return json(overview());
      if (url === '/api/business/plans/checkout/single') return json({ purchaseId: 'p1', url: session });
      throw new Error(url);
    });
    await act(async () => { render(<BusinessBillingPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /20 AZN ödə/ })); });
    const calls = fetchMock.mock.calls.filter(([u]) => u === '/api/business/plans/checkout/single');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body as string).idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    await waitFor(() => expect(sdk.open).toHaveBeenCalledWith(expect.objectContaining({ checkoutUrl: session, options: expect.objectContaining({ manualRedirect: true }) })));
    expect(sdk.initialize).toHaveBeenCalledWith(expect.objectContaining({ displayType: 'inline', mode: 'test' }));
    expect(assign).not.toHaveBeenCalled();
    // The offer is stated next to the form; a second click while it is open starts nothing.
    expect(screen.getByRole('heading', { name: /Tək vakansiya — 20 AZN, bir dəfəlik/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /20 AZN ödə/ })).toBeDisabled();
  });

  it('shows the server refusal inside the payment panel instead of pretending a form opened', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return json(overview());
      return json({ message: 'Şirkət təsdiqlənməyib və ya dayandırılıb' }, 403);
    });
    await act(async () => { render(<BusinessBillingPage />); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Biznes planına keç/ })); });
    expect(await screen.findByText(/Şirkət təsdiqlənməyib/)).toBeInTheDocument();
    expect(sdk.open).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows an active, cancelled-at-period-end subscription with its end date and a manage action', async () => {
    fetchMock.mockResolvedValue(json(overview({ business: { active: true, status: 'active', currentPeriodEnd: '2026-11-20T00:00:00.000Z', cancelAtPeriodEnd: true }, nextPublication: 'BUSINESS' })));
    await act(async () => { render(<BusinessBillingPage />); });
    expect(await screen.findByTestId('business-state')).toHaveTextContent(/Ləğv edilib.*tarixinədək aktivdir/);
    expect(screen.getByRole('button', { name: /Abunəliyi idarə et/ })).toBeInTheDocument();
  });

  it('says plainly that plans are off and charges nothing when they are not enabled', async () => {
    fetchMock.mockResolvedValue(json(overview({ gated: false, checkoutAvailable: false })));
    await act(async () => { render(<BusinessBillingPage />); });
    expect(await screen.findByText(/Vakansiya planları bu mühitdə hələ aktiv deyil/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AZN/ })).toBeNull();
  });

  it('does not claim success on the checkout return until the server shows the grant', async () => {
    params.current = new URLSearchParams('checkout=return');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json(overview()))
      .mockResolvedValueOnce(json(overview()))
      .mockResolvedValue(json(overview({ credits: { available: 1 }, nextPublication: 'CREDIT' })));
    await act(async () => { render(<BusinessBillingPage />); });
    expect(await screen.findByText(/Təsdiq ödəniş provayderindən gəlir/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(await screen.findByText(/Kredit hesabınıza əlavə olundu/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
