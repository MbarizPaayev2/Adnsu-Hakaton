import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PricingPage from './page';
import { loadRetentionApi } from '@/lib/retention/api';

let mockSession: { user: { id: string } } | null = null;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let mockFeatures: { documents: boolean | null; emailApplications: boolean | null; emailAutomation: boolean | null } = { documents: true, emailApplications: true, emailAutomation: false };
let mockPayments: boolean | null = false;
beforeEach(() => { mockPayments = false; mockSession = null; });
vi.mock('@/lib/billing', () => ({
  usePaymentsEnabled: () => mockPayments,
  usePublicFeatures: () => mockFeatures,
}));

vi.mock('@/lib/retention/api', () => ({
  loadRetentionApi: vi.fn().mockResolvedValue({
    getCatalogue: vi.fn().mockResolvedValue({
      candidate: {
        free: { id: 'free', name: 'Ödənişsiz', priceAzn: 0, period: 'həmişə', includes: [], allowances: [], grants: { 'documents.generations': { enabled: true, limit: 5, period: 'month' }, 'email.applications': { enabled: true, limit: 5, period: 'month' }, 'browser.applications': { enabled: false }, 'cv.versions': { enabled: true, limit: 1, period: 'lifetime' }, 'email.automation': { enabled: false }, 'applications.tracking': { enabled: true } } },
        plus: { id: 'plus', name: 'Plus', priceAzn: null, period: 'ay', includes: [], allowances: [], grants: { 'documents.generations': { enabled: true, limit: 30, period: 'month' }, 'email.applications': { enabled: true, limit: 30, period: 'month' }, 'browser.applications': { enabled: false }, 'cv.versions': { enabled: true, limit: 5, period: 'lifetime' }, 'email.automation': { enabled: false }, 'applications.tracking': { enabled: true } } },
        premium: { id: 'premium', name: 'Premium', priceAzn: null, period: 'ay', includes: [], allowances: [], grants: { 'documents.generations': { enabled: true, limit: null, period: 'month' }, 'email.applications': { enabled: true, limit: 100, period: 'month' }, 'browser.applications': { enabled: true, limit: 50, period: 'month' }, 'cv.versions': { enabled: true, limit: 5, period: 'lifetime' }, 'email.automation': { enabled: true }, 'applications.tracking': { enabled: true } } },
      },
      employer: [],
      source: 'live',
      paymentsEnabled: false,
    }),
  }),
}));

