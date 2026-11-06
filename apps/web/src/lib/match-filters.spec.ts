import { describe, expect, it } from 'vitest';
import {
  EMPTY_CRITERIA,
  activeCriteriaCount,
  applyMatchCriteria,
  locationOf,
  cityOptions,
  companyOptions,
  matchesQuery,
  normalizeAz,
  skillSuggestions,
  type FilterableMatch,
} from './match-filters';

const m = (id: string, title: string, company: string, location: string, keywords: string[] = [], status = 'NEW', gaps: string[] = []): FilterableMatch => ({
  id, status, details: { matchedKeywords: keywords, gaps }, job: { title, company, location },
});

const data = [
  m('1', 'İdarəetmə mühasibi', 'Kapital Bank', 'Bakı, Nərimanov', ['Excel', 'İFRS']),
  m('2', 'Backend Developer', 'Azərcell Telekom MMC', 'Bakı', ['TypeScript', 'PostgreSQL'], 'VIEWED', ['Kubernetes']),
  m('3', 'Satış meneceri', 'Kapital Bank', 'Gəncə', ['CRM'], 'APPLIED'),
  m('4', 'Sistem inzibatçısı', 'ASAN Xidmət', '', ['Linux']),
  { id: '5', status: 'NEW', details: { matchedKeywords: ['Figma'] }, vacancy: { title: 'UI dizayner', requirements: 'Figma və prototipləmə', location: 'Sumqayıt', company: { name: 'Native Employer' } } } as FilterableMatch,
];

describe('match filters', () => {
  it('normalises Azerbaijani casing (İ/I, ı/i) and whitespace', () => {
    expect(normalizeAz('  İDARƏETMƏ   MÜHASİBİ ')).toBe('idarəetmə mühasibi');
    expect(normalizeAz('IŞIQ')).toBe('ışıq');
    expect(matchesQuery(data[0], 'MÜHASİB')).toBe(true);
    expect(matchesQuery(data[0], 'idarəetmə')).toBe(true);
  });
  it('searches title and matched-skill evidence, never the missing gaps', () => {
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, query: 'typescript' }).map((x) => x.id)).toEqual(['2']);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, query: 'kubernetes' })).toHaveLength(0);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, query: 'figma' }).map((x) => x.id)).toEqual(['5']);
  });
  it('requires every query word to be present', () => {
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, query: 'backend postgresql' }).map((x) => x.id)).toEqual(['2']);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, query: 'backend excel' })).toHaveLength(0);
  });
  it('combines company, city, status and query predictably', () => {
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, company: 'Kapital Bank' }).map((x) => x.id)).toEqual(['1', '3']);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, company: 'Kapital Bank', city: 'Gəncə' }).map((x) => x.id)).toEqual(['3']);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, company: 'Kapital Bank', status: 'applied', query: 'crm' }).map((x) => x.id)).toEqual(['3']);
    expect(applyMatchCriteria(data, { ...EMPTY_CRITERIA, company: 'Kapital Bank', city: 'Sumqayıt' })).toHaveLength(0);
  });
  it('uses the posting location as written, drops only a trailing country, and never guesses a city', () => {
    const m = (location: string | undefined) => ({ id: 'x', status: 'NEW', job: { title: 't', company: 'c', location } });
    expect(locationOf(m('Bakı'))).toBe('Bakı');
    expect(locationOf(m('Bakı, Azərbaycan'))).toBe('Bakı');
    expect(locationOf(m('Bakı, Nərimanov rayonu'))).toBe('Bakı, Nərimanov rayonu'); // not cut at the first comma
    expect(locationOf(m('Bakı; Sumqayıt'))).toBe('Bakı; Sumqayıt'); // multi-location text stays whole
    expect(locationOf(m('Uzaqdan'))).toBe('Uzaqdan'); // a work arrangement shown as written, not a city
    expect(locationOf(m('Azərbaycan'))).toBe(''); // country only: no usable location
    expect(locationOf(m(''))).toBe('');
    expect(locationOf(m(undefined))).toBe('');
    expect(applyMatchCriteria([m('Bakı'), m('Bakı, Azərbaycan'), m('Bakı, Nərimanov rayonu')], { ...EMPTY_CRITERIA, city: 'Bakı' })).toHaveLength(2);
  });
  it('builds sorted, de-duplicated options from the full dataset, including vacancy companies', () => {
    expect(companyOptions(data)).toEqual(['ASAN Xidmət', 'Azərcell Telekom MMC', 'Kapital Bank', 'Native Employer']);
  });
  it('offers only skills that exist in the data as suggestions, most frequent first', () => {
    const withRepeat = [...data, m('6', 'Mühasib', 'X', 'Bakı', ['Excel'])];
    const suggestions = skillSuggestions(withRepeat, 3);
    expect(suggestions[0]).toBe('Excel');
    expect(suggestions).toHaveLength(3);
    expect(skillSuggestions(data)).not.toContain('Kubernetes');
  });
  it('counts active criteria', () => {
    expect(activeCriteriaCount(EMPTY_CRITERIA)).toBe(0);
    expect(activeCriteriaCount({ status: 'new', query: ' x ', company: 'A', city: 'B' })).toBe(4);
    expect(activeCriteriaCount({ ...EMPTY_CRITERIA, query: '   ' })).toBe(0);
  });
});
