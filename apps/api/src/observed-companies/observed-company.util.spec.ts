import { groupCompanies, isObservedCompanyId, monogramOf, observedCompanyId, observedCompanyKey } from './observed-company.util';

const at = (iso: string) => new Date(iso);

describe('observed company identity', () => {
  it('derives one stable opaque id from the normalised name, whatever the spelling, legal suffix or case', () => {
    const id = observedCompanyId(observedCompanyKey('Azərbaycan Hava Yolları QSC'));
    expect(id).toMatch(/^oc_[0-9a-f]{16}$/);
    expect(observedCompanyId(observedCompanyKey('AZƏRBAYCAN HAVA YOLLARI'))).toBe(id);
    expect(observedCompanyId(observedCompanyKey('Azerbaycan Hava Yollari  MMC'))).toBe(id);
    expect(observedCompanyId(observedCompanyKey('Another Employer'))).not.toBe(id);
    expect(isObservedCompanyId(id)).toBe(true);
    expect(['oc_', 'oc_xyz', 'cmabc', 'oc_0123456789abcdef0'].some(isObservedCompanyId)).toBe(false);
  });
});

describe('monogramOf', () => {
  it('uses up to two initials, locale-aware, with a deterministic colour', () => {
    expect(monogramOf('SOCAR', 'socar').text).toBe('S');
    expect(monogramOf('Azercell Telecom', 'azercell telecom').text).toBe('AT');
    expect(monogramOf('ilk addım', 'ilk addim').text).toBe('İA'); // Azerbaijani dotted capital İ
    expect(monogramOf('Банк Москвы', 'bank').text).toBe('БМ');
    expect(monogramOf('— & —', 'x').text).toBe('?');
    expect(monogramOf('Beta', 'beta').color).toBe(monogramOf('Beta Ltd', 'beta').color);
    expect(monogramOf('Beta', 'beta').color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('groupCompanies', () => {
  it('merges spellings of one company and sources, keeps the most used spelling, and reports unkeyed postings separately', () => {
    const { companies, unkeyedPostings } = groupCompanies([
      { company: 'Alpha MMC', source: 'work', count: 3, lastSeenAt: at('2026-10-01T00:00:00Z') },
      { company: 'ALPHA', source: 'smartjob', count: 1, lastSeenAt: at('2026-10-03T00:00:00Z') },
      { company: 'Alpha MMC', source: 'smartjob', count: 2, lastSeenAt: at('2026-10-02T00:00:00Z') },
      { company: 'Beta', source: 'work', count: 2, lastSeenAt: at('2026-10-02T00:00:00Z') },
      { company: '— —', source: 'work', count: 4, lastSeenAt: at('2026-10-02T00:00:00Z') },
    ]);
    expect(unkeyedPostings).toBe(4);
    expect(companies).toHaveLength(2);
    const alpha = companies.find((c) => c.key === 'alpha')!;
    expect(alpha).toMatchObject({ name: 'Alpha MMC', aliases: ['ALPHA'], openCount: 6, lastObservedAt: at('2026-10-03T00:00:00Z') });
    expect(alpha.sources).toEqual([{ key: 'smartjob', count: 3 }, { key: 'work', count: 3 }]);
  });
});
