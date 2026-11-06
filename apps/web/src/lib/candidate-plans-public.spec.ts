import { describe, expect, it } from 'vitest';
import { teaserFromCatalogue } from './candidate-plans-public';

const offer = (id: string, price: number | null, features: Record<string, unknown>) => ({ id, price, legacy: false, features });
describe('candidate plans on the landing', () => {
  it('states only what the catalogue grants today, in monthly units', () => {
    const plans = teaserFromCatalogue({ candidate: { offers: [
      offer('free', null, { 'documents.generations': { enabled: true, availability: 'available', limit: 5, period: 'month' }, 'email.applications': { enabled: true, availability: 'available', limit: 5, period: 'month' }, 'browser.applications': { enabled: false, availability: 'disabled' } }),
      offer('plus', 8, { 'documents.generations': { enabled: true, availability: 'available', limit: 30, period: 'month' }, 'email.applications': { enabled: true, availability: 'planned', limit: 30, period: 'month' } }),
      offer('premium', 50, { 'documents.generations': { enabled: true, availability: 'available', limit: null, period: 'month' }, 'browser.applications': { enabled: true, availability: 'available', limit: 50, period: 'month' } }),
      { id: 'basic', price: 5, legacy: true, features: {} },
    ] } });
    expect(plans).toEqual([
      { id: 'free', price: null, documents: 5, emailApplications: 5, browserAssistant: false },
      { id: 'plus', price: 8, documents: 30, emailApplications: undefined, browserAssistant: false },
      { id: 'premium', price: 50, documents: null, emailApplications: undefined, browserAssistant: true },
    ]);
  });
  it('says nothing when a plan is missing or the catalogue is malformed', () => {
    expect(teaserFromCatalogue(null)).toBeNull();
    expect(teaserFromCatalogue({ candidate: { offers: [offer('free', null, {})] } })).toBeNull();
  });
});
