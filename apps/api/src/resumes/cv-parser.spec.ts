import { CV_LIMITS, parseCv, findDateRange, normalizeText } from './cv-parser';

/**
 * Cover for the parser that replaced the hardcoded stub. The stub returned
 * identical skills for every upload, which silently fed the matching
 * pipeline invented data, so these tests care most about two things: real
 * fields come out of realistic text, and nothing is invented when the text
 * says nothing.
 */

const AZ_CV = `
Elvin Məmmədov
Bakı, Azərbaycan
elvin.mammadov@example.com
+994 50 123 45 67

Haqqımda
5 illik təcrübəsi olan Frontend Developer, React və TypeScript üzrə ixtisaslaşmışam.

İş təcrübəsi
Mart 2021 - hazırda
Senior Frontend Developer
Azericard MMC
React və TypeScript ilə daxili bank panelləri hazırlamışam.

Yanvar 2019 - Fevral 2021
Frontend Developer
Ultra Technologies
Vue əsaslı e-ticarət saytları.

Təhsil
2015 - 2019
Bakı Dövlət Universiteti
Bakalavr
Kompüter elmləri

Bacarıqlar
React, TypeScript, JavaScript, Node.js, Tailwind CSS, Git

Dillər
Azərbaycan dili, İngilis dili, Rus dili
`;

