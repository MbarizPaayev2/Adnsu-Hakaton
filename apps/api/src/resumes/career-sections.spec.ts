import { parseCareerSections, parseCv } from './cv-parser';

// Synthetic CV text; no real person's data.
const CV = `Leyla Hüseynova
leyla@example.com
Bakı

Təcrübə
Sep 2021 - Present
Data Analitik | Nümunə MMC
• Hesabatlar hazırlayıb

Layihələr
Kredit risk paneli | Universitet layihəsi 2022
• Power BI ilə panel qurdum
• 3 qrup ilə birlikdə işlədim
Open Data Portal — açıq data üçün vizuallaşdırma 2021

Könüllülük
Təşkilatçı, Gənclər Təşkilatı
2019 - 2020
• Tədbirlərin koordinasiyası

Liderlik
Klub sədri | Tələbə Klubu
Sep 2020 - Jun 2021

Sertifikatlar
Google Data Analytics – Coursera 2022
PMP

Təltiflər
Dekan təşəkkürü | Bakı Dövlət Universiteti 2020

Dillər
Azərbaycan dili - anadil, English (B2), Русский – A2
`;

describe('career section suggestions', () => {
  const found = parseCareerSections(CV);
  const by = (kind: string) => found.filter((e) => e.kind === kind);

  it('reads projects with their description, organisation and date, without composing anything', () => {
    const projects = by('PROJECT');
    expect(projects.map((p) => p.title)).toEqual(['Kredit risk paneli', 'Open Data Portal']);
    expect(projects[0].organization).toBe('Universitet layihəsi');
    expect(projects[0].description).toContain('Power BI ilə panel qurdum');
    expect(projects[1].description).toBe('açıq data üçün vizuallaşdırma');
    expect(projects[1].startDate).toMatch(/^2021/);
  });

  it('classifies volunteering and leadership by their own headings and keeps role/organisation/date', () => {
    const v = by('VOLUNTEERING')[0];
    expect(v).toMatchObject({ role: 'Təşkilatçı', organization: 'Gənclər Təşkilatı' });
    expect(v.startDate).toMatch(/^2019/);
    expect(by('LEADERSHIP')[0]).toMatchObject({ role: 'Klub sədri', organization: 'Tələbə Klubu', current: false });
  });

  it('certifications and awards: title, issuer and a date only when stated; a bare title stays bare', () => {
    const [google, pmp] = by('CERTIFICATION');
    expect(google).toMatchObject({ title: 'Google Data Analytics', organization: 'Coursera' });
    expect(google.issuedAt).toMatch(/^2022/);
    expect(pmp).toMatchObject({ title: 'PMP', organization: null, issuedAt: null });
    expect(by('AWARD')[0]).toMatchObject({ title: 'Dekan təşəkkürü', organization: 'Bakı Dövlət Universiteti' });
  });

  it('a year-only date is marked YEAR (never shown as a month); a month date is MONTH', () => {
    expect(by('PROJECT')[1].precision).toBe('YEAR');
    expect(by('CERTIFICATION')[0].precision).toBe('YEAR');
    expect(by('LEADERSHIP')[0].precision).toBe('MONTH');
  });

  it('languages with the level exactly as written; no level is invented', () => {
    expect(by('LANGUAGE').map((l) => [l.title, l.level])).toEqual([['Azərbaycan dili', 'anadil'], ['English', 'B2'], ['Русский', 'A2']]);
  });

  it('every suggestion keeps the original lines and every stored text field occurs in them', () => {
    for (const e of found) {
      expect(e.evidence.length).toBeGreaterThan(0);
      for (const field of [e.title, e.organization, e.role, e.level] as (string | null)[]) {
        if (field) expect(e.evidence.includes(field)).toBe(true);
      }
    }
  });

  it('a CV without these sections yields nothing (not placeholders), and the main parse is unchanged by them', () => {
    expect(parseCareerSections('Aysel Əliyeva\nTəcrübə\nSatış mütəxəssisi | Firma MMC\n2020 - 2022\n• Satış')).toEqual([]);
    const parsed = parseCv(CV, {});
    expect(parsed.workExperience).toHaveLength(1);
    expect(parsed.workExperience[0].company).toContain('Nümunə');
  });

  it('bullets with no heading line are not attributed to anything', () => {
    expect(parseCareerSections('Layihələr\n• yalnız bullet')).toEqual([]);
  });

  it('keeps wrapped project bullets with their own project, including numbers, dates and capitalised continuations', () => {
    const projects = parseCareerSections(`Selected AI & Data Projects
Economy Analysis – Undergraduate Researcher Apr 2026
• Completed a four-notebook study covering 20 years of data; estimated that oil
explains 50.9% of variance and modeled macroeconomic scenarios.
• Developed a scenario model for the March 2026 crisis via the
Pipeline, quantifying revenue; designed a stress test
anchored to the verified 2024 base.
• Built a purchasing-power index that revealed
63% wage growth but only 8–10% purchasing-power growth.
Technical Prototypes | Cloud Security & Document AI Feb – Apr 2026
• Co-developed a national security concept at a
Hackathon; contributed solution architecture.
• Built an AI-
enabled prototype without sending
documents to external cloud services.
Retention Analytics | SQL, Python, Tableau 2025
• Created a workflow with cohorts and
retention notebooks.
• Validated metric integrity; visualized
findings in executive dashboards.`).filter((e) => e.kind === 'PROJECT');
    expect(projects.map((e) => e.title)).toEqual(['Economy Analysis', 'Technical Prototypes', 'Retention Analytics']);
    expect(projects[0].description).toContain('explains 50.9% of variance');
    expect(projects[0].description).toContain('Pipeline, quantifying revenue');
    expect(projects[0].description).toContain('8–10% purchasing-power growth.');
    expect(projects[1].description).toContain('AI-enabled prototype without sending documents to external cloud services.');
    expect(projects[1].startDate).toBe('2026-02-01T00:00:00.000Z');
    expect(projects[1].endDate).toBe('2026-04-01T00:00:00.000Z');
    expect(projects[2].description).toContain('findings in executive dashboards.');
    expect(projects[0].description).not.toMatch(/Technical Prototypes/);
    expect(projects[1].description).not.toMatch(/Retention Analytics/);
  });

  it('separates undated titles and preserves a date on the next line', () => {
    const projects = parseCareerSections('Projects\nRisk Dashboard\n2022 - 2023\n• Built a dashboard.\nForecast Model\n• Evaluated forecasts.');
    expect(projects.map((p) => p.title)).toEqual(['Risk Dashboard', 'Forecast Model']);
    expect(projects[0].startDate).toMatch(/^2022/);
    expect(projects[0].endDate).toMatch(/^2023/);
  });

  it('does not treat a wrapped achievement ending in a year as a new dated project', () => {
    const projects = parseCareerSections('Projects\nReporting Dashboard | University 2024\n• Used historical benchmarks.\nImproved forecasts using data collected in 2023\n• Reported findings to the team.');
    expect(projects).toHaveLength(1);
    expect(projects[0].description).toContain('Improved forecasts using data collected in 2023');
  });
});
