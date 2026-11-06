import { inventedEmployment, bulletPerson, bulletProblems, letterProblems, namedTerms, numbersOf } from './az-rewrite';
import { vacancyTerms } from './az-compose';

const codes = (p: { code: string }[]) => p.map((x) => x.code);

describe('bullet rewrite verification: what is accepted', () => {
  it.each([
    ['Satış və müştəri məlumatları üzrə həftəlik hesabatlar hazırlayır.', 'Satış və müştəri məlumatları üzrə həftəlik hesabatlar hazırlayır.'],
    ['Power BI paneli qurdu; hesabat hazırlama vaxtı 40% azaldı.', 'Power BI-da panel qurdu, hesabat hazırlama vaxtı 40% azaldı.'],
    ['Müştərilərə telefon və noutbuk seçməkdə kömək edirəm', 'Müştərilərə telefon və noutbuk seçməkdə kömək edir.'],
    ['mühasibatliq sənədlərini hazirladim', 'Mühasibatlıq sənədlərini hazırladım.'],
    ['Excel-də pivot table-lar hazırladım', 'Excel-də pivot cədvəllər hazırladım.'],
  ])('keeps the meaning: %s', (src, out) => {
    expect(bulletProblems(src, out, { endedRole: false })).toEqual([]);
  });
});

