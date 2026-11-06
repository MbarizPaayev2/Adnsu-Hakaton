/**
 * What the public landing may say about candidate plans, read afresh from the server's catalogue: price and the allowances the plan grants
 * today. A value the server does not state is null and the landing leaves it out; nothing planned is presented as included.
 */
export interface CandidatePlanTeaser {
  id: 'free' | 'plus' | 'premium';
  price: number | null;
  /** Documents per month; null = no monthly cap; undefined = not stated. */
  documents?: number | null;
  emailApplications?: number | null;
  browserAssistant: boolean;
}

type Feature = { enabled?: boolean; availability?: string; limit?: number | null; period?: string };

export function teaserFromCatalogue(catalogue: unknown): CandidatePlanTeaser[] | null {
  const offers = (catalogue as { candidate?: { offers?: { id: string; legacy?: boolean; price: number | null; features?: Record<string, Feature> }[] } })?.candidate?.offers;
  if (!Array.isArray(offers)) return null;
  const allowance = (f: Feature | undefined) => {
    if (!f || f.enabled !== true || f.availability !== 'available') return undefined;
    if (f.limit === null) return null;
    return typeof f.limit === 'number' && f.period === 'month' ? f.limit : undefined;
  };
  const plans = (['free', 'plus', 'premium'] as const).map((id) => {
    const o = offers.find((x) => x.id === id && !x.legacy);
    if (!o) return null;
    const browser = o.features?.['browser.applications'];
    return {
      id,
      price: typeof o.price === 'number' ? o.price : null,
      documents: allowance(o.features?.['documents.generations']),
      emailApplications: allowance(o.features?.['email.applications']),
      browserAssistant: browser?.enabled === true && browser.availability === 'available',
    } satisfies CandidatePlanTeaser;
  });
  return plans.every(Boolean) ? (plans as CandidatePlanTeaser[]) : null;
}

export async function candidatePlansTeaser(): Promise<CandidatePlanTeaser[] | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
    const res = await fetch(`${base}/billing/catalogue`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    return res.ok ? teaserFromCatalogue(await res.json()) : null;
  } catch {
    return null;
  }
}
