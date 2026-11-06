import { cleanEmployerName, composeNarrativeLetter, inOrganisation, linkRequirements, plainCase } from './az-letter-compose';
import { letterEvidence } from './az-writer';
import { vacancyRequirements } from './az-compose';
import { dateProblems } from './az-dates';
import type { Persona, TailorJobInput } from './resume-tailor.types';

const base = { basics: { name: 'N', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } }, summary: '', skills: [], languages: [], projects: [], activities: [], awards: [], stories: [] };
const pharmacist = {
  ...base,
  experience: [
    { company: 'Şəfa Aptek ASC', position: 'Əczaçı', location: 'Bakı', period: 'Sep 2019 - Present', highlights: ['Reseptlərə əsasən dərmanları təqdim edirəm', 'Dərmanların istifadə müddətinə nəzarət edirəm', 'Aptekin aylıq qalıq hesabatını hazırlayıram'] },
    { company: 'Mərkəzi Xəstəxana', position: 'Əczaçı köməkçisi', location: 'Bakı', period: '2017 - 2019', highlights: ['Xəstəxana anbarından şöbələrə dərman paylanmasında iştirak etdim'] },
  ],
  education: [{ school: 'Azərbaycan Tibb Universiteti', degree: 'Bakalavr', area: 'Əczaçılıq', location: 'Bakı', period: '2013 - 2017', grade: '' }],
  certifications: [{ id: 'c0', title: 'Əczaçılıq fəaliyyəti üzrə sertifikat', issuer: 'Səhiyyə Nazirliyi', date: '2018', entryId: 'ec0' }],
} as unknown as Persona;
const job: TailorJobInput = { id: 'j', position: 'Baş əczaçı', company: 'Zeytun Əczaçılıq ASC', location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: '', description: 'Aptek şəbəkəsinin filialında dərmanların satışı və qalıq nəzarəti.', requirements: '- Əczaçılıq üzrə ali təhsil\n- Minimum 3 il təcrübə\n- Dərman qalıqlarının uçotu bacarığı', responsibilities: '' };

describe('requirement links and the composed letter', () => {
  it('keeps abbreviations as written when naming the position ("IT dəstək", never the dotless "ıt")', () => {
    const it = { ...pharmacist, experience: [{ company: 'Rəqəm Texnologiya MMC', position: 'IT dəstək mütəxəssisi', location: '', period: 'Feb 2022 - Present', highlights: ['İşçilərin kompüter problemlərini həll edirəm'] }] } as unknown as Persona;
    const text = composeNarrativeLetter(it, job, { motivation: '' }).paragraphs.join(' ');
    expect(text).toContain('IT dəstək mütəxəssisi vəzifəsində işləyirəm');
    expect(text).not.toContain('ıt dəstək');
  });

  it('answers a degree requirement with the degree, never with a certificate', () => {
    const ev = letterEvidence(pharmacist, job);
    const links = linkRequirements(vacancyRequirements(job), ev);
    const degree = links.find((l) => /ali təhsil/.test(l.requirement));
    expect(degree).toBeDefined();
    expect(ev.find((e) => e.id === degree!.evidenceId)?.kind).toBe('education');
    expect(links.every((l) => ev.find((e) => e.id === l.evidenceId)?.kind !== 'certificate' || /sertifikat|kurs|təlim/i.test(l.requirement))).toBe(true);
  });

  it('tells the facts as first-person sentences with correct dates, once, and invents no reason', () => {
    const { paragraphs } = composeNarrativeLetter(pharmacist, job, { motivation: 'Pasiyentlərə düzgün dərman məsləhəti verməyi vacib sayıram.' });
    const text = paragraphs.join('\n');
    expect(paragraphs[0]).toBe('Zeytun Əczaçılıq ASC tərəfindən elan olunmuş Baş əczaçı vakansiyasına müraciət edirəm. Pasiyentlərə düzgün dərman məsləhəti verməyi vacib sayıram.');
    expect(text).toContain('2019-cu ilin sentyabrından Şəfa Aptek ASC şirkətində əczaçı vəzifəsində işləyirəm.');
    expect(text).toContain('2017-ci ildən 2019-cu ilə qədər Mərkəzi Xəstəxanasında əczaçı köməkçisi vəzifəsində işləmişəm.'); // ended role: past
    expect(text).not.toMatch(/tələb olunur|tələbi ilə bağlı/); // fit is not announced by quoting the vacancy
    expect(text).toContain('2013-cü ildən 2017-ci ilə qədər Azərbaycan Tibb Universitetində Əczaçılıq ixtisası üzrə bakalavr təhsili almışam.');
    expect(text).not.toMatch(/ertifikatım: Əczaçılıq fəaliyyəti/); // a certificate is not offered for a degree requirement
    expect(dateProblems(text)).toEqual([]);
    expect(text).not.toMatch(/maraq|həvəs|arzu/i);
  });

  it('adds the employer reason only when the candidate wrote one, in the candidate\'s own words', () => {
    const none = composeNarrativeLetter(pharmacist, job, { motivation: '' }).paragraphs;
    const some = composeNarrativeLetter(pharmacist, job, { motivation: '', companyReason: 'Zeytun şəbəkəsinin aptek xidmətinə yanaşması mənə yaxındır.' }).paragraphs;
    expect(none.join(' ')).not.toContain('Zeytun şəbəkəsinin');
    expect(some.join(' ')).toContain('Zeytun şəbəkəsinin aptek xidmətinə yanaşması mənə yaxındır.');
    expect(none.at(-1)).toBe('Təcrübəm barədə görüşdə ətraflı danışmağa hazıram.');
    expect(some.at(-1)).toBe('Təcrübəmi və motivasiyamı görüşdə ətraflı izah etməyə hazıram.');
  });
});

