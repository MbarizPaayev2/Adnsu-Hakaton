/**
 * AISE product and entitlement specification: the single source of truth for what each offer includes.
 *
 * STATUS: PROPOSAL. Every number below is a provisional choice for the founder to confirm; none is a commitment to customers. Prices are
 * deliberately UNSET (null): until a price is configured (`PRODUCT_CONFIG_JSON`, see apps/api/src/billing/product-config.ts) the offer cannot be
 * purchased. Costly quotas (anything that spends model or provider money) are flagged `costly` and are configurable, never hard-coded in the UI.
 *
 * Both the API and the web read the EFFECTIVE values from the API (`GET /billing/catalogue`, `GET /billing/entitlements`); they must not copy
 * numbers from this file into screens.
 *
 * Legacy plans (BASIC, STANDARD, Limitsiz) keep their existing meaning (match quota, tailoring included per match, digests); they are listed here
 * so that the retention features below are additive for them and nothing they already have is reinterpreted.
 */
export const PRODUCT_SPEC_VERSION = '2026-10-12.1';

export type OfferAudience = 'candidate' | 'employer';
export type QuotaPeriod = 'day' | 'month' | 'lifetime' | 'per_match';

/** One feature as an offer grants it. `limit: null` means "no stated limit" and is never promised in copy as unlimited provider usage. */
export interface FeatureGrant {
  enabled: boolean;
  limit?: number | null;
  period?: QuotaPeriod;
  /** Spends model/provider money: always bounded, always configurable, counted in `UsageCounter`. */
  costly?: boolean;
  /** Not built yet / deliberately off: the UI must show it as unavailable, not hide the reason. */
  availability?: 'available' | 'planned' | 'disabled';
  note?: string;
  /** Transparent security/rate protections that apply even when there is no monthly cap. */
  protections?: { concurrent?: number; perHour?: number };
}

export interface OfferSpec {
  id: string;
  audience: OfferAudience;
  /** Prisma SubscriptionPlan value for candidate offers that map to one (employer plans are company-owned and map to no subscription plan). */
  plan?: 'FREE' | 'BASIC' | 'STANDARD' | 'Limitsiz' | 'PREMIUM' | 'PLUS';
  legacy?: boolean;
  label: string;
  /** Environment key suffix for the provider product id (e.g. PREMIUM -> DODO_PRODUCT_ID_PREMIUM). */
  priceKey?: string;
  /** Approved list price (AZN per month). An operator override in PRODUCT_CONFIG_JSON wins; the offer is still only purchasable with a provider product. */
  defaultPrice?: number;
  features: Record<string, FeatureGrant>;
}

const on = (extra: Partial<FeatureGrant> = {}): FeatureGrant => ({ enabled: true, availability: 'available', ...extra });
const off = (note?: string, availability: FeatureGrant['availability'] = 'disabled'): FeatureGrant => ({ enabled: false, availability, note });

/** Features every candidate has: public discovery and tracking are never paywalled. */
const CANDIDATE_BASE = {
  'discovery.public_jobs': on(),
  'applications.tracking': on(),
  'email.automation': off('automatic e-mail applications are part of Premium'),
  'profile.cv_tools': on({ note: 'basic profile and CV tools' }),
  'alerts.in_app': on(),
  'alerts.email_digest': on({ limit: 1, period: 'day', note: 'one digest a day at most' }),
};

