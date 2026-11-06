import { describe, expect, it } from 'vitest';
import { agentPipeline, nextAction } from './agent-overview';
import type { EmailApplicationSummary } from '@/lib/email-application';

const row = (deliveryState: EmailApplicationSummary['deliveryState'], extra: Partial<EmailApplicationSummary> = {}) => ({ id: deliveryState, deliveryState, ...extra }) as EmailApplicationSummary;

describe('agent pipeline', () => {
  it('never counts a waiting, queued or unconfirmed application as sent', () => {
    const p = agentPipeline([row('AWAITING_APPROVAL', { preparedByAgentAt: '2026-10-17' }), row('AWAITING_APPROVAL'), row('QUEUED'), row('SENDING'), row('PROVIDER_ACCEPTED'), row('DELIVERED'), row('UNCERTAIN'), row('QUEUED', { holdReason: 'USER_PAUSED' }), row('DRAFT'), row('CANCELLED')]);
    expect(p).toEqual({ awaiting: 2, awaitingFromAgent: 1, sending: 2, sent: 2, attention: 2 });
  });
});

describe('next action', () => {
  const calm = { awaiting: 0, awaitingFromAgent: 0, sending: 0, sent: 0, attention: 0 };
  it('puts approval first, then problems, then the profile, then new vacancies', () => {
    expect(nextAction({ pipeline: { ...calm, awaiting: 2, awaitingFromAgent: 2, attention: 1 }, newMatches: 4, profileReady: true, agentOn: true })).toMatchObject({ title: '2 müraciət təsdiqinizi gözləyir', href: '/dashboard/applications#review' });
    expect(nextAction({ pipeline: { ...calm, attention: 1 }, newMatches: 4, profileReady: true, agentOn: true }).title).toBe('1 müraciət diqqət tələb edir');
    expect(nextAction({ pipeline: calm, newMatches: 4, profileReady: false, agentOn: false }).href).toBe('/dashboard/profile');
    expect(nextAction({ pipeline: calm, newMatches: 4, profileReady: true, agentOn: false }).title).toBe('4 yeni uyğun vakansiya');
    expect(nextAction({ pipeline: null, newMatches: 0, profileReady: true, agentOn: false }).tone).toBe('calm');
  });
});
