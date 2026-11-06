import { composeTargetRoleHeadline } from './az-compose';
import { applyLetterEdits, applyReviewEdits, CandidateFacts, reconcileLetter, reconcileWithFacts, RejectedWithFeedback, TailorOutputError } from './tailor-facts';
import { Persona } from './resume-tailor.types';

const persona: Persona = {
  basics: { name: 'Leyla Huseynova', headline: 'Backend mühəndisi', email: 'leyla.synthetic@example.com', phone: '', location: 'Gəncə', website: { url: '', label: '' } },
  summary: 'Backend mühəndisi based in Gəncə.',
  experience: [
    {
      company: 'Qafqaz Labs',
      position: 'Backend Engineer',
      location: 'Gəncə',
      period: 'Jan 2022 - Present',
      highlights: ['Built REST APIs with NestJS and PostgreSQL.', 'Reduced response time by 30%.'],
    },
    {
      company: 'Xəzər Soft',
      position: 'Junior Developer',
      location: 'Bakı',
      period: 'Jun 2019 - Dec 2021',
      highlights: ['Maintained internal tools in TypeScript.'],
    },
  ],
  education: [{ school: 'Azərbaycan Texniki Universiteti', degree: 'Bakalavr', area: 'Kompüter elmləri', location: 'Bakı', period: 'Sep 2015 - Jun 2019', grade: '' }],
  skills: [{ name: 'Skills', keywords: ['NestJS', 'PostgreSQL', 'TypeScript', 'İngilis dili'], proficiency: '', level: 0 }],
  languages: [],
  projects: [],
  certifications: [],
};

const job = {
  id: 'job_1', position: 'Senior Backend Developer', company: 'Synthetic Co', location: 'Bakı', education: '', experience: '',
  salary_from: '', salary_to: '', category: '',
  description: 'We build services on Kubernetes and AWS. NestJS experience is a plus.',
  requirements: 'Docker, Kubernetes, PostgreSQL.', responsibilities: '',
};

const faithful = {
  language: 'az',
  headline: 'Backend mühəndisi (NestJS, PostgreSQL)',
  summary: 'NestJS və PostgreSQL ilə REST API-lər hazırlayan backend mühəndisi. TypeScript ilə daxili alətləri dəstəkləyib.',
  experience: [
    { company: 'Qafqaz Labs', position: 'Backend Engineer', period: 'Jan 2022 - Present', highlights: ['NestJS və PostgreSQL-dən istifadə edərək REST API-lər hazırladı.', 'Cavab müddətini 30% azaltdı.'] },
    { company: 'Xəzər Soft', position: 'Junior Developer', period: 'Jun 2019 - Dec 2021', highlights: ['TypeScript ilə daxili alətləri dəstəklədi.'] },
  ],
  skills: [{ name: 'Bacarıqlar', keywords: ['PostgreSQL', 'NestJS'] }],
};

describe('reconcileWithFacts', () => {
  it('keeps faithful Azerbaijani rewording and every saved fact', () => {
    const { content, issues } = reconcileWithFacts(persona, faithful);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(content.basics).toMatchObject({ name: 'Leyla Huseynova', email: 'leyla.synthetic@example.com', headline: faithful.headline });
    expect(content.experience.map((e) => [e.company, e.position, e.period])).toEqual([
      ['Qafqaz Labs', 'Backend Engineer', 'Jan 2022 - Present'],
      ['Xəzər Soft', 'Junior Developer', 'Jun 2019 - Dec 2021'],
    ]);
    expect(content.experience[0].highlights).toEqual(faithful.experience[0].highlights);
    // Preserves validated requested ordering and intentional omissions of skills
    expect(content.skills[0].keywords).toEqual(['PostgreSQL', 'NestJS']);
    // The section heading already says "Bacarıqlar"; the group itself is unnamed.
    expect(content.skills[0].name).toBe('');
    expect(content.education).toEqual(persona.education);
  });

  it('drops an Azerbaijani sentence that drifts into another language, keeps clean ones', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      language: 'az',
      summary: 'Qafqaz Labs-də Backend Engineer kimi işləyir. Sep 2020-présentə qədər NestJS ilə işləyib.',
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'wrong_language_text', severity: 'error', section: 'summary', detail: expect.stringContaining('présentə') }));
    expect(content.summary).toBe('Qafqaz Labs-də Backend Engineer kimi işləyir.');
  });

  it('allows letters from the candidate\'s own data and does not apply the alphabet check to English drafts', () => {
    const russian: Persona = { ...persona, experience: [{ ...persona.experience[0], company: 'Яндекс Баку' }, persona.experience[1]] };
    const az = reconcileWithFacts(russian, { ...faithful, language: 'az', summary: 'Яндекс Баку-da Backend Engineer kimi işləyir.' });
    expect(az.issues.filter((i) => i.code === 'wrong_language_text')).toEqual([]);
    const en = reconcileWithFacts(persona, { ...faithful, language: 'en', summary: 'Built APIs at Qafqaz Labs, a café-style startup.' });
    expect(en.issues.filter((i) => i.code === 'wrong_language_text')).toEqual([]);
  });

  it('never lets the model change the name, contact, employer, position or dates', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      basics: { name: 'Someone Else', email: 'x@y.z' },
      experience: [
        { company: 'Qafqaz Labs', position: 'Lead Architect', period: '2015 - Present', highlights: ['NestJS ilə REST API-lər hazırladı.'] },
        faithful.experience[1],
      ],
    });
    expect(content.basics.name).toBe('Leyla Huseynova');
    expect(content.experience[0]).toMatchObject({ position: 'Backend Engineer', period: 'Jan 2022 - Present' });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['changed_position', 'changed_period']));
  });

  it('drops and reports an invented employer', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      experience: [...faithful.experience, { company: 'Google', position: 'Staff Engineer', period: '2018 - 2019', highlights: ['Led search.'] }],
    });
    expect(content.experience.map((e) => e.company)).toEqual(['Qafqaz Labs', 'Xəzər Soft']);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'invented_experience', severity: 'error', detail: expect.stringContaining('Google') }));
  });

  it('drops sentences with metrics or years the facts do not contain', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      summary: 'Backend mühəndisi. 2016-cı ildən 45% artım təmin edib.',
      experience: [
        { ...faithful.experience[0], highlights: ['Cavab müddətini 30% azaltdı.', 'Gəliri 2 milyon manat artırdı.'] },
        faithful.experience[1],
      ],
    });
    expect(content.summary).toBe('Backend mühəndisi.');
    expect(content.experience[0].highlights).toEqual(['Cavab müddətini 30% azaltdı.']);
    expect(issues.filter((i) => i.code === 'unsupported_number').length).toBe(2);
  });

  it('drops claims about technologies the candidate never listed, including near names', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      experience: [
        { ...faithful.experience[0], highlights: ['Kubernetes-də mikroservisləri idarə etdi.', 'NestJS və PostgreSQL-dən istifadə edərək REST API-lər hazırladı.'] },
        { ...faithful.experience[1], highlights: ['TypeScript və Java ilə alətlər yazdı.'] },
      ],
    });
    // The saved line carrying the metric (30%) is in English while this document is Azerbaijani: it is not copied in, and the candidate is told how to add it.
    expect(content.experience[0].highlights).toEqual(['NestJS və PostgreSQL-dən istifadə edərək REST API-lər hazırladı.']);
    expect(issues.find((i) => i.code === 'dropped_metric')).toMatchObject({ reason: 'OTHER_LANGUAGE' });
    // Every bullet for this entry was rejected, so the saved description is kept.
    expect(content.experience[1].highlights).toEqual(persona.experience[1].highlights);
    expect(issues.filter((i) => i.code === 'unsupported_term').map((i) => i.detail)).toEqual([
      expect.stringContaining('Kubernetes'),
      expect.stringContaining('Java'),
    ]);
  });

  it('reports invented skills, education, languages and projects without adding them', () => {
    const { content, issues } = reconcileWithFacts(persona, {
      ...faithful,
      skills: [{ keywords: ['NestJS', 'Kubernetes', 'AWS'] }],
      education: [{ school: 'MIT', degree: 'MSc' }],
      languages: [{ language: 'Alman', fluency: 'C1' }, { language: 'İngilis' }],
      projects: [{ name: 'Search engine' }],
    });
    expect(content.skills[0].keywords).toEqual(['NestJS']);
    expect(content.education).toEqual(persona.education);
    expect(content.projects).toEqual([]);
    expect(content.languages).toEqual([]);
    const codes = issues.map((i) => `${i.code}:${i.detail}`);
    expect(codes).toEqual(expect.arrayContaining(['invented_skill:Kubernetes', 'invented_skill:AWS', 'invented_language:Alman', 'invented_project:Search engine']));
    expect(codes.some((c) => c.startsWith('invented_education'))).toBe(true);
    expect(codes).not.toContain('invented_language:İngilis');
  });

  it('keeps every saved entry and reports, rather than silently drops, surplus bullets', () => {
    const many = Array.from({ length: 11 }, (_, i) => `NestJS ilə REST API hazırladı (${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'][i]}).`);
    const { content, issues } = reconcileWithFacts(persona, { ...faithful, experience: [{ ...faithful.experience[0], highlights: many }] });
    expect(content.experience).toHaveLength(2);
    expect(content.experience[0].highlights).toHaveLength(8);
    expect(content.experience[1].highlights).toEqual(persona.experience[1].highlights);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'trimmed_highlights', detail: '3 generated bullet(s) not used' }));
  });

  it.each([['null', null], ['an array', []], ['an empty object', {}], ['only rejected text', { summary: 'Kubernetes expert.' }]])(
    'rejects %s as unusable output',
    (_label, output) => {
      expect(() => reconcileWithFacts(persona, output, job)).toThrow(TailorOutputError);
    },
  );

  it("treats a sentence-initial word from the job's own vocabulary as a claim", () => {
    const { content, issues } = reconcileWithFacts(persona, { ...faithful, summary: 'Kubernetes mütəxəssisi. NestJS ilə işləyir.' }, job);
    expect(content.summary).toBe('NestJS ilə işləyir.');
    expect(issues).toContainEqual(expect.objectContaining({ code: 'unsupported_term', detail: expect.stringContaining('Kubernetes') }));
  });
});

