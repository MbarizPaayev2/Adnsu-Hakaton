import { PRODUCT_SPEC, PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS, PLAN_PRICES_AZN } from '@aise/shared-types';
import { loadProductConfig, priceKeys } from './product-config';
import { BillingService } from './billing.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('product spec invariants', () => {
  const candidate = Object.values(PRODUCT_SPEC.candidate.offers);
  const employer = Object.values(PRODUCT_SPEC.employer.offers);

  it('carries the approved candidate and employer prices; operator config starts empty', () => {
    expect(PRODUCT_SPEC.status).toBe('proposal');
    expect(PLAN_PRICES_AZN).toMatchObject({ PLUS: 8, PREMIUM: 50, FREE: 0 });
    expect(PLAN_DAILY_MATCH_QUOTAS).toEqual({ PLUS: 1, PREMIUM: 5 });
    expect(PRODUCT_SPEC.candidate.offers.plus.defaultPrice).toBe(8);
    expect(PRODUCT_SPEC.candidate.offers.premium.defaultPrice).toBe(50);
    // Employer plans: Sınaq is free (no price key), Tək vakansiya 20 AZN once, Biznes 100 AZN a month; Enterprise is by agreement.
    expect(PRODUCT_SPEC.employer.offers.starter_trial.defaultPrice).toBeUndefined();
    expect(PRODUCT_SPEC.employer.offers.single_job.defaultPrice).toBe(20);
    expect(PRODUCT_SPEC.employer.offers.business.defaultPrice).toBe(100);
    expect(PRODUCT_SPEC.employer.offers.enterprise.defaultPrice).toBeUndefined();
    expect(loadProductConfig({}).prices).toEqual({});
    expect(priceKeys()).toEqual(expect.arrayContaining(['PLUS', 'PREMIUM', 'EMPLOYER_SINGLE_JOB', 'EMPLOYER_BUSINESS', 'EMPLOYER_PROMOTED']));
  });

  it('defines the same feature keys for every candidate offer, so no screen meets an undefined feature', () => {
    const keys = Object.keys(PRODUCT_SPEC.candidate.offers.free.features).sort();
    for (const o of candidate) expect(Object.keys(o.features).sort()).toEqual(keys);
  });

  it('keeps legacy plans exactly as they are: tailoring included per match, same match quotas, no new restriction', () => {
    for (const id of ['legacy_basic', 'legacy_standard', 'legacy_limitsiz']) {
      const o = PRODUCT_SPEC.candidate.offers[id];
      expect(o.legacy).toBe(true);
      expect(o.features['tailored.cv']).toMatchObject({ enabled: true, limit: null, period: 'per_match' });
    }
    expect(PLAN_MATCH_QUOTAS).toMatchObject({ FREE: null, BASIC: 10, STANDARD: 30, Limitsiz: null });
    expect(PRODUCT_SPEC.candidate.offers.legacy_limitsiz.features['cv.versions'].limit).toBeNull(); // multiple base CVs, as today
  });

  it('approved document allowances: Free 5, Plus 30, Premium no monthly cap (transparent protections only), legacy unchanged', () => {
    const doc = (id: string) => PRODUCT_SPEC.candidate.offers[id].features['documents.generations'];
    expect(doc('free')).toMatchObject({ enabled: true, limit: 5, period: 'month', costly: true });
    expect(doc('plus')).toMatchObject({ enabled: true, limit: 30, period: 'month', costly: true });
    expect(doc('premium')).toMatchObject({ enabled: true, limit: null, period: 'month', costly: true, protections: { concurrent: 3, perHour: 30 } });
    for (const id of ['legacy_basic', 'legacy_standard', 'legacy_limitsiz']) expect(doc(id)).toMatchObject({ limit: null, period: 'month' });
    for (const o of candidate) expect(doc(o.id).note).toMatch(/share this allowance|no monthly document cap/);
    expect(PRODUCT_SPEC.candidate.never).toEqual(expect.arrayContaining(['interview or hiring promise', 'unrestricted external auto-apply']));
    expect(JSON.stringify(PRODUCT_SPEC.candidate.never)).toContain('fair-use protections always apply');
  });

  it('keeps Free discovery and tracking free and does not give Free the premium-only features', () => {
    const free = PRODUCT_SPEC.candidate.offers.free.features;
    for (const f of ['discovery.public_jobs', 'saved.jobs', 'saved.searches', 'follows.companies', 'alerts.in_app', 'alerts.email_digest', 'applications.tracking', 'profile.cv_tools']) expect(free[f].enabled).toBe(true);
    for (const f of ['alerts.instant', 'preferences.rich']) expect(free[f].enabled).toBe(false);
    // Letters are part of the shared document allowance for everyone now.
    expect(free['tailored.cover_letter'].enabled).toBe(true);
  });

  it('never sells or exposes candidates: employer discovery is off and imported CVs are never exposed', () => {
    for (const o of employer) expect(o.features['candidates.discovery'].enabled).toBe(false);
    expect(PRODUCT_SPEC.employer.invariants.importedCvExposure).toBe('never');
    expect(PRODUCT_SPEC.employer.addons.promoted_listing.mustBeLabelled).toBe(true);
  });

  it('contains none of the forbidden claims in any label or note', () => {
    const text = JSON.stringify(PRODUCT_SPEC).toLowerCase().replace(/"forbiddenclaims":\[[^\]]*\]/, '');
    for (const claim of PRODUCT_SPEC.forbiddenClaims) expect(text).not.toContain(claim.toLowerCase());
  });
});

