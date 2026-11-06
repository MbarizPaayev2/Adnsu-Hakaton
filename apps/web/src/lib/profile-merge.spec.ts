import { describe, expect, it } from 'vitest';
import { mergeEducation, mergeExperiences, mergeSkills, sameExperience, type MergeExperience } from './profile-merge';

const exp = (over: Partial<MergeExperience>): MergeExperience => ({ title: 'Data Analyst', company: 'Acme', startDate: '2024-01-01', endDate: null, description: '', ...over });

describe('merging a second import into the saved profile', () => {
  it('keeps a role that appears in both once, and fills what the saved one lacks', () => {
    const saved = [exp({ description: 'Built dashboards for churn.' })];
    const r = mergeExperiences(saved, [exp({ company: 'Acme MMC', location: 'Baku', description: 'Built dashboards for churn.' })]);
    expect(r.merged).toHaveLength(1);
    expect(r.duplicates).toBe(1);
    expect(r.added).toBe(0);
    expect(r.merged[0].location).toBe('Baku');
    expect(r.conflicts).toEqual([]);
  });

  it('adds a role only the import has', () => {
    const r = mergeExperiences([exp({})], [exp({ title: 'Intern', company: 'Northwind', startDate: '2022-06-01' })]);
    expect(r.merged.map((e) => e.company)).toEqual(['Acme', 'Northwind']);
    expect(r.added).toBe(1);
  });

  it('reports a conflict when the same role differs, and never overwrites the candidate’s own text', () => {
    const saved = [exp({ description: 'Led the migration of the reporting stack to BigQuery.' })];
    const r = mergeExperiences(saved, [exp({ startDate: '2023-09-01', description: 'Managed vendor relations and procurement.' })]);
    expect(r.merged[0].description).toBe('Led the migration of the reporting stack to BigQuery.');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].fields).toEqual(expect.arrayContaining(['description', 'dates']));
  });

  it('does not treat different employers with a shared word as the same', () => {
    expect(sameExperience(exp({ company: 'Bank of Baku' }), exp({ company: 'Baku Steel', title: 'Data Analyst' }))).toBe(false);
  });

  it('merges education and skills without duplicates', () => {
    const edu = mergeEducation(
      [{ institution: 'Baku Higher Oil School', degree: 'Bachelor', fieldOfStudy: '', startDate: '2024-09-01', endDate: null }],
      [{ institution: 'Baku Higher Oil School (BHOS)', degree: 'Bachelor of Business Administration', fieldOfStudy: 'Business Administration', location: 'Baku', startDate: '2024-09-01', endDate: null }],
    );
    expect(edu.merged).toHaveLength(1);
    expect(edu.merged[0].fieldOfStudy).toBe('Business Administration');
    const sk = mergeSkills(['SQL', 'Power BI'], ['sql', 'Python', 'power  bi']);
    expect(sk.merged).toEqual(['SQL', 'Power BI', 'Python']);
    expect(sk.added).toEqual(['Python']);
  });
});