describe('CandidateFacts', () => {
  it('matches Azerbaijani/Turkish case and diacritics', () => {
    const facts = new CandidateFacts(persona);
    expect(facts.skill('ingilis DİLİ')).toBe('İngilis dili');
    expect(facts.unsupported('Gəncədə və Bakıda işləyib.')).toBeNull();
  });
});

describe('applyReviewEdits', () => {
  const draft = reconcileWithFacts(persona, faithful).content;

  it('applies wording edits but keeps identity facts from the saved profile', () => {
    const next = applyReviewEdits(persona, draft, {
      headline: 'Backend mühəndisi',
      experience: [{ company: 'Changed', highlights: ['Öz sözlərimlə yazılmış bənd.'] }, { highlights: [] }],
      skills: ['TypeScript', 'nestjs'],
    });
    expect(next.experience[0]).toMatchObject({ company: 'Qafqaz Labs', highlights: ['Öz sözlərimlə yazılmış bənd.'] });
    expect(next.skills[0].keywords).toEqual(['TypeScript', 'NestJS']);
    expect(next.basics.name).toBe('Leyla Huseynova');
  });

  it('refuses a skill that is not in the saved profile, and a mismatched entry count', () => {
    expect(() => applyReviewEdits(persona, draft, { skills: ['Kubernetes'] })).toThrow(/not in saved profile/);
    expect(() => applyReviewEdits(persona, draft, { experience: [{ highlights: [] }] })).toThrow(/must match/);
  });
});


