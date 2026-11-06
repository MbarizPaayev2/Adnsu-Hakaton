import {
  applyOrder,
  cleanDisplayRole,
  composeTargetRoleHeadline,
  composeVacancySummary,
  deterministicMatches,
  firstPerson,
  groupAndRankSkills,
  rankByRelevance,
  vacancyRequirements,
  vacancyTerms,
  validateMatches,
} from './az-compose';
import type { TailorJobInput } from './resume-tailor.types';

const job = (description: string, extra: Partial<TailorJobInput> = {}): TailorJobInput => ({ id: 'j', position: 'Mühasib', company: 'Nümunə MMC', location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: '', description, requirements: '', responsibilities: '', ...extra });

describe('az-compose (composition helpers)', () => {
  it('first person: only a final simple-past verb takes -m; anything else is left as the candidate wrote it', () => {
    expect(firstPerson('Əsas vəsaitlərin uçotunu apardı.')).toBe('Əsas vəsaitlərin uçotunu apardım');
    expect(firstPerson('Panel qurdu')).toBe('Panel qurdum');
    expect(firstPerson('Hesabat paneli')).toBe('Hesabat paneli');
    expect(firstPerson('Hesabatları hazırlayır.')).toBe('Hesabatları hazırlayır');
    // every finite past verb of the candidate's own action, also before "və"; one sentence at a time
    expect(firstPerson('İlkin sənədləri qəbul etdi və arxivləşdirdi.')).toBe('İlkin sənədləri qəbul etdim və arxivləşdirdim');
    expect(firstPerson('Panel qurdu. Hesabat vaxtı azaldı.')).toBe('Panel qurdum. Hesabat vaxtı azaldı');
    // results and passives whose subject is not the candidate are never turned into "I"
    expect(firstPerson('Tərəfdaşlar vasitəsilə satışların payı 18% oldu.')).toBe('Tərəfdaşlar vasitəsilə satışların payı 18% oldu');
    expect(firstPerson('Uyğunsuzluqlar bağlandı.')).toBe('Uyğunsuzluqlar bağlandı');
  });

  it('vacancy requirements: verbatim lines, without numbers, addresses or links, deduplicated and bounded', () => {
    const lines = vacancyRequirements(job('- Mühasibat uçotu üzrə ilkin sənədləşmələrin təşkil edilməsi;\n- İş təcrübəsi: 3-5 il;\n- CV göndərin: hr@example.com ünvanına;\n- Sayta baxın https://example.com/jobs səhifəsində;\n- Mühasibat uçotu üzrə ilkin sənədləşmələrin təşkil edilməsi;\n- Qısa;'));
    expect(lines).toEqual(['Mühasibat uçotu üzrə ilkin sənədləşmələrin təşkil edilməsi']);
    // the introduction of a posting is not a requirement: with two or more bullets only the bullets count; "we are looking for X" and the title itself are dropped
    const posting = job('Kommersiya komandamıza qoşulacaq təcrübəli Mühasib axtarırıq.\n- Əsas vəsaitlərin uçotunun aparılması;\n- Hesabatların hazırlanması və təqdim edilməsi;', { position: 'Baş Mühasib' });
    expect(vacancyRequirements(posting)).toEqual(['Əsas vəsaitlərin uçotunun aparılması', 'Hesabatların hazırlanması və təqdim edilməsi']);
  });

  it('ranks the candidate\'s items by the words the vacancy uses and keeps their own order on ties', () => {
    const terms = vacancyTerms(job('Əsas vəsaitlərin uçotu, inventarizasiya və amortizasiya hesablanması.'));
    expect(rankByRelevance(['Kassa ilə işlədi.', 'İnventarizasiyada iştirak etdi.', 'Əsas vəsaitlərin uçotunu apardı.', 'Arxiv apardı.'], (x) => x, terms)).toEqual(['Əsas vəsaitlərin uçotunu apardı.', 'İnventarizasiyada iştirak etdi.', 'Kassa ilə işlədi.', 'Arxiv apardı.']);
  });

  it('applies a proposed order safely', () => {
    expect(applyOrder(['a', 'b', 'c'], [2, 2, 5, 'x', 0])).toEqual(['c', 'a', 'b']);
    expect(applyOrder(['a', 'b'], 'nonsense')).toEqual(['a', 'b']);
  });

  it('validates id pairs: unknown requirement or evidence ids, duplicates and a non-array are dropped', () => {
    const ev = [{ id: 'E1', text: 'Əsas vəsaitlərin uçotunu apardı', source: 'experience' as const }, { id: 'E2', text: 'Kassa hesabatlarını hazırladı', source: 'story' as const }];
    const reqs = ['Əsas vəsaitlərin uçotunun aparılması', 'Kassa hesabatlarının hazırlanması'];
    expect(validateMatches([{ r: 0, e: 'E1' }, { r: 0, e: 'E2' }, { r: 1, e: 'E1' }, { r: 5, e: 'E2' }, { r: 1, e: 'E9' }, { r: 1, e: 'E2' }], reqs, ev).map((m) => [m.requirement, m.evidence.id])).toEqual([[reqs[0], 'E1'], [reqs[1], 'E2']]);
    // a pairing needs a word in common: unrelated evidence is never attached to a requirement
    expect(validateMatches([{ r: 0, e: 'E2' }], reqs, ev)).toEqual([]);
    expect(validateMatches('x', reqs, ev)).toEqual([]);
    expect(deterministicMatches(['Əsas vəsaitlərin uçotunun aparılması'], [{ id: 'E1', text: 'Əsas vəsaitlərin uçotunu apardı.', source: 'experience' }, { id: 'E2', text: 'Kassa ilə işlədi.', source: 'experience' }]).map((m) => m.evidence.id)).toEqual(['E1']);
  });

  describe('composeVacancySummary (general, traceable, no shortcuts)', () => {
    it('returns empty string if candidate profile omits summary and has no confirmed evidence', () => {
      const p: any = { summary: '', skills: [], experience: [], education: [] };
      expect(composeVacancySummary(p, job('Vacancy'))).toBe('');
    });

    it('composes a factual summary when original summary is missing but candidate has confirmed background facts', () => {
      const candidateNoSummary: any = {
        summary: '',
        skills: [{ keywords: ['PostgreSQL', 'Docker', 'Go'] }],
        experience: [{ position: 'Backend Mühəndisi', company: 'Pasha Bank' }],
        education: [{ school: 'BMU', degree: 'Bakalavr', area: 'Kompüter Mühəndisliyi' }],
      };
      const devJob = job('- Go və PostgreSQL təcrübəsi\n- Docker konteynerləşdirmə', { position: 'Backend Developer' });
      const res = composeVacancySummary(candidateNoSummary, devJob);
      expect(res).toContain('backend Mühəndisi vəzifəsində iş təcrübəsi var');
      expect(res).toContain('PostgreSQL, Docker, Go');
    });

    it('returns original summary if no job is provided', () => {
      const p: any = { summary: 'Mövcud profil xülasəsi.', skills: [], experience: [], education: [] };
      expect(composeVacancySummary(p, undefined)).toBe('Mövcud profil xülasəsi.');
    });

    it('tailors student summary based on academic degree and matching tools without claiming commercial seniority', () => {
      const student: any = {
        summary: 'Tələbə xülasəsi',
        education: [{ school: 'ADA Universiteti', degree: 'Bakalavr', area: 'Kompüter elmləri' }],
        experience: [{ position: 'Proqramlaşdırma üzrə təcrübəçi (Intern)', company: 'İnnovasiya Mərkəzi' }],
        skills: [{ keywords: ['Python', 'Git', 'React', 'HTML/CSS'] }],
      };
      const internJob = job('- Python və ya JavaScript bilikləri\n- Git ilə işləmək bacarığı', {
        position: 'Kompüter elmləri üzrə təcrübəçi (Intern)',
      });
      const res = composeVacancySummary(student, internJob);
      expect(res).toContain('Kompüter elmləri üzrə akademik təhsilə və sahə üzrə praktiki hazırlığa malikdir');
      expect(res).toContain('Python, Git');
      expect(res).not.toMatch(/baş mütəxəssis|aparıcı mühəndis|rəhbər/i);
    });

    it('tailors experienced specialist summary based on confirmed substantive role and matching expertise', () => {
      const hrSpecialist: any = {
        summary: 'İnsan resursları üzrə mütəxəssis',
        experience: [
          { position: 'Senior HR Mütəxəssisi', company: 'Global Corp MMC' },
        ],
        education: [{ school: 'BDU', degree: 'Bakalavr', area: 'Psixologiya' }],
        skills: [{ keywords: ['Talent Acquisition', 'KPI təhlili', 'İşə qəbul', 'Əmək qanunvericiliyi'] }],
      };
      const hrJob = job('- Talent Acquisition və kadr seçimi\n- KPI təhlili və performans idarəçiliyi', {
        position: 'HR Business Partner',
      });
      const res = composeVacancySummary(hrSpecialist, hrJob);
      expect(res).toContain('senior HR Mütəxəssisi vəzifəsində iş təcrübəsi var');
      expect(res).toContain('Talent Acquisition, KPI təhlili');
    });

    it('composes natural English summary when language is en', () => {
      const dev: any = {
        summary: 'Software developer summary',
        experience: [{ position: 'Backend Engineer', company: 'Tech MMC' }],
        education: [{ school: 'BMU', degree: 'Bachelor', area: 'Computer Engineering' }],
        skills: [{ keywords: ['Go', 'PostgreSQL', 'Docker'] }],
      };
      const devJob = job('- Go and PostgreSQL microservices\n- Docker containers', {
        position: 'Senior Backend Engineer',
      });
      const res = composeVacancySummary(dev, devJob, undefined, 'en');
      expect(res).toContain('Has worked as Backend Engineer');
      expect(res).toContain('Relevant skills: Go, PostgreSQL, Docker');
    });
  });

  describe('cleanDisplayRole', () => {
    it('strips Azerbaijani institutional department and center prefixes', () => {
      expect(
        cleanDisplayRole('Hiper avtomatlaşdırma üzrə ekspert mərkəzinə proseslərin avtomatlaşdırılması üzrə analitik')
      ).toBe('Proseslərin avtomatlaşdırılması üzrə analitik');
      expect(
        cleanDisplayRole('Rəqəmsal İnkişaf departamentinə: Aparıcı sistem mühəndisi')
      ).toBe('Aparıcı sistem mühəndisi');
    });

    it('strips English department / center-of-excellence prefixes', () => {
      expect(
        cleanDisplayRole('Center of Excellence for Automation: Process Automation Analyst')
      ).toBe('Process Automation Analyst');
    });

    it('strips slash/pipe department prefixes', () => {
      expect(cleanDisplayRole('IT / Backend Developer')).toBe('Backend Developer');
      expect(cleanDisplayRole('Maliyyə departamenti | Baş mühasib')).toBe('Baş mühasib');
    });

    it('leaves clean functional titles unchanged', () => {
      expect(cleanDisplayRole('Junior Data Analyst')).toBe('Junior Data Analyst');
      expect(cleanDisplayRole('Məlumat bazası inzibatçısı')).toBe('Məlumat bazası inzibatçısı');
    });
  });

  describe('composeTargetRoleHeadline', () => {
    it('returns candidate profile headline if no job is provided', () => {
      const p: any = { basics: { headline: 'Təcrübəli Mühasib' }, experience: [], skills: [] };
      expect(composeTargetRoleHeadline(p, undefined)).toBe('Təcrübəli Mühasib');
    });

    it('adds target prefix for student/intern applying for a substantive role', () => {
      const student: any = {
        basics: { headline: 'Tələbə' },
        experience: [{ position: 'Data Science Intern', company: 'Tech Hub' }],
        education: [{ area: 'Kompüter Elmləri' }],
        skills: [{ keywords: ['Python', 'SQL', 'Git'] }],
      };
      const devJob = job('Python and SQL development', { position: 'Junior Data Analyst' });
      const headline = composeTargetRoleHeadline(student, devJob, undefined, 'az');
      expect(headline).toMatch(/^Hədəf vəzifə: Junior Data Analyst/);
      expect(headline).toContain('Python');
      // Must not mutate profile headline
      expect(student.basics.headline).toBe('Tələbə');
    });

    it('adds target prefix for career changer transitioning into a new domain', () => {
      const changer: any = {
        basics: { headline: 'Müştəri Xidmətləri Mütəxəssisi' },
        experience: [{ position: 'Müştəri Xidmətləri Təmsilçisi', company: 'Bank' }],
        skills: [{ keywords: ['Manual Testing', 'Jira', 'SQL'] }],
      };
      const qaJob = job('Manual testing and Jira reporting', { position: 'Kiçik QA Mühəndisi' });
      const headline = composeTargetRoleHeadline(changer, qaJob, undefined, 'az');
      expect(headline).toMatch(/^Hədəf vəzifə: Kiçik QA Mühəndisi/);
      expect(headline).toContain('Manual Testing');
    });

    it('does NOT add target prefix if candidate has confirmed substantive experience in the role', () => {
      const experienced: any = {
        basics: { headline: 'Data Analyst' },
        experience: [{ position: 'Data Analyst', company: 'Fintech MMC' }],
        skills: [{ keywords: ['SQL', 'Python', 'Power BI'] }],
      };
      const dataJob = job('SQL and Python reporting', { position: 'Data Analyst' });
      const headline = composeTargetRoleHeadline(experienced, dataJob, undefined, 'en');
      expect(headline).not.toContain('Target role:');
      expect(headline).toBe('Data Analyst | SQL & Python');
    });

    it('adds target prefix if vacancy specifies Senior/Lead seniority that candidate lacks', () => {
      const midDev: any = {
        basics: { headline: 'Backend Developer' },
        experience: [{ position: 'Backend Developer', company: 'Dev MMC' }],
        skills: [{ keywords: ['Go', 'PostgreSQL'] }],
      };
      const seniorJob = job('Senior Go developer with 5+ years experience', { position: 'Senior Go Developer' });
      const headline = composeTargetRoleHeadline(midDev, seniorJob, undefined, 'az');
      expect(headline).toMatch(/^Hədəf vəzifə: Senior Go Developer/);
    });

    it('does NOT add target prefix if candidate already carries the target title in their headline', () => {
      const dev: any = {
        basics: { headline: 'Senior Backend Engineer' },
        experience: [{ position: 'Senior Backend Developer', company: 'Global Tech' }],
        skills: [{ keywords: ['Go', 'PostgreSQL', 'Docker'] }],
      };
      const jobPosting = job('Senior Backend Engineer with distributed systems expertise', { position: 'Senior Backend Engineer' });
      const headline = composeTargetRoleHeadline(dev, jobPosting, undefined, 'az');
      expect(headline).not.toMatch(/^Hədəf vəzifə:/);
      expect(headline).toContain('Senior Backend Engineer');
    });

    it('requires target prefix and rejects cross-domain manager title contamination (Sales Manager -> Senior Engineering Manager)', () => {
      const salesMgr: any = {
        basics: { headline: 'Sales Manager' },
        experience: [{ position: 'Sales Manager', company: 'Retail MMC' }],
        skills: [{ keywords: ['CRM', 'B2B Sales', 'Negotiation'] }],
      };
      const engJob = job('Leading software engineering teams and delivering cloud systems', { position: 'Senior Engineering Manager' });
      const headlineEn = composeTargetRoleHeadline(salesMgr, engJob, undefined, 'en');
      expect(headlineEn).toBe('Target role: Senior Engineering Manager');
      expect(headlineEn).not.toContain('Sales Manager');

      const headlineAz = composeTargetRoleHeadline(salesMgr, engJob, undefined, 'az');
      expect(headlineAz).toBe('Hədəf vəzifə: Senior Engineering Manager');
      expect(headlineAz).not.toContain('Sales Manager');
    });

    it('requires target prefix for cross-domain manager without senior level (Sales Manager -> Engineering Manager)', () => {
      const salesMgr: any = {
        basics: { headline: 'Sales Manager' },
        experience: [{ position: 'Sales Manager', company: 'Retail MMC' }],
        skills: [{ keywords: ['CRM', 'B2B Sales'] }],
      };
      const engJob = job('Manage engineering roadmap and delivery', { position: 'Engineering Manager' });
      const headline = composeTargetRoleHeadline(salesMgr, engJob, undefined, 'az');
      expect(headline).toBe('Hədəf vəzifə: Engineering Manager');
      expect(headline).not.toContain('Sales Manager');
    });

    it('preserves professional designation without target prefix for qualified same-domain engineering manager', () => {
      const engMgr: any = {
        basics: { headline: 'Senior Engineering Manager' },
        experience: [{ position: 'Senior Engineering Manager', company: 'Tech Corp' }],
        skills: [{ keywords: ['Distributed Systems', 'Cloud Architecture'] }],
      };
      const engJob = job('Lead engineering squads and cloud architecture', { position: 'Senior Engineering Manager' });
      const headline = composeTargetRoleHeadline(engMgr, engJob, undefined, 'en');
      expect(headline).not.toMatch(/^Target role:/);
      expect(headline).toBe('Senior Engineering Manager | Cloud Architecture');
    });
  });


  describe('groupAndRankSkills', () => {
    it('groups skills into Technical Tools, Domain Methodologies, and Spoken Languages', () => {
      const p: any = {
        skills: [
          { keywords: ['Python', 'SQL', 'İngilis dili', 'Maliyyə hesabatlığı', 'Azərbaycan dili', 'Audit'] },
        ],
      };
      const financeJob = job('SQL, Python, maliyyə hesabatlığı and financial audit', { position: 'Maliyyə Analitiki' });
      const groups = groupAndRankSkills(p, financeJob, undefined, 'az');

      expect(groups.length).toBe(3);
      expect(groups[0].name).toBe('Texniki alətlər və sistemlər');
      expect(groups[0].keywords).toContain('Python');
      expect(groups[0].keywords).toContain('SQL');
      // Spoken languages must NOT be in technical skills
      expect(groups[0].keywords).not.toContain('İngilis dili');
      expect(groups[0].keywords).not.toContain('Azərbaycan dili');

      expect(groups[1].name).toBe('Sahəvi biliklər və metodologiyalar');
      expect(groups[1].keywords).toContain('Maliyyə hesabatlığı');
      expect(groups[1].keywords).toContain('Audit');

      expect(groups[2].name).toBe('Dil bilikləri');
      expect(groups[2].keywords).toContain('İngilis dili');
      expect(groups[2].keywords).toContain('Azərbaycan dili');
    });

    it('ranks vacancy-matching skills ahead of non-matching skills within each group', () => {
      const p: any = {
        skills: [{ keywords: ['Excel', 'Docker', 'Python', 'Kubernetes'] }],
      };
      const pythonJob = job('Requires Python, Docker and general tools', { position: 'Backend Dev' });
      const groups = groupAndRankSkills(p, pythonJob, undefined, 'en');
      const toolKeywords = groups[0].keywords;
      expect(toolKeywords).toContain('Python');
      expect(toolKeywords).toContain('Docker');
    });

    it('strictly follows vacancy requirements and never classifies Rust as spoken Russian', () => {
      const candidate: any = {
        skills: [{ keywords: ['SQL', 'Docker', 'Java', 'Rust'] }],
      };
      const sqlOnlyJob = job('Data Analyst position requiring strong SQL knowledge and relational database queries', {
        position: 'Data Analyst',
      });
      const groups = groupAndRankSkills(candidate, sqlOnlyJob, undefined, 'az');

      expect(groups.length).toBe(1);
      expect(groups[0].name).toBe('Texniki alətlər və sistemlər');
      expect(groups[0].keywords).toEqual(['SQL']);
      expect(groups[0].keywords).not.toContain('Docker');
      expect(groups[0].keywords).not.toContain('Java');
      expect(groups[0].keywords).not.toContain('Rust');

      // Spoken languages group must NOT exist or must NOT contain Rust
      const langGroup = groups.find((g) => g.name === 'Dil bilikləri');
      expect(langGroup).toBeUndefined();
    });

    it('correctly classifies Russian language variants without affecting Rust', () => {
      const candidate: any = {
        skills: [{ keywords: ['Rust', 'Rus dili', 'Russian', 'SQL'] }],
      };
      const rustJob = job('Rust systems programming and SQL', { position: 'Systems Developer' });
      const groups = groupAndRankSkills(candidate, rustJob, undefined, 'az');

      const techGroup = groups.find((g) => g.name === 'Texniki alətlər və sistemlər');
      const langGroup = groups.find((g) => g.name === 'Dil bilikləri');

      expect(techGroup).toBeDefined();
      expect(techGroup!.keywords).toContain('Rust');
      expect(techGroup!.keywords).toContain('SQL');
      expect(techGroup!.keywords).not.toContain('Rus dili');

      expect(langGroup).toBeDefined();
      expect(langGroup!.keywords).toContain('Rus dili');
      expect(langGroup!.keywords).toContain('Russian');
      expect(langGroup!.keywords).not.toContain('Rust');
    });

    it('handles sparse postings where candidate skills have no direct vacancy matches', () => {
      const candidate: any = {
        skills: [{ keywords: ['Excel', 'PowerPoint', 'Komanda işi', 'İngilis dili'] }],
      };
      const sparseJob = job('Şirkətimizə yeni əməkdaş axtarılır.', { position: 'Mütəxəssis' });
      const groups = groupAndRankSkills(candidate, sparseJob, undefined, 'az');

      expect(groups.length).toBeGreaterThanOrEqual(1);
      const allKeywords = groups.flatMap((g) => g.keywords);
      expect(allKeywords).toContain('Excel');
      expect(allKeywords).toContain('Komanda işi');
      expect(allKeywords).toContain('İngilis dili');
    });

    it('prunes completely unrelated candidate skills from tailored output while keeping relevant and transferable skills', () => {
      const p: any = {
        skills: [
          { keywords: ['Power BI', 'SQL', 'Python', 'Qaynaq işləri', 'Stomatologiya', 'Aşpazlıq', 'Maliyyə hesabatlığı'] },
        ],
      };
      const biJob = job('Power BI dashboard və SQL təhlili, maliyyə hesabatları', { position: 'Junior BI Developer' });
      const groups = groupAndRankSkills(p, biJob, undefined, 'az');

      const allTailoredKeywords = groups.flatMap((g) => g.keywords);
      expect(allTailoredKeywords).toContain('Power BI');
      expect(allTailoredKeywords).toContain('SQL');
      expect(allTailoredKeywords).toContain('Maliyyə hesabatlığı');

      // Unrelated manual/medical/culinary skills are pruned from the BI document
      expect(allTailoredKeywords).not.toContain('Qaynaq işləri');
      expect(allTailoredKeywords).not.toContain('Stomatologiya');
      expect(allTailoredKeywords).not.toContain('Aşpazlıq');
    });

    it('distinguishes explicit requirements from sparse postings: does not export unrelated skills when explicit requirements are unsupported', () => {
      const candidate: any = {
        skills: [{ keywords: ['Rust', 'Docker', 'Java'] }],
      };
      const sqlOnlyJob = job('Data Analyst position requiring strong SQL knowledge and relational database queries', {
        position: 'Data Analyst',
      });
      const groups = groupAndRankSkills(candidate, sqlOnlyJob, undefined, 'az');

      // The vacancy explicitly requires SQL; candidate has Rust, Docker, Java but no SQL.
      // groupAndRankSkills must NOT export unrelated profile skills!
      expect(groups).toEqual([]);
      expect(groups.flatMap((g) => g.keywords)).not.toContain('Rust');
      expect(groups.flatMap((g) => g.keywords)).not.toContain('Docker');
      expect(groups.flatMap((g) => g.keywords)).not.toContain('Java');
    });

    it('regression 1: SQL-only posting + SQL/Python/Tableau/Excel defaults strictly to SQL only without domain bonuses', () => {
      const candidate: any = {
        skills: [{ keywords: ['SQL', 'Python', 'Tableau', 'Excel'] }],
      };
      const sqlJob = job('Data Analyst axtarılır. SQL bilikləri tələb olunur.', {
        position: 'Data Analyst',
      });
      const groups = groupAndRankSkills(candidate, sqlJob, undefined, 'az');
      const allKeywords = groups.flatMap((g) => g.keywords);
      expect(allKeywords).toEqual(['SQL']);
      expect(allKeywords).not.toContain('Python');
      expect(allKeywords).not.toContain('Tableau');
      expect(allKeywords).not.toContain('Excel');
    });

    it('regression 2: posting explicitly prefers Python alongside SQL -> supported Python is included', () => {
      const candidate: any = {
        skills: [{ keywords: ['SQL', 'Python', 'Tableau', 'Excel'] }],
      };
      const sqlPythonJob = job('SQL bilikləri tələb olunur. Python bilikləri arzuolunandır (üstünlükdür).', {
        position: 'Data Analyst',
      });
      const groups = groupAndRankSkills(candidate, sqlPythonJob, undefined, 'az');
      const allKeywords = groups.flatMap((g) => g.keywords);
      expect(allKeywords).toContain('SQL');
      expect(allKeywords).toContain('Python');
      expect(allKeywords).not.toContain('Tableau');
      expect(allKeywords).not.toContain('Excel');
    });

    it('regression 3: accounting posting does not automatically add unrequested 1C/SAP/Excel', () => {
      const candidate: any = {
        skills: [{ keywords: ['1C', 'SAP', 'Excel', 'Maliyyə hesabatlığı'] }],
      };
      const acctJob = job('Əsas vəsaitlərin uçotunun aparılması və maliyyə hesabatlığı standartlarının tətbiqi tələb olunur.', {
        position: 'Böyük mühasib',
      });
      const groups = groupAndRankSkills(candidate, acctJob, undefined, 'az');
      const allKeywords = groups.flatMap((g) => g.keywords);
      expect(allKeywords).toContain('Maliyyə hesabatlığı');
      expect(allKeywords).not.toContain('1C');
      expect(allKeywords).not.toContain('SAP');
      expect(allKeywords).not.toContain('Excel');
    });
  });
});



