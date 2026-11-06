import { describe, expect, it } from 'vitest';
import { companyKey, dedupeCompanies, initialsOf, searchCompanies } from './companies';
import type { CompanyRef } from './contract';

describe('companyKey', () => {
  it('normalizes case, punctuation, and removes legal suffixes', () => {
    expect(companyKey('SOCAR MMC')).toBe('socar');
    expect(companyKey('S.O.C.A.R.')).toBe('socar');
    expect(companyKey('Pasha Bank ASC')).toBe('pasha bank');
    expect(companyKey('Kapital Bank QSC')).toBe('kapital bank');
    expect(companyKey('Azercell Telecom LLC')).toBe('azercell telecom');
  });

  it('handles Azerbaijani specific characters correctly', () => {
    expect(companyKey('MƏDƏNİYYƏT MMC')).toBe('mədəniyyət');
    expect(companyKey('İnnovasiya Şirkəti')).toBe('innovasiya');
  });
});

describe('dedupeCompanies', () => {
  it('deduplicates duplicate backend IDs without merging distinct employers or summing vacancies', () => {
    const list: CompanyRef[] = [
      { id: 'c-1', key: 'socar', name: 'SOCAR MMC', sourceLabel: 'test', openVacancies: 5 },
      { id: 'c-1', key: 'socar', name: 'SOCAR MMC (Duplicate entry)', sourceLabel: 'test', openVacancies: 5 },
      { id: 'c-2', key: 'socar', name: 'SOCAR Türkiyə', sourceLabel: 'test', openVacancies: 2 },
      { id: 'c-3', key: 'pasha bank', name: 'Paşa Bank ASC', sourceLabel: 'test', openVacancies: 10 },
    ];

    const deduped = dedupeCompanies(list);
    // Preserves 3 distinct employers (c-1, c-2, c-3), does NOT merge c-1 and c-2 or sum 5+2
    expect(deduped).toHaveLength(3);
    const socar1 = deduped.find((c) => c.id === 'c-1');
    const socar2 = deduped.find((c) => c.id === 'c-2');
    expect(socar1?.openVacancies).toBe(5);
    expect(socar2?.openVacancies).toBe(2);
  });
});

describe('initialsOf', () => {
  it('generates two-letter initials ignoring legal suffixes', () => {
    expect(initialsOf('SOCAR MMC')).toBe('SO');
    expect(initialsOf('Paşa Bank ASC')).toBe('PB');
    expect(initialsOf('Kapital Bank')).toBe('KB');
    expect(initialsOf('ABB')).toBe('AB');
    expect(initialsOf('')).toBe('?');
  });
});

describe('searchCompanies', () => {
  it('filters companies by partial or full name', () => {
    const list: CompanyRef[] = [
      { key: 'socar', name: 'SOCAR MMC', sourceLabel: 'test', openVacancies: 5 },
      { key: 'pasha bank', name: 'Paşa Bank ASC', sourceLabel: 'test', openVacancies: 10 },
    ];

    expect(searchCompanies(list, 'socar')).toHaveLength(1);
    expect(searchCompanies(list, 'bank')).toHaveLength(1);
    expect(searchCompanies(list, 'xyz')).toHaveLength(0);
  });
});