describe('reconcileLetter', () => {
  const lettered: Persona = { ...persona, stories: [{ entryId: 's1', title: 'API sürəti', situation: 'Hesabat sorğuları yavaş idi.', action: 'PostgreSQL indekslərini yenilədim.', result: 'Sorğu vaxtı 30% azaldı.' }] };
  const body = {
    paragraphs: [
      'Backend mühəndisi olaraq Synthetic Co şirkətində Senior Backend Developer vəzifəsi ilə maraqlanıram.',
      'NestJS və PostgreSQL ilə REST API-lər hazırlamışam. Cavab müddətini 30% azaltdım.',
      'Hesabat sorğuları yavaş idi. PostgreSQL indekslərini yenilədim. Sorğu vaxtı 30% azaldı.',
    ],
  };
  const opts = { language: 'az', today: new Date('2026-10-04T10:00:00Z') };

  it('keeps fact-supported paragraphs and writes the fixed parts itself', () => {
    const { content, issues } = reconcileLetter(lettered, { ...body, salutation: 'Dear Bob', closing: 'Cheers' }, job, opts);
    expect(content).toMatchObject({ kind: 'LETTER', language: 'az', date: '2026-10-04', salutation: 'Hörmətli işə qəbul komandası,', closing: 'Hörmətlə,', signature: 'Leyla Huseynova', recipient: { company: 'Synthetic Co', position: 'Senior Backend Developer' } });
    expect(content.paragraphs.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(issues).toEqual([]);
  });

  it('drops an unsupported sentence, number, employer and tool, and reports each', () => {
    const { content, issues } = reconcileLetter(lettered, { paragraphs: [...body.paragraphs, 'Google şirkətində gəliri 45% artırdım. Kubernetes istifadə etdim.'] }, job, opts);
    expect(JSON.stringify(content)).not.toMatch(/Google|45%|Kubernetes/);
    expect(issues.filter((i) => i.severity === 'error').length).toBeGreaterThanOrEqual(1);
  });

  it('does not let the vacancy text support a claim: only its own name, title and place do', () => {
    const { content } = reconcileLetter(lettered, { paragraphs: [...body.paragraphs, 'Mən Kubernetes və AWS üzrə mütəxəssisəm.'] }, job, opts);
    expect(JSON.stringify(content)).not.toMatch(/Kubernetes|AWS/);
  });

  it('counts what the candidate typed as motivation as theirs', () => {
    const { content } = reconcileLetter(lettered, { paragraphs: [...body.paragraphs, 'Mikroservis memarlığı mənim üçün vacibdir.'] }, job, { ...opts, motivation: 'Mikroservis memarlığı mənim üçün vacibdir.' });
    expect(content.paragraphs.map((p) => p.text)).toContain('Mikroservis memarlığı mənim üçün vacibdir.');
  });

  it('refuses output with fewer than two usable paragraphs', () => {
    expect(() => reconcileLetter(lettered, { paragraphs: ['Google-da 45% artım təmin etdim.'] }, job, opts)).toThrow(TailorOutputError);
    expect(() => reconcileLetter(lettered, 'not an object', job, opts)).toThrow(TailorOutputError);
    expect(() => reconcileLetter(lettered, { paragraphs: [] }, job, opts)).toThrow(TailorOutputError);
  });

  it('keeps approved paragraphs of the previous letter in place and fills the other slots with new text', () => {
    const previous = [
      { id: 'p1', text: 'Mənim təsdiqlənmiş sözlərim.', approved: true },
      { id: 'p2', text: 'köhnə ikinci' },
      { id: 'p3', text: 'köhnə üçüncü' },
    ];
    const { content, issues } = reconcileLetter(lettered, body, job, { ...opts, previous });
    expect(content.paragraphs[0]).toEqual({ id: 'p1', text: 'Mənim təsdiqlənmiş sözlərim.', approved: true });
    // Slots 2 and 3 take the first two generated paragraphs; the third generated one is appended.
    expect(content.paragraphs.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(content.paragraphs.map((p) => p.text).slice(1)).toEqual(body.paragraphs);
    expect(issues.map((i) => i.code)).toContain('kept_approved_paragraph');
  });

  it('never exceeds five paragraphs', () => {
    const unique = { paragraphs: ['NestJS üzrə təcrübəm var.', 'PostgreSQL üzrə təcrübəm var.', 'TypeScript üzrə təcrübəm var.', 'Backend mühəndisi olaraq işləyirəm.', 'Gəncədə yaşayıram.', 'NestJS və PostgreSQL bacarıqlarım var.', 'TypeScript və NestJS bacarıqlarım var.'] };
    const { content, issues } = reconcileLetter(lettered, unique, job, opts);
    expect(content.paragraphs).toHaveLength(5);
    expect(issues.map((i) => i.code)).toContain('trimmed_paragraphs');
  });
});

describe('applyLetterEdits', () => {
  const base = reconcileLetter(persona, { paragraphs: ['NestJS üzrə təcrübəm var.', 'PostgreSQL üzrə təcrübəm var.'] }, job, { language: 'az' }).content;

  it('replaces wording, assigns ids to new paragraphs, and re-applies identity from the saved profile', () => {
    const next = applyLetterEdits({ ...base, signature: 'Mallory', basics: { ...base.basics, name: 'Mallory' } }, persona, {
      paragraphs: [{ id: 'p1', text: ' Yeni söz. ', approved: true }, { id: 'p2', text: 'İkinci.' }, { text: 'Üçüncü.' }],
    });
    expect(next.paragraphs).toEqual([{ id: 'p1', text: 'Yeni söz.', approved: true }, { id: 'p2', text: 'İkinci.' }, { id: 'p3', text: 'Üçüncü.' }]);
    expect(next.signature).toBe('Leyla Huseynova');
    expect(next.basics.name).toBe('Leyla Huseynova');
    expect(next.recipient.company).toBe('Synthetic Co');
  });

  it.each([
    ['no paragraphs', { paragraphs: [] }],
    ['six paragraphs', { paragraphs: Array.from({ length: 6 }, (_, i) => ({ text: `x${i}` })) }],
    ['an unknown id', { paragraphs: [{ id: 'zzz', text: 'x' }] }],
    ['a duplicate id', { paragraphs: [{ id: 'p1', text: 'a' }, { id: 'p1', text: 'b' }] }],
    ['an empty paragraph', { paragraphs: [{ id: 'p1', text: '  ' }] }],
    ['an oversized paragraph', { paragraphs: [{ id: 'p1', text: 'x'.repeat(1501) }] }],
    ['a non-object paragraph', { paragraphs: ['text'] }],
  ])('refuses %s', (_label, edits) => expect(() => applyLetterEdits(base, persona, edits)).toThrow(TailorOutputError));

  it('leaves the letter alone when no paragraph edit is sent', () => {
    expect(applyLetterEdits(base, persona, {}).paragraphs).toEqual(base.paragraphs);
  });
});

describe('letter style guards (letters only)', () => {
  const lettered: Persona = { ...persona, stories: [{ entryId: 's1', title: 'API sürəti', situation: 'Hesabat sorğuları yavaş idi.', action: 'PostgreSQL indekslərini yenilədim.', result: 'Sorğu vaxtı 30% azaldı.' }] };
  const grounded = ['Backend mühəndisi olaraq Synthetic Co şirkətində Senior Backend Developer vəzifəsi ilə maraqlanıram.', 'Hesabat sorğuları yavaş idi. PostgreSQL indekslərini yenilədim. Sorğu vaxtı 30% azaldı.'];
  const az = { language: 'az', today: new Date('2026-10-04T10:00:00Z') };
  const texts = (c: { paragraphs: { text: string }[] }) => c.paragraphs.map((p) => p.text).join(' ');

  it('removes a feeling, taste or hardship the candidate never stated, and reports it', () => {
    const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Bu işi çox sevirəm. Hər çətin tapşırıq məni ruhlandırır, çətinlik idi.'] }, job, az);
    expect(texts(content)).not.toMatch(/sevir|çətinlik/);
    expect(issues.filter((i) => i.code === 'unsupported_personal_claim' && i.severity === 'error').length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['en', 'I am passionate about clean data. I love this vacancy.', 'passionate|love'],
    ['ru', 'Мне нравится эта вакансия. Я мечтаю об этом.', 'нравится|мечта'],
  ])('applies the same rule in %s', (language, claim, forbidden) => {
    const { content, issues } = reconcileLetter(lettered, { paragraphs: ['Hesabat sorğuları yavaş idi. PostgreSQL indekslərini yenilədim.', 'Sorğu vaxtı 30% azaldı.', claim] }, job, { ...az, language });
    expect(texts(content)).not.toMatch(new RegExp(forbidden, 'i'));
    expect(issues.map((i) => i.code)).toContain('unsupported_personal_claim');
  });

  it('keeps the same statement when the candidate said it themselves (their motivation or a story)', () => {
    const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Hesabat sorğularını sürətləndirmək mənə xoş gəlir və bunu sevirəm.'] }, job, { ...az, motivation: 'Sorğuları sürətləndirməyi sevirəm.' });
    expect(texts(content)).toContain('sevirəm');
  });

  it('does not let the vacancy supply the candidate\'s feelings', () => {
    const passionate = { ...job, description: 'We want people who are passionate and who love data.' };
    const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'I am passionate and I love data.'] }, passionate, { ...az, language: 'en' });
    expect(texts(content)).not.toMatch(/passionate|love/i);
  });

  it('still removes an unsupported metric, employer or tool', () => {
    const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Sorğu vaxtını 60% azaltdım. Amazon şirkətində işləmişəm.'] }, job, az);
    expect(texts(content)).not.toMatch(/60%|Amazon/);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['unsupported_number']));
  });

  it('keeps a sentence that opens with an organisation the candidate or the vacancy names', () => {
    const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Qafqaz Labs şirkətində REST API-lər hazırlamışam. Synthetic Co şirkətinin vakansiyası mənə uyğun gəlir.'] }, job, az);
    expect(texts(content)).toMatch(/Qafqaz Labs şirkətində/);
    expect(texts(content)).toMatch(/Synthetic Co şirkətinin/);
  });

  it('flags a sentence that lists many of the candidate\'s tools but keeps it (they are facts)', () => {
    const dump = 'NestJS, PostgreSQL, TypeScript və İngilis dili bacarıqlarım var.';
    const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, dump] }, job, az);
    expect(texts(content)).toContain(dump);
    expect(issues.find((i) => i.code === 'skill_list')).toMatchObject({ severity: 'warning' });
    const quiet = reconcileLetter(lettered, { paragraphs: [...grounded, 'NestJS və PostgreSQL ilə işləmişəm.'] }, job, az);
    expect(quiet.issues.map((i) => i.code)).not.toContain('skill_list');
  });

  it('refuses an Azerbaijani letter with Turkish or English words, naming them for the retry; clean text and the candidate\'s own vocabulary pass', () => {
    const leaky = 'NestJS ilə işləmişəm, bu təcrübə data analizi için uyğundur və actionable insight verir.';
    let error: any;
    try { reconcileLetter(lettered, { paragraphs: [...grounded, leaky] }, job, az); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(RejectedWithFeedback);
    expect(error.kind).toBe('language');
    expect(error.feedback).toMatch(/için.*üçün/);
    expect(error.feedback).toMatch(/actionable/);
    const clean = reconcileLetter(lettered, { paragraphs: [...grounded, 'NestJS ilə işləmişəm və bu təcrübə vakansiyaya uyğun gəlir.'] }, job, az);
    expect(clean.content.paragraphs.length).toBeGreaterThan(0);
  });

  it('keeps approved paragraphs word for word on regeneration, even if they would not pass the generation checks', () => {
    const approved = 'Bu işi çox sevirəm. NestJS, PostgreSQL, TypeScript və İngilis dili mənim bacarıqlarımdır. 99% uğur!';
    const previous = [{ id: 'p1', text: approved, approved: true }, { id: 'p2', text: 'köhnə' }];
    const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Bu işi çox sevirəm.'] }, job, { ...az, previous });
    expect(content.paragraphs[0]).toEqual({ id: 'p1', text: approved, approved: true });
    expect(texts({ paragraphs: content.paragraphs.slice(1) })).not.toContain('sevirəm');
  });

  describe('short application-question answer', () => {
    let tag = 0;
    const words = (n: number) => `${Array.from({ length: n }, (_, i) => (i % 7 === 6 ? 'PostgreSQL' : 'sorğu')).join(' ')} ${'indeks '.repeat(++tag).trim()}.`;
    it('says nothing when the answer is inside 110 to 200 words', () => {
      const { issues } = reconcileLetter(lettered, { paragraphs: [words(70), words(70)] }, job, { ...az, mode: 'answer' });
      expect(issues.map((i) => i.code)).not.toContain('answer_length');
    });
    it('tells the candidate when it is too short or too long, and honours a destination limit', () => {
      expect(reconcileLetter(lettered, { paragraphs: [words(20), words(25)] }, job, { ...az, mode: 'answer' }).issues.map((i) => i.code)).toContain('answer_length');
      expect(reconcileLetter(lettered, { paragraphs: [words(120), words(120)] }, job, { ...az, mode: 'answer' }).issues.map((i) => i.code)).toContain('answer_length');
      expect(reconcileLetter(lettered, { paragraphs: [words(40), words(40)] }, job, { ...az, mode: 'answer', maxWords: 100 }).issues.map((i) => i.code)).not.toContain('answer_length');
      expect(reconcileLetter(lettered, { paragraphs: [words(40), words(80)] }, job, { ...az, mode: 'answer', maxWords: 100 }).issues.map((i) => i.code)).toContain('answer_length');
    });
    it('does not apply a size to a full letter', () => {
      expect(reconcileLetter(lettered, { paragraphs: [words(20), words(25)] }, job, az).issues.map((i) => i.code)).not.toContain('answer_length');
    });
  });
});