describe('bullet rewrite verification: paraphrase attacks are caught', () => {
  const run = (src: string, out: string, ended = false) => codes(bulletProblems(src, out, { endedRole: ended }));
  it('invented figure', () => expect(run('Power BI paneli qurdu; hesabat vaxtı 40% azaldı.', 'Power BI paneli qurdu; hesabat vaxtı 65% azaldı.')).toEqual(expect.arrayContaining(['invented_number', 'dropped_number'])));
  it('dropped figure', () => expect(run('Hesabat hazırlama vaxtı 40% azaldı.', 'Hesabat hazırlama vaxtı azaldı.')).toContain('dropped_number'));
  it('changed attribution: from a team member to the manager of the team', () => {
    const c = run('Komandada 4 nəfər idik, mən verilənlər bazası hissəsini və REST API-ni Java-da yazdım.', '4 nəfərlik komandanı idarə edərək verilənlər bazasını və REST API-ni Java-da yazdı.');
    expect(c).toContain('inflated_claim'); // "idarə etmək" (managing) was not in the original
  });
  it('"helped" upgraded to doing it', () => {
    const c = run('Satış hesabatının hazırlanmasında komanda üzvlərinə kömək etdim.', 'Satış hesabatını hazırladım.');
    expect(c).toEqual(expect.arrayContaining(['scope_dropped']));
  });
  it('unsupported tool or qualification', () => {
    expect(run('Hesabatları Excel-də hazırlayırdım.', 'Hesabatları Excel və Tableau-da hazırlayırdım.')).toContain('new_name');
    expect(run('Müştərilərlə danışırdım.', 'SAP sertifikatı əsasında müştərilərlə danışırdım.')).toEqual(expect.arrayContaining(['new_name']));
  });
  it('inflation and trait words the original did not have', () => {
    expect(run('Hesabatlar hazırladım.', 'Yüksək keyfiyyətli hesabatları effektiv şəkildə hazırladım.')).toContain('inflated_claim');
    expect(run('Anbar sənədlərini qeydə aldım.', 'Məsuliyyətlə anbar sənədlərini qeydə aldım.')).toContain('inflated_claim');
  });
  it('a different statement', () => expect(run('Kassa əməliyyatlarını aparırdım.', 'Marketinq kampaniyaları planlaşdırırdım.')).toContain('meaning_drift'));
  it('words copied from the vacancy that the candidate never wrote', () => {
    const terms = vacancyTerms({ id: '', position: 'Backend Developer', company: '', location: '', education: '', experience: '', salary_from: '', salary_to: '', category: '', description: 'mikroservis arxitekturası ilə REST xidmətlərinin layihələndirilməsi', requirements: '', responsibilities: '' });
    const c = codes(bulletProblems('REST API yazdım.', 'REST API yazdım və mikroservis arxitekturası ilə xidmətlərin layihələndirilməsində iştirak etdim.', { endedRole: true, vacancyTerms: terms }));
    expect(c).toEqual(expect.arrayContaining(['vacancy_word_imported']));
  });
  it('present tense in a role that has ended', () => expect(run('Mühasibat sənədlərini hazırladım.', 'Mühasibat sənədlərini hazırlayır.', true)).toContain('tense_drift'));
  it('a corrupted word is caught even when the meaning check passes', () => {
    expect(run('Həftəlik məşğələlər təşkil etdim.', 'Həftəlik məşğülələr təşkil etdi.')).toContain('unknown_word');
    expect(run('Mühasibatliq sənədlərini hazirladim.', 'Mühasibatlıq sənədlərini hazırladı.')).not.toContain('unknown_word');
  });
  it('turning what the candidate did into what happened is caught (azaltdım → azaldı)', () => {
    expect(run('Daşınma xərclərini 8% azaltdım.', 'Daşınma xərclərini 8% azaldı.')).toContain('voice_changed');
    expect(run('Daşınma xərclərini 8% azaltdım.', 'Daşınma xərclərini 8% azaltdı.')).not.toContain('voice_changed');
    expect(run('Hesabat vaxtı 40% azaldı.', 'Hesabat vaxtını 40% azaltdı.')).toContain('voice_changed');
    expect(run('Prosesi sürətləndirdim.', 'Proses sürətləndi.')).toContain('voice_changed');
  });
  it('"ilə" before a year is ordinary Azerbaijani; it is only suspicious where the evidence says "ildə <number>"', () => {
    const base = { position: 'Data analitik', company: 'Nümunə Analitika MMC', motivation: '', requirementLines: [] as string[] };
    const letter = (t: string) => [{ text: `Nümunə Analitika MMC-nin Data analitik vakansiyasına müraciət edirəm.`, uses: [] }, { text: t, uses: ['E1'] }];
    const ok = { ...base, evidence: [{ id: 'E1', text: 'SQL ilə satış hesabatları hazırlayır.', role: 'Data analitik', period: '2022-01 – present' }] };
    expect(codes(letterProblems(letter('SQL ilə 2022-ci ilin yanvarından satış hesabatları hazırlayıram və Power BI ilə panellər qururam.'), ok))).not.toContain('suspicious_phrase');
    const perYear = { ...base, evidence: [{ id: 'E1', text: 'İldə 60-a yaxın əməkdaşı işə götürürəm.', role: 'HR meneceri', period: '2020 – present' }] };
    expect(codes(letterProblems(letter('İlə 60-a yaxın əməkdaşı işə götürürəm. Prosesi idarə edirəm, adaptasiya proqramı hazırlayıram və kadr sənədlərinə nəzarət edirəm, həmçinin məzuniyyət cədvəllərini tərtib edirəm.'), perYear))).toContain('suspicious_phrase');
  });
  it('"etibarən" (as of) is not an inflated claim, while "etibarlı" still is', () => {
    expect(run('2022-ci ilin yanvarından SQL ilə hesabat hazırlayıram.', '2022-ci ilin yanvarından etibarən SQL ilə hesabat hazırlayıram.')).not.toContain('inflated_claim');
    expect(run('Hesabat hazırlayıram.', 'Etibarlı hesabat hazırlayıram.')).toContain('inflated_claim');
  });
  it('a short word that changes the meaning is caught (ildə → ilə)', () => {
    expect(run('İldə 60 əməkdaşı işə götürdüm.', 'İlə 60 əməkdaşı işə götürdüm.')).toContain('dropped_word');
  });
  it('an ending that breaks vowel harmony is a misspelling (qurdi for qurdu)', () => {
    expect(run('Panel qurdum.', 'Panel qurdi.')).toContain('unknown_word');
    expect(run('Panel qurdum.', 'Panel qurdu.')).not.toContain('unknown_word');
  });
  it('list formatting or several lines', () => {
    expect(run('Hesabatlar hazırladım.', '- Hesabatlar hazırladım.')).toContain('format');
    expect(run('Hesabatlar hazırladım.', 'Hesabatlar hazırladım.\nƏlavə iş gördüm.')).toContain('format');
  });
  it('a much longer text', () => expect(run('Hesabat hazırladım.', 'Hesabat hazırladım, onları təqdim etdim, nəticələri müzakirə etdim, təkliflər verdim, sənədləri arxivləşdirdim, əməkdaşlarla görüşdüm və hesabatları yenilədim.')).toContain('too_long'));
});

describe('number and name extraction', () => {
  it('numbers are compared canonically', () => expect(numbersOf('40% və 2,5 il, 007')).toEqual(['40', '2.5', '7']));
  it('named terms: tools, caps, camel case, mid-sentence capitals', () => {
    const t = namedTerms('Power BI və SQL ilə Excel-də PostgreSQL bazasını Bakıda yenilədim.');
    expect([...t]).toEqual(expect.arrayContaining(['bi', 'sql', 'excel', 'postgresql', 'bakida']));
  });
});

