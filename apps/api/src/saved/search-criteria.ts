import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { catalogueOptions } from '../jobs/job-catalogue.service';
import { foldText } from '../jobs/job-location.util';

/** The only fields a saved search may hold: exactly the public catalogue's filters (no URL, no SQL, no free-form keys). */
export const SEARCH_KEYS = ['q', 'location', 'category', 'source', 'company', 'work', 'experience', 'sort'] as const;
export type SearchCriteria = Partial<Record<(typeof SEARCH_KEYS)[number], string>>;

const DEFAULTS: Record<string, string> = { category: 'all', source: 'all', work: 'all', experience: 'all', sort: 'newest' };

/**
 * Validates with the catalogue's own parser and returns canonical criteria: trimmed, whitespace-collapsed, defaults removed. Rejects unknown keys,
 * non-string values and an empty search (which would just be "all jobs"). Throws 400 with an Azerbaijani message.
 */
export function normalizeSearchCriteria(input: unknown): SearchCriteria {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Axtarış meyarları yanlışdır');
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(SEARCH_KEYS as readonly string[]).includes(key)) throw new BadRequestException('Axtarış meyarlarında dəstəklənməyən sahə var');
  const clean: Record<string, string> = {};
  for (const key of SEARCH_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') throw new BadRequestException('Axtarış meyarları yanlışdır');
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (collapsed) clean[key] = collapsed;
  }
  catalogueOptions(clean); // 400 on anything the public catalogue would reject (lengths, unknown category/source/work/experience, sort)
  const criteria: SearchCriteria = {};
  for (const key of SEARCH_KEYS) {
    const value = clean[key];
    if (value === undefined || value === DEFAULTS[key]) continue;
    criteria[key] = value;
  }
  if (!Object.keys(criteria).filter((k) => k !== 'sort').length) throw new BadRequestException('Ən azı bir axtarış meyarı seçin');
  return criteria;
}

/** Stable identity of a search: folded text values, fixed key order. Two searches that differ only in case/accents/spacing are one. */
export function searchFingerprint(criteria: SearchCriteria): string {
  const folded = SEARCH_KEYS.filter((k) => criteria[k] !== undefined).map((k) => [k, k === 'q' || k === 'location' || k === 'company' ? foldText(criteria[k]) : criteria[k]]);
  return createHash('sha256').update(JSON.stringify(folded)).digest('hex');
}

export function defaultSearchName(criteria: SearchCriteria): string {
  const parts = [criteria.q, criteria.company, criteria.location, criteria.category, criteria.work, criteria.experience, criteria.source].filter(Boolean) as string[];
  return parts.join(' · ').slice(0, 80) || 'Axtarış';
}