describe('CV generation is untouched by the letter guards', () => {
  it('keeps a first-person feeling that the CV path does not treat as a letter claim only where it already passed', () => {
    // reconcileWithFacts has no personal-claim rule: a CV summary is checked for facts only, as before.
    const { issues } = reconcileWithFacts(persona, { language: 'az', summary: 'Backend mühəndisi. NestJS və PostgreSQL ilə işləyir.', experience: [], skills: [] }, job, { language: 'az' });
    expect(issues.map((i) => i.code)).not.toContain('unsupported_personal_claim');
    expect(issues.map((i) => i.code)).not.toContain('skill_list');
  });
});


describe('letter guards: two known limits', () => {
  const lettered: Persona = { ...persona, stories: [{ entryId: 's1', title: 'API sürəti', situation: 'Hesabat sorğuları yavaş idi.', action: 'PostgreSQL indekslərini yenilədim.', result: 'Sorğu vaxtı 30% azaldı.' }] };
  const grounded = ['Hesabat sorğuları yavaş idi. PostgreSQL indekslərini yenilədim.', 'Sorğu vaxtı 30% azaldı.'];
  const az = { language: 'az', today: new Date('2026-10-04T10:00:00Z') };
  const texts = (c: { paragraphs: { text: string }[] }) => c.paragraphs.map((p) => p.text).join(' ');

  describe('a feeling word elsewhere in the candidate\'s text', () => {
    const motivation = 'Komanda ilə işləməyi sevirəm.';
    it('does not support an unrelated personal claim, and the claim is removed', () => {
      const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Bu şirkətin məhsullarını sevirəm.'] }, job, { ...az, motivation });
      expect(texts(content)).not.toMatch(/məhsullarını sevirəm/);
      expect(issues.map((i) => i.code)).toContain('unsupported_personal_claim');
    });
    it('still supports a statement about the same subject', () => {
      const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Komandada işləməyi sevirəm.'] }, job, { ...az, motivation });
      expect(texts(content)).toContain('Komandada işləməyi sevirəm.');
    });
    it('supports a restatement that contains the candidate\'s whole sentence', () => {
      const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Bu işi çox sevirəm.'] }, job, { ...az, motivation: 'Bu işi sevirəm.' });
      expect(texts(content)).toContain('Bu işi çox sevirəm.');
    });
    it('is not fooled by a different kind of feeling word', () => {
      const { content } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Bu işlə bağlı böyük həvəsim var.'] }, job, { ...az, motivation });
      expect(texts(content)).not.toMatch(/həvəsim/);
    });
    it('works the same way in English', () => {
      const en = { ...az, language: 'en', motivation: 'I enjoy mentoring junior developers.' };
      const out = reconcileLetter(lettered, { paragraphs: [...grounded, 'I enjoy the mission of this company.'] }, job, en);
      expect(texts(out.content)).not.toMatch(/mission/);
      const ok = reconcileLetter(lettered, { paragraphs: [...grounded, 'I enjoy mentoring junior developers.'] }, job, en);
      expect(texts(ok.content)).toContain('I enjoy mentoring junior developers.');
    });
  });

  describe('the target employer named in the vacancy', () => {
    it('is not proof that the candidate worked there', () => {
      for (const claim of ['Mən Synthetic Co şirkətində işləmişəm.', 'Synthetic Co şirkətində əvvəl çalışmışam.', 'Synthetic Co-da təcrübəm var.']) {
        const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, claim] }, job, az);
        expect(texts(content)).not.toContain(claim);
        expect(issues.map((i) => i.code)).toContain('unsupported_employer_claim');
      }
      const en = reconcileLetter(lettered, { paragraphs: [...grounded, 'I previously worked at Synthetic Co.'] }, job, { ...az, language: 'en' });
      expect(texts(en.content)).not.toMatch(/previously worked/);
      const ru = reconcileLetter(lettered, { paragraphs: [...grounded, 'Ранее я работал в Synthetic Co.'] }, job, { ...az, language: 'ru' });
      expect(texts(ru.content)).not.toMatch(/Ранее/);
    });
    it('leaves legitimate statements about applying to that employer alone', () => {
      const { content, issues } = reconcileLetter(lettered, { paragraphs: [...grounded, 'Synthetic Co şirkətinin Senior Backend Developer vakansiyasına müraciət edirəm. Synthetic Co şirkətində işləmək istərdim.'] }, job, az);
      expect(texts(content)).toContain('müraciət edirəm');
      expect(texts(content)).toContain('işləmək istərdim');
      expect(issues.map((i) => i.code)).not.toContain('unsupported_employer_claim');
      const en = reconcileLetter(lettered, { paragraphs: [...grounded, 'I am applying to Synthetic Co and would like to work there.'] }, job, { ...az, language: 'en' });
      expect(texts(en.content)).toContain('I am applying to Synthetic Co');
    });
    it('accepts the claim when the candidate\'s own facts say it (profile or their own words)', () => {
      const alumni: Persona = { ...lettered, experience: [{ ...lettered.experience[0], company: 'Synthetic Co' }, ...lettered.experience.slice(1)] };
      const fromProfile = reconcileLetter(alumni, { paragraphs: [...grounded, 'Synthetic Co şirkətində işləmişəm.'] }, job, az);
      expect(texts(fromProfile.content)).toContain('işləmişəm');
      const fromWords = reconcileLetter(lettered, { paragraphs: [...grounded, 'Synthetic Co şirkətində işləmişəm.'] }, job, { ...az, motivation: 'Əvvəllər Synthetic Co şirkətində işləmişəm.' });
      expect(texts(fromWords.content)).toContain('işləmişəm');
    });
  });
});