describe('parseCv', () => {
  describe('an Azerbaijani CV', () => {
    const cv = parseCv(AZ_CV);

    it('reads the contact block', () => {
      expect(cv.personalInfo.name).toBe('Elvin Məmmədov');
      expect(cv.personalInfo.email).toBe('elvin.mammadov@example.com');
      expect(cv.personalInfo.phone).toBe('+994 50 123 45 67');
    });

    it('reads the location', () => {
      expect(cv.location).toBe('Bakı');
    });

    it('takes the headline from the summary section', () => {
      expect(cv.headline).toContain('Frontend Developer');
    });

    it('reads the skills the CV actually lists', () => {
      expect(cv.skills).toEqual(
        expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'Tailwind CSS', 'Git']),
      );
    });

    it('does not return the old stub skills unless they are present', () => {
      // The stub always emitted exactly these three; React/TypeScript are
      // genuinely in this CV, so the check is that skills are not *limited*
      // to the stub set.
      expect(cv.skills.length).toBeGreaterThan(3);
    });

    it('reads both roles with employers and dates', () => {
      expect(cv.workExperience).toHaveLength(2);

      const [recent, previous] = cv.workExperience;
      expect(recent.title).toBe('Senior Frontend Developer');
      expect(recent.company).toBe('Azericard MMC');
      expect(recent.startDate).toBe('2021-03-01T00:00:00.000Z');
      expect(recent.endDate).toBeNull(); // "hazırda" = still there

      expect(previous.title).toBe('Frontend Developer');
      expect(previous.company).toBe('Ultra Technologies');
      expect(previous.endDate).toBe('2021-02-01T00:00:00.000Z');
    });

    it('reads education', () => {
      expect(cv.education).toHaveLength(1);
      expect(cv.education[0].institution).toBe('Bakı Dövlət Universiteti');
      expect(cv.education[0].degree.toLowerCase()).toBe('bakalavr');
      expect(cv.education[0].fieldOfStudy).toBe('Kompüter elmləri');
    });

    it('reads education date ranges where month name has "to" with MONTH precision and start date', () => {
      const cvWithDate = parseCv(`
Fizuli Hasanov
Bakı, Azərbaycan

Təhsil
October 2025 - December 2025
Aspire Institute
Leadership Development
`);
      expect(cvWithDate.education).toHaveLength(1);
      expect(cvWithDate.education[0].institution).toBe('Aspire Institute');
      expect(cvWithDate.education[0].startDate).toBe('2025-10-01T00:00:00.000Z');
      expect(cvWithDate.education[0].endDate).toBe('2025-12-01T00:00:00.000Z');
      expect(cvWithDate.education[0].startPrecision).toBe('MONTH');
      expect(cvWithDate.education[0].endPrecision).toBe('MONTH');
    });

    it('reports which fields it found', () => {
      expect(cv.extracted).toEqual(
        expect.arrayContaining(['name', 'email', 'phone', 'skills', 'workExperience', 'education']),
      );
    });
  });

  describe('an English CV', () => {
    const cv = parseCv(`
John Smith
London
john@example.com

Experience
2020 - 2023
Backend Engineer
Acme Ltd
Built Python services on AWS.

Skills
Python, Docker, PostgreSQL
`);

    it('handles English headings too', () => {
      expect(cv.personalInfo.name).toBe('John Smith');
      expect(cv.skills).toEqual(expect.arrayContaining(['Python', 'Docker', 'PostgreSQL']));
      expect(cv.workExperience[0].title).toBe('Backend Engineer');
      expect(cv.workExperience[0].company).toBe('Acme Ltd');
    });
  });

  describe('a long career is read completely', () => {
    const roles = (n: number) => Array.from({ length: n }, (_, i) => `${1990 + i} - ${1991 + i}\nEngineer ${i + 1}\nCompany ${i + 1} Ltd\nBuilt service number ${i + 1}.`).join('\n\n');
    const cvWith = (n: number) => parseCv(`John Smith\nLondon\njohn@example.com\n\nExperience\n${roles(n)}\n\nSkills\nPython, Docker`);

    it('keeps all 25 roles (the old limit was 15) and reports nothing as left out', () => {
      const cv = cvWith(25);
      expect(cv.workExperience).toHaveLength(25);
      expect(cv.workExperience.map((r) => r.company)).toContain('Company 25 Ltd');
      expect(cv.omitted).toBeUndefined();
    });

    it('says so when a section exceeds even the generous limit, instead of dropping entries silently', () => {
      const cv = cvWith(CV_LIMITS.workExperience + 3);
      expect(cv.workExperience).toHaveLength(CV_LIMITS.workExperience);
      expect(cv.omitted).toEqual({ workExperience: 3 });
    });
  });

  describe('invents nothing', () => {
    it('returns empty fields for text with no CV structure', () => {
      const cv = parseCv('bu sadəcə təsadüfi mətndir və heç bir struktur yoxdur');
      expect(cv.skills).toEqual([]);
      expect(cv.workExperience).toEqual([]);
      expect(cv.education).toEqual([]);
      expect(cv.personalInfo.phone).toBe('');
      expect(cv.extracted).toEqual([]);
    });

    it('returns empty fields for empty input', () => {
      const cv = parseCv('');
      expect(cv.personalInfo.name).toBe('');
      expect(cv.skills).toEqual([]);
      expect(cv.extracted).toEqual([]);
    });

    it('falls back to the account name and email only when given them', () => {
      const cv = parseCv('', { name: 'Aysel Quliyeva', email: 'aysel@example.com' });
      expect(cv.personalInfo.name).toBe('Aysel Quliyeva');
      expect(cv.personalInfo.email).toBe('aysel@example.com');
      // A fallback is not an extraction, so it must not be reported as one.
      expect(cv.extracted).toEqual([]);
    });

    it('prefers the CV\'s own email over the account fallback', () => {
      const cv = parseCv('Contact: real@cv.com', { email: 'account@example.com' });
      expect(cv.personalInfo.email).toBe('real@cv.com');
    });
  });

  describe('robustness', () => {
    it('does not treat a heading word inside a sentence as a section', () => {
      const cv = parseCv(`
Rəşad Əliyev
Mənim iş təcrübəsi haqqında ətraflı danışa bilərəm və bu cümlədir.
`);
      expect(cv.workExperience).toEqual([]);
    });

    it('survives a very long single line', () => {
      expect(() => parseCv('x'.repeat(200_000))).not.toThrow();
    });

    it('caps runaway inputs', () => {
      const many = Array.from({ length: 400 }, (_, i) => `200${i % 10} - 201${i % 10}\nRole ${i}\nCo ${i}`).join('\n');
      const cv = parseCv(`İş təcrübəsi\n${many}`);
      expect(cv.workExperience.length).toBeLessThanOrEqual(CV_LIMITS.workExperience);
      expect(cv.omitted?.workExperience).toBeGreaterThan(0);
    });
  });
});