describe('the composed letter as a personal explanation (founder review round 2)', () => {
  const sparse = { ...base, experience: [{ company: 'Zəng Mərkəzi MMC', position: 'Operator', location: 'Bakı', period: '2023 - 2024', highlights: ['Gələn zənglərə cavab verirdim'] }], education: [], certifications: [] } as unknown as Persona;
  const vacancy: TailorJobInput = { ...job, position: 'Müştəri xidməti operatoru', company: 'Azərbaycan Hava Yolları ASC', requirements: '- Rus və Azərbaycan dillərini bilmək\n- Gələn zənglərə cavab vermək', description: '' };

  it('uses the candidate\'s answers in a connected order: reason, what made it clear, the work, what to notice, what caught the eye', () => {
    const { paragraphs } = composeNarrativeLetter(sparse, vacancy, {
      motivation: 'İnsanlara dəqiq məlumat verməyi sevirəm.',
      formative: 'Zəng mərkəzində əsəbi müştərini sakitləşdirdikdə bu işin mənalı olduğunu anladım.',
      contribution: 'Zənglərə sakit cavab verməyi bacarıram.',
      companyReason: 'Hava yolunda müştəriyə kömək etmək mənə maraqlı gəlir.',
    });
    expect(paragraphs[0]).toBe('Azərbaycan Hava Yolları ASC tərəfindən elan olunmuş Müştəri xidməti operatoru vakansiyasına müraciət edirəm. İnsanlara dəqiq məlumat verməyi sevirəm. Zəng mərkəzində əsəbi müştərini sakitləşdirdikdə bu işin mənalı olduğunu anladım.');
    expect(paragraphs[1]).toContain('2023-cü ildən 2024-cü ilə qədər Zəng Mərkəzi MMC şirkətində operator vəzifəsində işləmişəm.');
    expect(paragraphs[2]).toBe('Zənglərə sakit cavab verməyi bacarıram. Hava yolunda müştəriyə kömək etmək mənə maraqlı gəlir.');
    expect(paragraphs.join(' ')).not.toMatch(/tələb olunur|tələbi ilə|Elanda/);
  });

  it('stays short and honest without answers: no reason, no feeling, no padding', () => {
    const { paragraphs } = composeNarrativeLetter(sparse, vacancy, { motivation: '' });
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.join(' ')).not.toMatch(/sevir|maraq|həvəs|arzu|cəlb/);
    expect(paragraphs[2]).toBe('Təcrübəm barədə görüşdə ətraflı danışmağa hazıram.');
  });

  it('puts the achievement with a measurable result first and keeps the degree for a degree requirement', () => {
    const exp = { ...base, experience: [{ company: 'Elektro Plus MMC', position: 'Satış şöbəsinin rəhbəri', location: 'Bakı', period: 'Mar 2020 - Present', highlights: ['5 nəfərlik satış komandasına rəhbərlik edirəm', 'Aylıq satış hesabatlarını hazırlayıram', '2023-cü ildə satışı 25% artırdım'] }], education: [{ school: 'Bakı Biznes Universiteti', degree: 'Bakalavr', area: 'Marketinq', location: '', period: '2013 - 2017', grade: '' }], certifications: [] } as unknown as Persona;
    const v: TailorJobInput = { ...job, position: 'Regional satış meneceri', company: 'Nərgiz MMC', requirements: '- Satış komandasına rəhbərlik təcrübəsi\n- Marketinq üzrə ali təhsil', description: '' };
    const text = composeNarrativeLetter(exp, v, { motivation: '' }).paragraphs.join(' ');
    expect(text.indexOf('25%')).toBeGreaterThan(-1);
    expect(text).toContain('2013-cü ildən 2017-ci ilə qədər Bakı Biznes Universitetində Marketinq ixtisası üzrə bakalavr təhsili almışam.');
  });
});