describe('CV and resume style guards (heuristics, warnings only)', () => {
  // Saved text in the document's own language (Azerbaijani) with metrics of different meaning in two roles.
  const az: Persona = {
    ...persona,
    experience: [
      { ...persona.experience[0], highlights: ['REST API-lər hazırladı.', 'Cavab müddətini 30% azaltdı.', '4 nəfərlik komandaya baxdı.'] },
      { ...persona.experience[1], highlights: ['TypeScript ilə daxili alətləri dəstəklədi.', 'Test əhatəsini 70% etdi.'] },
    ],
    projects: [{ entryId: 'p1', name: 'Panel', period: '2022', description: 'Hesabat paneli qurdu.', result: 'Vaxt 40% azaldı.' }],
  };
  const rewrite = (highlights: string[], extra: Record<string, unknown> = {}, opts: { maxHighlights?: number } = {}, who: Persona = az) =>
    reconcileWithFacts(who, { language: 'az', headline: 'Backend mühəndisi', summary: 'Backend mühəndisi.', experience: [{ company: 'Qafqaz Labs', position: 'Backend Engineer', period: 'Jan 2022 - Present', highlights }], skills: [], ...extra }, job, { language: 'az', ...opts });
  const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

  it('keeps a metric the candidate supplied: a bullet that drops it is replaced by the saved line, with no duplicate', () => {
    const r = rewrite(['REST API-ləri hazırladı.', 'Cavab müddəti azaldıldı.', '4 nəfərlik komandaya baxdı.']);
    const bullets = r.content.experience[0].highlights;
    expect(bullets).toContain('Cavab müddətini 30% azaltdı.');
    expect(bullets).not.toContain('Cavab müddəti azaldıldı.');
    expect(bullets).toHaveLength(3);
    expect(new Set(bullets.map((b) => b.toLowerCase())).size).toBe(bullets.length);
    expect(codes(r)).toContain('restored_metric');
  });
  it('adds the saved line when no bullet says the same thing and there is room; tells the candidate when there is none', () => {
    const room = rewrite(['REST API-ləri hazırladı.', '4 nəfərlik komandaya baxdı.']);
    expect(room.content.experience[0].highlights).toContain('Cavab müddətini 30% azaltdı.');
    const full = rewrite(['REST API-ləri hazırladı.', '4 nəfərlik komandaya baxdı.'], {}, { maxHighlights: 2 });
    expect(full.content.experience[0].highlights).toHaveLength(2);
    expect(codes(full)).toContain('dropped_metric');
    expect(full.issues.find((i) => i.code === 'dropped_metric')).toMatchObject({ reason: 'NO_ROOM' });
  });
  it('never copies a saved line into a document of another language, and says what to do instead', () => {
    const english = { ...persona, experience: [persona.experience[0], persona.experience[1]] }; // saved text is English; the document is Azerbaijani
    const r = rewrite(['NestJS ilə REST API-lər hazırladı.'], {}, {}, english);
    expect(r.content.experience[0].highlights.join(' ')).not.toMatch(/Reduced response time/);
    expect(r.issues.find((i) => i.code === 'dropped_metric')).toMatchObject({ reason: 'OTHER_LANGUAGE' });
    expect(r.issues.find((i) => i.code === 'dropped_metric')?.detail).toContain('Reduced response time by 30%.'); // the saved line is shown so it can be added by hand
    expect(codes(r)).not.toContain('restored_metric');
  });
  it('keeps a metric attached to its own experience: a number from another role is removed', () => {
    const r = rewrite(['REST API-lər hazırladı.', 'Test əhatəsini 70% etdi.']); // 70% belongs to the other role
    expect(r.content.experience[0].highlights.join(' ')).not.toContain('70%');
    expect(r.issues.find((i) => i.code === 'misattributed_metric')).toMatchObject({ severity: 'error' });
  });
  it('keeps what a number measured: 30% may not become 30 of something else', () => {
    const r = rewrite(['REST API-lər hazırladı.', '30 müştəri ilə işlədi.']);
    expect(r.content.experience[0].highlights.join(' ')).not.toContain('30 müştəri');
    expect(codes(r)).toContain('changed_metric_meaning');
    expect(codes(rewrite(['Cavab müddətini 30 faiz azaltdı.']))).not.toContain('changed_metric_meaning'); // the same meaning in words
  });
  it('lets a role\'s own dates and tools appear as plain numbers', () => {
    const r = rewrite(['2022-ci ildən REST API-lər hazırladı.', 'Cavab müddətini 30% azaltdı.']);
    expect(r.content.experience[0].highlights[0]).toContain('2022-ci ildən');
    expect(codes(r)).not.toContain('misattributed_metric');
  });
  it('checks a project\'s reworded text against that project\'s own numbers', () => {
    const bad = rewrite(['REST API-lər hazırladı.'], { projects: [{ name: 'Panel', description: 'Paneli qurdu və vaxtı 30% azaltdı.' }] });
    expect(bad.content.projects[0].description).toBe('Hesabat paneli qurdu.');
    expect(codes(bad)).toEqual(expect.arrayContaining(['misattributed_metric']));
  });
  it('never exceeds the highlight limit while restoring', () => {
    const r = rewrite(['REST API-lər hazırladı.', '4 nəfərlik komandaya baxdı.', 'Başqa bir iş gördü.'], {}, { maxHighlights: 3 });
    expect(r.content.experience[0].highlights.length).toBeLessThanOrEqual(3);
  });
  it('never asks for or invents a number: a bullet without one is fine when its source has none', () => {
    const { content, issues } = rewrite(['NestJS ilə REST API-lər hazırladı.', 'Cavab müddətini 30% azaltdı.', '4 nəfərlik komandaya baxdı.']);
    expect(content.experience[0].highlights).toHaveLength(3);
    expect(issues.map((i) => i.code)).not.toContain('restored_metric');
    const second = rewrite(['TypeScript ilə daxili alətləri dəstəklədi.'], { experience: [{ company: 'Xəzər Soft', position: 'Junior Developer', period: 'Jun 2019 - Dec 2021', highlights: ['TypeScript ilə daxili alətləri dəstəklədi.'] }] });
    expect(second.issues.map((i) => i.code)).not.toContain('dropped_metric');
    expect(rewrite(['Cavab müddətini 90% azaltdı.']).issues.map((i) => i.code)).toContain('unsupported_number'); // in nobody's facts
    expect(rewrite(['Cavab müddətini 70% azaltdı.']).issues.map((i) => i.code)).toContain('misattributed_metric'); // in another role's facts
  });
  it('flags filler scaffolding and a bullet that lists many tools, but keeps both (they are the candidate\'s facts)', () => {
    const { content, issues } = rewrite(['REST API-lərə görə məsul idi.', 'NestJS, PostgreSQL, TypeScript və İngilis dili ilə işlədi.', 'Cavab müddətini 30% azaltdı.']);
    expect(content.experience[0].highlights.join(' ')).toContain('REST API-lərə görə məsul idi.');
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['filler_phrase', 'skill_list']));
  });
  it('still removes an unsupported claim (heuristic check, not a proof of grounding)', () => {
    const { content } = rewrite(['Kubernetes klasterlərini idarə etdi.', 'Cavab müddətini 30% azaltdı.']);
    expect(content.experience[0].highlights.join(' ')).not.toContain('Kubernetes');
  });
  it('does not apply the letter-only rules to CV text', () => {
    const { issues } = rewrite(['Sevirəm bu işi.', 'Cavab müddətini 30% azaltdı.']);
    expect(issues.map((i) => i.code)).not.toContain('unsupported_personal_claim');
  });
});