describe('findDateRange', () => {
  it('parses month-name ranges', () => {
    expect(findDateRange('Mart 2021 - Fevral 2023')).toMatchObject({
      start: '2021-03-01T00:00:00.000Z',
      end: '2023-02-01T00:00:00.000Z',
      current: false,
    });
  });

  it('parses numeric ranges', () => {
    expect(findDateRange('03/2021 – 06/2023')).toMatchObject({
      start: '2021-03-01T00:00:00.000Z',
      end: '2023-06-01T00:00:00.000Z',
    });
  });

  it('parses year-only ranges', () => {
    expect(findDateRange('2015 - 2019')).toMatchObject({
      start: '2015-01-01T00:00:00.000Z',
      end: '2019-01-01T00:00:00.000Z',
    });
  });

  it('treats "hazırda" and "present" as ongoing', () => {
    expect(findDateRange('2021 - hazırda')).toMatchObject({ current: true, end: null });
    expect(findDateRange('2021 - present')).toMatchObject({ current: true, end: null });
  });

  it('returns null when there is no year', () => {
    expect(findDateRange('Senior Frontend Developer')).toBeNull();
  });

  it('parses ranges where month names contain "to" such as October without splitting prematurely', () => {
    expect(findDateRange('October 2025 - December 2025')).toEqual({
      start: '2025-10-01T00:00:00.000Z',
      end: '2025-12-01T00:00:00.000Z',
      current: false,
      startPrecision: 'MONTH',
      endPrecision: 'MONTH',
    });
    expect(findDateRange('Development · (October 2025 - December 2025)')).toEqual({
      start: '2025-10-01T00:00:00.000Z',
      end: '2025-12-01T00:00:00.000Z',
      current: false,
      startPrecision: 'MONTH',
      endPrecision: 'MONTH',
    });
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and drops blank lines', () => {
    expect(normalizeText('a  b\n\n\n  c  \r\nd')).toEqual(['a b', 'c', 'd']);
  });
});

describe('Azerbaijani locale hazards', () => {
  // Every one of these was a real defect found by running the parser against a
  // realistic Azerbaijani CV, and every one of them fails silently rather than
  // throwing — which is exactly why they are pinned here.

  it('matches headings that begin with the dotted İ', () => {
    // "İş təcrübəsi".toLowerCase() is "i" + COMBINING DOT ABOVE, not "iş".
    const cv = parseCv(`Ad Soyad\nİş təcrübəsi\n2020 - 2022\nAnalyst\nAcme MMC`);
    expect(cv.workExperience).toHaveLength(1);
    expect(cv.workExperience[0].title).toBe('Analyst');
  });

  it('preserves uppercase names like FIZULI HASANOV without corrupting I to dotless ı', () => {
    const cv = parseCv('FIZULI HASANOV\nBakı, Azərbaycan\nİş təcrübəsi\n2020 - 2022\nAnalyst\nAcme MMC');
    expect(cv.personalInfo.name).toBe('Fizuli Hasanov');
  });

  it('parses İ-initial month names', () => {
    // İyun/İyul used to fall through to January of the same year.
    expect(findDateRange('İyun 2021 - Avqust 2022')).toMatchObject({
      start: '2021-06-01T00:00:00.000Z',
      end: '2022-08-01T00:00:00.000Z',
    });
    expect(findDateRange('İyul 2019 - Mart 2020')).toMatchObject({
      start: '2019-07-01T00:00:00.000Z',
    });
  });

  it('matches city names ending in a non-ASCII letter', () => {
    // /\bBakı\b/ can never match: ı is not an ASCII word character.
    expect(parseCv('Ad Soyad\nBakı, Azərbaycan').location).toBe('Bakı');
    expect(parseCv('Ad Soyad\nSumqayıt').location).toBe('Sumqayıt');
  });

  it('takes the location from the header, not from a university name', () => {
    const cv = parseCv(`
Aysel Quliyeva
Sumqayıt, Azərbaycan

Təhsil
2017 - 2021
Bakı Dövlət Universiteti
Bakalavr
`);
    // "Bakı" appears later in the institution name; the header must win.
    expect(cv.location).toBe('Sumqayıt');
  });

  it('folds case when de-duplicating skills', () => {
    const cv = parseCv('Ad Soyad\nBacarıqlar\nPython, python, PYTHON');
    const pythons = cv.skills.filter((s) => s.toLowerCase() === 'python');
    expect(pythons).toHaveLength(1);
  });
});