describe('letter verification', () => {
  const ctx = {
    position: 'Backend Developer (Java)', company: 'Bank Respublika ASC', motivation: 'Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.',
    evidence: [{ id: 'E1', text: 'Komandada 4 nəfər idik, mən verilənlər bazası hissəsini və REST API-ni Java-da yazdım.' }, { id: 'E2', text: 'Həftəlik məşğələlər təşkil etdim və yeni üzvlərə SQL öyrətdim. 25 üzvlü klubu idarə etdi.' }],
    requirementLines: ['Hibernate/JPA ilə işləmə, verilənlər bazası performansının optimallaşdırılması üzrə təcrübə'],
  };
  const good = [
    { text: 'Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm. Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.', uses: ['motivation'] },
    { text: 'Layihədə dörd nəfərlik komandada verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Eyni zamanda tələbə klubunda üzvlərə SQL öyrətdim.', uses: ['E1', 'E2'] },
  ];
  it('accepts a faithful letter', () => expect(letterProblems(good, ctx)).toEqual([]));
  it('rejects first person plural that the candidate did not write, and a letter that never names the employer', () => {
    const plural = [good[0], { text: good[1].text.replace('öyrətdim', 'öyrətdik'), uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(plural, ctx))).toContain('wrong_person');
    const noEmployer = [{ text: 'Backend Developer (Java) vəzifəsinə müraciət edirəm. Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.', uses: ['motivation'] }, good[1]];
    expect(codes(letterProblems(noEmployer, ctx))).toContain('employer_missing');
  });
  it('rejects a misspelled or garbled word that no source contains', () => {
    const bad = [good[0], { text: good[1].text.replace('öyrətdim', 'öyrətdim və həftəlik məşğülələr təşkil etdim'), uses: ['E1', 'E2'] }];
    expect(letterProblems(bad, ctx).filter((p) => p.code === 'unknown_word').map((p) => p.detail)).toEqual(['"məşğülələr"']);
  });
  it('rejects an invented figure, an unknown tool and an unknown evidence id', () => {
    const bad = [good[0], { text: good[1].text + ' Layihədə Spring Boot istifadə edərək 99 istifadəçi üçün sistem qurdum.', uses: ['E9'] }];
    expect(codes(letterProblems(bad, ctx))).toEqual(expect.arrayContaining(['invented_number', 'new_name', 'unknown_evidence']));
  });
  it('rejects copying the requirement line and unsupported traits', () => {
    const bad = [good[0], { text: 'Hibernate/JPA ilə işləmə, verilənlər bazası performansının optimallaşdırılması üzrə təcrübəm var. Mən çox ehtiraslı və məsuliyyətli bir mütəxəssisəm.', uses: [] }];
    expect(codes(letterProblems(bad, ctx))).toEqual(expect.arrayContaining(['copies_vacancy', 'inflated_claim']));
  });
  it('rejects a claim to have worked for the employer that nothing confirmed, but not a wish, a past role there, or another employer', () => {
    const socar = { ...ctx, position: 'HR mütəxəssisi', company: 'SOCAR', evidence: [{ id: 'E1', text: 'Namizədlərin CV-lərini ilkin yoxlayırdım.', role: 'HR stajyoru, Delta Trading' }], requirementLines: [] as string[] };
    const body = (second: string) => [
      { text: 'SOCAR şirkətinin HR mütəxəssisi vakansiyasına müraciət edirəm. Peşəkar kollektivdə işləməyi sevirəm.', uses: ['motivation'] },
      { text: `Delta Trading-də HR stajyoru olaraq namizədlərin CV-lərini ilkin yoxladım. ${second}`, uses: ['E1'] },
    ];
    expect(codes(letterProblems(body('SOCAR-da işləmişəm və kadr sənədlərini aparmışam.'), socar))).toContain('invented_employment');
    expect(codes(letterProblems(body('SOCAR-da işləməyi və komandaya töhfə verməyi arzulayıram.'), socar))).not.toContain('invented_employment');
    // The candidate did confirm a role at that employer: the same sentence is a statement of fact.
    const confirmed = { ...socar, evidence: [{ id: 'E1', text: 'Namizədlərin CV-lərini ilkin yoxlayırdım.', role: 'HR stajyoru, SOCAR Trading' }] };
    expect(codes(letterProblems(body('SOCAR-da işləmişəm və kadr sənədlərini aparmışam.'), confirmed))).not.toContain('invented_employment');
    expect(inventedEmployment('Başqa Şirkətdə işləmişəm.', 'SOCAR', socar.evidence)).toEqual([]);
  });
  it('rejects an invented name hidden behind a hyphen, and a stray hyphen join', () => {
    const bad = [good[0], { text: good[1].text.replace('Layihədə', '2019-cu ildən-Étienne Layihədə'), uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(bad, ctx))).toEqual(expect.arrayContaining(['new_name', 'stray_hyphen']));
    // A name with a case ending ("Java-da", "MMC-də") and an ordinary hyphenated word are not joins.
    const fine = [good[0], { text: good[1].text.replace('Java-da', 'Java-da və Spring-də'), uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(fine, ctx))).not.toContain('stray_hyphen');
  });
  it('rejects a third-person verb in a first-person letter, but not nouns that end in -ib', () => {
    const third = [good[0], { text: good[1].text.replace('yazdım.', 'yazdım. Universitetdə təhsil alıb.'), uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(third, ctx))).toContain('third_person_verb');
    const noun = [good[0], { text: good[1].text.replace('yazdım.', 'yazdım. Hesabatların tərtib.'), uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(noun, ctx))).not.toContain('third_person_verb');
    const converb = [good[0], { text: good[1].replace ? good[1].text.replace('yazdım.', 'yazdım. Kod yazıb komandaya təqdim etdim.') : '', uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(converb, ctx))).not.toContain('third_person_verb');
  });
  it('allows a grounded impersonal sentence that connects evidence to the role', () => {
    const connected = [good[0], { text: `${good[1].text} Bu təcrübə verilənlər bazası işi üçün zəmin yaradır.`, uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(connected, ctx))).not.toContain('third_person_verb');
    expect(codes(letterProblems(connected, ctx))).not.toContain('unsupported_clause');
  });
  it('rejects "orta" glued to a number in a bullet or a letter (the idiom lost its "hesabla")', () => {
    expect(codes(bulletProblems('Gündə orta hesabla 25 pasiyentin qəbulunu aparıram', 'Gündə orta 25 pasiyentin qəbulunu aparır'))).toContain('broken_phrase');
    expect(codes(bulletProblems('Gündə orta hesabla 25 pasiyentin qəbulunu aparıram', 'Gündə orta hesabla 25 pasiyentin qəbulunu aparır'))).not.toContain('broken_phrase');
  });
  it('rejects a bullet that ends in a bare participle', () => {
    expect(codes(bulletProblems('İşçi mübahisələri üzrə 12 iddianı bağlamışam', 'İşçi mübahisələri üzrə 12 iddianı bağlamış'))).toContain('incomplete_verb');
    expect(codes(bulletProblems('İşçi mübahisələri üzrə 12 iddianı bağlamışam', 'İşçi mübahisələri üzrə 12 iddianı bağlayıb'))).not.toContain('incomplete_verb');
  });
  it('rejects a sentence made mostly of words nothing confirmed contains (an embellishment), but not a faithful paraphrase', () => {
    const embellished = [good[0], { text: good[1].text + ' Layihədə müvafiq tədbirlər görülməsini və nəticələrin təsdiqlənməsini təmin etdim.', uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(embellished, ctx))).toContain('unsupported_clause');
    expect(codes(letterProblems(good, ctx))).not.toContain('unsupported_clause');
    // dates and education wording are generic and never count as novel
    const dated = [good[0], { text: 'Bakı Dövlət Universitetində 2020–2024-cü illərdə bakalavr təhsili almışam. ' + good[1].text, uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(dated, ctx))).not.toContain('unsupported_clause');
  });
  it('rejects a letter that names neither the position nor the employer, and one that is too short', () => {
    expect(codes(letterProblems([{ text: 'Sizin təklifinizə maraqlanıram.', uses: [] }, { text: 'Təcrübəm var.', uses: [] }], ctx))).toEqual(expect.arrayContaining(['not_addressed', 'too_short']));
  });
  it('the ordinary word for experience is not an inflation claim', () => {
    const t = [good[0], { text: 'Hakaton layihəsində dörd nəfərlik komandada verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Bu layihə mənim ilk komanda təcrübəm idi.', uses: ['E1'] }];
    expect(codes(letterProblems(t, ctx))).not.toContain('inflated_claim');
  });
  it('rejects a one-paragraph letter (an opening and the experience are two paragraphs)', () => {
    expect(codes(letterProblems([{ text: good[0].text + ' ' + good[1].text, uses: [] }], ctx))).toEqual(['shape']);
  });
  it('rejects repeated openings', () => {
    const rep = [{ text: 'Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm.', uses: [] }, { text: 'Mən verilənlər bazası hissəsini yazdım. Mən REST API-ni Java-da yazdım və komandada işlədim. Mən SQL öyrətdim, məşğələlər təşkil etdim.', uses: ['E1', 'E2'] }];
    expect(codes(letterProblems(rep, ctx))).toEqual(expect.arrayContaining(['repeated_opening']));
  });
});

