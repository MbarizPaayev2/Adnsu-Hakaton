import { canonicalSkill, evidenceFor, extractPostingNeeds, skillGuidance } from './job-skills';

const POSTING_EN = `
About the role
We build analytics for retail banks.

Responsibilities:
- Prepare monthly dashboards in Power BI
- Work with the product team

Requirements:
- Bachelor's degree in Economics, Finance or a related field
- 2+ years of experience in data analysis
- Strong knowledge of SQL and Excel
- Experience with Python, pandas
- Excellent communication skills
- Fluent English

Nice to have:
- Tableau
- Knowledge of Azure is a plus
`;

const POSTING_AZ = `
Tələblər:
- Ali təhsil (iqtisadiyyat, maliyyə)
- Minimum 3 il iş təcrübəsi
- MS Excel və 1C proqramını yaxşı bilmək
- Komanda ilə iş bacarığı
- İngilis dili (orta səviyyə)
Üstünlüklər:
- SQL bilikləri
`;

describe('extractPostingNeeds', () => {
  const n = extractPostingNeeds({ title: 'Data Analyst', description: POSTING_EN });
  const byLevel = (l: string) => n.skills.filter((s) => s.level === l).map((s) => s.skill);

  it('separates required from preferred, with the line each came from', () => {
    expect(byLevel('required')).toEqual(expect.arrayContaining(['SQL', 'MS Excel', 'Python', 'Communication skills']));
    expect(byLevel('preferred')).toEqual(expect.arrayContaining(['Tableau', 'Azure']));
    expect(byLevel('required')).not.toContain('Tableau');
    expect(n.skills.find((s) => s.skill === 'SQL')!.requirement).toMatch(/Strong knowledge of SQL and Excel/);
  });

  it('keeps degrees and years of experience out of the skills', () => {
    expect(n.other.map((o) => o.kind).sort()).toEqual(['degree', 'experience']);
    expect(n.skills.map((s) => s.skill.toLowerCase()).join('|')).not.toMatch(/bachelor|degree|years/);
  });

  it('does not take responsibilities as requirements', () => {
    expect(n.skills.map((s) => s.skill)).not.toContain('Power BI');
  });

  it('reads an Azerbaijani posting the same way', () => {
    const az = extractPostingNeeds({ title: 'Mühasib', description: POSTING_AZ });
    expect(az.skills.filter((s) => s.level === 'required').map((s) => s.skill)).toEqual(expect.arrayContaining(['MS Excel', '1C', 'Teamwork', 'English']));
    expect(az.skills.find((s) => s.skill === 'SQL')?.level).toBe('preferred');
    expect(az.other.map((o) => o.kind)).toEqual(expect.arrayContaining(['degree', 'experience']));
  });

  it('treats the listed skills of a native vacancy as required', () => {
    const v = extractPostingNeeds({ title: 'x', description: '', requirements: null, skills: ['Figma', 'Photoshop'] });
    expect(v.skills.map((s) => [s.skill, s.level])).toEqual([['Figma', 'required'], ['Photoshop', 'required']]);
  });
});

describe('profile evidence', () => {
  const profile = {
    skills: ['Excel', 'Python'],
    experiences: [{ title: 'Analyst', company: 'Acme', description: 'Built Power BI dashboards\nWrote SQL queries for churn analysis' }],
    languages: [{ title: 'English' }],
  };

  it('recognises synonyms and the same skill written another way', () => {
    expect(canonicalSkill('Microsoft Excel').key).toBe(canonicalSkill('MS Excel').key);
    expect(canonicalSkill('Postgres').label).toBe('PostgreSQL');
    expect(evidenceFor('MS Excel', profile)?.via).toBe('skills');
  });

  it('counts a skill the experience bullets show as evidenced, and says where', () => {
    expect(evidenceFor('SQL', profile)).toEqual({ skill: 'SQL', via: 'experience', where: 'Analyst, Acme' });
    expect(evidenceFor('Tableau', profile)).toBeNull();
  });

  it('builds the guidance without ever claiming the candidate lacks a skill', () => {
    const g = skillGuidance(extractPostingNeeds({ title: 'x', description: POSTING_EN }), profile);
    expect(g.evidenced.map((s) => s.skill)).toEqual(expect.arrayContaining(['SQL', 'MS Excel', 'Python', 'English']));
    expect(g.missingRequired.map((s) => s.skill)).toEqual(expect.arrayContaining(['Communication skills']));
    expect(g.missingPreferred.map((s) => s.skill)).toEqual(expect.arrayContaining(['Tableau', 'Azure']));
    expect(g.evidenced.map((s) => s.skill)).not.toContain('Tableau');
  });
});


it('retains every compound source requirement, including unknown long domain requirements', () => {
  const long = ('Nadir sektor metodologiyası üzrə ' + 'praktiki sınaq və yoxlama prosedurları '.repeat(9)).trim();
  const lines = [...Array.from({ length: 14 }, (_, i) => `SQL və Python bilikləri, hesabat ${i + 1}`), long];
  const needs = extractPostingNeeds({ requirements: lines.join('\n') });
  expect(needs.sourceRequirements?.map((r) => r.text)).toEqual(lines);
  expect(needs.other.some((r) => r.text === long)).toBe(true);
  const guidance = skillGuidance(needs, { skills: [], experiences: [] });
  expect(guidance.sourceRequirements).toEqual(needs.sourceRequirements);
});
