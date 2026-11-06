import { isRecommendationRelevant } from './recommendation-policy';

describe('recommendation role policy', () => {
  it('honours explicit occupation rejection regardless of total similarity or keywords', () => {
    expect(isRecommendationRelevant({ score: .9, matchedKeywords: ['Excel'], breakdown: { roleFit: .8, filters: { role_relevant: false } } })).toBe(false);
  });
  it('honours explicit location, work-arrangement, and seniority rejections', () => {
    expect(isRecommendationRelevant({ score: .9, breakdown: { roleFit: .9, filters: { role_relevant: true, location_ok: false } } })).toBe(false);
    expect(isRecommendationRelevant({ score: .9, breakdown: { roleFit: .9, filters: { role_relevant: true, work_arrangement_ok: false } } })).toBe(false);
    expect(isRecommendationRelevant({ score: .9, breakdown: { roleFit: .9, filters: { role_relevant: true, seniority_ok: false } } })).toBe(false);
    expect(isRecommendationRelevant({ score: .9, breakdown: { roleFit: .9, filters: { role_relevant: true, location_ok: true, work_arrangement_ok: true, seniority_ok: true } } })).toBe(true);
  });

  it.each([
    ['location', { location: false }],
    ['work arrangement', { work_arrangement: false }],
    ['seniority', { seniority: false }],
    ['citizenship', { citizenship: false }],
    ['work authorization (British spelling)', { work_authorisation: false }],
    ['work authorization (US spelling)', { work_authorization: false }],
    ['overall eligibility', { recommendation_eligible: false }],
  ])('preserves the %s veto emitted by the alternate scorer contract', (_label, signal) => {
    expect(isRecommendationRelevant({ score: 0.99, breakdown: { roleFit: 1, filters: { role_relevant: true, ...signal } } })).toBe(false);
  });
  it('rejects legacy deterministic zero-role results, but not absent evidence or adjacent careers', () => {
    expect(isRecommendationRelevant({ breakdown: { mode: 'rules-v1.2', roleFit: 0 } })).toBe(false);
    expect(isRecommendationRelevant({ breakdown: { mode: 'rules-v1.2', roleFit: .55 } })).toBe(true);
    expect(isRecommendationRelevant(null)).toBe(true);
    expect(isRecommendationRelevant({ breakdown: { roleFit: 0, filters: { role_relevant: true } } })).toBe(true);
  });
});
