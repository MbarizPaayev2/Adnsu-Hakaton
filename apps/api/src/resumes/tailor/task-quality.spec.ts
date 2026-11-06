import { postingLines } from '../../jobs/posting-sections';
import { extractPostingNeeds } from '../../jobs/job-skills';
import { analyzeVacancy } from './az-vacancy-analysis';
import {
  composeTargetRoleHeadline,
  composeVacancySummary,
  groupAndRankSkills,
  vacancyEvidenceScore,
} from './az-compose';
import { letterEvidence } from './az-writer';
import { composeNarrativeLetter } from './az-letter-compose';
import type { Persona, TailorJobInput } from './resume-tailor.types';

// Synthetic multi-domain candidates. No founder data or employer-specific branches.
const sales: TailorJobInput = {
  id: 'synthetic-sales',
  position: 'Korporativ satış mütəxəssisi',
  company: 'Example Distribution',
  location: 'Bakı',
  education: '',
  experience: '',
  salary_from: '',
  salary_to: '',
  category: '',
  requirements: '',
  responsibilities: '',
  description: `Əsas vəzifə öhdəlikləri:
Müştərilərlə danışıqların aparılması;
Sifarişlərin çatdırılmasının izlənilməsi;
Bazar araşdırmasının aparılması;
Satış hesabatlarının hazırlanması;
Tələb olunan bilik və bacarıqlar:
Excel, Word, Outlook proqramları üzrə biliklər;
MS Office bilikləri;
Təqdimat proqramlarında işləmək bacarığı (PPT, Visio);
Tələb olunan təhsil, iş təcrübəsi və dil bilikləri:
2-4 il satış təcrübəsi;
Azərbaycan dili səlis;
İş şərtlərimiz:
İş saatları: 09:00-18:00;
Biz nə təklif edirik:
Python təlimi və komanda tədbirləri;
Nahar;`,
};
const candidate = {
  basics: {
    name: 'Aysel Example',
    headline: 'Analyst',
    email: 'aysel@example.test',
    phone: '',
    location: 'Bakı',
    website: { url: '', label: '' },
  },
  summary: '',
  experience: [
    {
      entryId: 'fraud',
      position: 'Data analyst',
      company: 'Example Lab',
      period: '2024',
      location: '',
      highlights: [
        '284,807 əməliyyat üçün fırıldaqçılıq modelini hazırladım; XGBoost dəqiqliyi 98% oldu.',
      ],
    },
    {
      entryId: 'market',
      position: 'Market research intern',
      company: 'Example Project',
      period: '2025',
      location: '',
      highlights: [
        'Bazar araşdırması apardım və rəqib qiymətlərini müqayisə etdim.',
        'Müştəri sifarişləri üzrə satış hesabatlarını hazırladım.',
      ],
    },
  ],
  education: [],
  projects: [],
  certifications: [],
  languages: [],
  activities: [],
  awards: [],
  skills: [
    {
      name: 'Skills',
      keywords: [
        'Excel',
        'Word',
        'Outlook',
        'Satış',
        'Biznes təhlili',
        'Kohort və müştəri saxlama təhlili',
        'Python',
      ],
      proficiency: '',
      level: 0,
    },
  ],
} satisfies Persona;

