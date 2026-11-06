/**
 * What the public landing may say about employer plans, read afresh from the server's own catalogue. Prices appear only for an offer the server marks
 * purchasable while payments are on; when plans are off or the server cannot be read, the landing says nothing about them.
 */
export interface EmployerPlansTeaser {
  trialDays: number;
  singleDays: number;
  /** AZN, or null when that offer cannot be purchased right now. */
  singlePrice: number | null;
  businessPrice: number | null;
}

export async function employerPlansTeaser(): Promise<EmployerPlansTeaser | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
    const [catalogueRes, statusRes] = await Promise.all([
      fetch(`${base}/billing/catalogue`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }),
      fetch(`${base}/billing/status`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }),
    ]);
    if (!catalogueRes.ok) return null;
    const catalogue = await catalogueRes.json();
    const plans = catalogue?.employer?.plans;
    if (plans?.enabled !== true) return null;
    const paymentsOn = statusRes.ok ? (await statusRes.json())?.paymentsEnabled === true : false;
    const offers: { id: string; price: number | null; purchasable: boolean }[] = Array.isArray(catalogue?.employer?.offers) ? catalogue.employer.offers : [];
    const priceOf = (id: string) => {
      const o = offers.find((x) => x.id === id);
      return paymentsOn && o?.purchasable === true && typeof o.price === 'number' ? o.price : null;
    };
    return { trialDays: Number(plans.trialDays) || 14, singleDays: Number(plans.singleDays) || 30, singlePrice: priceOf('single_job'), businessPrice: priceOf('business') };
  } catch {
    return null;
  }
}
