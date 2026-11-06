import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Cfg = { mode: string; displayType: string; onEvent: (e: { event_type: string; data?: unknown }) => void };
let cfg: Cfg | null = null;
const open = vi.fn();
const close = vi.fn();
const init = vi.fn((c: Cfg) => { cfg = c; });
const sdk = {
  DodoPayments: { Initialize: (c: Cfg) => init(c), Checkout: { open: (o: unknown) => open(o), close: () => close(), isOpen: () => true } },
} as never;
const loadSdk = () => Promise.resolve(sdk);

const URL_OK = 'https://test.checkout.dodopayments.com/session/cks_test';

async function mount(createSession: () => Promise<{ url: string | null; message?: string }>, extra: { onPaid?: () => void; onCancel?: () => void; strict?: boolean } = {}) {
  vi.resetModules();
  const { EmbeddedCheckout } = await import('./embedded-checkout');
  const onPaid = extra.onPaid ?? vi.fn();
  const onCancel = extra.onCancel ?? vi.fn();
  const ui = <EmbeddedCheckout createSession={createSession} onPaid={onPaid} onCancel={onCancel} loadSdk={loadSdk} />;
  const rendered = render(extra.strict ? <StrictMode>{ui}</StrictMode> : ui);
  return { onPaid, onCancel, unmount: rendered.unmount };
}
const emit = (event_type: string, data?: unknown) => act(async () => { cfg!.onEvent({ event_type, data }); });

beforeEach(() => {
  cfg = null;
  open.mockClear(); close.mockClear(); init.mockClear();
});

describe('EmbeddedCheckout', () => {
  it('asks the server for one session and opens the provider frame inline for it, with manual redirect', async () => {
    const createSession = vi.fn().mockResolvedValue({ url: URL_OK });
    await mount(createSession);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ mode: 'test', displayType: 'inline' }));
    expect(open.mock.calls[0][0]).toMatchObject({ checkoutUrl: URL_OK, options: { manualRedirect: true } });
  });

  it('does not open a second session when the component is mounted twice by StrictMode', async () => {
    const createSession = vi.fn().mockResolvedValue({ url: URL_OK });
    await mount(createSession, { strict: true });
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(createSession.mock.calls.length).toBeLessThanOrEqual(2);
    // Whatever the double mount did, only one frame stays open: every unmount closes the previous one.
    expect(open.mock.calls.length - close.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('refuses a session address that is not the provider and says nothing was charged', async () => {
    await mount(vi.fn().mockResolvedValue({ url: 'https://evil.example/session/x' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Heç bir ödəniş tutulmayıb/);
    expect(open).not.toHaveBeenCalled();
  });

  it('shows the server message when the session cannot be created and offers a retry that asks again', async () => {
    const createSession = vi.fn().mockResolvedValueOnce({ url: null, message: 'Ödənişlər hazırda aktiv deyil' }).mockResolvedValueOnce({ url: URL_OK });
    await mount(createSession);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ödənişlər hazırda aktiv deyil');
    fireEvent.click(screen.getByRole('button', { name: /Yenidən cəhd et/ }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it('moves on only when the provider reports a finished payment, and only once', async () => {
    const { onPaid } = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    await waitFor(() => expect(cfg).not.toBeNull());
    await emit('checkout.form_ready');
    await emit('checkout.pay_button_clicked');
    expect(onPaid).not.toHaveBeenCalled();
    await emit('checkout.status', { message: { status: 'succeeded' } });
    await emit('checkout.status', { message: { status: 'succeeded' } });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/yoxlanılır/);
  });

  it('shows a failure with a retry for a declined payment and never calls onPaid', async () => {
    const { onPaid } = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    await waitFor(() => expect(cfg).not.toBeNull());
    await emit('checkout.status', { message: { status: 'failed' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/kartınızdan vəsait tutulmadı/);
    expect(screen.getByRole('button', { name: /Yenidən cəhd et/ })).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('reports an expired session and starts a fresh one on request', async () => {
    const createSession = vi.fn().mockResolvedValue({ url: URL_OK });
    await mount(createSession);
    await waitFor(() => expect(cfg).not.toBeNull());
    await emit('checkout.link_expired');
    expect(await screen.findByRole('alert')).toHaveTextContent(/vaxtı bitdi/);
    fireEvent.click(screen.getByRole('button', { name: /Yenidən cəhd et/ }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
  });

  it('keeps the hosted page as an explicit, separate choice and lets the customer leave', async () => {
    const { onCancel } = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    const link = await screen.findByRole('link', { name: /öz səhifəsində/ });
    expect(link).toHaveAttribute('href', URL_OK);
    fireEvent.click(screen.getByRole('button', { name: /Ləğv et/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('routes singleton events to the current mounted checkout after navigation', async () => {
    const first = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => {});
    const { EmbeddedCheckout } = await import('./embedded-checkout');
    const secondPaid = vi.fn();
    render(<EmbeddedCheckout createSession={async () => ({ url: URL_OK })} onPaid={secondPaid} onCancel={vi.fn()} loadSdk={loadSdk} />);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    await emit('checkout.status', { message: { status: 'succeeded' } });
    expect(secondPaid).toHaveBeenCalledTimes(1);
    expect(first.onPaid).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('keeps a rendered card form usable after a wallet initialization error', async () => {
    const { onPaid } = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    await emit('checkout.payment_page_opened');
    await emit('checkout.error', { message: 'Wallet initialization failed' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById('aise-embedded-checkout')).not.toHaveClass('hidden');
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('shows an active subscription without retrying or opening a second purchase', async () => {
    await mount(vi.fn().mockResolvedValue({ url: null, alreadyActive: true }));
    expect(await screen.findByRole('link', { name: 'Abunəliyi idarə et' })).toHaveAttribute('href', '/dashboard/settings');
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Yenidən cəhd et/ })).toBeNull();
  });

  it('returns to backend verification after a same-origin provider redirect, once', async () => {
    const { onPaid } = await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    const data = { message: { redirect_to: new URL('/dashboard?checkout=success', window.location.origin).href } };
    await emit('checkout.redirect', data);
    await emit('checkout.redirect', data);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });


  it('recovers from a wallet error before the card form is ready without requiring a page refresh', async () => {
    vi.useFakeTimers();
    try {
      await mount(vi.fn().mockResolvedValue({ url: URL_OK }));
      await act(async () => {});
      await emit('checkout.opened');
      await emit('checkout.error', { message: 'Wallet initialization failed' });
      await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
      expect(screen.getByRole('alert')).toHaveTextContent('Səhifəni yeniləmədən');
      expect(screen.getByRole('button', { name: /Yenidən cəhd et/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Dodo Payments/ })).toHaveAttribute('href', URL_OK);
      expect(screen.queryByText('Təhlükəsiz ödəniş forması yüklənir...')).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('bounds a session request that never completes and ignores a late answer', async () => {
    vi.useFakeTimers();
    try {
      let resolve: (value: { url: string }) => void = () => {};
      await mount(() => new Promise((done) => { resolve = done; }));
      await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
      expect(screen.getByRole('button', { name: /Yenidən cəhd et/ })).toBeInTheDocument();
      await act(async () => { resolve({ url: URL_OK }); });
      expect(open).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

});