describe('skills with inline category labels', () => {
  it('strips a leading "Category:" label instead of fusing it onto the first entry', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Skills',
      'Programming Languages: Python, Java, C++',
      'Frameworks: React, Django',
    ].join('\n'));

    expect(cv.skills).toEqual(expect.arrayContaining(['Python', 'Java', 'C++', 'React', 'Django']));
    expect(cv.skills.some((s) => s.includes(':'))).toBe(false);
    expect(cv.skills).not.toContain('Programming Languages: Python');
  });
});

describe('skills that differ only by digits/symbols', () => {
  it('does not fold "C++" and "1C" into the same skill', () => {
    // fold() (used for headings/prose) strips digits and symbols, so
    // "C++" and "1C" both reduce to bare "c" — mentioning either used to
    // register *both*, and whichever sorted later in KNOWN_SKILLS silently
    // overwrote the other's display name.
    const cv = parseCv('Ad Soyad\nBacarıqlar\nC++, Python');
    expect(cv.skills).toContain('C++');
    expect(cv.skills).not.toContain('1C');
  });

  it('keeps "1C" and "C++" distinct when both are actually present', () => {
    const cv = parseCv('Ad Soyad\nBacarıqlar\n1C, C++, C#');
    expect(cv.skills).toEqual(expect.arrayContaining(['1C', 'C++', 'C#']));
  });
});

describe('skill aliases', () => {
  it('recognizes common abbreviations and maps them to the canonical name', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Summary',
      'Backend work with Node and Postgres, some Mongo, deployed on K8s.',
    ].join('\n'));

    expect(cv.skills).toEqual(
      expect.arrayContaining(['Node.js', 'PostgreSQL', 'MongoDB', 'Kubernetes']),
    );
  });

  it('does not let a JS/Node alias collide with unrelated words', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Summary',
      'Managed a distributed system with many nodes across regions.',
    ].join('\n'));

    // "nodes" must not be mistaken for the "Node" alias — containsWord
    // requires a whole-word match, this just guards the actual behavior.
    expect(cv.skills).not.toContain('Node.js');
  });
});

describe('decorated/extended section headings', () => {
  it('recognizes a heading with extra trailing words as the same section', () => {
    const cv = parseCv([
      'Ad Soyad',
      'TECHNICAL SKILLS AND TOOLS',
      'Excel, Git, Figma',
    ].join('\n'));

    expect(cv.skills).toEqual(expect.arrayContaining(['Excel', 'Git', 'Figma']));
  });

  it('does not mistake an ordinary sentence starting with a heading word for a new section', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Haqqımda',
      'Experience working in a fast-paced team taught me to prioritize ruthlessly and ship on time.',
      'İş təcrübəsi',
      'Mart 2021 - hazırda',
      'Developer',
      'Acme MMC',
    ].join('\n'));

    // The long sentence must stay in the summary section, not get parsed as
    // a heading and swallow the real "İş təcrübəsi" content into the wrong bucket.
    expect(cv.workExperience).toHaveLength(1);
    expect(cv.workExperience[0].company).toBe('Acme MMC');
  });

  it('recognizes headings past the original five sections so they stop bleeding into experience', () => {
    // Every one of these was a real defect: once the parser ran out of known
    // headings after "Professional Experience" it kept accumulating, so an
    // entire resume tail (ventures, projects, capabilities, certifications,
    // leadership) silently misread as extra job entries.
    const cv = parseCv([
      'Ad Soyad',
      'Professional Experience',
      'Jun 2020 - Present',
      'Engineer',
      'Acme Inc',
      'Shipped things.',
      'Startups & Ventures',
      'Jun 2021 - Present',
      'MyStartup',
      'Founder',
      'Building a thing.',
      'Capabilities & Tools',
      'Python, SQL, Excel',
      'Certifications & Programs',
      'AWS Certified Solutions Architect',
      'Leadership & Community',
      'Volunteer coordinator for a local NGO.',
    ].join('\n'));

    expect(cv.workExperience).toHaveLength(2);
    expect(cv.workExperience.some((e) => e.description.includes('AWS Certified'))).toBe(false);
    expect(cv.workExperience.some((e) => e.description.includes('Volunteer coordinator'))).toBe(false);
    expect(cv.skills).toEqual(expect.arrayContaining(['Python', 'SQL', 'Excel']));
  });
});

