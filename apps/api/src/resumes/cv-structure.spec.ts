import { linesFromItems, type PositionedItem } from './cv-extract';
import { parseCv } from './cv-parser';

/**
 * Regression for a real defective import (redacted: invented names, same shapes). The original CV is a single column with:
 *  - "Role | Programme | Organisation | Place  Mon YYYY - Present" headers with the date at the end of the line,
 *  - "•" bullets whose sentences wrap onto unmarked lines,
 *  - a bullet sentence that mentions a year in the middle,
 *  - a second section whose entries put the organisation FIRST ("Org | Role | Descriptor"),
 *  - a PDF text layer that splits words at hyphens and kerning ("pathwa" + "ys", "202" + "6").
 */
const CV = [
  'ADA LƏMAN',
  'DATA ANALYST | PRODUCT BUILDER | SCHOLAR',
  '+994 50 000 00 00 | ada.synthetic@example.com | LinkedIn | GitHub',
  'PROFILE',
  'Scholar and student at Example Institute (GPA 4.0; Top 3 of 20,000+ applicants) with experience across data analysis,',
  'product development and strategy research. Combines structured research and product thinking to translate',
  'business problems into practical recommendations.',
  'EDUCATION',
  'Bachelor of Business Administration | Example Institute | Baku, Azerbaijan Sep 2024 - Jun 2029',
  'PROFESSIONAL EXPERIENCE',
  'Research Analyst | Mentorship Programme | Acme Advisory | Baku, Azerbaijan Jun 2026 - Present',
  'Selected as 1 of 4 students; produced eight non-confidential research deliverables across several sectors.',
  '• Designed a limited-assurance methodology for five KPIs, including a 20-document request list, evidence mapping,',
  'reconciliation procedures and risk-escalation logic using public research.',
  '• Benchmarked sustainability performance across 15+ international companies; developed phased roadmaps covering',
  'inventories, renewable energy, circularity and certification pathways.',
  'Business Analyst Intern | Northwind Technologies | Remote Mar 2026 - Present',
  '• Created a PostgreSQL and Power BI churn-monitoring analysis for 10,000 customers; quantified $108,623 in high-risk',
  'monthly revenue and modeled $195,522 in potential annual retention savings.',
  '• Completed an applied fraud-detection analysis on 284,807 transactions with a 577:1 class imbalance.',
  'Data Analyst Intern | Outstanding Contributor | Contoso Pathways | Remote Feb 2026 - Mar 2026',
  'Recognized as Outstanding Contributor among 2,000+ global participants.',
  '• Built a reproducible Python job-market analysis across 100K+ postings, including data validation and salary',
  'distributions.',
  'STARTUPS & VENTURES',
  'LedgerLab | Co-Founder & Product Lead | AI-OCR Product for Local SME Ledgers Jun 2026 - Present',
  '• Leading product development for an AI-OCR workflow that digitizes handwritten financial records; accepted into the',
  'regional Incubation Program.',
  '• Defined the user problem and an accuracy gap in two vendor tools for local handwriting; preparing development and',
  'validation with the incubation team.',
  'FinCoach | Founder | AI-Enabled Financial Wellness Venture Feb 2026 - Present',
  '• Developing a financial-wellness product combining AI coaching and budgeting; awarded a $400 Example Institute',
  'seed fund as one of 40 founders selected from 1,800+ global applications, simultaneously named 2026 Youth Fellow',
  '(one of 20 globally) by Example Foundation, with access to a business-school accelerator platform.',
  'Warehouse Robotics | Co-Founder & CEO | RPA + AGV Warehouse Automation Apr 2026 - Present',
  '• Co-developing an integrated RPA and autonomous guided vehicle concept for warehouse operations.',
  'CAPABILITIES & TOOLS',
  'Business & innovation: Business analysis, market and industry research, requirements definition, product discovery, competitive',
  'benchmarking, KPI design, financial modeling',
  'Data & visualization: Python for analysis (pandas, scikit-learn), SQL (PostgreSQL, BigQuery), Excel, Power BI, Tableau',
  'Languages: Azerbaijani (Native), English (C1 - IELTS 7.0), Turkish (Intermediate)',
].join('\n');

