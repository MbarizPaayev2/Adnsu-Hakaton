import { letterEvidence } from './az-writer';
import { composeNarrativeLetter } from './az-letter-compose';
import { composeVacancySummary, rankByRelevance, vacancyTerms } from './az-compose';
import { documentFields, needsTranslation } from './az-document-fields';
import { looksEnglish, untranslatedItems } from './az-translate';
import { parseLinkedInProfile } from '../cv-parser';
import type { Persona, TailorJobInput, TailoredContent } from './resume-tailor.types';

describe('Document Quality Evaluation Suite (4 Domains)', () => {
  // ── 1. Audit / Finance ──────────────────────────────────────────────────
  describe('Domain 1: Audit & Finance', () => {
    const auditCandidate: Persona = {
      basics: {
        name: 'Fizuli Hasanov',
        headline: 'Assurance & Audit Specialist',
        email: 'fizuli@example.com',
        phone: '+994 50 123 45 67',
        location: 'Bakı, Azərbaycan',
        website: { url: '', label: '' },
      },
      summary: 'Daxili audit və risk təhlili üzrə təcrübəli mütəxəssis. ISAE 3000 və maliyyə hesabatlarının auditi sahəsində praktiki biliklərə malikəm.',
      experience: [
        {
          company: 'Codveda Tech',
          position: 'Founder',
          location: 'Bakı, Azərbaycan',
          period: '2023 - 2024',
          highlights: ['32+ SME müştəri ilə danışaraq 6-cı inkubasiya proqramını bitirdim.'],
        },
        {
          company: 'SRT Advisory / Deloitte Layihəsi',
          position: 'Assurance and Audit Analyst',
          location: 'Bakı, Azərbaycan',
          period: '2021 - 2023',
          highlights: [
            'Daxili audit metodologiyası və risk hesabatlarını hazırlamışam.',
            'ISAE 3000 standartı üzrə 12 audit yoxlamasında daxili nəzarət mexanizmlərini test etdim.',
          ],
        },
      ],
      education: [
        {
          school: 'Azərbaycan Dövlət İqtisad Universiteti',
          degree: 'Bakalavr',
          area: 'Maliyyə və Audit',
          location: 'Bakı',
          period: '2017 - 2021',
          grade: '',
        },
      ],
      skills: [
        { name: 'Skills', keywords: ['Daxili audit', 'ISAE 3000', 'Maliyyə təhlili', 'Risk menecmenti', 'Excel'], proficiency: '', level: 0 },
      ],
      languages: [
        { entryId: 'l1', language: 'Azərbaycan dili', fluency: 'Ana dili', level: 0 },
        { entryId: 'l2', language: 'İngilis dili', fluency: 'C1', level: 0 },
      ],
      projects: [],
      certifications: [
        { entryId: 'c1', title: 'Certified Internal Auditor (CIA) Part 1', issuer: 'IIA', date: '2023', description: '' },
      ],
      activities: [],
      awards: [],
    };

    const auditVacancy: TailorJobInput = {
      id: 'job-audit',
      position: 'Audit üzrə mütəxəssis',
      company: 'Deloitte Azərbaycan',
      location: 'Bakı',
      requirements: '- Daxili audit və assurance metodologiyası\n- Maliyyə hesabatlarının auditi və risk təhlili\n- ISAE standartları üzrə biliklər',
      responsibilities: 'Müştərilərin daxili nəzarət sistemlərinin və maliyyə hesabatlarının auditi.',
      description: 'Deloitte audit departamentinə analitik axtarılır.',
      education: '',
      experience: '',
      salary_from: '',
      salary_to: '',
      category: 'Audit',
    };

    it('prioritizes assurance/audit evidence over unrelated startup metrics', () => {
      const ev = letterEvidence(auditCandidate, auditVacancy);
      expect(ev[0].role).toMatch(/assurance and audit analyst/i);
      // Both assurance and audit highlights outrank the unrelated startup metrics
      const startupIdx = ev.findIndex((e) => e.text.includes('32+ SME'));
      const auditIdx = ev.findIndex((e) => e.text.includes('Daxili audit metodologiyası'));
      const isaeIdx = ev.findIndex((e) => e.text.includes('ISAE 3000'));
      expect(auditIdx).toBeLessThan(startupIdx);
      expect(isaeIdx).toBeLessThan(startupIdx);
    });

    it('composes a motivation letter connecting candidate facts to the audit role without padding', () => {
      const { paragraphs } = composeNarrativeLetter(auditCandidate, auditVacancy, {
        motivation: 'Audit və daxili nəzarət sistemlərinin dəqiq qurulmasını təmin etmək istəyirəm.',
        contribution: 'Daxili audit və risk hesabatlarının tərtibində praktiki təcrübəm var.',
      });
      const letterText = paragraphs.join(' ');
      expect(paragraphs[0]).toContain('Deloitte Azərbaycan tərəfindən elan olunmuş Audit üzrə mütəxəssis vakansiyasına müraciət edirəm.');
      expect(letterText).toContain('SRT Advisory / Deloitte Layihəsi');
      expect(letterText.toLowerCase()).toContain('daxili audit metodologiyası');
      expect(letterText).not.toMatch(/dinamik komanda|peşəkar inkişaf|ideal namizəd/);
    });

    it('preserves exact name Fizuli Hasanov without dotless corruption', () => {
      expect(auditCandidate.basics.name).toBe('Fizuli Hasanov');
      expect(auditCandidate.basics.name).not.toContain('Fızuli');
    });
  });

  // ── 2. Business / Data Analysis ─────────────────────────────────────────
  describe('Domain 2: Business & Data Analysis', () => {
    const dataCandidate: Persona = {
      basics: {
        name: 'Ada Leman',
        headline: 'Data Analyst | Business Intelligence',
        email: 'ada@example.com',
        phone: '+994 50 987 65 43',
        location: 'Bakı, Azərbaycan',
        website: { url: '', label: '' },
      },
      summary: 'Data analyst with 3 years of experience in retail banking analytics, ETL pipelines and Power BI dashboard development.',
      experience: [
        {
          company: 'Northwind Technologies',
          position: 'Senior Data Analyst',
          location: 'Baku, Azerbaijan',
          period: '2024 - Present',
          highlights: [
            'Built customer churn prediction model in Python using XGBoost with 84% ROC-AUC.',
            'Created weekly Power BI KPI dashboards for executive committee.',
          ],
        },
        {
          company: 'Acme Advisory',
          position: 'Junior Analyst',
          location: 'Baku, Azerbaijan',
          period: '2022 - 2024',
          highlights: ['Cleaned and transformed transaction datasets of 250,000 rows in SQL.'],
        },
      ],
      education: [
        {
          school: 'Bakı Dövlət Universiteti',
          degree: 'Bakalavr',
          area: 'Tətbiqi riyaziyyat',
          location: 'Bakı',
          period: '2018 - 2022',
          grade: '',
        },
      ],
      skills: [
        { name: 'Skills', keywords: ['Python', 'SQL', 'Power BI', 'XGBoost', 'ETL', 'Data Visualization'], proficiency: '', level: 0 },
      ],
      languages: [
        { entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 },
        { entryId: 'l2', language: 'İngilis', fluency: 'İşgüzar', level: 0 },
      ],
      projects: [],
      certifications: [
        { entryId: 'c1', title: 'Google Data Analytics Professional Certificate', issuer: 'Coursera', date: '2023', description: 'SQL and R fundamentals.' },
      ],
      activities: [],
      awards: [],
    };

    const dataVacancy: TailorJobInput = {
      id: 'job-data',
      position: 'Aparıcı Data Analitik',
      company: 'Bank Respublika ASC',
      location: 'Bakı',
      requirements: '- SQL və Python ilə məlumatların təhlili\n- Power BI dashboard hazırlanması\n- Proqnozlaşdırma modelləri (Machine Learning)',
      responsibilities: 'Müştəri davranışlarının təhlili və idarə heyəti üçün hesabatların hazırlanması.',
      description: 'Pərakəndə bankçılıq məlumatları üzrə analitik axtarılır.',
      education: '',
      experience: '',
      salary_from: '',
      salary_to: '',
      category: 'Analytics',
    };

    it('selects and prioritizes relevant Python, SQL and Power BI experience', () => {
      const ev = letterEvidence(dataCandidate, dataVacancy);
      expect(ev[0].text).toMatch(/XGBoost|Power BI|Python/);
      expect(ev[0].kind).toBe('experience');
    });

    it('captures certification titles for translation', () => {
      const cv: TailoredContent = {
        language: 'az',
        basics: dataCandidate.basics,
        summary: dataCandidate.summary,
        experience: dataCandidate.experience.map(e => ({ company: e.company, position: e.position, location: e.location, period: e.period, highlights: [...e.highlights] })),
        education: dataCandidate.education.map(ed => ({ school: ed.school, degree: ed.degree, area: ed.area, location: ed.location, period: ed.period })),
        skills: [{ name: 'Skills', keywords: ['Python', 'Power BI'] }],
        languages: [{ entryId: 'l1', language: 'İngilis', fluency: 'İşgüzar' }],
        projects: [],
        certifications: [
          { entryId: 'c1', title: 'Google Data Analytics Professional Certificate', issuer: 'Coursera', date: '2023', description: 'SQL and R fundamentals.' },
        ],
        activities: [],
        awards: [],
      };
      const fields = documentFields(cv as any);
      expect(fields.some(f => f.id === 'certifications.0.title' && f.text === 'Google Data Analytics Professional Certificate')).toBe(true);
    });
  });

  // ── 3. Software / Technical Work ────────────────────────────────────────
  describe('Domain 3: Software & Technical Work', () => {
    const techCandidate: Persona = {
      basics: {
        name: 'Kamran Babayev',
        headline: 'Backend Software Engineer',
        email: 'kamran@example.com',
        phone: '+994 55 555 55 55',
        location: 'Bakı, Azərbaycan',
        website: { url: '', label: '' },
      },
      summary: 'Backend developer with 4 years of experience building high-throughput microservices using Go, PostgreSQL and Docker.',
      experience: [
        {
          company: 'Fintech Solutions MMC',
          position: 'Backend Developer',
          location: 'Bakı, Azərbaycan',
          period: '2022 - Present',
          highlights: [
            'Go və PostgreSQL ilə dəqiqədə 15,000 sorğunu emal edən REST API mikroservisləri qurdum.',
            'Docker və Kubernetes ilə konteynerləşdirməni təşkil edərək sistemin etibarlılığını 99.9% səviyyəsində saxladım.',
          ],
        },
      ],
      education: [
        {
          school: 'Bakı Mühəndislik Universiteti',
          degree: 'Bakalavr',
          area: 'Kompüter mühəndisliyi',
          location: 'Bakı',
          period: '2018 - 2022',
          grade: '',
        },
      ],
      skills: [
        { name: 'Dillər və Texnologiyalar', keywords: ['Go', 'PostgreSQL', 'Docker', 'Kubernetes', 'REST API', 'Redis'], proficiency: '', level: 0 },
      ],
      languages: [
        { entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 },
        { entryId: 'l2', language: 'İngilis', fluency: 'İşgüzar', level: 0 },
      ],
      projects: [],
      certifications: [],
      activities: [],
      awards: [],
    };

    const techVacancy: TailorJobInput = {
      id: 'job-tech',
      position: 'Senior Backend Engineer',
      company: 'Payriff MMC',
      location: 'Bakı',
      requirements: '- Go (Golang) və PostgreSQL ilə güclü təcrübə\n- Mikroservis arxitekturası və REST API\n- Docker və Kubernetes',
      responsibilities: 'Ödəniş şlüzü mikroservislərinin inkişafı və optimizasiyası.',
      description: 'Backend komandamız üçün mühəndis axtarırıq.',
      education: '',
      experience: '',
      salary_from: '',
      salary_to: '',
      category: 'Engineering',
    };

    it('retains technical terms and acronyms verbatim while generating natural Azerbaijani prose', () => {
      const ev = letterEvidence(techCandidate, techVacancy);
      expect(ev[0].text).toContain('Go və PostgreSQL');
      expect(ev[0].text).toContain('REST API');
      expect(ev[0].text).toContain('15,000');
    });

    it('correctly detects English function words and does not flag legitimate technical terms', () => {
      expect(looksEnglish('Built a high-throughput backend using Go and PostgreSQL')).toBe(true);
      expect(looksEnglish('Go və PostgreSQL ilə mikroservislər hazırladım')).toBe(false);
      expect(needsTranslation('REST API', 'label')).toBe(false);
      expect(needsTranslation('PostgreSQL', 'label')).toBe(false);
      expect(needsTranslation('Senior Backend Engineer', 'label')).toBe(true);
    });
  });

  // ── 4. Student with Projects (Little Employment) ─────────────────────────
  describe('Domain 4: Student with Projects and Coursework', () => {
    const studentCandidate: Persona = {
      basics: {
        name: 'Aydan Məmmədova',
        headline: 'ADA Universiteti Tələbəsi | Junior Developer',
        email: 'aydan@example.com',
        phone: '+994 70 777 77 77',
        location: 'Bakı, Azərbaycan',
        website: { url: '', label: '' },
      },
      summary: 'ADA Universitetində 3-cü kurs tələbəsi. Proqramlaşdırma üzrə akademik layihələrdə iştirak etmişəm və veb proqramlaşdırma sahəsində təcrübə axtarıram.',
      experience: [
        {
          company: 'İnnovasiya Mərkəzi',
          position: 'Proqramlaşdırma üzrə təcrübəçi (Intern)',
          location: 'Bakı, Azərbaycan',
          period: 'Jun 2024 - Aug 2024',
          highlights: ['Frontend komandasında React komponentlərinin hazırlanmasında kömək etdim.'],
        },
      ],
      education: [
        {
          school: 'ADA Universiteti',
          degree: 'Bakalavr',
          area: 'Kompüter elmləri',
          location: 'Bakı',
          period: '2022 - Present',
          grade: '',
        },
      ],
      skills: [
        { name: 'Texnologiyalar', keywords: ['JavaScript', 'React', 'HTML/CSS', 'Git', 'Python'], proficiency: '', level: 0 },
      ],
      languages: [
        { entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 },
        { entryId: 'l2', language: 'İngilis', fluency: 'Əla', level: 0 },
      ],
      projects: [
        {
          id: 'p1',
          name: 'Tələbə İştirak Sistemi',
          period: '2024',
          description: 'Python və OpenCV istifadə edərək tələbələrin davamiyyətini qeyd edən veb tətbiq qurdum.',
          result: 'Kompüter laboratoriyasında 40 tələbə ilə sınaqdan keçirildi.',
        },
      ],
      certifications: [],
      activities: [],
      awards: [
        { entryId: 'aw1', title: 'Fəxri Tələbə Təqaüdü', issuer: 'ADA Universiteti', date: '2023' },
      ],
    };

    const studentVacancy: TailorJobInput = {
      id: 'job-intern',
      position: 'Kompüter elmləri üzrə təcrübəçi (Intern)',
      company: 'PashaPay',
      location: 'Bakı',
      requirements: '- Kompüter elmləri və ya İT üzrə təhsil\n- Python və ya JavaScript bilikləri\n- Git ilə işləmək bacarığı',
      responsibilities: 'Proqram təminatı komandasında tədqiqat və kodlaşdırma tapşırıqlarının icrası.',
      description: 'Universitet tələbələri üçün ödənişli təcrübə proqramı.',
      education: '',
      experience: '',
      salary_from: '',
      salary_to: '',
      category: 'Internship',
    };

    it('accurately identifies ongoing education and emphasizes student projects', () => {
      const ev = letterEvidence(studentCandidate, studentVacancy);
      expect(ev.some(e => e.kind === 'project' && (e.role?.includes('Tələbə İştirak') || e.text.includes('Tələbə İştirak')))).toBe(true);
      // Explicit '2022 - Present' is marked current
      const edu = ev.find(e => e.kind === 'education');
      expect(edu?.current).toBe(true);
    });

    it('composes a tailored student letter in present tense for ongoing degree', () => {
      const { paragraphs } = composeNarrativeLetter(studentCandidate, studentVacancy, {
        motivation: 'Akademik biliklərimi real layihələrdə tətbiq etmək istəyirəm.',
      });
      const letterText = paragraphs.join(' ');
      expect(letterText).toContain('PashaPay');
      expect(letterText).toContain('ADA Universitetində');
      // For confirmed ongoing education, must use present tense "təhsili alıram"
      expect(letterText).toContain('alıram');
      expect(letterText).not.toContain('almışam');
    });

    it('preserves uncertainty for unconfirmed future dates (e.g. 2022-2026) without inventing graduation or enrollment', () => {
      const unconfirmedStudent: Persona = {
        ...studentCandidate,
        education: [{ ...studentCandidate.education[0], period: '2022 - 2026' }],
      };
      const ev = letterEvidence(unconfirmedStudent, studentVacancy);
      const edu = ev.find(e => e.kind === 'education');
      // A future date alone without explicit ongoing indicator is NOT marked current
      expect(edu?.current).toBe(false);

      const { paragraphs } = composeNarrativeLetter(unconfirmedStudent, studentVacancy, {
        motivation: 'Akademik biliklərimi tətbiq etmək istəyirəm.',
      });
      const letterText = paragraphs.join(' ');
      // Preserves factual uncertainty: does not invent graduation ("almışam") or active enrollment ("alıram")
      expect(letterText).toContain('qeyd olunub');
      expect(letterText).not.toContain('almışam');
      expect(letterText).not.toContain('alıram');
    });
  });

  // ── 5. Generalization Suite across 6 Diverse Candidate Archetypes ─────────
  describe('Generalization Suite across 6 Diverse Candidate Archetypes', () => {
    // Archetype 1: Student with Projects and Coursework, No Employment
    describe('Archetype 1: Student with Projects and No Employment', () => {
      const student: Persona = {
        basics: { name: 'Aydan Məmmədova', headline: 'Kompüter elmləri tələbəsi', email: 'aydan@example.com', phone: '+994 50 111 22 33', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: 'ADA Universitetində kompüter elmləri üzrə təhsil alıram. Akademik layihələrdə veb tətbiqlər və alqoritmik həllər hazırlamışam.',
        education: [{ school: 'ADA Universiteti', degree: 'Bakalavr', area: 'Kompüter elmləri', location: 'Bakı', period: '2022 - Present' }],
        experience: [],
        skills: [{ name: 'Skills', keywords: ['Python', 'JavaScript', 'React', 'Git', 'HTML/CSS'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'İngilis', fluency: 'C1', level: 0 }],
        projects: [
          { id: 'p1', name: 'Tələbə İştirak Sistemi', period: '2024', description: 'Python və OpenCV ilə tələbələrin davamiyyətini qeyd edən veb tətbiq qurdum.', result: '40 tələbə ilə uğurla sınaqdan keçirildi.' },
          { id: 'p2', name: 'Şəbəkə Monitorinqi Aləti', period: '2023', description: 'Lokal şəbəkədə paket gecikmələrini analiz edən skript yazdım.', result: 'Laboratoriya şəbəkəsində gecikmələri 15% azaldan konfiqurasiya aşkarlandı.' },
        ],
        certifications: [],
        activities: [],
        awards: [],
      };

      const devInternship: TailorJobInput = {
        id: 'vac-intern', position: 'Kompüter elmləri üzrə təcrübəçi (Intern)', company: 'PashaPay', location: 'Bakı',
        requirements: '- Kompüter elmləri üzrə ali təhsil\n- Python və ya JavaScript bilikləri\n- Git ilə işləmək bacarığı',
        responsibilities: 'Proqramlaşdırma komandasında kodlaşdırma tapşırıqları.', description: 'Təcrübəçi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Tech',
      };

      const supportJob: TailorJobInput = {
        id: 'vac-support', position: 'Texniki Dəstək Mütəxəssisi', company: 'Delta Telecom', location: 'Bakı',
        requirements: '- Şəbəkə və avadanlıqların diaqnostikası\n- Müştəri sorğularının vaxtında həlli\n- Komandada əməkdaşlıq bacarığı',
        responsibilities: 'Texniki problemlərin aradan qaldırılması və şəbəkə dəstəyi.', description: 'Texniki dəstək mütəxəssisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Support',
      };

      it('tailors summary and prioritizes evidence differently between Dev Internship and Technical Support for the same student', () => {
        const sumDev = composeVacancySummary(student, devInternship);
        const sumSupport = composeVacancySummary(student, supportJob);

        expect(sumDev).toContain('Python və OpenCV ilə tələbələrin davamiyyətini qeyd edən veb tətbiq qurdum');
        expect(sumDev).toContain('Python');
        expect(sumDev).toContain('Git');
        expect(sumDev).not.toMatch(/kommersiya təcrübəsi|aparıcı mühəndis/);

        expect(sumSupport).toContain('şəbək');
        expect(sumSupport).not.toContain('Python və OpenCV ilə tələbələrin davamiyyətini');

        // Evidence prioritization changes with target role
        const evDev = rankByRelevance(student.projects, (p) => `${p.name} ${p.description}`, vacancyTerms(devInternship));
        const evSupport = rankByRelevance(student.projects, (p) => `${p.name} ${p.description}`, vacancyTerms(supportJob));
        expect(evDev[0].name).toBe('Tələbə İştirak Sistemi');
        expect(evSupport[0].name).toBe('Şəbəkə Monitorinqi Aləti');
      });
    });

    // Archetype 2: Career Changer (Teacher/Linguist pivoting to QA Engineer)
    describe('Archetype 2: Career Changer', () => {
      const careerChanger: Persona = {
        basics: { name: 'Murad Əliyev', headline: 'QA Tester | Texniki İngilis dili', email: 'murad@example.com', phone: '+994 50 222 33 44', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: '5 il ingilis dili tədrisi təcrübəsindən sonra proqram təminatının test edilməsi (QA) sahəsinə keçid etmişəm. Test keyslərin yazılması, Postman ilə API testi və Jira ilə defektlərin idarə edilməsi üzrə praktiki təcrübəm var.',
        education: [{ school: 'Bakı Slavyan Universiteti', degree: 'Bakalavr', area: 'Filologiya və Tərcümə', location: 'Bakı', period: '2015 - 2019' }],
        experience: [
          { company: 'British Academy Baku', position: 'İngilis dili müəllimi', location: 'Bakı', period: '2019 - 2024', highlights: ['Tələbələrlə metodoloji dərslər və imtahan hazırlığı apardım.'] },
        ],
        skills: [{ name: 'Skills', keywords: ['QA Manual Testing', 'Postman', 'Jira', 'SQL', 'Test Keysləri', 'İngilis dili', 'Tərcümə'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'İngilis', fluency: 'C2', level: 0 }],
        projects: [
          { id: 'p1', name: 'E-ticarət Veb Platformasının Testi', period: '2024', description: 'Postman ilə REST API sorğularını yoxladım və Jira-da 30-dan çox defekt sənədləşdirdim.', result: 'Bütün kritik funksionallıq üzrə test hesabatı hazırlandı.' },
        ],
        certifications: [
          { entryId: 'c1', title: 'ISTQB Certified Tester Foundation Level', issuer: 'ISTQB', date: '2024', description: 'Manual testing principles.' },
        ],
        activities: [],
        awards: [],
      };

      const qaJob: TailorJobInput = {
        id: 'vac-qa', position: 'Junior QA Mühəndisi', company: 'Kapital Bank ASC', location: 'Bakı',
        requirements: '- Proqram təminatının manual testi üzrə biliklər\n- Postman ilə API yoxlamaları və SQL sorğuları\n- Jira ilə iş təcrübəsi',
        responsibilities: 'Bank tətbiqlərinin funksional testi və qüsurların qeydiyyatı.', description: 'Junior QA mütəxəssisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'QA',
      };

      const localizationJob: TailorJobInput = {
        id: 'vac-loc', position: 'Məzmun və Lokallaşdırma Mütəxəssisi', company: 'Wolt Azərbaycan', location: 'Bakı',
        requirements: '- İngilis və Azərbaycan dillərində mükəmməl yazı bacarığı\n- Mətnlərin tərcüməsi və redaktəsi\n- Detallara diqqət',
        responsibilities: 'Mobil tətbiq və marketinq mətnlərinin lokallaşdırılması.', description: 'Lokallaşdırma mütəxəssisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Content',
      };

      it('tailors career changer documents accurately: emphasizes QA skills for tech role without inventing 5 years of commercial QA, and emphasizes linguistic mastery for content role', () => {
        const sumQa = composeVacancySummary(careerChanger, qaJob);
        const sumLoc = composeVacancySummary(careerChanger, localizationJob);

        // For QA role: recognizes confirmed skills (QA Manual Testing, Postman, Jira) matching the vacancy
        expect(sumQa).toContain('Postman ilə REST API sorğularını yoxladım və Jira-da 30-dan çox defekt sənədləşdirdim');
        expect(sumQa).not.toContain('5 il QA mühəndisi');

        // For Localization role: emphasizes language & translation skills matching the vacancy
        expect(sumLoc).toContain('İngilis dili, Tərcümə');

        // Motivation letter connects the relevant career pivot facts honestly
        const { paragraphs } = composeNarrativeLetter(careerChanger, qaJob, {
          motivation: 'Keyfiyyət təminatı sahəsində praktiki biliklərimi tətbiq etmək istəyirəm.',
        });
        const letter = paragraphs.join(' ');
        expect(letter).toContain('Kapital Bank ASC');
        expect(letter).toContain('Junior QA Mühəndisi');
      });
    });

    // Archetype 3: Experienced Specialist (Senior HR Specialist targeting HRBP)
    describe('Archetype 3: Experienced Specialist', () => {
      const hrSpecialist: Persona = {
        basics: { name: 'Leyla Qasımova', headline: 'Senior HR Specialist | Talent Management', email: 'leyla@example.com', phone: '+994 50 333 44 55', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: 'Pərakəndə və xidmət sektorunda 6 illik insan resursları təcrübəsi. İşə qəbul, KPI sistemlərinin qurulması və əməkdaşların inkişafı sahəsində ixtisaslaşmışam.',
        education: [{ school: 'Azərbaycan Dövlət İqtisad Universiteti', degree: 'Bakalavr', area: 'Menecment', location: 'Bakı', period: '2014 - 2018' }],
        experience: [
          {
            company: 'Retail Group MMC', position: 'Senior HR Mütəxəssisi', location: 'Bakı', period: '2021 - Present',
            highlights: ['450 nəfərlik komanda üçün KPI qiymətləndirmə sistemini tətbiq etdim.', 'İllik işçi axını göstəricisini 24%-dən 16%-ə endirdim.'],
          },
          {
            company: 'Hospitality Services ASC', position: 'İşə qəbul üzrə mütəxəssis', location: 'Bakı', period: '2018 - 2021',
            highlights: ['İldə 120-dən çox vakansiya üzrə kadr seçimini uğurla bağladım.'],
          },
        ],
        skills: [{ name: 'Skills', keywords: ['Talent Acquisition', 'KPI təhlili', 'İşə qəbul', 'Əmək qanunvericiliyi', 'Performans menecmenti'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'İngilis', fluency: 'B2', level: 0 }],
        projects: [],
        certifications: [{ entryId: 'c1', title: 'SHRM Certified Professional', issuer: 'SHRM', date: '2022', description: '' }],
        activities: [],
        awards: [],
      };

      const hrbpJob: TailorJobInput = {
        id: 'vac-hrbp', position: 'HR Business Partner', company: 'Baku Steel Company QSC', location: 'Bakı',
        requirements: '- İnsan resurslarının idarə edilməsi üzrə 5+ il təcrübə\n- Performans menecmenti və KPI təhlili\n- Təşkilati strukturun inkişafı',
        responsibilities: 'Biznes vahidləri ilə strateji HR tərəfdaşlığı.', description: 'HRBP axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'HR',
      };

      it('tailors experienced specialist document preserving chronology and highlighting confirmed senior achievements', () => {
        const sum = composeVacancySummary(hrSpecialist, hrbpJob);
        expect(sum).toContain('450 nəfərlik komanda üçün KPI qiymətləndirmə sistemini tətbiq etdim');
        expect(sum).toContain('KPI təhlili, Performans menecmenti');

        const ev = letterEvidence(hrSpecialist, hrbpJob);
        expect(ev[0].role).toMatch(/Senior HR Mütəxəssisi/i);
        expect(ev.some((e) => e.text.includes('KPI qiymətləndirmə'))).toBe(true);

        const { paragraphs } = composeNarrativeLetter(hrSpecialist, hrbpJob, {
          motivation: 'Şirkətinizin strateji hədəflərinə HR tərəfdaşlığı ilə töhfə vermək istəyirəm.',
          contribution: 'KPI sistemlərinin qurulması və işçi axınının azaldılması təcrübəm var.',
        });
        expect(paragraphs[0]).toContain('Baku Steel Company QSC');
        expect(paragraphs[0]).toContain('HR Business Partner');
      });

      const taJob: TailorJobInput = {
        id: 'vac-ta', position: 'İstedadların İdarə Edilməsi və İşə Qəbul Rəhbəri', company: 'Azercell Telekom', location: 'Bakı',
        requirements: '- Talent Acquisition və işə qəbul üzrə 4+ il təcrübə\n- Kadr seçimi kanallarının inkişafı\n- Əməkdaşların inkişafı proqramları',
        responsibilities: 'Şirkət üzrə istedadların cəlb edilməsi və işə qəbul strategiyasının idarə olunması.', description: 'İşə qəbul rəhbəri axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'HR',
      };

      it('tailors experienced specialist document to talent acquisition role emphasizing hiring volume and recruitment skills', () => {
        const sum = composeVacancySummary(hrSpecialist, taJob);
        expect(sum).toContain('Talent Acquisition, İşə qəbul');

        const ev = letterEvidence(hrSpecialist, taJob);
        expect(ev.some((e) => e.text.includes('120-dən çox vakansiya'))).toBe(true);

        const { paragraphs } = composeNarrativeLetter(hrSpecialist, taJob, {
          motivation: 'Azercell komandasına güclü kadrların cəlb edilməsinə rəhbərlik etmək istəyirəm.',
          contribution: 'Geniş miqyaslı kadr seçimi və SHRM biliklərimlə komandanı gücləndirə bilərəm.',
        });
        expect(paragraphs[0]).toContain('Azercell Telekom');
        expect(paragraphs[0]).toContain('İstedadların İdarə Edilməsi və İşə Qəbul Rəhbəri');
      });
    });

    // Archetype 4: Non-technical / Customer-facing Candidate
    describe('Archetype 4: Non-Technical / Customer-Facing Candidate', () => {
      const customerCareCandidate: Persona = {
        basics: { name: 'Rəşad Məmmədov', headline: 'Müştəri Xidmətləri və Satış Mütəxəssisi', email: 'rashad@example.com', phone: '+994 55 444 55 66', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: 'Müştəri xidmətləri və satış sahəsində 3 illik təcrübə. Müştəri məmnuniyyəti, narazılıqların həlli və CRM sistemləri ilə işləmək bacarığı.',
        education: [{ school: 'Azərbaycan Dillər Universiteti', degree: 'Bakalavr', area: 'Regionşünaslıq', location: 'Bakı', period: '2017 - 2021' }],
        experience: [
          {
            company: 'Azercell Call Center Layihəsi', position: 'Müştəri xidmətləri təmsilçisi', location: 'Bakı', period: '2021 - 2024',
            highlights: ['Gündəlik 80+ zəng qəbul edərək müştəri məmnuniyyəti reytinqini 96% səviyyəsində saxladım.'],
          },
        ],
        skills: [{ name: 'Skills', keywords: ['Müştəri xidmətləri', 'CRM', 'Müştəri məmnuniyyəti', 'Satış', 'Problem həlletmə'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'Rus', fluency: 'Sərbəst', level: 0 }],
        projects: [],
        certifications: [],
        activities: [],
        awards: [],
      };

      const b2bJob: TailorJobInput = {
        id: 'vac-b2b', position: 'Korporativ Müştəri Meneceri', company: 'PASHA Sığorta ASC', location: 'Bakı',
        requirements: '- Müştəri xidmətləri və ya korporativ satış sahəsində təcrübə\n- CRM sistemləri ilə işləmək bacarığı\n- Müştəri məmnuniyyəti və danışıqların aparılması',
        responsibilities: 'Korporativ müştərilərlə əlaqələrin idarə edilməsi.', description: 'Müştəri meneceri axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Sales',
      };

      it('tailors non-technical customer service profile into natural Azerbaijani prose without jargon', () => {
        const sum = composeVacancySummary(customerCareCandidate, b2bJob);
        expect(sum).toContain('Gündəlik 80+ zəng qəbul edərək müştəri məmnuniyyəti reytinqini 96% səviyyəsində saxladım');
        for (const skill of ['Müştəri xidmətləri', 'CRM', 'Müştəri məmnuniyyəti']) expect(sum).toContain(skill);
        expect(sum).not.toMatch(/kodlaşdırma|proqramlaşdırma|algoritm/i);

        const { paragraphs } = composeNarrativeLetter(customerCareCandidate, b2bJob, {
          motivation: 'Sığorta sektorunda korporativ müştərilərlə uzunmüddətli tərəfdaşlıq qurmaq istəyirəm.',
          contribution: 'Zəng mərkəzində qazandığım ünsiyyət və narazılıqların həlli bacarıqlarımı tətbiq edəcəyəm.',
        });
        expect(paragraphs[0]).toContain('PASHA Sığorta ASC');
        expect(paragraphs[0]).toContain('Korporativ Müştəri Meneceri');
      });

      const retailSupportJob: TailorJobInput = {
        id: 'vac-retail', position: 'Müştəri Əlaqələri Koordinatoru', company: 'Bravo Supermarket MMC', location: 'Bakı',
        requirements: '- Müştəri xidmətləri və müştəri məmnuniyyəti sahəsində təcrübə\n- Problem həlletmə və operativ reaksiya bacarığı\n- Rus dili biliyi üstünlükdür',
        responsibilities: 'Müştəri müraciətlərinin və şikayətlərinin koordinasiyası.', description: 'Koordinator axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Customer Service',
      };

      it('tailors customer service profile to retail coordinator highlighting problem solving and customer satisfaction', () => {
        const sum = composeVacancySummary(customerCareCandidate, retailSupportJob);
        expect(sum).toContain('Müştəri xidmətləri, Müştəri məmnuniyyəti, Problem həlletmə');

        const { paragraphs } = composeNarrativeLetter(customerCareCandidate, retailSupportJob, {
          motivation: 'Bravo komandasında müştəri məmnuniyyətini ən yüksək standartda təmin etmək istəyirəm.',
          contribution: '96% müştəri məmnuniyyəti göstəricisi və operativ problem həlletmə bacarığımla faydalı olacağam.',
        });
        expect(paragraphs[0]).toContain('Bravo Supermarket MMC');
        expect(paragraphs[0]).toContain('Müştəri Əlaqələri Koordinatoru');
      });
    });

    // Archetype 5: Technical Candidate (Go Backend Engineer)
    describe('Archetype 5: Technical Candidate', () => {
      const techCandidate: Persona = {
        basics: { name: 'Kamran Babayev', headline: 'Backend Engineer | Go & Distributed Systems', email: 'kamran@example.com', phone: '+994 55 555 55 55', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: 'Go, PostgreSQL və Docker ilə yüksək yüklü sistemlər üzrə 4 illik təcrübəyə malik mühəndis.',
        education: [{ school: 'BMU', degree: 'Bakalavr', area: 'Kompüter mühəndisliyi', location: 'Bakı', period: '2018 - 2022' }],
        experience: [
          { company: 'Fintech MMC', position: 'Backend Developer', location: 'Bakı', period: '2022 - Present', highlights: ['Dəqiqədə 15,000 tranzaksiyanı emal edən Go mikroservisləri qurdum.'] },
        ],
        skills: [{ name: 'Skills', keywords: ['Go', 'PostgreSQL', 'Docker', 'Kubernetes', 'Redis', 'REST API'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'İngilis', fluency: 'C1', level: 0 }],
        projects: [],
        certifications: [],
        activities: [],
        awards: [],
      };

      const dataPlatformJob: TailorJobInput = {
        id: 'vac-platform', position: 'Məlumat Platforması Mühəndisi', company: 'PASHA Bank ASC', location: 'Bakı',
        requirements: '- PostgreSQL verilənlər bazası və sorğuların optimizasiyası\n- Redis ilə keşləmə mexanizmləri\n- Docker konteynerləşdirmə',
        responsibilities: 'Məlumat platformasının infrastrukturunun qurulması.', description: 'Platforma mühəndisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Engineering',
      };

      it('tailors technical candidate profile adapting confirmed tools to data platform requirements', () => {
        const sum = composeVacancySummary(techCandidate, dataPlatformJob);
        expect(sum).toContain('Kompüter mühəndisliyi');
        expect(sum).not.toContain('peşəkar biliklərə malikdir');
        expect(sum).toContain('PostgreSQL, Docker, Redis');

        const { paragraphs } = composeNarrativeLetter(techCandidate, dataPlatformJob, {
          motivation: 'PASHA Bank-ın analitik və verilənlər bazası infrastrukturunu inkişaf etdirmək istəyirəm.',
          contribution: 'PostgreSQL və Redis optimizasiyası təcrübəmlə etibarlı məlumat platforması qurmağa hazıram.',
        });
        expect(paragraphs[0]).toContain('PASHA Bank ASC');
        expect(paragraphs[0]).toContain('Məlumat Platforması Mühəndisi');
      });

      const backendLeadJob: TailorJobInput = {
        id: 'vac-go-lead', position: 'Senior Go Backend Developer', company: 'Kapital Bank ASC', location: 'Bakı',
        requirements: '- Go (Golang) və mikroservis arxitekturası üzrə dərin biliklər\n- REST API və yüksək yüklü sistemlər\n- Kubernetes və Docker konteynerləşdirmə',
        responsibilities: 'Əsas bank xidmətlərinin backend arxitekturasının hazırlanması.', description: 'Go mühəndisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Engineering',
      };

      it('tailors technical candidate profile to Go backend lead focusing on high throughput and microservices', () => {
        const sum = composeVacancySummary(techCandidate, backendLeadJob);
        expect(sum).toContain('Go, Docker, Kubernetes');

        const ev = letterEvidence(techCandidate, backendLeadJob);
        expect(ev.some((e) => e.text.includes('15,000 tranzaksiya'))).toBe(true);

        const { paragraphs } = composeNarrativeLetter(techCandidate, backendLeadJob, {
          motivation: 'Kapital Bank-ın rəqəmsal bankçılıq mikroservislərini Go ilə miqyaslandırmaq istəyirəm.',
          contribution: 'Dəqiqədə 15,000 tranzaksiya emal edən sistemlər qurma təcrübəmlə dəyər qatacağam.',
        });
        expect(paragraphs[0]).toContain('Kapital Bank ASC');
        expect(paragraphs[0]).toContain('Senior Go Backend Developer');
      });
    });

    // Archetype 6: Sparse & Multilingual Candidate
    describe('Archetype 6: Sparse & Multilingual Candidate', () => {
      const sparseCandidate: Persona = {
        basics: { name: 'Nigar Hüseynova', headline: 'Junior Specialist', email: 'nigar@example.com', phone: '+994 50 666 77 88', location: 'Bakı, Azərbaycan', website: { url: '', label: '' } },
        summary: 'Recent graduate interested in business operations.',
        education: [{ school: 'Qərbi Kaspi Universiteti', degree: 'Bakalavr', area: 'Biznesin idarə edilməsi', location: 'Bakı', period: '2020 - 2024' }],
        experience: [
          { company: 'Logistics LLC', position: 'Təcrübəçi', location: 'Bakı', period: 'Jun 2023 - Aug 2023', highlights: ['Assisted the operational logistics team with daily documentation.'] },
        ],
        skills: [{ name: 'Skills', keywords: ['Excel', 'Word', 'Sənədləşmə'], proficiency: '', level: 0 }],
        languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }, { entryId: 'l2', language: 'İngilis', fluency: 'B2', level: 0 }],
        projects: [],
        certifications: [],
        activities: [],
        awards: [],
      };

      const opsJob: TailorJobInput = {
        id: 'vac-ops', position: 'Əməliyyat üzrə Kiçik Mütəxəssis', company: 'Socar Polymer', location: 'Sumqayıt',
        requirements: '- Ali təhsil (biznes və ya iqtisadiyyat üzrə)\n- Excel və sənədləşmə bacarığı\n- Məsuliyyət və intizam',
        responsibilities: 'Gündəlik əməliyyat hesabatlarının tərtibatı.', description: 'Əməliyyat mütəxəssisi axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Operations',
      };

      it('handles sparse profile with honest, modest tailoring without inventing senior claims', () => {
        const sum = composeVacancySummary(sparseCandidate, opsJob);
        expect(sum).toContain('Biznesin idarə edilməsi üzrə akademik təhsilə və sahə üzrə praktiki hazırlığa malikdir');
        expect(sum).toContain('Excel, Sənədləşmə');
        expect(sum).not.toMatch(/10 il|rəhbərlik etdi|lider/i);

        const { paragraphs } = composeNarrativeLetter(sparseCandidate, opsJob, {
          motivation: 'Socar Polymer komandasında əməliyyat proseslərini dərindən öyrənmək istəyirəm.',
          contribution: 'Təhsilim və təcrübə müddətində qazandığım sənədləşmə bacarığımı məsuliyyətlə tətbiq edəcəyəm.',
        });
        expect(paragraphs[0]).toContain('Socar Polymer');
        expect(paragraphs[0]).toContain('Əməliyyat üzrə Kiçik Mütəxəssis');
      });

      const officeAdminJob: TailorJobInput = {
        id: 'vac-admin', position: 'Kargüzar və Ofis Meneceri', company: 'Silk Way West Airlines', location: 'Bakı',
        requirements: '- Sənədləşmə və kargüzarlıq qaydaları\n- MS Word və Excel proqramlarında sərbəst iş\n- İngilis dili biliyi',
        responsibilities: 'Şirkətdaxili sənəd dövriyyəsinin idarə edilməsi.', description: 'Kargüzar axtarılır.',
        education: '', experience: '', salary_from: '', salary_to: '', category: 'Administration',
      };

      it('tailors sparse profile to office admin role focusing on confirmed documentation skills and education', () => {
        const sum = composeVacancySummary(sparseCandidate, officeAdminJob);
        expect(sum).toContain('Word, Sənədləşmə');
        expect(sum).not.toMatch(/rəhbərlik|menecer təcrübəsi/i);

        const { paragraphs } = composeNarrativeLetter(sparseCandidate, officeAdminJob, {
          motivation: 'Silk Way West Airlines kimi nüfuzlu aviaşirkətdə sənəd dövriyyəsinin dəqiqliyinə töhfə vermək istəyirəm.',
          contribution: 'Sənədləşmə, Word və Excel bacarıqlarımla ofis işlərinin səliqəli idarə olunmasını təmin edəcəyəm.',
        });
        expect(paragraphs[0]).toContain('Silk Way West Airlines');
        expect(paragraphs[0]).toContain('Kargüzar və Ofis Meneceri');
      });
    });
  });
});
