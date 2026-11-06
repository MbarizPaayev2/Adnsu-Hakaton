import { classifyGlorriInfoItems, mapGlorriJobToIngestPayload } from './glorri-mapping.util';
import { isEmploymentTypeLabel, usableLocation } from '../../jobs/job-location.util';

describe('Glorri location mapping', () => {
  describe('classifyGlorriInfoItems', () => {
    it('reads company, location and employment type when all three bullets exist', () => {
      expect(classifyGlorriInfoItems(['PASHA Bank', 'Bakı, Azərbaycan', 'Tam ştat'])).toEqual({
        company_name: 'PASHA Bank',
        location: 'Bakı, Azərbaycan',
        employment_type: 'Tam ştat',
      });
    });

    it('does not read the employment type as the location when the location bullet is missing', () => {
      // The defect: positional parsing stored "Tam ştat" as the location of 118 postings.
      expect(classifyGlorriInfoItems(['Landau Education Group', 'Tam ştat'])).toEqual({
        company_name: 'Landau Education Group',
        location: null,
        employment_type: 'Tam ştat',
      });
    });

    it('is independent of bullet order and tolerant of spelling and case', () => {
      expect(classifyGlorriInfoItems(['Acme', 'TAM STAT', 'Gəncə, Azərbaycan'])).toMatchObject({ location: 'Gəncə, Azərbaycan', employment_type: 'TAM STAT' });
      expect(classifyGlorriInfoItems(['Acme', 'Yarım ştat'])).toMatchObject({ location: null, employment_type: 'Yarım ştat' });
    });

    it('never guesses: a page with only the company has no location and no employment type', () => {
      expect(classifyGlorriInfoItems(['Acme'])).toEqual({ company_name: 'Acme', location: null, employment_type: null });
      expect(classifyGlorriInfoItems([])).toEqual({ company_name: null, location: null, employment_type: null });
    });
  });

  describe('employment-type labels', () => {
    it.each(['Tam ştat', 'tam ştat', 'Tam stat', 'Yarım ştat', 'Növbə əsasında', 'Könüllü', 'Müvəqqəti', 'Təcrübə', 'Frilans', 'Full-time', 'Part time'])('%s is not a place', (label) => {
      expect(isEmploymentTypeLabel(label)).toBe(true);
      expect(usableLocation(label)).toBeNull();
    });

    it.each(['Bakı, Azərbaycan', 'Baku, Azerbaijan', 'Xankəndi', 'İnşaatçılar pr., 22L', 'Port Baku Towers, Bakı'])('%s is a place', (place) => {
      expect(isEmploymentTypeLabel(place)).toBe(false);
      expect(usableLocation(place)).toBe(place);
    });

    it('treats empty input as no location', () => {
      expect(usableLocation('')).toBeNull();
      expect(usableLocation(null)).toBeNull();
      expect(usableLocation('   ')).toBeNull();
    });
  });

  describe('mapGlorriJobToIngestPayload', () => {
    const base = { slug: 'x', title: 'Mühasib', company: { slug: 'acme', name: 'Acme' } };

    it('uses the detail location when it is a place', () => {
      expect(mapGlorriJobToIngestPayload({ ...base, location: 'Bakı, Azərbaycan', detail: { location: 'Gəncə, Azərbaycan' } as any }).location).toBe('Gəncə, Azərbaycan');
    });

    it('falls back to the listing location when the stored detail location is an employment type', () => {
      const payload = mapGlorriJobToIngestPayload({ ...base, location: 'Bakı, Azərbaycan', detail: { location: 'Tam ştat', employment_type: null } as any });
      expect(payload.location).toBe('Bakı, Azərbaycan');
    });

    it('falls back to the country, never a guessed city, when no trustworthy location exists', () => {
      expect(mapGlorriJobToIngestPayload({ ...base, location: 'Tam ştat', detail: { location: 'Tam ştat' } as any }).location).toBe('Azerbaijan');
      expect(mapGlorriJobToIngestPayload({ ...base }).location).toBe('Azerbaijan');
    });

    it('keeps the original source record, including the misplaced value, for diagnosis', () => {
      const job = { ...base, location: 'Bakı, Azərbaycan', detail: { location: 'Tam ştat' } as any };
      expect((mapGlorriJobToIngestPayload(job).rawPayload as any).detail.location).toBe('Tam ştat');
    });
  });
});