describe('hyphenated names the candidate wrote', () => {
  it('are supported as written, whatever their first segment', () => {
    const persona = {
      basics: { name: 'A', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } },
      summary: '',
      experience: [{ company: 'Acme', position: 'Analyst', location: '', period: '2026', highlights: ['Co-developing an RPA concept; XGBoost achieving PR-AUC 0.87 and ROC-AUC 0.98.'] }],
      education: [], skills: [], languages: [], projects: [], certifications: [],
    } as any;
    const facts = new CandidateFacts(persona);
    expect(facts.unsupported('Co-developing an RPA concept.')).toBeNull();
    expect(facts.unsupported('XGBoost achieving PR-AUC 0.87.')).toBeNull();
    // still refused: a hyphenated name that is not among the facts
    expect(facts.unsupported('Used Re-ranker pipelines.')?.code).toBe('unsupported_term');
  });
});


it('retains verified translated roles and skill aliases through ordinary review, rejecting unknown skills', () => {
  const draft = reconcileWithFacts(persona, faithful).content;
  draft.experience[0].position = 'Backend mühəndisi';
  draft.translationSources = { 'experience.0.position': { source: 'Backend Engineer', text: 'Backend mühəndisi' }, 'skills.0.keywords.0': { source: 'TypeScript', text: 'TypeScript bacarığı' } };
  const next = applyReviewEdits(persona, draft, { skills: ['TypeScript bacarığı'] });
  expect(next.experience[0].position).toBe('Backend mühəndisi');
  expect(next.skills[0].keywords).toEqual(['TypeScript bacarığı']);
  expect(() => applyReviewEdits(persona, draft, { skills: ['AWS bacarığı'] })).toThrow('not in saved profile');
  expect(persona.experience[0].position).toBe('Backend Engineer');
});