describe('a single-line title/company/date header (tab-aligned right date)', () => {
  // Real defect found against a modern CV template: the position line and
  // its date range share one paragraph, right-aligned via a tab stop
  // ("Title | Company | Location    Jun 2024 - Present") rather than the
  // date sitting on a line of its own. Previously this meant no date at all
  // (the "is this whole line just a date" check only fires on short lines)
  // and a garbled title containing the date, with the *next* physical line
  // (a bullet) wrongly consumed as "company".
  it('separates the trailing date from the header and does not consume the next bullet as company', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Experience',
      'Senior Analyst | Acme Inc | Baku, Azerbaijan Jun 2024 - Present',
      'Did the first big thing.',
      'Did the second big thing.',
    ].join('\n'));

    expect(cv.workExperience).toHaveLength(1);
    const [entry] = cv.workExperience;
    expect(entry.title).toBe('Senior Analyst');
    expect(entry.company).toBe('Acme Inc');
    expect(entry.startDate).toBe('2024-06-01T00:00:00.000Z');
    expect(entry.endDate).toBeNull();
    expect(entry.description).toContain('Did the first big thing.');
    expect(entry.description).toContain('Did the second big thing.');
  });

  it('splits a pipe-delimited education header into institution/degree/field, dropping the location', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Education',
      'Bachelor of Business Administration | Baku Higher Oil School | Baku, Azerbaijan Sep 2020 - Jun 2024',
    ].join('\n'));

    expect(cv.education).toHaveLength(1);
    const [entry] = cv.education;
    expect(entry.institution).toBe('Baku Higher Oil School');
    expect(entry.degree.toLowerCase()).toBe('bachelor');
    expect(entry.fieldOfStudy).toBe('Business Administration');
    expect(entry.startDate).toBe('2020-09-01T00:00:00.000Z');
    expect(entry.endDate).toBe('2024-06-01T00:00:00.000Z');
  });
});

describe('a long single-paragraph profile/summary section', () => {
  it('keeps a dense summary whole and never cuts the headline inside a word', () => {
    const longSummary =
      'Presidential Scholar and BBA student with experience across AI-enabled product development, business and data analysis, innovation, and strategy research spanning multiple ventures and internships.';
    expect(longSummary.length).toBeGreaterThan(120);

    const cv = parseCv([
      'Ad Soyad',
      'Profile',
      longSummary,
      'Experience',
      '2022 - 2023',
      'Analyst',
      'Acme Inc',
    ].join('\n'));

    // The whole paragraph is kept as the summary; the headline is cut at a word boundary (never "…with experien").
    expect(cv.summary).toBe(longSummary);
    expect(cv.headline.length).toBeLessThanOrEqual(141);
    expect(longSummary.startsWith(cv.headline.replace(/…$/, ''))).toBe(true);
    expect(cv.headline.replace(/…$/, '')).toMatch(/\w$/);
    expect(longSummary.charAt(cv.headline.replace(/…$/, '').length)).toBe(' ');
  });
});

describe('short skill tokens that collide with ordinary words', () => {
  it('does not detect "Go" from "go-to-market" or "R" from "R-squared"', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Summary',
      'Focused on go-to-market planning and reported an R-squared of 0.8 in the model.',
    ].join('\n'));

    expect(cv.skills).not.toContain('Go');
    expect(cv.skills).not.toContain('R');
  });

  it('still finds Go when the CV actually lists Golang as a skill', () => {
    // Only the bare "Go"/"R" whole-document scan (KNOWN_SKILLS pass 2) was
    // removed; the SKILL_ALIASES entry ("Golang" -> "Go") is a safe, specific
    // token and still matches. A bare single-letter "R" was never picked up
    // by either pass — pass 1 has its own `length >= 2` bound — so that's an
    // existing limit, not something this fix touches either way.
    const cv = parseCv(['Ad Soyad', 'Skills', 'Golang, Python'].join('\n'));
    expect(cv.skills).toEqual(expect.arrayContaining(['Go', 'Python']));
  });
});