describe('task-first document quality', () => {
  it('reads whole mixed-section postings and keeps benefits out of requirements and tools', () => {
    const analysis = analyzeVacancy(sales);
    expect(analysis.principalResponsibilities).toHaveLength(4);
    expect(analysis.requiredQualifications.join(' ')).toContain('2-4 il');
    expect(analysis.toolsAndTechnologies).toEqual(
      expect.arrayContaining(['excel', 'word', 'outlook', 'visio']),
    );
    expect(analysis.toolsAndTechnologies).not.toContain('python');
    const needs = extractPostingNeeds({ description: sales.description });
    expect(needs.skills.map((s) => s.skill)).toEqual(
      expect.arrayContaining([
        'MS Excel',
        'Word',
        'Outlook',
        'MS Office',
        'PowerPoint',
        'Visio',
        'Azerbaijani',
      ]),
    );
    for (const bad of ['Biz', 'MS', 'Python'])
      expect(needs.skills.map((s) => s.skill)).not.toContain(bad);
    expect(needs.sourceRequirements?.map((r) => r.text).join(' ')).not.toMatch(
      /təklif|Nahar|09:00/,
    );
  });
  it.each([
    ['Requirements: SQL\nBenefits:\nPython training', 'SQL', 'Python'],
    ['Требования:\nSQL\nМы предлагаем:\nPython training', 'SQL', 'Python'],
    ['Tələblər: SQL\nBiz nə təklif edirik:\nPython təlimi', 'SQL', 'Python'],
  ])(
    'recognizes inline and multilingual section boundaries',
    (text, required, excluded) => {
      const lines = postingLines(text);
      expect(lines.find((l) => l.text === required)?.section).toBe('required');
      expect(
        extractPostingNeeds({ description: text }).skills.map((s) => s.skill),
      ).toContain(required);
      expect(
        extractPostingNeeds({ description: text }).skills.map((s) => s.skill),
      ).not.toContain(excluded);
    },
  );
  it('keeps all responsibility and requirement lines beyond the old display caps', () => {
    const job = {
      ...sales,
      description: '',
      responsibilities: Array.from(
        { length: 15 },
        (_, i) => `Sifariş ${i + 1} üzrə hesabatın hazırlanması`,
      ).join('\n'),
    };
    expect(analyzeVacancy(job).principalResponsibilities).toHaveLength(15);
  });
  it('ranks task evidence above irrelevant large metrics without changing source identities', () => {
    expect(
      vacancyEvidenceScore(candidate.experience[1].highlights[0], sales),
    ).toBeGreaterThan(
      vacancyEvidenceScore(candidate.experience[0].highlights[0], sales),
    );
    const facts = letterEvidence(candidate, sales);
    expect(facts[0].sourceId).toBe('experience:market');
    expect(
      facts.find((e) => e.sourceId === 'experience:fraud')?.text,
    ).toContain('284,807');
    const summary = composeVacancySummary(candidate, sales);
    expect(summary).not.toMatch(/284,807|XGBoost/);
    expect(summary).toMatch(/Bazar|satış/);
    const letter = composeNarrativeLetter(candidate, sales, {
      motivation: 'Müştərilərlə və satış məlumatları ilə işləmək istəyirəm.',
    }).paragraphs.join(' ');
    expect(letter).not.toMatch(/XGBoost|284,807/);
    expect(letter).toContain('Example Project');
  });
  it('does not repeat an adopted experience fact in the role paragraph', () => {
    const fact = candidate.experience[1].highlights[1];
    const text = composeNarrativeLetter(candidate, sales, {
      motivation: '',
      formative: `${fact} Bu işə davam etmək istəyirəm.`,
    }).paragraphs.join(' ');
    expect(text.split(fact)).toHaveLength(2);
  });
  it('classifies office tools correctly and rejects compound domain skills supported by only one shared fragment', () => {
    const groups = groupAndRankSkills(candidate, sales);
    expect(
      groups.find((g) => g.name === 'Texniki alətlər və sistemlər')?.keywords,
    ).toEqual(expect.arrayContaining(['Excel', 'Word', 'Outlook']));
    for (const bad of [
      'Kohort və müştəri saxlama təhlili',
      'Biznes təhlili',
      'Python',
    ])
      expect(groups.flatMap((g) => g.keywords)).not.toContain(bad);
    expect(candidate.skills[0].keywords).toContain('Python');
  });
  it('keeps programme participation out of employment wording even when the role title omits mentee', () => {
    const participant = {
      ...candidate,
      experience: [
        {
          ...candidate.experience[1],
          company: 'Example Mentorship Program',
          position: 'Market Research Analyst',
        },
      ],
    };
    expect(letterEvidence(participant, sales)[0].scope).toBe('mentorship');
    const text = composeNarrativeLetter(participant, sales, {
      motivation: '',
    }).paragraphs.join(' ');
    expect(text).toContain('iştirak etmişəm');
    expect(text).not.toContain('vəzifəsində işləmişəm');
  });
  it('does not pad a sales headline with basic office tools', () => {
    const headline = composeTargetRoleHeadline(candidate, sales);
    expect(headline).toContain('Korporativ satış');
    expect(headline).not.toMatch(/Excel|Word|Outlook|\|/);
    const studentHeadline = composeTargetRoleHeadline(
      {
        ...candidate,
        education: [
          {
            school: 'Example',
            degree: 'Bakalavr',
            area: 'Biznesin idarə edilməsi',
            location: '',
            period: '2025',
            grade: '',
          },
        ],
      },
      sales,
    );
    expect(studentHeadline).not.toContain('Biznesin idarə edilməsi');
  });
  it('changes the preferred evidence when the same candidate targets a model-development vacancy', () => {
    const data = {
      ...sales,
      position: 'Machine Learning Engineer',
      description:
        'Requirements: XGBoost\nResponsibilities:\nFırıldaqçılıq modelinin hazırlanması',
      requirements: '',
      responsibilities: '',
    };
    expect(letterEvidence(candidate, data)[0].sourceId).toBe(
      'experience:fraud',
    );
    expect(composeVacancySummary(candidate, data)).toContain('XGBoost');
  });
});
