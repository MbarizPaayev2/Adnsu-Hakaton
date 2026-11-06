import type { CompanyRef } from './contract';

const LEGAL_SUFFIXES = new Set(['mmc', 'asc', 'qsc', 'llc', 'ltd', 'llp', 'ojsc', 'cjsc', 'inc', 'gmbh', 'plc', 'qk', 'şirkəti', 'sirketi']);

/** Alias-free key: "SOCAR" , "Socar MMC" and "S.O.C.A.R." collapse together. */
export function companyKey(name: string): string {
  const cleaned = name
    .toLocaleLowerCase('az')
    .replace(/[“”"'`.,()]/g, ' ')
    .replace(/[-_/&]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !LEGAL_SUFFIXES.has(word));
  // Dotted initialisms ("S.O.C.A.R.") arrive as single letters; join them.
  const joined: string[] = [];
  let letters = '';
  for (const word of cleaned) {
    if (word.length === 1) { letters += word; continue; }
    if (letters) { joined.push(letters); letters = ''; }
    joined.push(word);
  }
  if (letters) joined.push(letters);
  return joined.join(' ');
}

/**
 * Deduplicate companies by their stable backend id.
 * Distinct employers are never merged solely by normalized name, and
 * vacancy counts are never artificially summed across records.
 */
export function dedupeCompanies(companies: CompanyRef[]): CompanyRef[] {
  const byId = new Map<string, CompanyRef>();
  for (const company of companies) {
    if (!company.id) continue;
    if (!byId.has(company.id)) {
      byId.set(company.id, company);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

export function searchCompanies(companies: CompanyRef[], query: string): CompanyRef[] {
  const q = query.trim().toLocaleLowerCase('az');
  if (!q) return companies;
  return companies.filter((c) =>
    c.name.toLocaleLowerCase('az').includes(q) ||
    (c.location && c.location.toLocaleLowerCase('az').includes(q))
  );
}

/** Two-letter initials for a missing logo. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w) && !LEGAL_SUFFIXES.has(w.toLocaleLowerCase('az')));
  if (!words.length) return '?';
  const letters = words.length === 1 ? [...words[0]].filter((c) => /\p{L}/u.test(c)).slice(0, 2) : words.slice(0, 2).map((w) => [...w].find((c) => /\p{L}/u.test(c)) ?? '');
  return letters.join('').toLocaleUpperCase('az');
}