describe('skills with parenthetical qualifiers', () => {
  it('keeps a parenthetical group intact instead of splitting on the comma inside it', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Skills',
      'Data tools: Python (pandas, scikit-learn), SQL (PostgreSQL, BigQuery), Excel',
    ].join('\n'));

    expect(cv.skills).not.toContain('Python (pandas');
    expect(cv.skills).not.toContain('scikit-learn)');
    // Individual tools still surface via the known-skills pass.
    expect(cv.skills).toEqual(expect.arrayContaining(['Python', 'PostgreSQL', 'BigQuery', 'Excel']));
  });

  it('keeps a language entry whole (wordy proficiency note included) as a language, not as a skill', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Languages',
      'Azerbaijani (Native), English (C1 - IELTS 7.0), Turkish (Intermediate)',
    ].join('\n'));

    expect(cv.skills).toEqual([]);
    const langs = cv.careerSuggestions.filter((c) => c.kind === 'LANGUAGE');
    expect(langs.map((l) => l.title)).toEqual(['Azerbaijani', 'English', 'Turkish']);
    expect(langs.find((l) => l.title === 'English')?.level).toMatch(/C1/);
  });

  it('reads a "Languages:" line inside the skills section as languages and joins wrapped skill lines', () => {
    const cv = parseCv([
      'Ad Soyad',
      'Capabilities & Tools',
      'Business: Business analysis, product discovery, competitive',
      'benchmarking, KPI design',
      'Data: Python for analysis (pandas, scikit-learn), SQL (PostgreSQL, BigQuery), Excel',
      'Languages: Azerbaijani (Native), English (C1 - IELTS 7.0)',
    ].join('\n'));

    expect(cv.skills).toEqual(expect.arrayContaining(['competitive benchmarking'.replace('competitive ', 'competitive ')]));
    expect(cv.skills).not.toContain('competitive');
    expect(cv.skills).toEqual(expect.arrayContaining(['Python', 'scikit-learn', 'SQL', 'PostgreSQL', 'BigQuery', 'Excel']));
    expect(cv.skills.filter((s) => /^SQL/.test(s))).toEqual(['SQL']);
    expect(cv.skills.some((s) => /Native|IELTS/.test(s))).toBe(false);
    expect(cv.careerSuggestions.filter((c) => c.kind === 'LANGUAGE').map((l) => l.title)).toEqual(['Azerbaijani', 'English']);
  });

  describe('multiple roles under one employer', () => {
    it('inherits company for consecutive roles when employer name is listed once', () => {
      const cv = parseCv([
        'Ad Soyad',
        'İş təcrübəsi',
        'PASHA Bank ASC',
        'Senior Software Engineer | 2022 - Present',
        'Led backend systems architecture and cloud migration.',
        'Software Engineer | 2020 - 2022',
        'Built payment transaction services in Go and PostgreSQL.',
      ].join('\n'));

      expect(cv.workExperience).toHaveLength(2);
      expect(cv.workExperience[0].title).toBe('Senior Software Engineer');
      expect(cv.workExperience[0].company).toBe('PASHA Bank ASC');
      expect(cv.workExperience[1].title).toBe('Software Engineer');
      expect(cv.workExperience[1].company).toBe('PASHA Bank ASC');
    });
  });

  describe('page furniture filtering', () => {
    it('filters out stray page numbers and curriculum vitae headers from sections', () => {
      const cv = parseCv([
        'Curriculum Vitae',
        'Ad Soyad',
        'Haqqımda',
        'Analitik təfəkkürə və proqramlaşdırma üzrə praktiki hazırlığa malikəm.',
        'Page 1 of 2',
        'İş təcrübəsi',
        'Backend Developer | Payriff MMC | 2023 - Present',
        'Mikroservisləri inkişaf etdirirəm.',
        '- 2 -',
        'Təhsil',
        'Bakı Dövlət Universiteti | Bakalavr | Tətbiqi riyaziyyat | 2019 - 2023',
        'Səhifə 2 / 2',
      ].join('\n'));

      expect(cv.personalInfo.name).toBe('Ad Soyad');
      expect(cv.workExperience).toHaveLength(1);
      expect(cv.workExperience[0].company).toBe('Payriff MMC');
      expect(cv.education).toHaveLength(1);
      expect(cv.education[0].institution).toBe('Bakı Dövlət Universiteti');
      // Verifies page labels were not treated as experience, skills, or headline
      expect(cv.headline).not.toMatch(/Page|Səhifə|Curriculum Vitae/i);
    });
  });
});
