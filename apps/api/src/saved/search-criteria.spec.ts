import { BadRequestException } from '@nestjs/common';
import { defaultSearchName, normalizeSearchCriteria, searchFingerprint } from './search-criteria';

describe('saved search criteria', () => {
  it('keeps only the public catalogue filters, trimmed, with defaults removed', () => {
    expect(normalizeSearchCriteria({ q: '  mühasib   1C ', location: 'Bakı', category: 'all', source: 'all', work: 'all', sort: 'newest' })).toEqual({ q: 'mühasib 1C', location: 'Bakı' });
  });
  it.each([
    ['a URL field', { q: 'x', url: 'https://evil.example' }],
    ['SQL in an unknown key', { q: 'x', where: '1=1; DROP TABLE "Job"' }],
    ['an unknown category', { category: 'nope' }],
    ['an unknown work value', { q: 'x', work: 'moon' }],
    ['a non-string value', { q: 5 }],
    ['an over-long query', { q: 'x'.repeat(101) }],
    ['nothing but defaults', { category: 'all', source: 'all' }],
    ['only a sort', { sort: 'oldest' }],
    ['an array', ['q']],
    ['null', null],
  ])('rejects %s', (_l, input) => {
    expect(() => normalizeSearchCriteria(input)).toThrow(BadRequestException);
  });
  it('gives one fingerprint to searches that differ only in case, accents or spacing', () => {
    const a = searchFingerprint(normalizeSearchCriteria({ q: 'Mühasib', location: 'Bakı' }));
    expect(searchFingerprint(normalizeSearchCriteria({ q: ' muhasib ', location: 'BAKI' }))).toBe(a);
    expect(searchFingerprint(normalizeSearchCriteria({ q: 'Mühasib', location: 'Gəncə' }))).not.toBe(a);
  });
  it('names a search from its criteria', () => {
    expect(defaultSearchName({ q: 'mühasib', location: 'Bakı' })).toBe('mühasib · Bakı');
  });
});