it('preserves translated company descriptors and profile labels when saving an edited legacy role', () => {
  const translatedPersona: Persona = {
    ...persona,
    basics: { ...persona.basics, location: 'Baku, Azerbaijan' },
    experience: [{ ...persona.experience[0], company: 'LedgerLens | AI-OCR Product', position: 'Product Lead', location: 'Baku, Azerbaijan' }, persona.experience[1]],
    education: [{ ...persona.education[0], degree: 'Bachelor', area: 'Computer Science', location: 'Baku, Azerbaijan' }],
  };
  const draft = reconcileWithFacts(translatedPersona, faithful).content;
  draft.basics.location = 'Bakı, Azərbaycan';
  draft.experience[0].position = 'Məhsul rəhbəri';
  draft.experience[0].company = 'LedgerLens | Süni intellekt əsaslı OCR məhsulu';
  draft.experience[0].location = 'Bakı, Azərbaycan';
  draft.education[0].degree = 'Bakalavr';
  draft.education[0].area = 'Kompüter elmləri';
  draft.education[0].location = 'Bakı, Azərbaycan';
  draft.translationSources = {
    'basics.location': { source: 'Baku, Azerbaijan', text: 'Bakı, Azərbaycan' },
    'experience.0.position': { source: 'Product Lead', text: 'Məhsul rəhbəri' },
    'experience.0.company': { source: 'AI-OCR Product', text: 'Süni intellekt əsaslı OCR məhsulu' },
    'experience.0.location': { source: 'Baku, Azerbaijan', text: 'Bakı, Azərbaycan' },
    'education.0.degree': { source: 'Bachelor', text: 'Bakalavr' },
    'education.0.area': { source: 'Computer Science', text: 'Kompüter elmləri' },
    'education.0.location': { source: 'Baku, Azerbaijan', text: 'Bakı, Azərbaycan' },
  };
  const saved = applyReviewEdits(translatedPersona, draft, { experience: [{ highlights: ['Məhsul axınını hazırladım.'] }, { highlights: [] }] });
  expect(saved.basics.location).toBe('Bakı, Azərbaycan');
  expect(saved.experience[0]).toMatchObject({
    company: 'LedgerLens | Süni intellekt əsaslı OCR məhsulu', position: 'Məhsul rəhbəri', location: 'Bakı, Azərbaycan',
    highlights: ['Məhsul axınını hazırladım.'],
  });
  expect(saved.education[0]).toMatchObject({ degree: 'Bakalavr', area: 'Kompüter elmləri', location: 'Bakı, Azərbaycan' });
});

it('saves a complete translated long bullet without truncation', () => {
  const draft = reconcileWithFacts(persona, faithful).content;
  const long = 'Məlumatları təhlil etdim. '.repeat(30);
  const next = applyReviewEdits(persona, draft, { experience: [{ highlights: [long] }, { highlights: [] }] });
  expect(next.experience[0].highlights[0]).toBe(long.trim());
});

