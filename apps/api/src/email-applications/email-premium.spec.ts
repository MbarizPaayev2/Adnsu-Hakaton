import {
  candidateAlias,
  premiumEmailAccess,
  senderAlias,
} from './email-premium';
import {
  EmailAutomationService,
  AUTOMATION_CONSENT_VERSION,
} from './email-automation.service';

describe('Premium email identity and automatic-mode gates', () => {
  const now = new Date();
  const user = (plan: string, status = 'active') => ({
    name: 'Aysel Məmmədova',
    emailVerified: now,
    candidateMailAlias: null,
    subscription: {
      plan,
      status,
      currentPeriodEnd: new Date(now.getTime() + 86400000),
    },
  });
  const dbOf = (u: any): any => ({
    user: {
      findUnique: jest.fn(async () => u),
      updateMany: jest.fn(async ({ data }) => {
        Object.assign(u, data);
        return { count: 1 };
      }),
    },
    emailApplySettings: { findUnique: jest.fn(async () => null) },
    emailAutomationDecision: { findMany: jest.fn(async () => []) },
    emailApplication: { count: jest.fn() },
  });
  it.each(['FREE', 'PLUS', 'BASIC', 'STANDARD'])(
    'does not grant automatic sending or a sender alias to %s',
    async (plan) => {
      const db = dbOf(user(plan));
      expect((await premiumEmailAccess(db, 'u')).included).toBe(false);
      expect(await senderAlias(db, 'u', 'Aysel Məmmədova')).toBeNull();
      expect(db.user.updateMany).not.toHaveBeenCalled();
    },
  );
  it('stops an expired or on-hold Premium subscription, while respecting a current override', async () => {
    const u = user('PREMIUM', 'on_hold');
    const db = dbOf(u);
    expect((await premiumEmailAccess(db, 'u')).included).toBe(false);
    (u as any).planOverrides = [
      {
        plan: 'PREMIUM',
        expiresAt: new Date(now.getTime() + 100000),
        revokedAt: null,
      },
    ];
    expect((await premiumEmailAccess(db, 'u')).included).toBe(true);
  });
  it('persists a collision-resistant alias once, and does not change it after a profile rename', async () => {
    const db = dbOf(user('PREMIUM'));
    const alias = await senderAlias(db, 'u1', 'Aysel Məmmədova');
    expect(alias).toMatch(/^aysel\.memmedova\.[a-f0-9]+@aisehr\.com$/);
    expect(await senderAlias(db, 'u1', 'Different Name')).toBe(alias);
    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
    expect(candidateAlias('Aysel Məmmədova', 'u2')).not.toBe(alias);
    expect(candidateAlias('CEO\r\nBcc:evil@x', 'u3')).not.toMatch(/[\r\n<>]/);
    expect(candidateAlias('Admin', 'u4')).not.toBe('admin@aisehr.com');
  });
  it('checks the plan when settings are saved and again when an opted-in worker runs', async () => {
    const db = dbOf(user('FREE'));
    const svc = new EmailAutomationService(
      db,
      { isPaused: jest.fn(async () => false) } as any,
      {} as any,
      { enabled: true, automationEnabled: true } as any,
    );
    await expect(
      svc.save('u', { enabled: true, consent: true }),
    ).rejects.toThrow('PLAN_REQUIRED');
    const s: any = {
      userId: 'u',
      automationEnabled: true,
      automationConsentedAt: now,
      consentVersion: AUTOMATION_CONSENT_VERSION,
    };
    expect(await svc.runForUser(s)).toEqual({ applied: 0, skipped: 0 });
    expect(db.emailApplication.count).not.toHaveBeenCalled();
  });
  it('does not revive an old opt-in automatically when the global switch turns on', async () => {
    const db = dbOf(user('PREMIUM'));
    const svc = new EmailAutomationService(
      db,
      {} as any,
      {} as any,
      { enabled: true, automationEnabled: true } as any,
    );
    expect(
      await svc.runForUser({
        userId: 'u',
        automationEnabled: true,
        automationConsentedAt: now,
        consentVersion: 'old',
      } as any),
    ).toEqual({ applied: 0, skipped: 0 });
    expect(db.emailApplication.count).not.toHaveBeenCalled();
  });
});