describe('a real defective import, redacted', () => {
  const cv = parseCv(CV);
  const by = (needle: string) => cv.workExperience.find((e) => (e.title + ' ' + e.company).includes(needle))!;

  it('finds each role once, with its own title, company, place and dates', () => {
    expect(cv.workExperience.map((e) => e.title)).toEqual([
      'Research Analyst', 'Business Analyst Intern', 'Data Analyst Intern', 'Co-Founder & Product Lead', 'Founder', 'Co-Founder & CEO',
    ]);
    expect(by('Mentorship').company).toBe('Mentorship Programme | Acme Advisory');
    expect(by('Mentorship').location).toBe('Baku, Azerbaijan');
    expect(by('Northwind').company).toBe('Northwind Technologies');
    expect(by('Northwind').location).toBe('Remote');
    // organisation first: the role word decides which segment is the title
    expect(by('LedgerLab').title).toBe('Co-Founder & Product Lead');
    expect(by('LedgerLab').company).toBe('LedgerLab | AI-OCR Product for Local SME Ledgers');
    expect(by('FinCoach').title).toBe('Founder');
    expect(by('FinCoach').company).toBe('FinCoach | AI-Enabled Financial Wellness Venture');
    expect(by('Contoso').endDate).toBe('2026-03-01T00:00:00.000Z');
    expect(by('Warehouse').startDate).toBe('2026-04-01T00:00:00.000Z');
  });

  it('keeps every bullet with its own role: a venture is never a bullet of the previous job', () => {
    expect(by('Contoso').description.split('\n')).toHaveLength(2);
    expect(by('Contoso').description).not.toMatch(/LedgerLab/);
    expect(by('LedgerLab').description.split('\n')).toHaveLength(2);
    expect(by('Mentorship').description.split('\n')).toHaveLength(3);
  });

  it('does not start a new entry at a sentence that merely mentions a year, and does not cut it', () => {
    const fin = by('FinCoach').description.split('\n');
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatch(/seed fund as one of 40 founders/);
    expect(fin[0]).toMatch(/business-school accelerator platform\.$/);
    expect(cv.workExperience).toHaveLength(6);
  });

  it('joins wrapped lines, strips bullet signs and never cuts a long role', () => {
    for (const e of cv.workExperience) {
      expect(e.description).not.toMatch(/^[•▪●]/m);
      for (const b of e.description.split('\n')) expect(b).toMatch(/[.a-z)]$/i);
    }
    const long = parseCv(['Ad Soyad', 'Experience', 'Analyst | Acme Inc Jan 2020 - Present', `• ${'detailed work '.repeat(150)}end.`].join('\n'));
    expect(long.workExperience[0].description.length).toBeGreaterThan(1500);
    expect(long.workExperience[0].description.endsWith('end.')).toBe(true);
  });

  it('keeps the whole summary and a tagline headline; the headline is not cut in a word', () => {
    expect(cv.summary).toMatch(/^Scholar and student at Example Institute/);
    expect(cv.summary).toMatch(/practical recommendations\.$/);
    expect(cv.headline).toBe('DATA ANALYST | PRODUCT BUILDER | SCHOLAR');
  });

  it('lists skills once, splits tool groups, joins wrapped phrases and keeps languages out of skills', () => {
    expect(cv.skills).toEqual(expect.arrayContaining(['Business analysis', 'competitive benchmarking', 'KPI design', 'Python', 'Pandas', 'scikit-learn', 'SQL', 'PostgreSQL', 'BigQuery']));
    expect(new Set(cv.skills.map((s) => s.toLowerCase())).size).toBe(cv.skills.length);
    expect(cv.skills).not.toContain('competitive');
    expect(cv.skills.some((s) => /Native|IELTS|Intermediate/.test(s))).toBe(false);
    expect(cv.careerSuggestions.filter((c) => c.kind === 'LANGUAGE').map((l) => l.title)).toEqual(['Azerbaijani', 'English', 'Turkish']);
  });
});

describe('text extraction joins fragments by their real distance', () => {
  const item = (x: number, xEnd: number, text: string, y = 700): PositionedItem => ({ x, xEnd, y, text, h: 8.4 });

  it('does not put spaces inside words, hyphenated compounds or years', () => {
    const lines = linesFromItems([
      item(55, 212, 'Designed an ISAE 3000 limited'), item(212, 214.6, '-'), item(214.7, 300, 'assurance methodology'),
      item(55, 90, 'pathwa', 650), item(90, 101, 'ys.', 650),
      item(55, 95, 'Jun 202', 600), item(95, 100, '6', 600), item(103, 110, '-', 600), item(113, 140, 'Present', 600),
    ]);
    expect(lines).toEqual(['Designed an ISAE 3000 limited-assurance methodology', 'pathways.', 'Jun 2026 - Present']);
  });

  it('keeps real spaces between separate words and treats a one-point baseline difference as the same line', () => {
    const lines = linesFromItems([item(10, 40, 'Senior', 700), item(46, 80, 'Analyst', 699.4), item(100, 130, 'Acme', 700.3)]);
    expect(lines).toEqual(['Senior Analyst Acme']);
  });
});
