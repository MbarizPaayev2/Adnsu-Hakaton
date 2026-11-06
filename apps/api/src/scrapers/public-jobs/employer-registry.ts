import targets from './employers-100.json';

export interface EmployerTarget {
  id: string; name: string; sector: string; priority: number; websiteCandidate: string;
  careerUrl: string | null; evidence: string; adapter: string | null;
}

/**
 * A curated target list, not a revenue/employment ranking or a claim of working coverage. The file is still called employers-100.json: it holds the 100
 * companies originally requested PLUS employers added later after their own career source was verified. Every addition must be declared here, so the
 * list can only grow on purpose (audit-employer-sources.spec.ts pins the original 100 and requires each addition to be verified).
 */
export const EMPLOYER_TARGETS: readonly EmployerTarget[] = targets;

/** Employers added after the original 100, each with a verified official career source. A new employer is added here and to the JSON, never only to the JSON. */
export const ADDED_VERIFIED_EMPLOYERS: readonly string[] = ['xsolla', 'avrora', 'alumil', 'fugro', 'supportyourapp', 'wolt'];

export function validateEmployerRegistry(entries: readonly EmployerTarget[] = EMPLOYER_TARGETS) {
  const ids = new Set<string>();
  for (const row of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || ids.has(row.id) || !row.name || !row.sector || ![1, 2].includes(row.priority)) throw new Error('Invalid or repeated employer');
    ids.add(row.id);
    for (const input of [row.websiteCandidate, row.careerUrl].filter(Boolean)) {
      const url = new URL(input!);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|\d)/i.test(url.hostname)) throw new Error('Invalid employer public URL');
    }
  }
}
