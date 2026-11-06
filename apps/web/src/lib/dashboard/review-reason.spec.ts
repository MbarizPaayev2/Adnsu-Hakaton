import { describe, expect, it } from 'vitest';
import { reviewReason } from './review-reason';

describe('review reason', () => {
  it('names the rules the posting meets and keeps profile gaps as "not evidenced"', () => {
    const r = reviewReason({ title: 'Data Mühəndisi (Python)', rules: { allowedRoles: ['Developer', 'mühəndis'], allowedLocations: ['Bakı'] }, match: { matchedKeywords: ['Python', 'SQL'], gaps: ['Airflow', 7] } });
    expect(r).toEqual({ roles: ['mühəndis'], cities: ['Bakı'], evidenced: ['Python', 'SQL'], notEvidenced: ['Airflow'] });
  });
  it('says nothing it does not know', () => {
    expect(reviewReason({ title: 'X', rules: null, match: null })).toEqual({ roles: [], cities: [], evidenced: [], notEvidenced: [] });
  });
});