export const PRODUCT_SPEC = {
  version: PRODUCT_SPEC_VERSION,
  status: 'proposal' as const,

  /** Claims no offer, label or screen may make. A test scans the catalogue copy for these. */
  forbiddenClaims: [
    'interview guaranteed',
    'guaranteed interview',
    'hiring guaranteed',
    'unlimited auto-apply',
    'unlimited external apply',
    'unlimited AI',
    'ATS score',
    'ATS-guaranteed',
    'Harvard certified',
    'Harvard approved',
    'müsahibə zəmanəti',
    'işə qəbul zəmanəti',
    'ATS balı',
    'Harvard təsdiqli',
    'Harvard sertifikatlı',
  ],

  /**
   * Short, truthful value copy for the screens (Azerbaijani). The benefit is stronger applications; it is described through what the product
   * actually does: a clearly structured CV on the Harvard CV template, the vacancy's relevant experience and skills emphasised from the
   * candidate's own facts, a factual cover letter (planned), the candidate reviewing every change, and the right document and application
   * method. It never promises an interview, never states an improvement figure, and never implies Harvard's involvement beyond the template.
   * Evidence needed before any stronger claim: see docs/cv-harvard-template-evidence-2026-10-03.md and the outcome counts it describes.
   */
  positioning: {
    landing: { headlineAz: 'İş müraciətlərini avtomatlaşdır. Vaxtın özünə qalsın.', subAz: 'CV-niz Harvard CV şablonu əsasında hazırlanır; hər dəyişikliyi siz yoxlayıb təsdiq edirsiniz.' },
    cvPreview: { az: 'Harvard CV şablonu əsasında hazırlanmış. Yalnız profilinizdəki faktlar istifadə olunur; hər dəyişikliyi siz təsdiq edirsiniz.' },
    applicationReview: { az: 'Göndərməzdən əvvəl yoxlayın: düzgün CV versiyası, məktub və müraciət üsulu. Sizin təsdiqiniz olmadan heç nə göndərilmir.' },
    premiumComparison: { az: 'Premium: təkrarlanan müraciət işini sizin yerinizə görən agent. Uyğun e-poçt elanları üçün müraciəti hazırlayır, siz təsdiqləyəndə göndərir; aylıq sənəd limiti yoxdur, daha çox e-poçt müraciəti və brauzer köməkçisi var. Müsahibə və ya işə qəbul vəd edilmir.' },
    finePrintAz: 'Harvard CV şablonunun quruluşundan istifadə olunur; Harvard Universiteti ilə əlaqə, təsdiq və ya sertifikat yoxdur.',
    /** Claims that need measured evidence first (candidate- and employer-confirmed interview outcomes tracked separately). */
    needsEvidenceBeforeClaiming: ['any change in interview invitations', 'any percentage or ratio of improvement', 'ATS compatibility or score', 'any number of hours or minutes saved (needs the manual-vs-AISE comparison with its sample size)'],
  },

  candidate: {
    offers: {
      free: {
        id: 'free', audience: 'candidate', plan: 'FREE', label: 'Free',
        features: {
          ...CANDIDATE_BASE,
          'saved.jobs': on({ limit: 200, period: 'lifetime' }),
          'saved.searches': on({ limit: 3, period: 'lifetime' }),
          'follows.companies': on({ limit: 20, period: 'lifetime' }),
          'alerts.instant': off('bounded instant alerts are a Premium preference'),
          'cv.versions': on({ limit: 1, period: 'lifetime', note: 'one base CV' }),
          // Approved 2026-10-04: documents are governed by the shared monthly allowance below; the older per-match counters stay as shadow metering.
          'documents.generations': on({ limit: 5, period: 'month', costly: true, note: 'CVs, resumes and motivation letters share this allowance; one successfully generated document uses one generation; editing, reviewing, downloading and exporting an existing document is free' }),
          'email.applications': on({ limit: 5, period: 'month', note: 'applications sent by e-mail through AISE; separate from the document allowance; a send that definitively fails does not use a unit' }),
          'tailored.cv': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'tailored.cover_letter': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'preferences.rich': off('premium'),
          'applications.advanced_preparation': off('premium', 'planned'),
          'browser.applications': off('the browser assistant is part of Premium'),
        },
      },
      plus: {
        id: 'plus', audience: 'candidate', plan: 'PLUS', label: 'Plus', priceKey: 'PLUS', defaultPrice: 8,
        features: {
          ...CANDIDATE_BASE,
          'saved.jobs': on({ limit: 1000, period: 'lifetime' }),
          'saved.searches': on({ limit: 20, period: 'lifetime' }),
          'follows.companies': on({ limit: 100, period: 'lifetime' }),
          'alerts.instant': on({ limit: 10, period: 'day', note: 'bounded: at most this many instant alerts a day' }),
          'cv.versions': on({ limit: 5, period: 'lifetime', note: 'additional CV versions' }),
          'documents.generations': on({ limit: 30, period: 'month', costly: true, note: 'CVs, resumes and motivation letters share this allowance; one successfully generated document uses one generation; editing, reviewing, downloading and exporting an existing document is free' }),
          'email.applications': on({ limit: 30, period: 'month', note: 'applications sent by e-mail through AISE; separate from the document allowance; a send that definitively fails does not use a unit' }),
          'tailored.cv': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'tailored.cover_letter': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'preferences.rich': on(),
          'applications.advanced_preparation': on({ availability: 'planned', note: 'checklist and document-version review before applying' }),
          'browser.applications': off('the browser assistant is part of Premium'),
        },
      },
      premium: {
        id: 'premium', audience: 'candidate', plan: 'PREMIUM', label: 'Premium', priceKey: 'PREMIUM', defaultPrice: 50,
        features: {
          ...CANDIDATE_BASE,
          'saved.jobs': on({ limit: 1000, period: 'lifetime' }),
          'saved.searches': on({ limit: 20, period: 'lifetime' }),
          'follows.companies': on({ limit: 100, period: 'lifetime' }),
          'alerts.instant': on({ limit: 10, period: 'day', note: 'bounded: at most this many instant alerts a day' }),
          'cv.versions': on({ limit: 5, period: 'lifetime', note: 'additional CV versions' }),
          'documents.generations': on({ limit: null, period: 'month', costly: true, protections: { concurrent: 3, perHour: 30 }, note: 'no monthly document cap; transparent protections only: at most 3 generations running at once and 30 started per hour. CVs, resumes and motivation letters share this allowance; one successfully generated document uses one generation; editing, reviewing, downloading and exporting an existing document is free' }),
          'email.automation': on({ note: 'explicit opt-in, candidate-approved CV and message, role/location rules; uses the normal e-mail allowance' }),
          'email.applications': on({ limit: 100, period: 'month', note: 'applications sent by e-mail through AISE; separate from the document allowance; a send that definitively fails does not use a unit' }),
          'tailored.cv': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'tailored.cover_letter': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
          'preferences.rich': on(),
          'applications.advanced_preparation': on({ availability: 'planned', note: 'checklist and document-version review before applying' }),
          // Included in the existing Premium price. A defined, enforced cap: every application is approved by the candidate and counted once, when its
          // submission is permitted; document generations and e-mail applications are separate allowances.
          'browser.applications': on({ limit: 50, period: 'month', note: 'applications the browser assistant submits for you, each approved by you; separate from the document and e-mail allowances' }),
        },
      },
      // Existing plans, untouched in meaning. Retention features are additive for them (same as Premium's saved/follow/alert limits);
      // tailoring and match quotas stay exactly as they are today (PLAN_MATCH_QUOTAS, included per match).
      legacy_basic: legacyOffer('legacy_basic', 'BASIC', 'Basic'),
      legacy_standard: legacyOffer('legacy_standard', 'STANDARD', 'Standard'),
      legacy_limitsiz: legacyOffer('legacy_limitsiz', 'Limitsiz', 'Limitsiz'),
    } as Record<string, OfferSpec>,
    /** What no candidate offer may ever grant or imply. */
    never: ['interview or hiring promise', 'unrestricted external auto-apply', 'unrestricted provider usage (fair-use protections always apply)'],
  },

  employer: {
    offers: {
      // Approved employer plans (docs/employer-plans-2026-10-11.md). Company-owned, enforced by the server; candidate plans are a separate subject.
      starter_trial: {
        id: 'starter_trial', audience: 'employer', label: 'Sınaq',
        features: {
          'vacancies.active': on({ limit: 1, period: 'lifetime', note: 'first vacancy of a verified company; 14 days from actual publication; no card; once per company' }),
          'applications.review': on({ limit: null, note: 'applications received stay accessible after the trial ends' }),
          'team.seats': on({ limit: 1 }),
          'candidates.discovery': off('requires the candidate-consent workflow, which does not exist yet', 'planned'),
        },
      },
      single_job: {
        id: 'single_job', audience: 'employer', label: 'Tək vakansiya', priceKey: 'EMPLOYER_SINGLE_JOB', defaultPrice: 20,
        features: {
          'vacancies.active': on({ limit: 1, period: 'per_match', note: 'one vacancy for 30 days from publication; one-time payment, no automatic renewal; another 30 days only by an explicit new purchase' }),
          'applications.review': on({ limit: null }),
          'team.seats': on({ limit: 1 }),
          'candidates.discovery': off('requires the candidate-consent workflow', 'planned'),
        },
      },
      business: {
        // PROPOSED future benefit (not built, not offered, not advertised): three 7-day vacancy boosts per month. Recorded in docs/employer-plans-2026-10-11.md.
        id: 'business', audience: 'employer', label: 'Biznes', priceKey: 'EMPLOYER_BUSINESS', defaultPrice: 100,
        features: {
          'vacancies.active': on({ limit: null, note: 'no count cap for legitimate vacancies of one verified company; anti-spam, duplicate and agency-resale rules apply; listings are reconfirmed at least every 60 days' }),
          'applications.review': on({ limit: null }),
          'team.seats': on({ limit: 1 }),
          'candidates.discovery': off('requires the candidate-consent workflow', 'planned'),
        },
      },
      enterprise: {
        id: 'enterprise', audience: 'employer', label: 'Enterprise',
        features: {
          'vacancies.active': on({ limit: null, note: 'configured per contract' }),
          'applications.review': on({ limit: null }),
          'team.seats': on({ limit: null, note: 'configured per contract' }),
          'candidates.discovery': off('requires the candidate-consent workflow', 'planned'),
        },
      },
    } as Record<string, OfferSpec>,
    addons: {
      promoted_listing: { id: 'promoted_listing', label: 'Promoted listing', priceKey: 'EMPLOYER_PROMOTED', mustBeLabelled: true, labelAz: 'Promosyon' },
    },
    /** Employer access to candidates is only ever through an explicit candidate-consented workflow; imported CVs are never exposed or sold. */
    invariants: {
      importedCvExposure: 'never',
      candidateContact: 'only through an explicit candidate-consented workflow (not built)',
    },
  },
};

