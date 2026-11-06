import { readFileSync } from 'fs';
import { join } from 'path';
import { looksLikeLinkedIn, readLinkedIn } from './linkedin-import';
import { normalizeText, parseCv } from './cv-parser';

// Synthetic profile text in the shape of a LinkedIn export / pasted profile page.
const PROFILE = [
  'Contact',
  'www.linkedin.com/in/ada-leman (LinkedIn)',
  'Top Skills',
  'SQL',
  'Power BI',
  'Product Analytics',
  'Languages',
  'Azerbaijani (Native or Bilingual)',
  'English (Full Professional)',
  'Ada Leman',
  'Data Analyst | Product Builder',
  'Baku, Azerbaijan',
  'Summary',
  'Analyst with a focus on retail banking data and product experiments.',
  'Experience',
  'Acme Advisory',
  'Research Analyst',
  'June 2026 - Present (4 months)',
  'Baku, Azerbaijan',
  'Designed a limited-assurance methodology for five KPIs.',
  'Benchmarked sustainability performance across 15 companies.',
  'Northwind Technologies',
  '2 years 3 months',
  'Senior Data Analyst',
  'March 2025 - Present (1 year 7 months)',
  'Remote',
  'Built a churn model for 10,000 customers.',
  'Data Analyst',
  'July 2024 - February 2025 (8 months)',
  'Baku, Azerbaijan',
  'Created the weekly KPI dashboard in Power BI.',
  'Education',
  'Example Institute',
  'Bachelor of Business Administration - BBA, Business Administration · (2020 - 2024)',
].join('\n');

describe('LinkedIn profile text', () => {
  it('is recognised', () => {
    expect(looksLikeLinkedIn(PROFILE)).toBe(true);
    expect(looksLikeLinkedIn('Ad Soyad\nExperience\nAnalyst | Acme Jan 2020 - Present')).toBe(false);
  });

  it('reads one role per title, keeping company grouping and places', () => {
    const roles = readLinkedIn(normalizeText(PROFILE).map((text) => ({ text }))).roles;
    expect(roles.map((r) => [r.title, r.company, r.location, r.dates])).toEqual([
      ['Research Analyst', 'Acme Advisory', 'Baku, Azerbaijan', 'June 2026 - Present'],
      ['Senior Data Analyst', 'Northwind Technologies', 'Remote', 'March 2025 - Present'],
      ['Data Analyst', 'Northwind Technologies', 'Baku, Azerbaijan', 'July 2024 - February 2025'],
    ]);
    expect(roles[1].description).toBe('Built a churn model for 10,000 customers.');
  });

  it('goes through the normal parser: roles, dates, places, bullets, skills, summary, education', () => {
    const cv = parseCv(PROFILE);
    expect(cv.workExperience.map((e) => [e.title, e.company, e.location ?? ''])).toEqual([
      ['Research Analyst', 'Acme Advisory', 'Baku, Azerbaijan'],
      ['Senior Data Analyst', 'Northwind Technologies', 'Remote'],
      ['Data Analyst', 'Northwind Technologies', 'Baku, Azerbaijan'],
    ]);
    expect(cv.workExperience[0].startDate).toBe('2026-06-01T00:00:00.000Z');
    expect(cv.workExperience[0].description.split('\n')).toHaveLength(2);
    expect(cv.workExperience[2].endDate).toBe('2025-02-01T00:00:00.000Z');
    expect(cv.skills).toEqual(expect.arrayContaining(['SQL', 'Power BI']));
    expect(cv.summary).toMatch(/retail banking data/);
  });
});


