import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), downloadAuthedFile: vi.fn() }));
import AgentHubPage from './page';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
// What the extension's bridge does in a real browser (jsdom's postMessage leaves origin and source empty, so the reply is dispatched as the browser would).
const reply = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window })), 0);
const caps = { enabled: true, pausedByOperator: false, portals: [], entitlement: { included: true, monthlyLimit: 50, usedThisMonth: 0, remainingThisMonth: 50 } };

describe('browser assistant setup', () => {
  let devices: unknown[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    devices = [];
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/agent/capabilities') return json(caps);
      if (path === '/agent/devices') return json(devices);
      if (path === '/agent/pairing') return json({ code: 'ABCD2345', expiresInSeconds: 600 });
      return json([]);
    });
  });
  afterEach(() => { vi.useRealTimers(); apiFetch.mockReset(); });

  it('shows where the candidate is and what to do next', async () => {
    render(<AgentHubPage />);
    const progress = await screen.findByTestId('agent-setup-progress');
    expect(progress).toHaveTextContent('Premium plan');
    expect(progress).toHaveTextContent('Növbəti addım: Genişlənməni kompüterdə quraşdırın və brauzeri qoşun.');
  });

  it('counts the pairing code down and says when it has expired instead of waiting forever', async () => {
    render(<AgentHubPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cütləmə kodu yarat' }));
    expect(await screen.findByText('ABCD2345')).toBeInTheDocument();
    await act(async () => {}); // let the countdown and the faster poll start before time moves
    expect(screen.getByText(/\d:\d\d qalıb/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(601_000); });
    expect(screen.getByText(/Kodun vaxtı bitdi/)).toBeInTheDocument();
    expect(screen.queryByText(/Qoşulma gözlənilir/)).toBeNull();
  });

  it('drops the used code once the browser has paired', async () => {
    render(<AgentHubPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cütləmə kodu yarat' }));
    expect(await screen.findByText('ABCD2345')).toBeInTheDocument();
    await act(async () => {}); // let the countdown and the faster poll start before time moves
    devices = [{ id: 'd1', name: 'Chrome', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }];
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(screen.queryByText('ABCD2345')).toBeNull();
    expect(screen.getByTestId('agent-setup-progress')).toHaveTextContent('Növbəti addım: Hansı portal');
  });

  it('links to the correct application tracker route', async () => {
    render(<AgentHubPage />);
    const link = await screen.findByRole('link', { name: 'Müraciət cədvəli' });
    expect(link).toHaveAttribute('href', '/dashboard/applications/tracker');
  });

  it('does not poll every few seconds when nothing is pending', async () => {
    render(<AgentHubPage />);
    await screen.findByTestId('agent-setup-progress');
    const before = apiFetch.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(apiFetch.mock.calls.length).toBe(before);
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(apiFetch.mock.calls.length).toBeGreaterThan(before);
  });

  it('connects this browser in one click when the extension answers on the page', async () => {
    // A stand-in for the extension's bridge content script: answers the page's ping, then accepts the pairing code it is handed.
    let paired = false; let handed = '';
    const bridge = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.source !== 'aise-web') return;
      if (m.type === 'ping') reply({ source: 'aise-extension', type: 'hello', version: '0.3.3', paired });
      if (m.type === 'pair') { handed = m.code; paired = true; devices = [{ id: 'd1', name: 'Chrome · macOS', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), extensionVersion: '0.3.3', update: null }]; reply({ source: 'aise-extension', type: 'pair-result', nonce: m.nonce, ok: true }); }
    };
    window.addEventListener('message', bridge);
    try {
      render(<AgentHubPage />);
      expect(await screen.findByText(/AISE Agent bu brauzerdə quraşdırılıb \(versiya 0\.3\.3\)/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /AISE Agent faylını yüklə/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Bu brauzeri qoş' }));
      expect(await screen.findByText('Bu brauzer qoşuldu.')).toBeInTheDocument();
      expect(handed).toBe('ABCD2345');
      expect(await screen.findByText(/Versiya 0\.3\.3\./)).toBeInTheDocument();
      expect(screen.queryByText('ABCD2345')).toBeNull();
    } finally { window.removeEventListener('message', bridge); }
  });

  it('keeps the code on screen and says why when the extension refuses the one-click pairing', async () => {
    const bridge = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.source !== 'aise-web') return;
      if (m.type === 'ping') reply({ source: 'aise-extension', type: 'hello', version: '0.3.3', paired: false });
      if (m.type === 'pair') reply({ source: 'aise-extension', type: 'pair-result', nonce: m.nonce, ok: false, error: 'already paired (ALREADY_PAIRED)' });
    };
    window.addEventListener('message', bridge);
    try {
      render(<AgentHubPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Bu brauzeri qoş' }));
      expect(await screen.findByText(/artıq başqa AISE hesabı ilə cütlənib/)).toBeInTheDocument();
      expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    } finally { window.removeEventListener('message', bridge); }
  });

  it('shows the install steps only when no extension answers, and says which browsers need an update', async () => {
    devices = [{ id: 'd1', name: 'Chrome · Windows', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), extensionVersion: null, update: 'required' }];
    render(<AgentHubPage />);
    expect(await screen.findByText('Yeniləmə lazımdır')).toBeInTheDocument();
    expect(screen.getByText(/Versiya 0\.3\.3-dən köhnədir/)).toBeInTheDocument();
    expect(screen.getByTestId('agent-update')).toHaveTextContent('Cütləmə saxlanılır');
    expect(screen.queryByText(/Pack extension/)).toBeNull();
  });
});

describe('browser assistant on devices that cannot run the extension', () => {
  const ua = navigator.userAgent;
  const setUa = (v: string) => Object.defineProperty(window.navigator, 'userAgent', { value: v, configurable: true });
  beforeEach(() => {
    apiFetch.mockImplementation(async (path: string) => (path === '/agent/capabilities' ? json(caps) : json([])));
  });
  afterEach(() => { setUa(ua); apiFetch.mockReset(); });

  it('on a phone: explains what works there and offers no download', async () => {
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    render(<AgentHubPage />);
    expect(await screen.findByTestId('agent-support')).toHaveTextContent('Telefon və planşetdə genişlənmə quraşdırılmır');
    expect(screen.queryByRole('button', { name: /faylını yüklə/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cütləmə kodu yarat' })).toBeNull();
  });

  it('in Firefox on a computer: names the browsers that work', async () => {
    setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0');
    render(<AgentHubPage />);
    expect(await screen.findByTestId('agent-support')).toHaveTextContent('Firefox genişlənməni dəstəkləmir');
    expect(screen.queryByRole('button', { name: /faylını yüklə/ })).toBeNull();
  });
});

