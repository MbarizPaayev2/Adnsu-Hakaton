import { createHash } from 'node:crypto';
import { normalizeCompany } from '../jobs/job-dedup.util';

/** The identity of an observed company: the normalised name that cross-source deduplication and company follows already use. */
export const observedCompanyKey = (name: string | null | undefined): string => normalizeCompany(name);

/**
 * A stable, opaque public id derived from the key. It does not depend on database rows, import order or which source listed the company first,
 * so a page URL survives re-imports, closures and new sources. (If the name itself is changed by the employer the key, and so the id, changes.)
 */
export const observedCompanyId = (key: string): string => `oc_${createHash('sha256').update(`observed-company:v1:${key}`).digest('hex').slice(0, 16)}`;
export const isObservedCompanyId = (id: string): boolean => /^oc_[0-9a-f]{16}$/.test(id);

const PALETTE = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0e7490', '#4d7c0f', '#a21caf'];

/** What the page shows when there is no verified logo: up to two initials and a deterministic colour with sufficient contrast for white text. */
export function monogramOf(name: string, key: string): { text: string; color: string } {
  const words = name.normalize('NFC').split(/[\s\-–—_.,/&+()'"]+/u).filter((w) => /\p{L}|\p{N}/u.test(w));
  const initials = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? ''])
    .map((w) => [...w].find((c) => /\p{L}|\p{N}/u.test(c)) ?? '')
    .join('');
  const text = (initials || '?').toLocaleUpperCase('az').slice(0, 2);
  const hash = createHash('sha256').update(key).digest()[0];
  return { text, color: PALETTE[hash % PALETTE.length] };
}

export interface CompanyPosting { company: string; source: string; count: number; lastSeenAt: Date }

export interface GroupedCompany {
  key: string;
  id: string;
  /** The spelling used by most postings (ties: the shortest, then alphabetical). */
  name: string;
  aliases: string[];
  openCount: number;
  sources: { key: string; count: number }[];
  lastObservedAt: Date;
}

/** Groups per-spelling, per-source counts into companies. Postings whose name has no usable key are reported separately, never merged together. */
export function groupCompanies(rows: CompanyPosting[]): { companies: GroupedCompany[]; unkeyedPostings: number } {
  const byKey = new Map<string, CompanyPosting[]>();
  let unkeyedPostings = 0;
  for (const row of rows) {
    const key = observedCompanyKey(row.company);
    if (!key) { unkeyedPostings += row.count; continue; }
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const companies: GroupedCompany[] = [];
  for (const [key, group] of byKey) {
    const spellings = new Map<string, number>();
    const sources = new Map<string, number>();
    let last = group[0].lastSeenAt;
    for (const r of group) {
      spellings.set(r.company, (spellings.get(r.company) ?? 0) + r.count);
      sources.set(r.source, (sources.get(r.source) ?? 0) + r.count);
      if (r.lastSeenAt > last) last = r.lastSeenAt;
    }
    const ordered = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]));
    companies.push({
      key, id: observedCompanyId(key), name: ordered[0][0], aliases: ordered.slice(1).map(([n]) => n),
      openCount: group.reduce((n, r) => n + r.count, 0),
      sources: [...sources.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      lastObservedAt: last,
    });
  }
  return { companies, unkeyedPostings };
}