describe('positioning copy', () => {
  const all = (o: unknown): string[] => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(all) : o && typeof o === 'object' ? Object.values(o).flatMap(all) : []);
  const copy = all({ landing: PRODUCT_SPEC.positioning.landing, cv: PRODUCT_SPEC.positioning.cvPreview, review: PRODUCT_SPEC.positioning.applicationReview, premium: PRODUCT_SPEC.positioning.premiumComparison, fine: PRODUCT_SPEC.positioning.finePrintAz });
  it('uses the Harvard template wording only as "based on the template", with no endorsement', () => {
    const joined = copy.join(' ');
    expect(joined).toContain('Harvard CV şablonu əsasında hazırlanır');
    expect(joined).toMatch(/Harvard Universiteti ilə əlaqə, təsdiq və ya sertifikat yoxdur/);
    for (const c of copy.filter((s) => /harvard/i.test(s) && !/yoxdur/i.test(s))) expect(c).not.toMatch(/təsdiqli|sertifikatlı|rəsmi|tərəfdaş|approved|certified|official/i);
  });
  it('promises no interview, hiring, percentage, ratio or ATS score, and names the human review', () => {
    for (const c of copy) {
      expect(c).not.toMatch(/\d+\s*%|%\s*\d|dəfə daha|faiz/i);
      for (const claim of PRODUCT_SPEC.forbiddenClaims) expect(c.toLowerCase()).not.toContain(claim.toLowerCase());
    }
    expect(copy.join(' ')).toContain('təsdiq');
    expect(PRODUCT_SPEC.positioning.premiumComparison.az).toContain('vəd edilmir');
    expect(PRODUCT_SPEC.positioning.needsEvidenceBeforeClaiming).toEqual(expect.arrayContaining(['any percentage or ratio of improvement']));
  });
});

describe('PRODUCT_CONFIG_JSON', () => {
  const cfg = (v: unknown) => loadProductConfig({ PRODUCT_CONFIG_JSON: typeof v === 'string' ? v : JSON.stringify(v) });
  it('accepts known prices and limits', () => {
    expect(cfg({ prices: { PREMIUM: 9.5 }, limits: { 'candidate.plus.documents.generations': 40, 'candidate.free.saved.jobs': null } })).toEqual({ prices: { PREMIUM: 9.5 }, limits: { 'candidate.plus.documents.generations': 40, 'candidate.free.saved.jobs': null } });
  });
  it.each([
    ['invalid JSON', '{nope'],
    ['an array', '[]'],
    ['an unknown section', { discounts: {} }],
    ['an unknown price key', { prices: { PLATINUM: 5 } }],
    ['a zero price', { prices: { PREMIUM: 0 } }],
    ['a negative price', { prices: { PREMIUM: -3 } }],
    ['a string price', { prices: { PREMIUM: '9' } }],
    ['an unknown limit key', { limits: { 'candidate.premium.nothing': 1 } }],
    ['a fractional limit', { limits: { 'candidate.plus.documents.generations': 2.5 } }],
    ['a negative limit', { limits: { 'candidate.plus.documents.generations': -1 } }],
  ])('fails loudly on %s', (_label, value) => {
    expect(() => cfg(value)).toThrow(/PRODUCT_CONFIG_JSON/);
  });
});