describe('where a candidate worked', () => {
  it('uses the right word for the kind of employer and never calls a school a company', () => {
    expect(inOrganisation('Şəfa Aptek ASC')).toBe('Şəfa Aptek ASC şirkətində');
    expect(inOrganisation('Gənc Nəsil Məktəbi')).toBe('Gənc Nəsil Məktəbində');
    expect(inOrganisation('Mərkəzi Xəstəxana')).toBe('Mərkəzi Xəstəxanasında');
    expect(inOrganisation('Kafe Mərkəz')).toBe('Kafe Mərkəz təşkilatında');
  });

  it('strips awards and qualifiers from employer name and avoids polluted locative forms', () => {
    expect(cleanEmployerName('Outstanding Contributor | Contoso Pathways')).toBe('Contoso Pathways');
    expect(cleanEmployerName('Contoso Pathways | Outstanding Contributor')).toBe('Contoso Pathways');
    expect(cleanEmployerName('Top 1% | Contoso MMC')).toBe('Contoso MMC');
    expect(cleanEmployerName('Contoso Pathways')).toBe('Contoso Pathways');

    expect(inOrganisation('Outstanding Contributor | Contoso Pathways')).toBe('Contoso Pathways təşkilatında');
    expect(inOrganisation('Contoso Pathways | Outstanding Contributor')).toBe('Contoso Pathways təşkilatında');
    expect(inOrganisation('Contoso Pathways, MMC')).toBe('Contoso Pathways, MMC şirkətində');
  });

  it('varies connectors between consecutive roles and filters generic communication fluff', () => {
    const candidate: any = {
      basics: { name: 'Leyla', headline: 'Data Analyst' },
      experience: [
        {
          position: 'Junior BI Developer',
          company: 'Outstanding Contributor | Contoso Pathways',
          period: '2023 - Present',
          current: true,
          highlights: [
            'Komanda daxilində güclü ünsiyyət bacarıqları nümayiş etdirdi',
            '95K+ müştəri üçün RFM iş axını və 13M gəlir əhatə edən Power BI paneli qurdu',
          ],
        },
        {
          position: 'Data Intern',
          company: 'DataLead MMC',
          period: '2022 - 2023',
          highlights: ['SQL sorğuları yazaraq gündəlik hesabatları avtomatlaşdırdı'],
        },
      ],
      education: [],
      skills: [],
    };
    const jobInput: any = {
      company: 'DataLead MMC',
      position: 'Junior BI Developer / Data Analyst',
      requirements: 'Power BI və SQL bilikləri',
    };
    const { paragraphs } = composeNarrativeLetter(candidate, jobInput, { motivation: '' });
    const fullText = paragraphs.join(' \n');

    // Employer name in first role must be cleaned
    expect(fullText).toContain('Contoso Pathways təşkilatında');
    expect(fullText).not.toContain('Outstanding Contributor');

    // Metric is preserved without 13M gəlirəm corruption
    expect(fullText).toContain('13M gəlir');
    expect(fullText).not.toContain('13M gəlirəm');

    // Generic communication claim was filtered in favor of concrete deliverable
    expect(fullText).not.toContain('güclü ünsiyyət');

    // First role connector is "Bu müddət ərzində"
    expect(fullText).toContain('Bu müddət ərzində');
    // Earlier role connector varies to "Həmin dövrdə" and does not repeat "Bu müddət ərzində"
    expect(fullText).toContain('Bundan əvvəl,');
    expect(fullText).toContain('Həmin dövrdə');
  });

  it('reproduction: strips institutional prefixes from vacancy position and separates comma-separated awards from employer', () => {
    const candidate: any = {
      basics: { name: 'Fizuli Hasanov', headline: 'Proses Analitiki' },
      experience: [
        {
          position: 'Məlumat Analitiki Təcrübəçi, Əla töhfəçi',
          company: 'Elevvo Pathways',
          period: 'Fev 2026 - Mar 2026',
          highlights: ['95K+ müştəri üçün RFM iş axını qurdum'],
        },
      ],
      education: [],
      skills: [],
    };
    const jobInput: any = {
      company: 'ABB',
      position: 'Hiper avtomatlaşdırma üzrə ekspert mərkəzinə proseslərin avtomatlaşdırılması üzrə analitik',
      requirements: 'Proseslərin avtomatlaşdırılması və analitika',
    };
    const { paragraphs } = composeNarrativeLetter(candidate, jobInput, {
      motivation: 'Proseslərin optimallaşdırılmasına marağım var.',
      contribution: 'Müştəri və ya həmkarlarla aydın ünsiyyət qura bilirəm.',
    });
    const fullText = paragraphs.join(' \n');

    // Opening cleans institutional prefix
    expect(paragraphs[0]).toContain('ABB tərəfindən elan olunmuş Proseslərin avtomatlaşdırılması üzrə analitik vakansiyasına müraciət edirəm.');
    expect(paragraphs[0]).not.toContain('ekspert mərkəzinə');

    // Employer name clean: not "Əla töhfəçi, Elevvo Pathways"
    expect(fullText).toContain('Elevvo Pathways təşkilatında');
    expect(fullText).not.toContain('Əla töhfəçi, Elevvo Pathways');

    // Generic communication claim dropped
    expect(fullText).not.toContain('aydın ünsiyyət qura bilirəm');
  });

  it('renders project and activity evidence as natural narrative clauses instead of colon lists', () => {
    const studentCandidate: any = {
      basics: { name: 'Aysel Məmmədova', headline: 'Kompüter elmləri tələbəsi' },
      experience: [],
      projects: [
        {
          name: 'Bank Prosesləri Portalı',
          organization: 'ABB Hackathon',
          period: '2023',
          description: 'Kredit müraciəti prosesinin avtomatlaşdırılmasını icra etdim.',
        },
      ],
      activities: [
        {
          title: 'Könüllü',
          organization: 'Azərbaycan İnkişaf Fondu',
          period: '2022',
          description: 'Gənclər üçün rəqəmsal bacarıqlar təliminin təşkilini icra etdim.',
        },
      ],
      education: [],
      skills: [],
    };
    const jobInput: any = {
      company: 'ABB ASC',
      position: 'Proseslərin avtomatlaşdırılması üzrə mütəxəssis',
      requirements: 'Proseslərin avtomatlaşdırılması və rəqəmsal bacarıqlar',
    };
    const { paragraphs } = composeNarrativeLetter(studentCandidate, jobInput, {
      motivation: 'Bank sistemlərində proseslərin avtomatlaşdırılması üzrə təcrübə qazanmaq istəyirəm.',
    });
    const letter = paragraphs.join(' \n');
    expect(letter).toContain('ABB Hackathon nəzdində «Bank Prosesləri Portalı» layihəsi çərçivəsində kredit müraciəti prosesinin avtomatlaşdırılmasını icra etdim.');
    expect(letter).not.toMatch(/Bank Prosesləri Portalı.*:/);
  });
});

describe('plainCase keeps names and platforms', () => {
  it('never turns a Latin capital I into the dotless ı, and keeps known platform names', () => {
    expect(plainCase('Instagram səhifəsi')).toBe('Instagram səhifəsi');
    expect(plainCase('Excel hesabatı')).toBe('Excel hesabatı');
    expect(plainCase('Əczaçı köməkçisi')).toBe('əczaçı köməkçisi');
    expect(plainCase('IT dəstək')).toBe('IT dəstək');
  });
});

it('frames a confirmed mentorship as programme participation rather than employment', () => {
  const p = { ...base, basics: { ...base.basics }, education: [], certifications: [], experience: [
    { company: 'Nümunə Mentor Proqramı', position: 'Audit üzrə mentee', period: '2024 - 2025', location: 'Bakı', highlights: ['Excel ilə sənədləri yoxladım.'] },
  ] } as unknown as Persona;
  const text = composeNarrativeLetter(p, { ...job, position: 'Audit təcrübəçisi', requirements: 'Excel ilə sənədlərin yoxlanılması' }, { motivation: '' }).paragraphs.join(' ');
  expect(text).toContain('iştirak etmişəm. Bu müddət ərzində');
  expect(text).not.toContain('vəzifəsində işləmişəm');
});
