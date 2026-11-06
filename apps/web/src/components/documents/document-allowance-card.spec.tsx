import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentAllowanceCard } from './document-allowance-card';

vi.mock('@/lib/api', () => ({ apiFetch: (path: string) => fetch(path) }));

const view = (over: object = {}) => ({ plan: 'FREE', limit: 5, used: 0, reserved: 0, remaining: 5, period: '2026-10', resetsAt: '2026-10-31T20:00:00.000Z', protections: null, costs: { perDocument: 1, cvAndLetter: 2 }, generationAvailable: true, ...over });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

describe('document allowance card', () => {
  it('says plainly that generation is unavailable while the deployment has it switched off', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view({ generationAvailable: false })), { status: 200 }));
    render(<DocumentAllowanceCard />);
    expect(await screen.findByTestId('generation-unavailable')).toHaveTextContent(/hazırda əlçatan deyil/);
  });

  it('shows no such notice when generation is available', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }));
    render(<DocumentAllowanceCard />);
    await waitFor(() => expect(screen.getByTestId('document-allowance-card')).toBeInTheDocument());
    expect(screen.queryByTestId('generation-unavailable')).toBeNull();
  });
});