function legacyOffer(id: string, plan: 'BASIC' | 'STANDARD' | 'Limitsiz', label: string): OfferSpec {
  return {
    id, audience: 'candidate', plan, legacy: true, label,
    features: {
      ...CANDIDATE_BASE,
      'saved.jobs': on({ limit: 1000, period: 'lifetime' }),
      'saved.searches': on({ limit: 20, period: 'lifetime' }),
      'follows.companies': on({ limit: 100, period: 'lifetime' }),
      'alerts.instant': on({ limit: 10, period: 'day' }),
      'cv.versions': on({ limit: plan === 'Limitsiz' ? null : 1, period: 'lifetime', note: plan === 'Limitsiz' ? 'multiple base CVs, as today' : 'one base CV, as today' }),
      // Legacy customers keep what they have: documents are not capped monthly (only the same transparent protections apply).
      'documents.generations': on({ limit: null, period: 'month', costly: true, protections: { concurrent: 3, perHour: 30 }, note: 'legacy plan: no monthly document cap, as before' }),
      // Legacy customers have never had a monthly e-mail cap; only the daily abuse limit applies, as before.
      'email.applications': on({ limit: null, period: 'month', note: 'legacy plan: no monthly e-mail application cap, as before' }),
      'tailored.cv': on({ limit: null, period: 'per_match', costly: true, note: 'included per match, as today' }),
      'tailored.cover_letter': on({ limit: null, period: 'per_match', costly: true, note: 'counted in documents.generations' }),
      'preferences.rich': on(),
      'applications.advanced_preparation': off('premium', 'planned'),
      'browser.applications': off('the browser assistant is part of Premium'),
    },
  };
}

export type ProductSpec = typeof PRODUCT_SPEC;
