import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { loadEmailApplyConfig } from '../email-applications/email-apply.config';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: {
    user: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    academySeatGrant: Record<string, jest.Mock>;
    match: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    // No DODO_PAYMENTS_API_KEY set in the test env, so the service falls back
    // to its mock default key and every mock-mode branch is exercised.
    delete process.env.DODO_PAYMENTS_API_KEY;
    delete process.env.PAYMENTS_ENABLED;

    prisma = {
      user: { findUnique: jest.fn() },
      subscription: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      academySeatGrant: { findMany: jest.fn().mockResolvedValue([]) },
      match: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PostHogService, useValue: { capture: jest.fn() } },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  describe('getPlans', () => {
    it('exposes a dodoProductId for every paid plan and none for free', () => {
      const plans = service.getPlans();
      const free = plans.find((p) => p.id === 'free');
      const pro = plans.find((p) => p.id === 'basic');
      const premium = plans.find((p) => p.id === 'unlimited');

      expect(free && 'dodoProductId' in free).toBe(false);
      expect(pro).toHaveProperty('dodoProductId');
      expect(premium).toHaveProperty('dodoProductId');
    });

    it('uses a lowercase id for every plan, including the top tier', () => {
      // Regression: the old Paddle-era plan used id 'Limitsiz' (mixed case)
      // while createCheckoutSession compared against planId.toLowerCase(),
      // so that plan's checkout could never match. Every id must round-trip
      // through .toLowerCase() unchanged.
      const plans = service.getPlans();
      for (const p of plans) {
        expect(p.id).toBe(p.id.toLowerCase());
      }
    });
  });

  describe('getSubscription', () => {
    it('reports sponsored access and the single effective match allowance', async () => {
      const endsAt = new Date(Date.now() + 7 * 86_400_000);
      prisma.user.findUnique.mockResolvedValue({
        subscription: { plan: 'PLUS', status: 'active', currentPeriodEnd: endsAt, cancelAtPeriodEnd: false, matchesUsedThisPeriod: 0, dodoSubscriptionId: 'dodo_1' },
        planOverrides: [{ plan: 'PREMIUM', expiresAt: endsAt, revokedAt: null, academySeatGrantId: 'seat_1' }],
      });
      prisma.academySeatGrant.findMany.mockResolvedValue([{ plan: 'PREMIUM', endsAt, academy: { name: 'Holberton Baku' } }]);
      prisma.match.count.mockResolvedValue(2);

      const result = await service.getSubscription('student_1');

      expect(result.plan).toBe('PREMIUM');
      expect(result.matchesPerDay).toBe(5);
      expect(result.matchesUsedToday).toBe(2);
      expect(result.sponsoredAccess).toMatchObject({ academyName: 'Holberton Baku', plan: 'PREMIUM', matchesRemainingToday: 3 });
      expect(result.override).toBeNull();
    });
  });

  describe('createCheckoutSession', () => {
    it('rejects the free plan', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      await expect(service.createCheckoutSession('user_1', 'free')).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown plan', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      await expect(service.createCheckoutSession('user_1', 'nonexistent')).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createCheckoutSession('user_1', 'plus')).rejects.toThrow(NotFoundException);
    });

    it('rejects the retired Basic, Standard and Limitsiz plans for a new checkout', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      for (const id of ['basic', 'standard', 'unlimited', 'UNLIMITED']) {
        await expect(service.createCheckoutSession('user_1', id)).rejects.toThrow(BadRequestException);
      }
      expect(service.getPlans().filter((p) => ['basic', 'standard', 'unlimited'].includes(p.id)).every((p) => (p as { purchasable?: boolean }).purchasable === false)).toBe(true);
    });

    it('accepts the top-tier plan id case-insensitively', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      const result = await service.createCheckoutSession('user_1', 'PREMIUM');
      expect(result.url).toContain('/dashboard?checkout=success&mock=1');
    });

    it('returns a mock return url in local mock mode that claims no plan', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      const result = await service.createCheckoutSession('user_1', 'plus');
      expect(result.url).toContain('/dashboard?checkout=success&mock=1');
      expect(result.url).not.toMatch(/plan=/);
    });

    it('refuses checkout in production when only the mock key is configured', async () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
        expect(service.getStatus()).toEqual({ paymentsEnabled: false, mode: 'mock', documentGenerationEnabled: true, emailApplicationsEnabled: false, emailAutomationEnabled: false });
        await expect(service.createCheckoutSession('user_1', 'plus')).rejects.toThrow(ServiceUnavailableException);
      } finally {
        process.env.NODE_ENV = saved;
      }
    });

    it('does not publish automatic e-mail sending just because it is switched on', () => {
      const saved = { ...process.env };
      Object.assign(process.env, { EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_AUTOMATION_ENABLED: 'true' });
      delete process.env.EMAIL_APPLY_AUTOMATION_PUBLISHED;
      try {
        expect(service.getStatus().emailAutomationEnabled).toBe(false);
        process.env.EMAIL_APPLY_AUTOMATION_PUBLISHED = 'true';
        expect(service.getStatus().emailAutomationEnabled).toBe(loadEmailApplyConfig().enabled && loadEmailApplyConfig().automationEnabled);
      } finally {
        process.env = saved;
      }
    });

    it('honours the PAYMENTS_ENABLED=false kill switch', async () => {
      process.env.PAYMENTS_ENABLED = 'false';
      try {
        expect(service.paymentsEnabled()).toBe(false);
      } finally {
        delete process.env.PAYMENTS_ENABLED;
      }
    });

    // Production holds a real Dodo key and no PAYMENTS_ENABLED at all; the
    // paid lifecycle is unverified, so a real key alone must not open checkout.
    describe('with a real provider key', () => {
      const saved = { flag: process.env.PAYMENTS_ENABLED, env: process.env.NODE_ENV };
      beforeEach(() => {
        (service as any).isMock = false;
        process.env.NODE_ENV = 'production';
      });
      afterEach(() => {
        if (saved.flag === undefined) delete process.env.PAYMENTS_ENABLED;
        else process.env.PAYMENTS_ENABLED = saved.flag;
        process.env.NODE_ENV = saved.env;
      });

      it('keeps purchasing off when PAYMENTS_ENABLED is unset', async () => {
        delete process.env.PAYMENTS_ENABLED;
        expect(service.paymentsEnabled()).toBe(false);
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
        await expect(service.createCheckoutSession('user_1', 'plus')).rejects.toThrow(ServiceUnavailableException);
      });

      it.each(['', '1', 'yes', 'TRUE', 'false'])('keeps purchasing off for PAYMENTS_ENABLED=%p', (value) => {
        process.env.PAYMENTS_ENABLED = value;
        expect(service.paymentsEnabled()).toBe(false);
      });

      it('opens purchasing only for an explicit PAYMENTS_ENABLED=true', () => {
        process.env.PAYMENTS_ENABLED = 'true';
        expect(service.paymentsEnabled()).toBe(true);
      });
    });

    describe('embedded checkout sessions (real provider call stubbed)', () => {
      let create: jest.Mock;
      const saved = { flag: process.env.PAYMENTS_ENABLED };
      beforeEach(() => {
        (service as any).isMock = false;
        process.env.PAYMENTS_ENABLED = 'true';
        create = jest.fn().mockResolvedValue({ checkout_url: 'https://test.checkout.dodopayments.com/session/cks_a', session_id: 'cks_a' });
        (service as any).dodo = { checkoutSessions: { create } };
        // Offers are purchasable only with configured prices and provider products; the test supplies both.
        jest.spyOn(service, 'getPlans').mockReturnValue([
          { id: 'free', name: 'Free', price: 0 },
          { id: 'plus', name: 'Plus', price: 8, purchasable: true, dodoProductId: 'pdt_plus' },
          { id: 'premium', name: 'Premium', price: 50, purchasable: true, dodoProductId: 'pdt_premium' },
        ] as any);
      });
      afterEach(() => {
        if (saved.flag === undefined) delete process.env.PAYMENTS_ENABLED;
        else process.env.PAYMENTS_ENABLED = saved.flag;
      });

      it('creates the session on the server from the approved product with the wallets and AISE presentation', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', name: 'A', subscription: null });
        const r = await service.createCheckoutSession('user_1', 'plus');
        expect(r.url).toBe('https://test.checkout.dodopayments.com/session/cks_a');
        const body = create.mock.calls[0][0];
        expect(body.product_cart).toEqual([{ product_id: expect.any(String), quantity: 1 }]);
        expect(body.allowed_payment_method_types).toEqual(['credit', 'debit', 'apple_pay', 'google_pay']);
        expect(body.customization).toEqual({ theme: 'light', force_language: 'az' });
        expect(body.return_url).toContain('/dashboard?checkout=success');
        expect(body.metadata).toEqual({ userId: 'user_1', plan: 'PLUS' });
      });

      it('hands the same unpaid session to a double click or remount instead of opening a second one', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', subscription: null });
        const [a, b] = await Promise.all([service.createCheckoutSession('user_1', 'plus'), Promise.resolve().then(() => service.createCheckoutSession('user_1', 'plus'))]);
        const c = await service.createCheckoutSession('user_1', 'plus');
        expect(c.url).toBe(a.url);
        expect(b.url).toBe(a.url);
        // The two concurrent calls may both reach the provider; once one has finished, every later call reuses it.
        const afterBurst = create.mock.calls.length;
        await service.createCheckoutSession('user_1', 'plus');
        expect(create.mock.calls.length).toBe(afterBurst);
      });

      it('does not mix sessions between plans or accounts', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', subscription: null });
        await service.createCheckoutSession('user_1', 'plus');
        await service.createCheckoutSession('user_1', 'premium');
        prisma.user.findUnique.mockResolvedValue({ id: 'user_2', email: 'c@d.com', subscription: null });
        await service.createCheckoutSession('user_2', 'plus');
        expect(create).toHaveBeenCalledTimes(3);
      });

      it('refuses to sell a plan the account already holds with an active provider subscription', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', subscription: { plan: 'PLUS', status: 'active', dodoSubscriptionId: 'sub_1', dodoCustomerId: 'cus_1' } });
        await expect(service.createCheckoutSession('user_1', 'plus')).rejects.toThrow(/artıq aktivdir/);
        expect(create).not.toHaveBeenCalled();
        // A different offer is still allowed.
        await expect(service.createCheckoutSession('user_1', 'premium')).resolves.toBeDefined();
      });
    });

    it('never enables purchasing with the mock key in production, even when asked to', () => {
      const saved = { flag: process.env.PAYMENTS_ENABLED, env: process.env.NODE_ENV };
      process.env.PAYMENTS_ENABLED = 'true';
      process.env.NODE_ENV = 'production';
      try {
        expect(service.paymentsEnabled()).toBe(false);
      } finally {
        if (saved.flag === undefined) delete process.env.PAYMENTS_ENABLED;
        else process.env.PAYMENTS_ENABLED = saved.flag;
        process.env.NODE_ENV = saved.env;
      }
    });
  });

  describe('createPortalSession', () => {
    it('rejects a user with no subscription', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', subscription: null });
      await expect(service.createPortalSession('user_1')).rejects.toThrow(BadRequestException);
    });

    it('returns a mock portal url in mock mode without requiring a real dodoCustomerId', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        subscription: { dodoCustomerId: null, dodoSubscriptionId: null },
      });
      const result = await service.createPortalSession('user_1');
      expect(result.url).toContain('portal=mock_success');
    });
  });

  describe('handleWebhook', () => {
    it('short-circuits without verifying a signature in mock mode', async () => {
      const result = await service.handleWebhook(Buffer.from('{}'), {
        webhookId: 'x',
        webhookSignature: 'x',
        webhookTimestamp: 'x',
      });
      expect(result).toEqual({ received: true });
    });
  });

  // Regression cover for the production failure where a real API key was
  // configured but the product ids were not: checkout reached Dodo with
  // 'mock_basic' and came back 422 "Product mock_basic does not exist",
  // visible to the user only as a failed purchase.
  describe('startup configuration guard', () => {
    const DODO_ENV_KEYS = [
      'DODO_PAYMENTS_API_KEY',
      'DODO_ENV',
      'DODO_PRODUCT_ID_BASIC',
      'DODO_PRODUCT_ID_STANDARD',
      'DODO_PRODUCT_ID_UNLIMITED',
    ];
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      for (const k of DODO_ENV_KEYS) saved[k] = process.env[k];
    });

    afterEach(() => {
      for (const k of DODO_ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    });

    const construct = () =>
      new BillingService(prisma as any, { capture: jest.fn() } as any);

    const setRealKeyWith = (extra: Record<string, string>) => {
      // Must not contain the substring 'mock' anywhere: the service decides
      // mock vs real with `apiKey.includes('mock')`, so a fixture like
      // 'live_realkey.notamock' is silently treated as mock and the guard
      // under test never runs.
      process.env.DODO_PAYMENTS_API_KEY = 'fixture_not_a_real_key.aaaa1111';
      delete process.env.DODO_ENV;
      delete process.env.DODO_PRODUCT_ID_BASIC;
      delete process.env.DODO_PRODUCT_ID_STANDARD;
      delete process.env.DODO_PRODUCT_ID_UNLIMITED;
      Object.assign(process.env, extra);
    };

    it('still boots with a mock key and no other Dodo config (local dev)', () => {
      delete process.env.DODO_PAYMENTS_API_KEY;
      expect(() => construct()).not.toThrow();
    });

    it('refuses to boot when a real key has no product ids', () => {
      setRealKeyWith({ DODO_ENV: 'live_mode' });
      expect(() => construct()).toThrow(/DODO_PRODUCT_ID_BASIC/);
    });

    it('treats leftover mock_ product ids as missing', () => {
      setRealKeyWith({
        DODO_ENV: 'live_mode',
        DODO_PRODUCT_ID_BASIC: 'mock_basic',
        DODO_PRODUCT_ID_STANDARD: 'pdt_standard',
        DODO_PRODUCT_ID_UNLIMITED: 'pdt_unlimited',
      });
      expect(() => construct()).toThrow(/DODO_PRODUCT_ID_BASIC/);
    });

    it('refuses to boot when DODO_ENV is unset, which silently means test_mode', () => {
      setRealKeyWith({
        DODO_PRODUCT_ID_BASIC: 'pdt_basic',
        DODO_PRODUCT_ID_STANDARD: 'pdt_standard',
        DODO_PRODUCT_ID_UNLIMITED: 'pdt_unlimited',
      });
      expect(() => construct()).toThrow(/DODO_ENV/);
    });

    it('boots when a real key is fully configured', () => {
      setRealKeyWith({
        DODO_ENV: 'live_mode',
        DODO_PRODUCT_ID_BASIC: 'pdt_basic',
        DODO_PRODUCT_ID_STANDARD: 'pdt_standard',
        DODO_PRODUCT_ID_UNLIMITED: 'pdt_unlimited',
      });
      expect(() => construct()).not.toThrow();
    });
  });

});
