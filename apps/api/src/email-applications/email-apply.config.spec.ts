import { emailApplyConfigProblems, loadEmailApplyConfig, recipientAllowed } from './email-apply.config';
import { canTransition, payloadHash, stateFromEvidence } from './email-application-state';

const cfg = (env: Record<string, string>) => loadEmailApplyConfig(env as never);
const none = { providerAcceptedAt: null, deliveredAt: null, bouncedAt: null, complainedAt: null, providerFailedAt: null };
const t = new Date('2026-10-02T08:00:00Z');

describe('e-mail application configuration', () => {
  it('is off by default, in sink mode, with automation off', () => {
    expect(cfg({})).toMatchObject({ enabled: false, transport: 'sink', automationEnabled: false, inboundEnabled: false, realRecipients: false });
    expect(emailApplyConfigProblems(cfg({}))).toEqual([]);
  });
  it('allows the local sink only on a loopback address', () => {
    expect(emailApplyConfigProblems(cfg({ EMAIL_APPLY_ENABLED: 'true' }))).toEqual([]);
    expect(emailApplyConfigProblems(cfg({ EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_SINK_URL: 'http://example.com:4599' }))).toHaveLength(1);
    expect(emailApplyConfigProblems(cfg({ EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_SINK_URL: 'http://user:pw@127.0.0.1:4599' }))).toHaveLength(1);
  });
  it('refuses live sending without a key, a verified sender, a signing secret and an authorized recipient policy', () => {
    const live = { EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'live' };
    expect(emailApplyConfigProblems(cfg(live))).toHaveLength(4);
    expect(emailApplyConfigProblems(cfg({ ...live, RESEND_API_KEY: 'mock-key', EMAIL_APPLY_FROM: 'A <a@b.c>', EMAIL_APPLY_WEBHOOK_SECRET: 'whsec_abc', EMAIL_APPLY_RECIPIENT_ALLOWLIST: 'me@x.az' }))).toHaveLength(1); // mock key is not a key
    expect(emailApplyConfigProblems(cfg({ ...live, RESEND_API_KEY: 're_real', EMAIL_APPLY_FROM: 'A <a@b.c>', EMAIL_APPLY_WEBHOOK_SECRET: 'whsec_abc', EMAIL_APPLY_RECIPIENT_ALLOWLIST: 'me@x.az' }))).toEqual([]);
    expect(emailApplyConfigProblems(cfg({ ...live, RESEND_API_KEY: 're_real', EMAIL_APPLY_FROM: 'A <a@b.c>', EMAIL_APPLY_WEBHOOK_SECRET: 'whsec_abc', EMAIL_APPLY_REAL_RECIPIENTS: 'true' }))).toEqual([]);
  });
  it('limits live recipients to the allowlist until real recipients are authorized', () => {
    const pilot = cfg({ EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'live', EMAIL_APPLY_RECIPIENT_ALLOWLIST: 'pilot@x.az, @inbox.test' });
    expect(recipientAllowed(pilot, 'PILOT@x.az')).toBe(true);
    expect(recipientAllowed(pilot, 'anyone@inbox.test')).toBe(true);
    expect(recipientAllowed(pilot, 'hr@employer.az')).toBe(false);
    expect(recipientAllowed(pilot, 'hr@evil-inbox.test')).toBe(false);
    expect(recipientAllowed({ ...pilot, realRecipients: true }, 'hr@employer.az')).toBe(true);
    expect(recipientAllowed(cfg({ EMAIL_APPLY_ENABLED: 'true' }), 'hr@employer.az')).toBe(true); // sink never leaves the machine
  });
  it('bounds numeric settings', () => {
    expect(cfg({ EMAIL_APPLY_USER_DAILY_LIMIT: '-5', EMAIL_APPLY_MAX_ATTEMPTS: '99' })).toMatchObject({ userDailyLimit: 10, maxAttempts: 3 });
  });
});

describe('delivery and recruitment state rules', () => {
  it('derives the strongest state from accumulated evidence, regardless of arrival order', () => {
    expect(stateFromEvidence({ ...none, providerAcceptedAt: t }, 'SENDING')).toBe('PROVIDER_ACCEPTED');
    expect(stateFromEvidence({ ...none, providerAcceptedAt: t, deliveredAt: t }, 'PROVIDER_ACCEPTED')).toBe('DELIVERED');
    expect(stateFromEvidence({ ...none, providerAcceptedAt: t, deliveredAt: t, bouncedAt: t }, 'DELIVERED')).toBe('BOUNCED');
    expect(stateFromEvidence({ ...none, bouncedAt: t, complainedAt: t }, 'BOUNCED')).toBe('COMPLAINED');
    expect(stateFromEvidence(none, 'UNCERTAIN')).toBe('UNCERTAIN');
  });
  it('allows candidate-reported progress and visible corrections, never a return to "not sent" or a manual "sent"', () => {
    expect(canTransition('SENT', 'INTERVIEW_SCHEDULED')).toBe(true);
    expect(canTransition('REJECTED', 'INTERVIEW_INVITED')).toBe(true);
    expect(canTransition('SENT', 'NOT_SENT')).toBe(false);
    expect(canTransition('ACKNOWLEDGED', 'SENT')).toBe(false);
    expect(canTransition('WITHDRAWN', 'OFFER')).toBe(false);
    expect(canTransition('SENT', 'SENT')).toBe(false);
  });
  it('changes the approval hash when any approved part changes', () => {
    const base = { recipient: 'a@b.az', subject: 's', body: 'b', cvSha256: 'c'.repeat(64), cvFileName: 'cv.pdf', replyTo: 'me@x.az', senderName: 'N', copyToSelf: true };
    const h = payloadHash(base);
    for (const change of [{ recipient: 'x@b.az' }, { subject: 'z' }, { body: 'z' }, { cvSha256: 'd'.repeat(64) }, { cvFileName: 'z.pdf' }, { replyTo: 'z@x.az' }, { senderName: 'Z' }, { copyToSelf: false }]) {
      expect(payloadHash({ ...base, ...change })).not.toBe(h);
    }
    expect(payloadHash({ ...base })).toBe(h);
  });
});
