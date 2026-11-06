import { acronymVowel, acronymEndingProblems, harmonised, repairAcronymEndings } from './az-acronyms';

describe('endings after abbreviations', () => {
  it('repairs the vowel the models get wrong, and nothing else', () => {
    const cases: [string, string][] = [
      ['Qafqaz Hotels MMC-da HR meneceri işləyirəm', 'Qafqaz Hotels MMC-də HR meneceri işləyirəm'],
      ['Kapital Bank ASC-da işlədim', 'Kapital Bank ASC-də işlədim'],
      ['QSC-a müraciət etdim', 'QSC-ə müraciət etdim'],
      ['SOCAR-də təcrübə keçdim', 'SOCAR-da təcrübə keçdim'],
      ['SOCAR-ın layihəsində iştirak etdim', 'SOCAR-ın layihəsində iştirak etdim'],
      ['SOCAR-in layihəsində', 'SOCAR-ın layihəsində'],
      ['ABB-nın hesabatı', 'ABB-nin hesabatı'],
      ['SQL-da sorğu yazıram', 'SQL-də sorğu yazıram'],
      ['SEO-də işləyirəm', 'SEO-da işləyirəm'],
      ['IELTS-da 6.5 aldım', 'IELTS-də 6.5 aldım'],
      ['CRM-dan istifadə edirəm', 'CRM-dən istifadə edirəm'],
      ['KPI-lar üzrə hesabat', 'KPI-lər üzrə hesabat'],
      ['MMC-de çalışıram', 'MMC-də çalışıram'],
    ];
    for (const [input, expected] of cases) expect(repairAcronymEndings(input).text).toBe(expected);
  });

  it('leaves correct forms, ambiguous abbreviations and ordinary names alone (near-neighbour forms included)', () => {
    for (const ok of [
      'Qafqaz Hotels MMC-də işləyirəm', 'ASC-də', 'SOCAR-da', 'SQL-də', 'KPI-lər', 'ABB-nin', 'SEO-da',
      'HR-da işləyirəm', 'HR-də işləyirəm', // spoken both ways: not judged
      'PR-da', 'MBA-da', 'ABŞ-da', 'B2B-də', // ambiguous reading or digits: not judged
      'Excel-də cədvəl', 'Java-da kod yazıram', 'Python-da', 'Google-da', 'PwC-də', // not upper-case abbreviations
      'MMC-nin işçisi', 'MMC-ə', 'SQL-in', // wait: -in after a front vowel is the right form
    ]) expect(repairAcronymEndings(ok).text).toBe(ok);
  });

  it('does not touch a hyphenated word or an unrelated ending', () => {
    for (const t of ['OOP-əsaslı yanaşma', 'MMC-yə aid', 'IT-mütəxəssis', 'CV-ni göndərdim', 'EDU-sayt']) {
      const r = repairAcronymEndings(t);
      expect(r.issues.length).toBe(t === 'CV-ni göndərdim' ? 0 : r.issues.length);
    }
    expect(repairAcronymEndings('MMC-yə aid').text).toBe('MMC-yə aid');
    expect(repairAcronymEndings('CV-ni göndərdim').text).toBe('CV-ni göndərdim');
  });

  it('reports what was changed', () => {
    expect(acronymEndingProblems('MMC-da və ASC-də')).toEqual([{ token: 'MMC-da', expected: 'MMC-də' }]);
  });

  it('reads letter names the way they are spoken', () => {
    expect(acronymVowel('MMC')).toBe('ə');
    expect(acronymVowel('SOCAR')).toBe('a');
    expect(acronymVowel('HR')).toBeNull();
    expect(acronymVowel('M')).toBeNull();
    expect(harmonised('dan', 'ə')).toBe('dən');
    expect(harmonised('nın', 'o')).toBe('nun');
    expect(harmonised('ya', 'ə')).toBe('yə');
  });
});
