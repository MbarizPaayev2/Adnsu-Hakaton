import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AgentPanel, type AgentState, type EmailAllowance, type DocumentAllowance, type SendingSettings } from './agent-panel';
import type { AgentPipeline } from '@/lib/dashboard/agent-overview';

describe('AgentPanel', () => {
  const baseState: AgentState = {
    enabled: false,
    rules: {
      allowedRoles: ['Maliyyə analitiki', 'Audit'],
      allowedLocations: ['Bakı'],
      dailyLimit: 3,
    },
    reviewQueue: {
      available: true,
      enabled: true,
      pending: 2,
      maxPending: 10,
    },
  };

  const basePipeline: AgentPipeline = {
    awaiting: 2,
    awaitingFromAgent: 2,
    sending: 1,
    sent: 5,
    attention: 0,
  };

  const emailAllowance: EmailAllowance = {
    limit: 10,
    used: 5,
    remaining: 5,
    resetsAt: '2026-11-01T00:00:00.000Z',
  };

  const docAllowance: DocumentAllowance = {
    limit: 30,
    used: 12,
    remaining: 18,
    resetsAt: '2026-11-01T00:00:00.000Z',
  };

  const sending: SendingSettings = {
    sendingPausedAt: null,
    consentRevokedAt: null,
  };

  it('keeps email-agent links visible when its status request fails', () => {
    const { container } = render(
      <AgentPanel state={null} pipeline={null} allowance={null} sending={null} />
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Agent və e-poçt qaydaları' })).toHaveAttribute('href', '/dashboard/email-applications/settings');
  });

  it('renders active review queue state with candidate rules and pipeline metrics', () => {
    render(
      <AgentPanel
        state={baseState}
        pipeline={basePipeline}
        allowance={emailAllowance}
        docAllowance={docAllowance}
        sending={sending}
      />
    );

    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    expect(screen.getByText('Aktiv · hazırlayır, siz təsdiqləyirsiniz')).toBeInTheDocument();
    expect(screen.getByText(/Maliyyə analitiki, Audit/)).toBeInTheDocument();
    expect(screen.getByText(/Bakı/)).toBeInTheDocument();
    expect(screen.getByText(/gündə ən çox 3/)).toBeInTheDocument();

    // Pipeline metrics
    expect(screen.getByText('Təsdiqinizi gözləyir')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Göndərilir')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Göndərildi')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);

    // Primary CTA to review waiting applications
    const cta = screen.getByRole('link', { name: /Gözləyənləri yoxla/ });
    expect(cta).toHaveAttribute('href', '/dashboard/applications#review');
  });

  it('shows both email and document allowances clearly without confusing them', () => {
    render(
      <AgentPanel
        state={baseState}
        pipeline={basePipeline}
        allowance={emailAllowance}
        docAllowance={docAllowance}
        sending={sending}
      />
    );

    const allowanceBox = screen.getByTestId('agent-allowances');
    expect(allowanceBox).toHaveTextContent('Bu ay e-poçt müraciəti: 5 / 10 qalıb.');
    expect(allowanceBox).toHaveTextContent('Göndərilməyən müraciət limitdən çıxılmır.');
    expect(allowanceBox).toHaveTextContent('Bu ay sənəd hazırlığı: 18 / 30 qalıb.');
  });

  it('displays paused banner and warning badge when sending is paused', () => {
    render(
      <AgentPanel
        state={baseState}
        pipeline={basePipeline}
        allowance={emailAllowance}
        docAllowance={docAllowance}
        sending={{ ...sending, sendingPausedAt: '2026-10-18T12:00:00.000Z' }}
      />
    );

    expect(screen.getByText('Göndəriş dayandırılıb')).toBeInTheDocument();
    const banner = screen.getByTestId('agent-paused-banner');
    expect(banner).toHaveTextContent('Müraciətlərin göndərişi müvəqqəti dayandırılıb.');
    expect(banner).toHaveTextContent('siz davam etdirməyincə heç nə göndərilmir');
  });

  it('explains the 4 supported application routes and transparent submission policy', () => {
    render(
      <AgentPanel
        state={baseState}
        pipeline={basePipeline}
        allowance={emailAllowance}
        docAllowance={docAllowance}
        sending={sending}
      />
    );

    const routes = screen.getByTestId('agent-supported-routes');
    expect(routes).toHaveTextContent('AISE-nin dəstəklədiyi 4 müraciət yolu');
    expect(routes).toHaveTextContent('1. AISE e-poçt müraciəti');
    expect(routes).toHaveTextContent('2. Formada kömək (brauzer köməkçisi)');
    expect(routes).toHaveTextContent('3. Təsdiqlə göndəriş (dəstəklənən portallar)');
    expect(routes).toHaveTextContent('4. Sərbəst xarici müraciət');
    expect(routes).toHaveTextContent('AISE hazırlıq və ya forma doldurma mərhələsini heç vaxt avtomatik göndəriş kimi qələmə vermir');
  });

  it('renders Premium required state honestly for unpaid accounts', () => {
    render(
      <AgentPanel
        state={{ ...baseState, premiumRequired: true, reviewQueue: undefined }}
        pipeline={null}
        allowance={null}
        docAllowance={null}
        sending={sending}
      />
    );

    expect(screen.getByText('Premium planında')).toBeInTheDocument();
    expect(screen.getByText(/Agent Premium planına daxildir/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Planları müqayisə et' })).toHaveAttribute('href', '/pricing');
  });
});