it('summarizes a relevant later project rather than the first unrelated employer or a project title alone', () => {
  const p: any = { basics: {}, summary: '', education: [], skills: [{ keywords: ['SQL'] }],
    experience: [{ position: 'Retail Assistant', company: 'Shop', highlights: Array(110).fill('Gündəlik malları rəflərə düzdüm.') }],
    projects: [{ name: 'Analitik portal', description: 'SQL ilə sifariş məlumatlarını təhlil edib hesabat hazırladım.' }], certifications: [] };
  const result = composeVacancySummary(p, job('SQL ilə hesabatların hazırlanması', { position: 'Data Analyst' }));
  expect(result).toContain(p.projects[0].description);
  expect(result).not.toContain('retail');
  expect(result).not.toContain('Analitik portal.');
  expect(result).not.toContain('peşəkar biliklərə malikdir');
});

it('can use a relevant later sentence inside a source highlight instead of falling back to a skills-only summary', () => {
  const p: any = { basics: {}, summary: '', education: [], skills: [{ keywords: ['SQL'] }],
    experience: [{ position: 'Analyst', company: 'Example', highlights: ['Tədbir materiallarını hazırladım. SQL ilə sifariş məlumatlarını yoxlayıb hesabat hazırladım.'] }],
    projects: [], certifications: [] };
  const result = composeVacancySummary(p, job('SQL ilə hesabatların hazırlanması', { position: 'Data Analyst' }));
  expect(result).toContain('SQL ilə sifariş məlumatlarını yoxlayıb hesabat hazırladım.');
  expect(result).not.toContain('Tədbir materiallarını');
});