describe('selection preservation and multi-role experience reconciliation', () => {
  it('correctly associates bullets to multiple roles at the same employer without confusion', () => {
    const multiRolePersona: Persona = {
      ...persona,
      experience: [
        {
          company: 'Tech Solutions MMC',
          position: 'Junior Software Engineer',
          location: 'Bakı',
          period: '2020 - 2022',
          highlights: ['PostgreSQL sorğularını optimallaşdırdı və kod yazdı.'],
        },
        {
          company: 'Tech Solutions MMC',
          position: 'Senior Software Engineer',
          location: 'Bakı',
          period: '2022 - 2024',
          highlights: ['Mikroxidmətlər arxitekturasına və komandaya rəhbərlik etdi.'],
        },
      ],
    };

    const proposedModel = {
      headline: 'Senior Software Engineer',
      summary: persona.summary,
      experience: [
        {
          company: 'Tech Solutions MMC',
          position: 'Senior Software Engineer',
          period: '2022 - 2024',
          highlights: ['Mikroxidmətlər arxitekturasına və komandaya rəhbərlik etdi.'],
        },
        {
          company: 'Tech Solutions MMC',
          position: 'Junior Software Engineer',
          period: '2020 - 2022',
          highlights: ['PostgreSQL sorğularını optimallaşdırdı və kod yazdı.'],
        },
      ],
      skills: [{ keywords: ['PostgreSQL', 'NestJS'] }],
    };

    const { content, issues } = reconcileWithFacts(multiRolePersona, proposedModel);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    // Verify Junior role received Junior highlights, and Senior role received Senior highlights
    expect(content.experience[0].position).toBe('Junior Software Engineer');
    expect(content.experience[0].highlights).toEqual(['PostgreSQL sorğularını optimallaşdırdı və kod yazdı.']);

    expect(content.experience[1].position).toBe('Senior Software Engineer');
    expect(content.experience[1].highlights).toEqual(['Mikroxidmətlər arxitekturasına və komandaya rəhbərlik etdi.']);
  });

  it('preserves validated requested ordering and intentional omissions of projects, certs, activities, awards', () => {
    const richPersona: Persona = {
      ...persona,
      projects: [
        { entryId: 'proj-1', name: 'Internal CRM', description: 'Internal CRM system built with PostgreSQL', period: '2021' },
        { entryId: 'proj-2', name: 'Analytics Pipeline', description: 'Real-time data pipeline processing metrics', period: '2022' },
        { entryId: 'proj-3', name: 'Mobile App API', description: 'Backend API for iOS application', period: '2023' },
      ],
      certifications: [
        { entryId: 'cert-1', title: 'AWS Cloud Practitioner', issuer: 'Amazon', date: '2021' },
        { entryId: 'cert-2', title: 'PostgreSQL Professional', issuer: 'Postgres Org', date: '2022' },
        { entryId: 'cert-3', title: 'Scrum Master', issuer: 'Scrum.org', date: '2023' },
      ],
      activities: [
        { entryId: 'act-1', title: 'Tech Conference Speaker', period: '2022', organization: 'Baku Tech' },
        { entryId: 'act-2', title: 'Student Mentor', period: '2023', organization: 'University' },
      ],
      awards: [
        { entryId: 'awd-1', title: 'Best Innovator 2022', period: '2022', organization: 'Ministry' },
        { entryId: 'awd-2', title: 'Hackathon Winner 2023', period: '2023', organization: 'Tech Fest' },
      ],
    };

    const tailoredSelection = {
      headline: 'Backend Engineer',
      summary: 'Qafqaz Labs-də Backend Engineer kimi işləyir.',
      experience: [
        {
          company: 'Qafqaz Labs',
          position: 'Backend Engineer',
          period: 'Jan 2022 - Present',
          highlights: ['NestJS ilə mikroxidmətlər arxitekturasını qurdu.'],
        },
      ],
      // Intentional omission and reordering: 2 projects (reversed), 1 cert, 1 activity, 1 award
      projects: [
        { name: 'Analytics Pipeline', description: 'Real-time data pipeline processing metrics' },
        { name: 'Internal CRM', description: 'Internal CRM system built with PostgreSQL' },
      ],
      certifications: [
        { title: 'PostgreSQL Professional' },
      ],
      activities: [
        { title: 'Student Mentor' },
      ],
      awards: [
        { title: 'Hackathon Winner 2023' },
      ],
      skills: [
        { name: 'Texniki', keywords: ['PostgreSQL', 'NestJS'] },
      ],
    };

    const { content, issues } = reconcileWithFacts(richPersona, tailoredSelection);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    // Projects: 2 kept in requested order, proj-3 omitted
    expect(content.projects).toHaveLength(2);
    expect(content.projects[0].name).toBe('Analytics Pipeline');
    expect(content.projects[1].name).toBe('Internal CRM');

    // Certifications: 1 kept, cert-1 and cert-3 omitted
    expect(content.certifications).toHaveLength(1);
    expect(content.certifications[0].title).toBe('PostgreSQL Professional');

    // Activities: 1 kept, act-1 omitted
    expect(content.activities).toHaveLength(1);
    expect(content.activities[0].title).toBe('Student Mentor');

    // Awards: 1 kept, awd-1 omitted
    expect(content.awards).toHaveLength(1);
    expect(content.awards[0].title).toBe('Hackathon Winner 2023');

    // Skills: only the 2 requested keywords in the named group, leftovers NOT appended
    expect(content.skills).toHaveLength(1);
    expect(content.skills[0].keywords).toEqual(['PostgreSQL', 'NestJS']);

    // Base persona facts remain completely intact and unmutated
    expect(richPersona.projects).toHaveLength(3);
    expect(richPersona.certifications).toHaveLength(3);
    expect(richPersona.activities).toHaveLength(2);
    expect(richPersona.awards).toHaveLength(2);
    expect(richPersona.skills[0].keywords).toHaveLength(4);
  });

  it('prunes unrelated skills on fallback instead of dumping all facts.skills when job is provided', () => {
    const candidate: any = {
      basics: { name: 'Aydan', headline: 'Data Analyst' },
      summary: '',
      experience: [],
      education: [],
      projects: [],
      certifications: [],
      activities: [],
      awards: [],
      skills: [
        { name: '', keywords: ['Python', 'SQL', 'Qaynaq işləri', 'Aşpazlıq', 'Power BI'], proficiency: '', level: 0 },
      ],
      languages: [],
    };
    const targetJob: any = {
      position: 'Junior BI Developer',
      company: 'DataLead MMC',
      requirements: 'Power BI və SQL bilikləri',
    };
    // Draft with omitted skills
    const draft: any = {
      language: 'az',
      headline: 'Data Analyst',
      summary: '',
      experience: [],
    };
    const { content } = reconcileWithFacts(candidate, draft, targetJob, { language: 'az' });
    const allKeywords = content.skills.flatMap((s) => s.keywords);

    expect(allKeywords).toContain('Power BI');
    expect(allKeywords).toContain('SQL');
    // Unrequested skills are not included merely because candidate matches other requirements
    expect(allKeywords).not.toContain('Python');
    expect(allKeywords).not.toContain('Qaynaq işləri');
    expect(allKeywords).not.toContain('Aşpazlıq');
  });

  it('distinguishes unsupported explicit requirements from sparse postings: does not export unrelated profile skills when explicit requirements are unsupported, while preserving base-profile skills', () => {
    const candidate: any = {
      basics: { name: 'Emin', headline: 'Backend Developer' },
      summary: '',
      experience: [],
      education: [],
      projects: [],
      certifications: [],
      activities: [],
      awards: [],
      skills: [
        { name: '', keywords: ['Rust', 'Docker', 'Java'], proficiency: '', level: 0 },
      ],
      languages: [],
    };
    const sqlOnlyJob: any = {
      position: 'Data Analyst',
      company: 'DataLead MMC',
      requirements: 'Strong SQL knowledge and relational database queries required',
    };
    const draft: any = {
      language: 'az',
      headline: 'Backend Developer',
      summary: '',
      experience: [],
    };
    const { content } = reconcileWithFacts(candidate, draft, sqlOnlyJob, { language: 'az' });
    const allTailoredKeywords = content.skills.flatMap((s) => s.keywords);

    // Explicit requirement (SQL) exists in posting but candidate has Rust, Docker, Java (none supported).
    // Tailored document must NOT fill skills with unrelated profile skills!
    expect(allTailoredKeywords).toEqual([]);
    expect(allTailoredKeywords).not.toContain('Rust');
    expect(allTailoredKeywords).not.toContain('Docker');
    expect(allTailoredKeywords).not.toContain('Java');

    // Base-profile skills remain preserved on candidate
    expect(candidate.skills[0].keywords).toEqual(['Rust', 'Docker', 'Java']);
  });

  it('sparse postings: uses fallback when posting itself lacks usable requirements, preserving candidate skills', () => {
    const candidate: any = {
      basics: { name: 'Emin', headline: 'Mütəxəssis' },
      summary: '',
      experience: [],
      education: [],
      projects: [],
      certifications: [],
      activities: [],
      awards: [],
      skills: [
        { name: '', keywords: ['Rust', 'Docker', 'Java'], proficiency: '', level: 0 },
      ],
      languages: [],
    };
    const sparseJob: any = {
      position: 'Mütəxəssis',
      company: 'Nümunə MMC',
      description: 'Şirkətimizə yeni əməkdaş axtarılır.',
    };
    const draft: any = {
      language: 'az',
      headline: 'Mütəxəssis',
      summary: '',
      experience: [],
    };
    const { content } = reconcileWithFacts(candidate, draft, sparseJob, { language: 'az' });
    const allTailoredKeywords = content.skills.flatMap((s) => s.keywords);

    // Fallback retains candidate profile skills when posting lacks usable requirements
    expect(allTailoredKeywords).toContain('Rust');
    expect(allTailoredKeywords).toContain('Docker');
    expect(allTailoredKeywords).toContain('Java');

    // Base-profile skills remain preserved on candidate
    expect(candidate.skills[0].keywords).toEqual(['Rust', 'Docker', 'Java']);
  });
});



it('accepts only the deterministic target headline as target context, without claiming the candidate held that role', () => {
  const target: any = { position: 'Data Quality & Governance Specialist', description: '', requirements: 'SQL', responsibilities: '', company: 'Synthetic', location: '' };
  const headline = composeTargetRoleHeadline(persona, target, undefined, 'az');
  const result = reconcileWithFacts(persona, { ...faithful, headline }, target, { language: 'az' });
  expect(result.content.basics.headline).toBe(headline);
  expect(result.content.basics.headline).toContain('Hədəf vəzifə:');
  const invented = reconcileWithFacts(persona, { ...faithful, headline: 'Certified AWS Kubernetes Architect' }, target, { language: 'az' });
  expect(invented.content.basics.headline).not.toContain('Certified AWS Kubernetes Architect');
});
