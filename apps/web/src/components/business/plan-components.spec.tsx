import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanSummary } from './plan-summary';
import { VacancyPlanPanel } from './vacancy-plan-panel';
import type { PlansOverview } from '@/lib/business-plans';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: any }) => <a href={href} {...rest}>{children}</a>,
}));

const overview = (patch: Partial<PlansOverview> = {}): PlansOverview => ({
  gated: true,
  checkoutAvailable: true,
  prices: { singleAzn: 20, singleDays: 30, businessAznPerMonth: 100, trialDays: 14 },
  trial: { available: true, used: false, startedAt: null, endsAt: null },
  credits: { available: 0 },
  business: { active: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  nextPublication: 'TRIAL',
  ...patch,
});

describe('PlanSummary', () => {
  it('renders nothing when plans are off or unreadable', () => {
    const { container, rerender } = render(<PlanSummary overview={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PlanSummary overview={overview({ gated: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states trial, credits and the next publication from the server state', () => {
    render(<PlanSummary overview={overview({ credits: { available: 2 }, nextPublication: 'CREDIT' })} />);
    expect(screen.getByText(/Hər şirkət üçün bir dəfə/)).toBeInTheDocument();
    expect(screen.getByText(/2 işlənməmiş kredit/)).toBeInTheDocument();
    expect(screen.getByText(/Bir Tək vakansiya krediti işlənəcək/)).toBeInTheDocument();
  });

  it('shows a lapsed Business subscription honestly, with data preserved', () => {
    render(<PlanSummary overview={overview({ business: { active: false, status: 'on_hold', currentPeriodEnd: null, cancelAtPeriodEnd: false }, nextPublication: 'NONE', trial: { available: false, used: true, startedAt: null, endsAt: null } })} />);
    expect(screen.getByText(/Abunəlik aktiv deyil/)).toBeInTheDocument();
    expect(screen.getByText(/saxlanılır/)).toBeInTheDocument();
  });
});

describe('VacancyPlanPanel', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when plans are off', () => {
    const { container } = render(<VacancyPlanPanel vacancy={{ id: 'v', title: 'x', status: 'ACTIVE' }} overview={overview({ gated: false })} onChanged={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('submits a draft for review and reports the updated state', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'v', status: 'PENDING_REVIEW' }), { status: 200 }));
    const onChanged = vi.fn();
    render(<VacancyPlanPanel vacancy={{ id: 'v', title: 'x', status: 'DRAFT' }} overview={overview()} onChanged={onChanged} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yoxlamaya göndər' })); });
    expect(fetchMock).toHaveBeenCalledWith('/api/business/plans/vacancies/v/submit', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'v', status: 'PENDING_REVIEW' })));
    expect(screen.getByRole('status')).toHaveTextContent('yoxlamaya göndərildi');
  });

  it('shows the cost before publishing and the server refusal verbatim', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bu şirkət üçün ödənişsiz sınaq artıq istifadə olunub' }), { status: 403 }));
    render(<VacancyPlanPanel vacancy={{ id: 'v', title: 'x', status: 'APPROVED' }} overview={overview()} onChanged={() => undefined} />);
    expect(screen.getByText(/Ödənişsiz 14 günlük sınaq/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yayımla' })); });
    expect(await screen.findByText(/ödənişsiz sınaq artıq istifadə olunub/)).toBeInTheDocument();
  });

  it('leads to the plan page instead of a dead button when nothing entitles publication', () => {
    render(<VacancyPlanPanel vacancy={{ id: 'v', title: 'x', status: 'APPROVED' }} overview={overview({ nextPublication: 'NONE' })} onChanged={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Plan seç' })).toHaveAttribute('href', '/business/billing');
    expect(screen.queryByRole('button', { name: 'Yayımla' })).toBeNull();
  });
});