describe('grammatical person of a bullet', () => {
  it('first person (mən, -dım, -ıram, -mışam) versus the CV style', () => {
    for (const t of ['Hesabatlar hazırladım', 'Excel-də işləyirəm', 'Mən layihəni yazdım', 'Komandada 4 nəfər idik', 'Satış planı hazırlamışam']) expect(bulletPerson(t)).toBe('first');
    for (const t of ['Hesabatlar hazırladı', 'Excel-də işləyir', 'Müştərilərə kömək edir', 'Kassa əməliyyatlarını aparır']) expect(bulletPerson(t)).toBe('third');
  });
});


describe('letter gates added after the founder review (11 October 2026)', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    position: 'Kuryer', company: 'Bolt Delivery Azərbaycan',
    evidence: [{ id: 'E1', text: 'Gündə orta hesabla 18 sifarişi çatdırıram', role: 'Kuryer, Sürətli Çatdırılma MMC', period: '2023-06 – present' }],
    motivation: '', requirementLines: [] as string[], ...over,
  });
  const body = (text: string) => [{ text: 'Bolt Delivery Azərbaycan şirkətində Kuryer vəzifəsinə müraciət edirəm.', uses: [] as string[] }, { text, uses: ['E1'] }];
  const codes = (text: string, over: Record<string, unknown> = {}) => letterProblems(body(text), ctx(over) as never).map((p) => p.code);

  it('refuses a year with a bare case ending or the wrong ordinal', () => {
    expect(codes('2023-cü ilin iyunundan Sürətli Çatdırılma MMC şirkətində kuryer işləyirəm, gündə orta hesabla 18 sifarişi çatdırıram.')).not.toContain('date_case');
    expect(codes('2023-dən 2024-cü il kimi Sürətli Çatdırılma MMC şirkətində kuryer işləmişəm, gündə orta hesabla 18 sifarişi çatdırıram.')).toEqual(expect.arrayContaining(['date_case', 'date_until']));
  });

  it('refuses a wish or feeling the candidate did not write, and accepts the candidate\'s own reason for the employer', () => {
    const text = 'Sürətli Çatdırılma MMC şirkətində kuryer işləyirəm, gündə orta hesabla 18 sifarişi çatdırıram. Bolt Delivery Azərbaycanda işləməyə böyük həvəs duyuram.';
    expect(codes(text)).toContain('invented_feeling');
    expect(codes(text, { companyReason: 'Bolt Delivery Azərbaycanda işləməyə böyük həvəs duyuram.' })).not.toContain('invented_feeling');
  });

  it('refuses a sentence that ends in a third-person verb', () => {
    expect(codes('Sürətli Çatdırılma MMC şirkətində kuryer işləyirəm. Gündə orta hesabla 18 sifarişi çatdırır.')).toContain('third_person_verb');
  });

  it('asks again (style) for a short letter that leaves out expected evidence, but never because of length alone', () => {
    const short = 'Sürətli Çatdırılma MMC şirkətində kuryer işləyirəm, gündə orta hesabla 18 sifarişi çatdırıram, sifarişləri ünvanlara vaxtında təhvil verirəm və müştəri ilə telefonla əlaqə saxlayıram. Şəhəri yaxşı bildiyim üçün marşrutları rahat seçirəm.';
    expect(codes(short, { minWords: 80, expectedUses: ['E1'] })).not.toContain('thin_letter'); // E1 is used
    expect(letterProblems([{ text: 'Bolt Delivery Azərbaycan şirkətində Kuryer vəzifəsinə müraciət edirəm.', uses: [] }, { text: short, uses: [] }], ctx({ minWords: 80, expectedUses: ['E1'] }) as never).map((p) => p.code)).toContain('thin_letter');
  });
});

describe('someone else did it', () => {
  it('refuses to turn "my classmates tested it" into the candidate testing it (16 Oct evaluation, student CV)', () => {
    const codes = bulletProblems('Tətbiqi kurs yoldaşlarım test etdi', 'Tətbiqi kurs yoldaşlarım test etdim').map((p) => p.code);
    expect(codes).toContain('subject_changed');
  });
  it('still corrects a candidate who wrote about themselves in the third person', () => {
    const codes = bulletProblems('Müştərilərlə telefonla danışdı', 'Müştərilərlə telefonla danışdım').map((p) => p.code);
    expect(codes).not.toContain('subject_changed');
  });
});