describe('multi-page LinkedIn education regression', () => {
  it('keeps wrapped subjects, degree names and dates with the right school; discards every page footer', () => {
    const cv = parseCv(PROFILE.replace('Example Institute\nBachelor of Business Administration - BBA, Business Administration · (2020 - 2024)', [
      'Tech Institute', 'Entrepreneurship Studies · (July 2026 - September 2026)',
      'Coding School', 'Generative Artificial Intelligence · (February 2026 - June 2026)',
      'Business University', 'Bachelor of Business Administration - BBA, Business',
      'Administration · (September 2024 - June 2029)',
      'Leadership Institute', 'Page 3 of 4', 'Leadership Program, Global Leadership and Professional',
      'Development · (October 2025 - December 2025)', 'Page 4 of 4',
    ].join('\n')));
    expect(cv.headline).toBe('Data Analyst | Product Builder');
    expect(cv.personalInfo.name).toBe('Ada Leman');
    expect(cv.education).toHaveLength(4);
    expect(cv.education[0]).toMatchObject({ institution: 'Tech Institute', fieldOfStudy: 'Entrepreneurship Studies', startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-09-01T00:00:00.000Z' });
    expect(cv.education[2]).toMatchObject({ degree: 'Bachelor of Business Administration - BBA', fieldOfStudy: 'Business Administration', startDate: '2024-09-01T00:00:00.000Z' });
    expect(cv.education[3].fieldOfStudy).toBe('Leadership Program, Global Leadership and Professional Development');
    expect(cv.education[3]).toMatchObject({
      institution: 'Leadership Institute',
      startDate: '2025-10-01T00:00:00.000Z',
      endDate: '2025-12-01T00:00:00.000Z',
      startPrecision: 'MONTH',
      endPrecision: 'MONTH',
    });
    expect(JSON.stringify(cv)).not.toMatch(/Page [34] of 4/);
  });
});

const fixture = (name: string) => join(__dirname, '../../test/fixtures/linkedin', name);

describe('text copied from a LinkedIn profile page', () => {
  const cv = parseCv(readFileSync(fixture('copied-profile.txt'), 'utf8'));

  it('drops the screen-reader repeats, buttons and pronouns', () => {
    expect(cv.personalInfo.name).toBe('Nigar Example');
    expect(cv.headline).toBe('Product Designer | UX research and design systems for fintech');
    expect(cv.summary).toBe('I design mobile banking features end to end, from interviews with customers to the final interface. I care about plain language and accessible flows.');
    expect(cv.skills).toEqual(['Figma', 'User Research']);
  });

  it('reads grouped and single roles in the page order (title before company)', () => {
    expect(cv.workExperience.map((e) => [e.title, e.company, e.location ?? '', e.description])).toEqual([
      ['Senior Product Designer', 'Example Pay', '', 'Redesigned the card activation flow with the mobile team.'],
      ['Product Designer', 'Example Pay', 'Hybrid', 'Ran usability tests with 30 customers before each release.'],
      ['UX Design Intern', 'Studio North', 'Baku, Azerbaijan', 'Prepared wireframes for two client websites.'],
    ]);
  });

  it('reads education, certificates with issuer and date, and languages with level', () => {
    expect(cv.education).toEqual([expect.objectContaining({ institution: 'Baku Higher Oil School', degree: "Bachelor's degree", fieldOfStudy: 'Information Technology', startPrecision: 'YEAR' })]);
    expect(cv.careerSuggestions.find((s) => s.kind === 'CERTIFICATION')).toMatchObject({ title: 'Google UX Design', organization: 'Coursera', issuedAt: '2023-03-01T00:00:00.000Z' });
    expect(cv.careerSuggestions.filter((s) => s.kind === 'LANGUAGE').map((s) => [s.title, s.level])).toEqual([
      ['English', 'Full professional proficiency'],
      ['Azerbaijani', 'Native or bilingual proficiency'],
    ]);
  });
});

// ------------------------------------------------------------------ boundary, wrapping and date-precision audit --
// Synthetic names only. Each fixture is the text a LinkedIn export or profile page gives, line by line.

/** "Save to PDF" export read as text alone (no font sizes), sidebar first, with page footers and a repeated name after a page break. */
const EXPORT_TEXT = [
  'Contact', 'www.linkedin.com/in/rauf-sample (LinkedIn)',
  'Top Skills', 'SQL', 'Python',
  'Languages', 'English (Professional Working)',
  'Certifications', 'Google Data Analytics',
  'Rauf Sample', 'Data Engineer', 'Baku, Azerbaijan',
  'Summary', 'Engineer who builds data pipelines.',
  'Experience',
  'Caspian Data Systems', '3 years 2 months',
  // A title wrapped over two lines.
  'Lead Data Engineer, Payments Platform and', 'Reporting',
  'January 2023 - Present (1 year 10 months)', 'Baku, Azerbaijan',
  'Moved nightly batch jobs to streaming.',
  'Page 1 of 3', 'Rauf Sample',
  'Data Engineer', 'Sep. 2021 - Dec. 2022 (1 year 4 months)', 'Tbilisi, Georgia',
  'Maintained the warehouse.',
  // A company name wrapped over two lines, then a role with year-only dates and no place or description.
  'Northwind Advisory and', 'Consulting Services',
  'Junior Analyst', '2019 - 2021 (2 years)',
  // A company whose name has a comma is not a place.
  'Acme, LLC',
  'Intern', 'Jun 2018',
  'Page 2 of 3',
  'Education',
  'Example University', "Bachelor's degree, Computer Science · (2015 - 2019)",
  'Example Lyceum',
  'Page 3 of 3',
].join('\n');

describe('LinkedIn export text: boundaries, wrapped fields, footers, grouping, date precision', () => {
  const cv = parseCv(EXPORT_TEXT);

  it('reads every role with its own employer, place and stated dates', () => {
    expect(cv.workExperience.map((e) => [e.title, e.company, e.location ?? ''])).toEqual([
      ['Lead Data Engineer, Payments Platform and Reporting', 'Caspian Data Systems', 'Baku, Azerbaijan'],
      ['Data Engineer', 'Caspian Data Systems', 'Tbilisi, Georgia'],
      ['Junior Analyst', 'Northwind Advisory and Consulting Services', ''],
      ['Intern', 'Acme, LLC', ''],
    ]);
  });

  it('never lets a page footer or the repeated name into a role', () => {
    expect(cv.workExperience[0].description).toBe('Moved nightly batch jobs to streaming.');
    expect(cv.workExperience[1].description).toBe('Maintained the warehouse.');
    expect(JSON.stringify(cv.workExperience)).not.toMatch(/Rauf Sample|Page \d of 3/);
    expect(JSON.stringify(cv)).not.toMatch(/Page \d of 3/);
  });

  it('keeps month, year and "Present" exactly as stated, and leaves missing ends unknown', () => {
    expect(cv.workExperience[0]).toMatchObject({ startDate: '2023-01-01T00:00:00.000Z', startPrecision: 'MONTH', endDate: null, current: true });
    // "Sep." with a period is still September, not January.
    expect(cv.workExperience[1]).toMatchObject({ startDate: '2021-09-01T00:00:00.000Z', startPrecision: 'MONTH', endDate: '2022-12-01T00:00:00.000Z', endPrecision: 'MONTH' });
    expect(cv.workExperience[2]).toMatchObject({ startPrecision: 'YEAR', endPrecision: 'YEAR' });
    // A single start month: no end date and not current.
    expect(cv.workExperience[3]).toMatchObject({ startDate: '2018-06-01T00:00:00.000Z', startPrecision: 'MONTH', endDate: null });
    expect(cv.workExperience[3].current).toBeFalsy();
    expect(cv.workExperience[3].endPrecision).toBeUndefined();
  });

  it('flags the wrapped title and company it joined without font sizes', () => {
    expect(cv.workExperience[0].uncertain).toEqual(expect.arrayContaining(['title']));
    expect(cv.workExperience[2].uncertain).toEqual(expect.arrayContaining(['company']));
  });

  it('ends Education at the next heading or footer and keeps an undated school undated', () => {
    expect(cv.education.map((e) => [e.institution, e.degree, e.fieldOfStudy])).toEqual([
      ['Example University', "Bachelor's degree", 'Computer Science'],
      ['Example Lyceum', '', ''],
    ]);
    expect(cv.education[0]).toMatchObject({ startPrecision: 'YEAR', endPrecision: 'YEAR' });
    expect(cv.education[1]).toMatchObject({ startDate: null, endDate: null });
    expect(cv.skills).toEqual(expect.arrayContaining(['SQL', 'Python']));
    expect(cv.careerSuggestions.filter((s) => s.kind === 'CERTIFICATION').map((s) => s.title)).toEqual(['Google Data Analytics']);
  });
});

describe('LinkedIn export with font sizes: wrapped company and title', () => {
  // Sizes as in the export: name 26, headline 12, headings 15.75, company and school 12, everything else 10.5.
  const L = (text: string, size = 10.5) => ({ text, size });
  const li = readLinkedIn([
    L('Rauf Sample', 26), L('Data Engineer', 12), L('Baku, Azerbaijan'),
    L('Experience', 15.75),
    L('Azerbaijan Example Oil and Gas Production', 12), L('Company', 12),
    L('Lead Engineer, Reservoir Modelling and'), L('Simulation'), L('March 2020 - Present (4 years 7 months)'), L('Baku, Azerbaijan'),
    L('Built the reservoir model.'),
    L('Caspian Data Systems', 12), L('Analyst'), L('2017 - 2019 (2 years)'),
    L('Education', 15.75), L('Example University', 12), L('Bachelor of Science - BS, Physics · (2013 - 2017)'),
  ], { fromPdf: true });

  it('joins a two-line company and a two-line title', () => {
    expect(li.roles.map((r) => [r.title, r.company, r.location, r.dates])).toEqual([
      ['Lead Engineer, Reservoir Modelling and Simulation', 'Azerbaijan Example Oil and Gas Production Company', 'Baku, Azerbaijan', 'March 2020 - Present'],
      ['Analyst', 'Caspian Data Systems', '', '2017 - 2019'],
    ]);
    expect(li.roles[0].description).toBe('Built the reservoir model.');
  });
});

/** Profile page copied as text: screen-reader repeats, a grouped employer whose roles each name their employment type. */
const twice = (lines: string[]) => lines.flatMap((l) => [l, l]);
const COPIED_GROUPED = [
  ...twice(['Kamran Sample', 'Backend Engineer', 'Baku, Azerbaijan']), 'Contact info', '500+ connections',
  ...twice(['Experience']),
  'Example Telecom logo',
  ...twice(['Example Telecom', 'Full-time · 3 yrs 2 mos', 'Baku, Azerbaijan']),
  ...twice(['Senior Backend Engineer', 'Full-time']), 'Jan 2023 - Present · 1 yr 10 mos', 'Jan 2023 to Present · 1 yr 10 mos',
  ...twice(['Owned the billing API.']),
  // A title with a comma is not a place, and the bare employment type is not a company.
  ...twice(['Engineer, Payments Platform', 'Full-time']), 'Sep 2021 - Dec 2022 · 1 yr 4 mos', 'Sep 2021 to Dec 2022 · 1 yr 4 mos',
  ...twice(['Remote', 'Wrote the first integration tests.']),
  ...twice(['Support Intern', 'Studio Example · Internship', '2020 - 2021 · 1 yr', 'Answered customer tickets.']),
  ...twice(['Education', 'Example University', "Master's degree, Finance", '2019 - 2021']),
  ...twice(['Volunteering', 'Mentor', 'Example Charity']),
  ...twice(['Honors & awards', 'Dean’s List']),
  ...twice(['Skills', 'Go', 'PostgreSQL']),
  ...twice(['Languages', 'English', 'Full professional proficiency']),
].join('\n');

describe('copied profile: grouped roles with employment type lines, section boundaries', () => {
  const cv = parseCv(COPIED_GROUPED);

  it('keeps grouped roles with their employer', () => {
    expect(cv.workExperience.map((e) => [e.title, e.company, e.location ?? '', e.description])).toEqual([
      ['Senior Backend Engineer', 'Example Telecom', '', 'Owned the billing API.'],
      ['Engineer, Payments Platform', 'Example Telecom', 'Remote', 'Wrote the first integration tests.'],
      ['Support Intern', 'Studio Example', '', 'Answered customer tickets.'],
    ]);
    expect(cv.workExperience[0]).toMatchObject({ startPrecision: 'MONTH', endDate: null, current: true });
    expect(cv.workExperience[2]).toMatchObject({ startDate: '2020-01-01T00:00:00.000Z', startPrecision: 'YEAR', endPrecision: 'YEAR' });
  });

  it('stops each section at the next heading', () => {
    expect(cv.education).toEqual([expect.objectContaining({ institution: 'Example University', degree: "Master's degree", fieldOfStudy: 'Finance' })]);
    expect(cv.skills).toEqual(expect.arrayContaining(['Go', 'PostgreSQL']));
    expect(cv.skills).not.toContain('Mentor');
    expect(cv.careerSuggestions.filter((s) => s.kind === 'AWARD').map((s) => s.title)).toEqual(['Dean’s List']);
    expect(cv.careerSuggestions.filter((s) => s.kind === 'LANGUAGE').map((s) => [s.title, s.level])).toEqual([['English', 'Full professional proficiency']]);
  });
});

/** An export with Azerbaijani headings, months and "indiki" (current). */
const AZ_EXPORT = [
  'Əlaqə', 'www.linkedin.com/in/aysel-numune (LinkedIn)',
  'Əsas bacarıqlar', 'Excel',
  'Dillər', 'Azərbaycan dili (Ana dili)',
  'Aysel Nümunə', 'Mühasib', 'Bakı, Azərbaycan',
  'Təcrübə',
  'Nümunə Bank', '5 il 2 ay',
  'Baş mühasib', 'İyun 2021 - indiki (3 il 4 ay)', 'Bakı, Azərbaycan', 'Aylıq hesabatları hazırladım.',
  'Mühasib', '2019 - 2021 (2 il)',
  'Təhsil', 'Nümunə Universiteti', 'Bakalavr, Mühasibat · (2015 - 2019)',
  'Sertifikatlar', 'ACCA F3',
].join('\n');

describe('LinkedIn export with Azerbaijani headings and dates', () => {
  const cv = parseCv(AZ_EXPORT);

  it('reads roles, "indiki" as current and Azerbaijani month names with month precision', () => {
    expect(cv.workExperience.map((e) => [e.title, e.company, e.location ?? ''])).toEqual([
      ['Baş mühasib', 'Nümunə Bank', 'Bakı, Azərbaycan'],
      ['Mühasib', 'Nümunə Bank', ''],
    ]);
    expect(cv.workExperience[0]).toMatchObject({ startDate: '2021-06-01T00:00:00.000Z', startPrecision: 'MONTH', endDate: null, current: true });
    expect(cv.workExperience[1]).toMatchObject({ startPrecision: 'YEAR', endPrecision: 'YEAR' });
  });

  it('stops Education at the certificates heading and reads the sidebar lists', () => {
    expect(cv.education.map((e) => [e.institution, e.degree, e.fieldOfStudy])).toEqual([['Nümunə Universiteti', 'Bakalavr', 'Mühasibat']]);
    expect(cv.skills).toContain('Excel');
    expect(cv.careerSuggestions.filter((s) => s.kind === 'CERTIFICATION').map((s) => s.title)).toEqual(['ACCA F3']);
    expect(cv.careerSuggestions.filter((s) => s.kind === 'LANGUAGE').map((s) => [s.title, s.level])).toEqual([['Azərbaycan dili', 'Ana dili']]);
  });
});
