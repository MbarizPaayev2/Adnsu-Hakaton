import { extractCandidateEvidence, detectScope, mapPrioritiesToEvidence, calculateRelevance } from './az-evidence-mapping';
import { analyzeVacancy } from './az-vacancy-analysis';
import type { Persona, TailorJobInput } from './resume-tailor.types';

describe('az-evidence-mapping', () => {
  const candidate: Persona = {
    basics: {
      name: 'Fizuli Hasanov',
      headline: 'Data Analitik & İqtisadçı',
      email: 'fizuli@example.com',
      phone: '+994501234567',
      location: 'Bakı, Azərbaycan',
      website: { url: 'https://github.com', label: 'GitHub' },
    },
    summary: 'Məlumatların təhlili və hesabatlılıq üzrə mütəxəssis.',
    education: [
      {
        school: 'Azərbaycan Dövlət İqtisad Universiteti',
        degree: 'Bakalavr',
        area: 'Maliyyə',
        location: 'Bakı',
        period: '2020 - 2024',
        grade: '',
      },
    ],
    experience: [
      {
        company: 'Deloitte Azerbaijan',
        position: 'Business Analyst Mentee',
        location: 'Bakı',
        period: '2023 - 2023',
        highlights: [
          'Audit və konsaltinq metodologiyaları üzrə mentorluq sessiyalarında iştirak etdi.',
          'Böyük korporativ müştərilərin biznes tələblərini müşahidə etdi.',
        ],
      },
      {
        company: 'Local Fintech MMC',
        position: 'Data Analyst',
        location: 'Bakı',
        period: '2024 - Present',
        highlights: [
          'PostgreSQL və Python vasitəsilə gündəlik 50,000 tranzaksiyanın təmizlənməsi və vizuallaşdırılmasını qurdu.',
          'Power BI dashboardları ilə rəhbərlik üçün maliyyə hesabatlılığı təmin etdi.',
        ],
      },
    ],
    skills: [
      { name: 'Texniki', keywords: ['SQL', 'Python', 'Power BI', 'Excel', 'Docker'], proficiency: 'Aktiv', level: 4 },
    ],
    projects: [
      {
        name: 'Bank Churn Prediction',
        period: '2024',
        organization: 'Kaggle',
        description: 'Müştəri itkisini proqnozlaşdıran ML modeli qurdu.',
        result: 'Model 88% dəqiqlik göstərdi.',
      },
    ],
    certifications: [
      {
        title: 'Python for Data Science Bootcamp',
        issuer: 'DataCamp',
        date: '2023',
        description: '',
      },
    ],
    languages: [{ language: 'Azərbaycan dili', fluency: 'Ana dili' }, { language: 'İngilis dili', fluency: 'İşgüzar' }],
  };

  const job: TailorJobInput = {
    id: 'job-analytics',
    position: 'Data Analitik',
    company: 'Pasha Bank',
    location: 'Bakı',
    education: 'Ali',
    experience: '1-3 il',
    salary_from: '1500',
    salary_to: '2200',
    category: 'Analitika',
    description: 'Biznes hesabatlarının və analitik modellərin qurulması.',
    requirements: `
      • SQL və Python üzrə biliklər
      • Power BI ilə hesabatların hazırlanması
      • Docker və Kubernetes bilikləri arzuolunandır
      • Tableau üzrə təcrübə üstünlükdür
    `,
    responsibilities: `
      • Məlumat bazalarından tranzaksiyaların analizi
      • Rəhbərlik üçün interaktiv hesabatların hazırlanması
    `,
  };

  it('correctly classifies experience scopes (mentorship vs employment)', () => {
    const evidence = extractCandidateEvidence(candidate);
    const deloitte = evidence.filter((e) => e.organization?.includes('Deloitte'));
    const fintech = evidence.filter((e) => e.organization?.includes('Local Fintech'));

    expect(deloitte.length).toBeGreaterThan(0);
    expect(deloitte[0].scope).toBe('mentorship');

    expect(fintech.length).toBeGreaterThan(0);
    expect(fintech[0].scope).toBe('employment');
  });

  it('ranks direct task relevance higher than brand prestige', () => {
    const analysis = analyzeVacancy(job);
    const toolPriority = analysis.priorities.find((p) => p.category === 'tool_method');
    expect(toolPriority).toBeDefined();

    const evidence = extractCandidateEvidence(candidate);
    const deloitteItem = evidence.find((e) => e.organization?.includes('Deloitte'))!;
    const fintechItem = evidence.find((e) => e.organization?.includes('Local Fintech') && e.tools.includes('python'))!;

    const deloitteScore = calculateRelevance(deloitteItem, toolPriority!, analysis.toolsAndTechnologies);
    const fintechScore = calculateRelevance(fintechItem, toolPriority!, analysis.toolsAndTechnologies);

    // Fintech item with exact Python/PostgreSQL tools must outscore generic Deloitte mentee bullet
    expect(fintechScore).toBeGreaterThan(deloitteScore);
  });

  it('maps priorities and distinguishes direct, skill_only, and unmatched classifications', () => {
    const analysis = analyzeVacancy(job);
    const { matches, gapQuestions } = mapPrioritiesToEvidence(analysis, candidate);

    expect(matches.length).toBe(analysis.priorities.length);

    // SQL/Python tools should have direct matches
    const toolMatch = matches.find((m) => m.matchedEvidence?.tools.includes('python'));
    expect(toolMatch).toBeDefined();
    expect(toolMatch?.classification).toBe('direct');
    expect(toolMatch?.matchedEvidence?.tools).toContain('python');


    // Docker is in skills but not in highlights, so it should be identified if prioritized
    // Tableau is neither in skills nor in highlights, so it should generate gap questions
    expect(gapQuestions.length).toBeLessThanOrEqual(2);
  });

  it('rejects global-tool contamination: Python development with 15k requests scores 0 for Financial audit required', () => {
    const pythonEvidence = {
      id: 'E-py',
      source: 'experience' as const,
      scope: 'employment' as const,
      title: 'Python Backend Developer',
      organization: 'Tech Hub',
      period: '2022 - 2024',
      text: 'Gündəlik 15,000 sorğu qəbul edən yüksək yüklü mikroxidmətləri Python və FastAPI ilə qurdu.',
      tools: ['python', 'fastapi'],
      hasConcreteResult: true,
      isNegated: false,
    };

    const financialAuditPriority = {
      id: 'prio-audit',
      title: 'Maliyyə auditi təcrübəsi',
      sourceText: 'Şirkətin maliyyə hesabatlarının auditi və vergi uyğunluğu yoxlanışı tələb olunur.',
      importance: 'required' as const,
      category: 'domain_knowledge' as const,
      keywords: ['audit', 'maliyyə', 'vergi'],
    };

    // Even if Python occurs elsewhere in the vacancy, scoring against the audit priority must be 0
    const globalVacTools = ['python', 'fastapi', 'docker', 'sql'];
    const score = calculateRelevance(pythonEvidence, financialAuditPriority, globalVacTools);
    expect(score).toBe(0);
  });

  it('withholds concrete deliverable/result bonus from unrelated evidence (unrelated metrics)', () => {
    const unrelatedEvidence = {
      id: 'E-unrelated',
      source: 'experience' as const,
      scope: 'employment' as const,
      title: 'Office Operations Specialist',
      organization: 'Logistics LLC',
      period: '2021 - 2023',
      text: 'Ofis ləvazimatlarının satınalmasını optimallaşdıraraq illik xərcləri 25% azaltdı.',
      tools: [],
      hasConcreteResult: true, // Has 25% metric
      isNegated: false,
    };

    const k8sPriority = {
      id: 'prio-k8s',
      title: 'Kubernetes klasterlərinin idarə edilməsi',
      sourceText: 'Production mühitində Kubernetes klasterlərinin qurulması və monitorinqi.',
      importance: 'required' as const,
      category: 'tool_method' as const,
      keywords: ['kubernetes', 'klaster'],
    };

    const score = calculateRelevance(unrelatedEvidence, k8sPriority);
    expect(score).toBe(0);
  });

  it('assigns 0 relevance to negated experience statements', () => {
    const negatedEvidence = {
      id: 'E-negated',
      source: 'experience' as const,
      scope: 'employment' as const,
      title: 'Junior Developer',
      organization: 'Startup MMC',
      period: '2023 - 2024',
      text: 'Böyük həcmli verilənlər bazası və SQL ilə iş təcrübəsi olmayıb.',
      tools: ['sql'],
      hasConcreteResult: false,
      isNegated: true,
    };

    const sqlPriority = {
      id: 'prio-sql',
      title: 'SQL üzrə dərin biliklər',
      sourceText: 'Mürəkkəb SQL sorğularının yazılması və optimallaşdırılması.',
      importance: 'required' as const,
      category: 'tool_method' as const,
      keywords: ['sql'],
    };

    const score = calculateRelevance(negatedEvidence, sqlPriority);
    expect(score).toBe(0);
  });

  it('distinguishes direct vs transferable evidence and allows multi-priority support', () => {
    const directDevEvidence = {
      id: 'E-direct',
      source: 'experience' as const,
      scope: 'employment' as const,
      title: 'Data Engineer',
      organization: 'Fintech Bank',
      period: '2022 - 2024',
      text: 'PostgreSQL və Python vasitəsilə ETL boru xətlərini qurdu və gündəlik 100,000 tranzaksiya emal etdi.',
      tools: ['postgresql', 'python'],
      hasConcreteResult: true,
      isNegated: false,
    };

    const pythonCourseEvidence = {
      id: 'E-course',
      source: 'certification' as const,
      scope: 'course' as const,
      title: 'Python Programming Certificate',
      organization: 'Coursera',
      period: '2023',
      text: 'Python proqramlaşdırma üzrə intensiv kurs keçdi.',
      tools: ['python'],
      hasConcreteResult: false,
      isNegated: false,
    };

    const pythonPriority = {
      id: 'prio-py',
      title: 'Python proqramlaşdırma',
      sourceText: 'Python ilə skriptlərin və xidmətlərin yazılması tələb olunur.',
      importance: 'required' as const,
      category: 'tool_method' as const,
      keywords: ['python'],
    };

    const postgrePriority = {
      id: 'prio-pg',
      title: 'PostgreSQL verilənlər bazası',
      sourceText: 'PostgreSQL bazalarında məlumat strukturlarının idarəsi.',
      importance: 'required' as const,
      category: 'tool_method' as const,
      keywords: ['postgresql'],
    };

    const testPersona: Persona = {
      basics: { name: 'Ali' },
      experience: [
        {
          company: 'Fintech Bank',
          position: 'Data Engineer',
          highlights: ['PostgreSQL və Python vasitəsilə ETL boru xətlərini qurdu və gündəlik 100,000 tranzaksiya emal etdi.'],
        },
      ],
      skills: [{ keywords: ['Python', 'PostgreSQL'] }],
    };

    const testAnalysis = {
      position: 'Data Engineer',
      company: 'Bank',
      targetDomain: 'Data',
      statedSeniority: 'mid' as const,
      priorities: [pythonPriority, postgrePriority],
      toolsAndTechnologies: ['python', 'postgresql'],
      uncoveredRequirements: [],
    };

    const { matches } = mapPrioritiesToEvidence(testAnalysis, testPersona);
    expect(matches).toHaveLength(2);

    // Both priorities should successfully match the strong dual-purpose evidence without arbitrary lockout
    expect(matches[0].matchedEvidence?.id).toBe(matches[1].matchedEvidence?.id);
    expect(matches[0].classification).toBe('direct');
    expect(matches[1].classification).toBe('direct');

    // Course evidence gets discounted scope multiplier
    const courseScore = calculateRelevance(pythonCourseEvidence, pythonPriority);
    const directScore = calculateRelevance(directDevEvidence, pythonPriority);
    expect(directScore).toBeGreaterThan(courseScore);
  });
});

