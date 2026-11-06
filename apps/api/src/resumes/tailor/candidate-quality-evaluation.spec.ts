import { ResumeTailorService } from './resume-tailor.service';
import { ConfigService } from '@nestjs/config';
import type { Persona, TailorJobInput } from './resume-tailor.types';
import * as fs from 'fs';
import * as path from 'path';

describe('Candidate Quality 6-Pair Diverse Submission Evaluation', () => {
  let service: ResumeTailorService;
  const artifactDir = '/Users/fizuli.050icloud.com/.gemini/antigravity/brain/b8eb3411-2166-445d-b28a-06166abfca21';

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '' } }],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    service = new ResumeTailorService(
      new ConfigService({
        AI_API_KEY: 'mock-key',
        NVIDIA_API_KEY: 'mock-key',
        TAILOR_AI_RANKING: 'false',
        TAILOR_AZ_FREE_WRITING: '',
      }),
      {} as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Archetype 1: Student without employment (only university & academic mentorship)
  const studentCandidate: Persona = {
    basics: {
      name: 'Nihad Əliyev',
      headline: 'İqtisadiyyat tələbəsi',
      email: 'nihad.aliyev@example.test',
      phone: '+994 50 200 11 22',
      location: 'Bakı, Azərbaycan',
      website: { url: '', label: '' },
    },
    summary: 'Maliyyə və data təhlili üzrə akademik biliklərə malik UNEC tələbəsi.',
    education: [
      {
        school: 'Azərbaycan Dövlət İqtisad Universiteti (UNEC)',
        degree: 'Bakalavr',
        area: 'Maliyyə və mühasibat',
        location: 'Bakı',
        period: '2023 - 2027',
      },
    ],
    experience: [
      {
        company: 'Deloitte Azərbaycan',
        position: 'Akademik Təcrübəçi (Mentee)',
        location: 'Bakı',
        period: 'Okt 2024 - Dek 2024',
        highlights: [
          'Mentor nəzarəti altında maliyyə hesabatlarının təhlili üzrə təlimlərdə iştirak etdim.',
          'Excel-də tələbə simulyasiyası üzrə 100+ parametrli dinamik büdcə modeli qurdum.',
        ],
      },
    ],
    skills: [
      {
        name: 'Əsas bacarıqlar',
        keywords: ['Excel', 'Power BI', 'SQL', 'Python', 'Maliyyə təhlili'],
        proficiency: '',
        level: 0,
      },
    ],
    languages: [{ entryId: 'l1', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }],
    projects: [
      {
        name: 'Tələbə Büdcə Simulyasiyası',
        description: 'Excel və Python ilə tələbə qrupu üçün büdcə planlaşdırma modeli qurdum.',
        result: 'Fakültə simulyasiya müsabiqəsində 1-ci yer.',
      },
    ],
    certifications: [],
    activities: [],
    awards: [],
  };

  // Archetype 2: Experienced Specialist (Senior Accountant / Finance Lead with 7+ yrs exp)
  const experiencedCandidate: Persona = {
    basics: {
      name: 'Sevinc Məmmədova',
      headline: 'Aparıcı Mühasib və Maliyyə Mütəxəssisi',
      email: 'sevinc.m@example.test',
      phone: '+994 55 300 44 55',
      location: 'Bakı, Azərbaycan',
      website: { url: '', label: '' },
    },
    summary: 'Maliyyə hesabatlığı, Vergi Məcəlləsi və 1C:8 üzrə 7 illik peşəkar təcrübə.',
    education: [
      {
        school: 'Azərbaycan Dövlət İqtisad Universiteti',
        degree: 'Magistr',
        area: 'Mühasibat uçotu və audit',
        location: 'Bakı',
        period: '2015 - 2017',
      },
    ],
    experience: [
      {
        company: 'Retail Group MMC',
        position: 'Aparıcı Mühasib',
        location: 'Bakı',
        period: '2020 - 2026',
        highlights: [
          '1C:8.3 sistemində 500-dən çox əməkdaş üzrə əməkhaqqı və vergi bəyannamələrini hazırladım.',
          'Vergi yoxlamalarında sənədləşməni 100% uyğunluqla təhvil verdim.',
          'Dövriyyə balans cədvəli və daxili maliyyə nəzarət hesabatlarını formalaşdırdım.',
        ],
      },
      {
        company: 'Audit Service MMC',
        position: 'Mühasib',
        location: 'Bakı',
        period: '2017 - 2020',
        highlights: [
          'Bank və kassa əməliyyatlarının gündəlik uçotunu apardım.',
          'Müştəri şirkətlərin ilkin uçot sənədlərinin yoxlanılmasını həyata keçirdim.',
        ],
      },
    ],
    skills: [
      {
        name: 'Peşəkar bacarıqlar',
        keywords: ['1C:8', 'Vergi Məcəlləsi', 'Maliyyə hesabatlığı', 'MHBS', 'Excel', 'Daxili audit'],
        proficiency: '',
        level: 0,
      },
    ],
    languages: [{ entryId: 'l2', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }],
    projects: [],
    certifications: [],
    activities: [],
    awards: [],
  };

  // Archetype 3: Career Changer (Customer Support Lead -> Tech / Sales)
  const changerCandidate: Persona = {
    basics: {
      name: 'Rəşad Quliyev',
      headline: 'Müştəri Xidmətləri Mütəxəssisi',
      email: 'rashad.quliyev@example.test',
      phone: '+994 70 400 77 88',
      location: 'Bakı, Azərbaycan',
      website: { url: '', label: '' },
    },
    summary: 'Müştəri tələblərinin təhlili və proseslərin optimallaşdırılması üzrə 4 illik təcrübə.',
    education: [
      {
        school: 'Bakı Dövlət Universiteti',
        degree: 'Bakalavr',
        area: 'Tətbiqi riyaziyyat',
        location: 'Bakı',
        period: '2018 - 2022',
      },
    ],
    experience: [
      {
        company: 'Telecom Support MMC',
        position: 'Müştəri Təcrübəsi Qrup Rəhbəri',
        location: 'Bakı',
        period: '2022 - 2026',
        highlights: [
          '15 nəfərlik komanda ilə 10,000-dən çox müraciəti təhlil edib xidmət gecikməsini 25% azaltdım.',
          'SQL ilə müştəri şikayətləri məlumat bazasını sorğulayıb həftəlik analitik hesabatlar tərtib etdim.',
          'B2B korporativ müştərilərlə xidmət səviyyəsi müqavilələrinin (SLA) icrasına nəzarət etdim.',
        ],
      },
    ],
    skills: [
      {
        name: 'Bacarıqlar',
        keywords: ['SQL', 'Müştəri münasibətləri', 'Biznes təhlili', 'B2B satış', 'Proseslərin optimallaşdırılması'],
        proficiency: '',
        level: 0,
      },
    ],
    languages: [{ entryId: 'l3', language: 'Azərbaycan', fluency: 'Ana dili', level: 0 }],
    projects: [],
    certifications: [],
    activities: [],
    awards: [],
  };

  // Vacancies
  const vacStudentDataAnalyst: TailorJobInput = {
    id: 'vac-1a',
    position: 'Kiçik Data Analitik',
    company: 'Paşa Bank ASC',
    location: 'Bakı',
    requirements: '- Excel və Power BI bilikləri\n- SQL ilə verilənlər bazasından məlumat çıxarma bacarığı\n- Maliyyə təhlilinə analitik maraq',
    responsibilities: 'Bank əməliyyatları üzrə analitik hesabatların və vizual panellərin hazırlanması.',
    description: 'Paşa Bank data analitikası komandasına kiçik mütəxəssis axtarır.',
    education: '',
    experience: '',
    salary_from: '',
    salary_to: '',
    category: 'Analitika',
  };

  const vacStudentPythonDev: TailorJobInput = {
    id: 'vac-1b',
    position: 'Kiçik Python Proqramçı',
    company: 'Bravo Supermarketlər Şəbəkəsi',
    location: 'Bakı',
    requirements: '- Python və verilənlər bazası (SQL) bilikləri\n- Skriptlərin yazılması və məlumatların emalı\n- Komandada işləmək bacarığı',
    responsibilities: 'Daxili logistika və anbar məlumatlarının avtomatlaşdırılmış emalı üçün Python skriptlərinin hazırlanması.',
    description: 'Bravo İT departamenti üçün kiçik proqramçı dəvət edir.',
    education: '',
    experience: '',
    salary_from: '',
    salary_to: '',
    category: 'İT',
  };

  const vacExpChiefAccountant: TailorJobInput = {
    id: 'vac-2a',
    position: 'Baş Mühasib',
    company: 'SOCAR Midstream Operations',
    location: 'Bakı',
    requirements: '- 1C:8 proqram təminatı və Vergi Məcəlləsi bilikləri\n- Maliyyə hesabatlığı və vergi bəyannamələrinin tərtibi\n- Minimum 5 il mühasibat təcrübəsi',
    responsibilities: 'Müəssisənin maliyyə-təsərrüfat fəaliyyətinin uçotu, vergi hesabatlılığı və daxili nəzarət.',
    description: 'SOCAR Midstream baş mühasib vəzifəsinə qəbul elan edir.',
    education: '',
    experience: '5+ il',
    salary_from: '',
    salary_to: '',
    category: 'Maliyyə',
  };

  const vacExpFinancialAnalyst: TailorJobInput = {
    id: 'vac-2b',
    position: 'Maliyyə Analitiki',
    company: 'Gilan Holding',
    location: 'Bakı',
    requirements: '- Excel və maliyyə modelləşdirməsi\n- Büdcə planlaşdırılması və daxili audit hesabatları\n- İqtisadi təhlil qabiliyyəti',
    responsibilities: 'Holdinq şirkətlərinin illik büdcələrinin təhlili və maliyyə risklərinin qiymətləndirilməsi.',
    description: 'Gilan Holding maliyyə analitiki komandasına təcrübəli mütəxəssis dəvət edir.',
    education: '',
    experience: '3+ il',
    salary_from: '',
    salary_to: '',
    category: 'Maliyyə',
  };

  const vacChangerBusinessAnalyst: TailorJobInput = {
    id: 'vac-3a',
    position: 'Kiçik Biznes Analitik',
    company: 'Azercell Telekom',
    location: 'Bakı',
    requirements: '- Biznes təhlili və tələblərin toplanması\n- SQL ilə məlumatların yoxlanılması\n- Proseslərin optimallaşdırılması',
    responsibilities: 'Müştəri xidmətləri sistemlərinin funksional tələblərinin formalaşdırılması və analizi.',
    description: 'Azercell biznes proseslərinin təhlili üzrə kiçik biznes analitik axtarır.',
    education: '',
    experience: '1+ il',
    salary_from: '',
    salary_to: '',
    category: 'Analitika',
  };

  const vacChangerB2BSales: TailorJobInput = {
    id: 'vac-3b',
    position: 'Korporativ Satış Meneceri (B2B)',
    company: 'Trendyol Azərbaycan',
    location: 'Bakı',
    requirements: '- B2B satış və müştəri münasibətləri\n- Korporativ tərəfdaşlarla danışıqlar və müqavilələrin idarə edilməsi\n- Analitik hesabatlılıq',
    responsibilities: 'Yeni korporativ tərəfdaşların cəlb edilməsi və satış hədəflərinin yerinə yetirilməsi.',
    description: 'Trendyol B2B korporativ satış komandasını genişləndirir.',
    education: '',
    experience: '2+ il',
    salary_from: '',
    salary_to: '',
    category: 'Satış',
  };

  it('evaluates all 6 diverse candidate-vacancy pairs with Typst PDF compilation and provenance', async () => {
    const pairs = [
      {
        id: 'Pair 1A (Student -> Data Analyst)',
        candidate: studentCandidate,
        job: vacStudentDataAnalyst,
        motivation: 'Paşa Bank-ın data analitika komandasında analitik hesabatların hazırlanması işlərinə töhfə vermək istəyirəm.',
        expectedTitle: 'Kiçik Data Analitik',
        expectedKeyword: 'Power BI',
        assertScope: (cv: any, letter: any) => {
          // Scope preservation: must remain academic / simulation, not commercial revenue
          const allText = JSON.stringify(cv.content) + ' ' + JSON.stringify(letter.content);
          expect(allText).not.toContain('kommersiya gəliri');
          expect(cv.content.basics.name).toBe('Nihad Əliyev');
        },
      },
      {
        id: 'Pair 1B (Student -> Python Dev)',
        candidate: studentCandidate,
        job: vacStudentPythonDev,
        motivation: 'Bravo şirkətində anbar və logistika məlumatlarının Python skriptləri ilə emalı prosesində iştirak etmək istəyirəm.',
        expectedTitle: 'Kiçik Python Proqramçı',
        expectedKeyword: 'Python',
        assertScope: (cv: any) => {
          expect(cv.content.basics.name).toBe('Nihad Əliyev');
          expect(cv.content.skills.some((g: any) => g.keywords.includes('Python'))).toBe(true);
        },
      },
      {
        id: 'Pair 2A (Experienced -> Chief Accountant)',
        candidate: experiencedCandidate,
        job: vacExpChiefAccountant,
        motivation: 'SOCAR Midstream Operations şirkətində 1C:8 və vergi uçotu üzrə təcrübəmi daxili nəzarət standartlarına uyğun tətbiq etmək istəyirəm.',
        expectedTitle: 'Baş Mühasib',
        expectedKeyword: '1C:8',
        assertScope: (cv: any) => {
          expect(cv.content.basics.name).toBe('Sevinc Məmmədova');
          expect(cv.content.experience.length).toBeGreaterThanOrEqual(2);
        },
      },
      {
        id: 'Pair 2B (Experienced -> Financial Analyst)',
        candidate: experiencedCandidate,
        job: vacExpFinancialAnalyst,
        motivation: 'Gilan Holding-də büdcə planlaşdırılması və maliyyə modelləşdirməsi istiqamətində analitik töhfə vermək niyyətindəyəm.',
        expectedTitle: 'Maliyyə Analitiki',
        expectedKeyword: 'Maliyyə hesabatlığı',
        assertScope: (cv: any) => {
          expect(cv.content.basics.name).toBe('Sevinc Məmmədova');
        },
      },
      {
        id: 'Pair 3A (Career Changer -> Business Analyst)',
        candidate: changerCandidate,
        job: vacChangerBusinessAnalyst,
        motivation: 'Azercell-də müştəri xidmətləri sistemlərinin funksional tələblərinin formalaşdırılması və SQL təhlili sahəsində işləmək istəyirəm.',
        expectedTitle: 'Kiçik Biznes Analitik',
        expectedKeyword: 'SQL',
        assertScope: (cv: any) => {
          expect(cv.content.basics.name).toBe('Rəşad Quliyev');
          // History role is preserved exactly as candidate held it
          expect(cv.content.experience[0].position).toBe('Müştəri Təcrübəsi Qrup Rəhbəri');
        },
      },
      {
        id: 'Pair 3B (Career Changer -> B2B Sales Manager)',
        candidate: changerCandidate,
        job: vacChangerB2BSales,
        motivation: 'Trendyol-un korporativ tərəfdaşlıqlar və B2B satış hədəfləri üzrə komandasına müştəri münasibətləri təcrübəmlə dəstək olmaq istəyirəm.',
        expectedTitle: 'Korporativ Satış Meneceri (B2B)',
        expectedKeyword: 'B2B satış',
        assertScope: (cv: any) => {
          expect(cv.content.basics.name).toBe('Rəşad Quliyev');
        },
      },
    ];

    const evaluationResults: any[] = [];

    for (const pair of pairs) {
      const cv = await service.generate(pair.candidate, pair.job, { language: 'az' });
      const letter = await service.generateLetter(pair.candidate, pair.job, {
        language: 'az',
        motivation: pair.motivation,
      });

      expect(cv.content.basics.headline).toContain(pair.expectedTitle);
      expect(JSON.stringify(cv.content)).toContain(pair.expectedKeyword);
      expect(letter.content.paragraphs.length).toBeGreaterThanOrEqual(2);
      expect(letter.content.recipient.company).toContain(pair.job.company.split(' ')[0]);

      pair.assertScope(cv, letter);

      // Verify clean Typst PDF compilation for both documents
      const cvPdf = service.compileDocumentPdf(cv.content);
      const letterPdf = service.compileDocumentPdf(letter.content);

      expect(Buffer.isBuffer(cvPdf)).toBe(true);
      expect(cvPdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(cvPdf.length).toBeGreaterThan(5000);

      expect(Buffer.isBuffer(letterPdf)).toBe(true);
      expect(letterPdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(letterPdf.length).toBeGreaterThan(3000);

      evaluationResults.push({
        id: pair.id,
        candidateName: pair.candidate.basics.name,
        targetRole: pair.job.position,
        company: pair.job.company,
        headline: cv.content.basics.headline,
        summary: cv.content.summary,
        cvPdfBytes: cvPdf.length,
        letterPdfBytes: letterPdf.length,
        letterIntro: letter.content.paragraphs[0]?.text,
        letterBody: letter.content.paragraphs[1]?.text,
      });
    }

    expect(evaluationResults.length).toBe(6);

    // Save summary of generated evaluation results into a test fixture artifact
    const reportData = {
      evaluatedAt: new Date().toISOString(),
      liveProviderEvaluated: false,
      liveQualityLabel: 'Unverified live writing quality (local deterministic generator and Typst renderer verified)',
      pairs: evaluationResults,
    };

    if (!fs.existsSync(artifactDir)) {
      fs.mkdirSync(artifactDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(artifactDir, 'candidate-quality-6pair-evaluation.json'),
      JSON.stringify(reportData, null, 2),
      'utf8',
    );
  });
});