describe('PricingPage', () => {
  it('uses a loading state instead of advertising coming soon before capability checks finish', () => {
    mockPayments = null;
    render(<PricingPage />);
    expect(screen.getAllByRole('button', { name: 'Yüklənir…' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /Tezliklə/ })).toBeNull();
  });
  it('renders free plan document allowance and shared rules', async () => {
    render(<PricingPage />);

    // Document allowance lines, from the server's grants
    expect(await screen.findByText(/Ayda 5 sənəd generasiyası/i)).toBeDefined();
    expect(screen.getByText(/Ayda 30 sənəd generasiyası/i)).toBeDefined();
    expect(screen.getByText(/Sənəd üçün aylıq limit yoxdur/i)).toBeDefined();

    // Shared allowance explanation in factual card
    expect(
      screen.getByText(/CV, rezüme və motivasiya məktubları eyni ortaq generasiya limitini bölüşür/i),
    ).toBeDefined();

    // Honest disclaimer: no false ATS or interview guarantees
    expect(
      screen.getByText(/AISE namizədlərə qondarma zəmanətlər/i),
    ).toBeDefined();
  });

  it('does not promise document generation while the deployment has it switched off, and says so', () => {
    mockFeatures = { documents: false, emailApplications: false, emailAutomation: false };
    try {
      render(<PricingPage />);
      expect(screen.getByTestId('documents-unavailable-notice')).toHaveTextContent(/hazırda əlçatan deyil/);
      expect(screen.queryByText(/Ayda 5 sənəd generasiyası/i)).toBeNull();
      expect(screen.getByText(/Sənəd generasiyası hazırda əlçatan deyil/)).toBeDefined();
    } finally {
      mockFeatures = { documents: true, emailApplications: true, emailAutomation: false };
    }
  });

  it('compares every plan on the same rows and units, without claims the product does not make', async () => {
    render(<PricingPage />);
    const table = await screen.findByTestId('plan-comparison');
    const row = (label: string) => [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent?.startsWith(label))!;
    const cells = (label: string) => [...row(label).querySelectorAll('td')].map((td) => td.textContent);
    // The table renders "—" until the catalogue arrives; wait for the server's grants rather than reading the placeholder.
    await waitFor(() => expect(cells('Vakansiyaya uyğun sənəd')).not.toContain('—'));
    expect(cells('Vakansiyaya uyğun sənəd')).toEqual(['ayda 5 sənəd', 'ayda 30 sənəd', 'aylıq limit yoxdur (eyni anda 3, saatda 30)']);
    expect(cells('E-poçtla müraciət')).toEqual(['ayda 5 müraciət', 'ayda 30 müraciət', 'ayda 100 müraciət']);
    expect(cells('Brauzer köməkçisi')).toEqual(['yoxdur', 'yoxdur', 'ayda 50 təsdiqli müraciət']);
    expect(cells('İş tövsiyələri')).toEqual(['həftədə 3-ə qədər', 'gündə 1-ə qədər', 'gündə 5-ə qədər']);
    expect(cells('CV versiyaları')).toEqual(['cəmi 1 versiya', 'cəmi 5 versiya', 'cəmi 5 versiya']);
    expect(document.body.textContent).not.toMatch(/prioritet generasiya|Limitsiz sənəd versiyaları/);
  });

  it('keeps paid purchase disabled when server payments are unavailable', async () => {
    render(<PricingPage />);

    const buyButtons = await screen.findAllByRole('button', { name: /Hazırda əlçatan deyil/i });
    expect(buyButtons.length).toBeGreaterThan(0);
    expect((buyButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not list automatic sending as a Premium benefit while the server has it off', async () => {
    mockFeatures = { documents: true, emailApplications: true, emailAutomation: false };
    render(<PricingPage />);
    expect(await screen.findByTestId('automation-planned')).toHaveTextContent('hələ açıq deyil');
    expect(screen.queryByText(/^Avtomatik e-poçt müraciətləri:/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('plan-comparison')).toHaveTextContent('hələ açıq deyil'));
  });
  it('lists automatic sending once the server has it on', async () => {
    mockFeatures = { documents: true, emailApplications: true, emailAutomation: true };
    render(<PricingPage />);
    expect(await screen.findByText(/^Avtomatik e-poçt müraciətləri:/)).toBeDefined();
    expect(screen.queryByTestId('automation-planned')).toBeNull();
  });
});

it('enters checkout with document links so the provider CSP is applied before SDK loading', async () => {
  mockPayments = true;
  mockSession = { user: { id: 'synthetic-candidate' } };
  const api = await loadRetentionApi();
  const catalogue = await api.getCatalogue();
  vi.mocked(api.getCatalogue).mockResolvedValueOnce({ ...catalogue, candidate: {
    ...catalogue.candidate,
    plus: { ...catalogue.candidate.plus!, purchasable: true, priceAzn: 8 },
    premium: { ...catalogue.candidate.premium!, purchasable: true, priceAzn: 50 },
  } });
  render(<PricingPage />);
  expect(await screen.findByRole('link', { name: 'Premium plana keç' })).toHaveAttribute('href', '/checkout?plan=premium');
  expect(screen.getByRole('link', { name: 'Plus plana keç' })).toHaveAttribute('href', '/checkout?plan=plus');
  expect(screen.queryByRole('button', { name: 'Premium plana keç' })).not.toBeInTheDocument();
});