describe('Plus and Premium purchase eligibility', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const build = () => {
    delete process.env.DODO_PAYMENTS_API_KEY;
    delete process.env.PAYMENTS_ENABLED;
    return new BillingService({ user: { findUnique: jest.fn().mockResolvedValue({ id: 'u', email: 'a@b.c' }) } } as any, { capture: jest.fn() } as any);
  };
  it('lists the approved prices (Plus 8, Premium 50 AZN) and is purchasable in local mock mode', async () => {
    delete process.env.PRODUCT_CONFIG_JSON;
    const plans = build().getPlans() as any[];
    expect(plans.find((p) => p.id === 'plus')).toMatchObject({ price: 8, currency: 'AZN', purchasable: true, matchesPerDay: 1, matchesPerMonth: null });
    expect(plans.find((p) => p.id === 'premium')).toMatchObject({ price: 50, currency: 'AZN', purchasable: true, matchesPerDay: 5, matchesPerMonth: null });
    expect((await build().createCheckoutSession('u', 'plus')).url).toContain('checkout=success&mock=1');
  });
  it('with a real provider key and no provider product the plan is listed but not purchasable, and checkout refuses it', async () => {
    delete process.env.PRODUCT_CONFIG_JSON;
    Object.assign(process.env, { DODO_PAYMENTS_API_KEY: 'fixture_not_a_real_key.aaaa1111', DODO_ENV: 'test_mode', DODO_PRODUCT_ID_BASIC: 'pdt_b', DODO_PRODUCT_ID_STANDARD: 'pdt_s', DODO_PRODUCT_ID_UNLIMITED: 'pdt_u' });
    delete process.env.DODO_PRODUCT_ID_PLUS; delete process.env.DODO_PRODUCT_ID_PREMIUM;
    const service = new BillingService({ user: { findUnique: jest.fn() } } as any, { capture: jest.fn() } as any); // boots: the approved prices alone do not demand products
    for (const id of ['plus', 'premium']) {
      const plan: any = service.getPlans().find((p) => p.id === id);
      expect(plan.purchasable).toBe(false);
      expect('dodoProductId' in plan).toBe(false);
      await expect(service.createCheckoutSession('u', id)).rejects.toThrow(ServiceUnavailableException);
    }
  });
  it('a configured provider product makes exactly that plan purchasable', () => {
    delete process.env.PRODUCT_CONFIG_JSON;
    Object.assign(process.env, { DODO_PAYMENTS_API_KEY: 'fixture_not_a_real_key.aaaa1111', DODO_ENV: 'test_mode', DODO_PRODUCT_ID_BASIC: 'pdt_b', DODO_PRODUCT_ID_STANDARD: 'pdt_s', DODO_PRODUCT_ID_UNLIMITED: 'pdt_u', DODO_PRODUCT_ID_PLUS: 'pdt_plus' });
    delete process.env.DODO_PRODUCT_ID_PREMIUM;
    const plans = new BillingService({} as any, { capture: jest.fn() } as any).getPlans() as any[];
    expect(plans.find((p) => p.id === 'plus')).toMatchObject({ purchasable: true, dodoProductId: 'pdt_plus' });
    expect(plans.find((p) => p.id === 'premium').purchasable).toBe(false);
  });
  it('an operator price override wins and then requires its provider product at startup with a real key', () => {
    process.env.PRODUCT_CONFIG_JSON = JSON.stringify({ prices: { PREMIUM: 12 } });
    expect((build().getPlans() as any[]).find((p) => p.id === 'premium')).toMatchObject({ price: 12, purchasable: true });
    Object.assign(process.env, { DODO_PAYMENTS_API_KEY: 'fixture_not_a_real_key.aaaa1111', DODO_ENV: 'live_mode', DODO_PRODUCT_ID_BASIC: 'pdt_b', DODO_PRODUCT_ID_STANDARD: 'pdt_s', DODO_PRODUCT_ID_UNLIMITED: 'pdt_u' });
    delete process.env.DODO_PRODUCT_ID_PREMIUM;
    expect(() => new BillingService({} as any, { capture: jest.fn() } as any)).toThrow(/DODO_PRODUCT_ID_PREMIUM/);
  });
});
