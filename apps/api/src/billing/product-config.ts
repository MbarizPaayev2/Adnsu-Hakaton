import { PRODUCT_SPEC, type FeatureGrant, type OfferSpec } from '@aise/shared-types';

/**
 * Operator configuration of prices and costly quotas: `PRODUCT_CONFIG_JSON`, for example
 *   {"prices":{"PREMIUM":12},"limits":{"candidate.premium.tailored.cv":25}}
 * Prices are AZN per month (candidate) or per unit (employer) and default to UNSET, which keeps the offer unpurchasable. Limits override a feature's `limit`
 * (an integer ≥ 0, or null for "no stated limit"). Unknown keys, wrong types and negative numbers fail loudly at startup instead of being ignored.
 */
export interface ProductConfig {
  prices: Record<string, number>;
  limits: Record<string, number | null>;
}

export function priceKeys(): string[] {
  const keys: string[] = [];
  for (const group of [PRODUCT_SPEC.candidate.offers, PRODUCT_SPEC.employer.offers] as Record<string, OfferSpec>[]) {
    for (const o of Object.values(group)) if (o.priceKey) keys.push(o.priceKey);
  }
  keys.push(PRODUCT_SPEC.employer.addons.promoted_listing.priceKey);
  return keys;
}

export function limitKey(audience: string, offerId: string, feature: string): string {
  return `${audience}.${offerId}.${feature}`;
}

function limitKeys(): Set<string> {
  const out = new Set<string>();
  for (const group of [PRODUCT_SPEC.candidate.offers, PRODUCT_SPEC.employer.offers] as Record<string, OfferSpec>[]) {
    for (const o of Object.values(group)) for (const [f, g] of Object.entries(o.features)) if (g.limit !== undefined) out.add(limitKey(o.audience, o.id, f));
  }
  return out;
}

export function loadProductConfig(env: Record<string, string | undefined> = process.env): ProductConfig {
  const raw = env.PRODUCT_CONFIG_JSON;
  const config: ProductConfig = { prices: {}, limits: {} };
  if (!raw || !raw.trim()) return config;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PRODUCT_CONFIG_JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PRODUCT_CONFIG_JSON must be an object');
  for (const k of Object.keys(parsed)) if (k !== 'prices' && k !== 'limits') throw new Error(`PRODUCT_CONFIG_JSON has an unknown section "${k}"`);
  const knownPrices = new Set(priceKeys());
  for (const [k, v] of Object.entries(parsed.prices ?? {})) {
    if (!knownPrices.has(k)) throw new Error(`PRODUCT_CONFIG_JSON prices: unknown price key "${k}"`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000) throw new Error(`PRODUCT_CONFIG_JSON prices.${k} must be a positive number`);
    config.prices[k] = v;
  }
  const knownLimits = limitKeys();
  for (const [k, v] of Object.entries(parsed.limits ?? {})) {
    if (!knownLimits.has(k)) throw new Error(`PRODUCT_CONFIG_JSON limits: unknown limit key "${k}"`);
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0)) throw new Error(`PRODUCT_CONFIG_JSON limits.${k} must be an integer ≥ 0 or null`);
    config.limits[k] = v as number | null;
  }
  return config;
}

/** A feature grant with the operator's limit override applied. */
export function effectiveGrant(offer: OfferSpec, feature: string, config: ProductConfig): FeatureGrant | undefined {
  const grant = offer.features[feature];
  if (!grant) return undefined;
  const key = limitKey(offer.audience, offer.id, feature);
  return key in config.limits ? { ...grant, limit: config.limits[key] } : grant;
}
