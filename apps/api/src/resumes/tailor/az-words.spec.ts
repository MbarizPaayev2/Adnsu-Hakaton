import { harmonious, unknownWords } from './az-words';

const unknown = (text: string, ...sources: string[]) => unknownWords(text, sources);

describe('word existence check (deterministic spelling guard)', () => {
  it('accepts the candidate\'s own words and ordinary letter vocabulary', () => {
    expect(unknown('Bank Respublika ASC-da müraciət edirəm.', 'Bank Respublika ASC', 'Backend Developer')).toEqual([]);
    expect(unknown('Hazırda 8 müştəri üçün səhifələri idarə edirəm, həftədə 10 post hazırlayıram.', 'müştəri səhifələrini idarə edirəm həftədə post hazırlayıram')).toEqual([]);
  });

  it.each([
    'işləyirəm', 'hazırlayıram', 'götürürəm', 'almışam', 'edirəm', 'çalışıram', 'tələbəyəm', 'vakansiyasına', 'təcrübəmi', 'komandada', 'illərdə', 'bundan', 'çünki', 'həmçinin',
    'mühəndisəm', 'elandakı', 'başlandı', 'illər', 'təqdim etdim', 'öyrətdim', 'apardım', 'aparıram', 'qurdum', 'yazdım',
  ])('accepts a well-formed ordinary form: %s', (w) => {
    expect(unknown(w, 'götür işlə müraciət vakansiya komanda mühəndis təcrübə')).toEqual([]);
  });

  it.each([
    ['məşğülələr', 'məşğələlər təşkil etdim'],
    ['məshələtçi', 'satış məsləhətçisi'],
    ['gündüzlükorta', 'gündə orta hesabla 30 müştəri'],
    ['bütlər', 'bütçəni daha tez təsdiq etməyə başladı'],
    ['hazırlıdım', 'hazırladım'],
    ['kömikl', 'kömək'],
    ['gündelik', 'gündə orta hesabla'], // a Turkish e where Azerbaijani has ə
    ['müşteri', 'müştəri'],
  ])('rejects a garbled or misspelled word: %s', (bad, source) => {
    expect(unknown(`Mən ${bad} üçün işlədim.`, source)).toContain(bad);
  });

  it('judges names and abbreviations elsewhere, and numbers and short tokens not at all', () => {
    expect(unknown('Marriott brendi və CIPD 2021-ci ildə SQL ilə PASHA Bank-da.', 'Marriott CIPD')).toEqual([]);
  });

  it('a case ending after a hyphen takes ə, not a plain e', () => {
    expect(unknown('Qafqaz Hotels MMC-də işləyirəm, Java-da yazdım.', 'Qafqaz Hotels MMC Java')).toEqual([]);
    expect(unknown('Qafqaz Hotels MMC-de işləyirəm.', 'Qafqaz Hotels MMC')).toEqual(['MMC-de']);
  });

  it('a capitalised ordinary word at the start of a sentence is still checked', () => {
    expect(unknown('Məshələtçi kimi işlədim.', 'məsləhətçi')).toEqual(['Məshələtçi']);
  });

  it('lets a word the candidate wrote without diacritics come back with them, but not with a different letter', () => {
    expect(unknown('mühasibatlıq sənədlərini hazırladım', 'muhasibatliq senedlerini hazirladim')).toEqual([]);
    expect(unknown('Excel-də hesabat hazırladım', 'Excel-de hesabat hazirladim')).toEqual([]);
  });
  it('accepts a source word with other well-formed endings', () => {
    expect(unknown('qaimələri qaiməyə qaimələrində', 'qaiməni')).toEqual([]);
  });
});

describe('vowel harmony of endings', () => {
  it.each([['qur', 'dum'], ['hazırla', 'dı'], ['işlə', 'dim'], ['sənəd', 'lər'], ['hesabat', 'lar'], ['tələbə', 'yəm'], ['komanda', 'da'], ['müştəri', 'lərə']])('accepts %s + %s', (root, ending) => {
    expect(harmonious(root, ending)).toBe(true);
  });
  it.each([['qur', 'di'], ['hazırla', 'di'], ['işlə', 'dı'], ['sənəd', 'lar'], ['hesabat', 'lər'], ['komanda', 'də']])('rejects %s + %s', (root, ending) => {
    expect(harmonious(root, ending)).toBe(false);
  });
});

describe('legitimate Azerbaijani must not be rejected (inflections, names, abbreviations, technical terms)', () => {
  const sources = [
    'Qafqaz Hotels MMC-də HR meneceri kimi işləyirəm. Power BI və SQL ilə hesabatlar hazırladım. PASHA Bank, ASAN xidmət, Bakı Dövlət Universiteti, Azərbaycan Texniki Universiteti. PostgreSQL, REST API, Docker, Kubernetes, Jira, SAP.',
  ];
  it.each([
    'Qafqaz Hotels MMC-də HR meneceri kimi işləyirəm.',
    'Power BI-da və SQL ilə həftəlik hesabatlar hazırladım, nəticələri rəhbərliyə təqdim etdim.',
    'PASHA Bank-da, Bakı Dövlət Universitetində və Azərbaycan Texniki Universitetində oxumuşam.',
    'REST API-lər və PostgreSQL verilənlər bazası üzərində işlədim; Docker konteynerlərini idarə edirdim.',
    'Komandada dörd nəfər idi; müştərilərlə görüşlər keçirir və sənədləşməni aparırdı.',
    'İşçilərin adaptasiya proqramını hazırlayıb tətbiq etmişəm, kadr sənədlərinin nəzarətini həyata keçirirəm.',
    'Magistr təhsilimi 2022-ci ildə başa vurmuşam və hazırda doktorantura üzrə tədqiqat aparıram.',
    'Qaimələrin rəsmiləşdirilməsi, kassa əməliyyatları və anbar uçotu üzrə təcrübəm var.',
    'Mən verilənlərin təmizlənməsi və vizuallaşdırılması ilə məşğul olmuşam.',
  ])('accepts: %s', (sentence) => {
    expect(unknownWords(sentence, sources)).toEqual([]);
  });
});

describe('regression: legitimate words the production canary letter was refused for', () => {
  it.each(['rolunda', 'rolu', 'rolun', 'istərdim', 'deyildi', 'komandanızla', 'komandamızla', 'öyrəndiklərimi', 'təxminən', 'qarşılaşmışam', 'olacağına', 'quraraq'])('accepts %s', (w) => {
    expect(unknownWords(`Mən ${w} üçün`, [])).toEqual([]);
  });
  it.each(['rolqunda', 'analitik롤u', 'rooluda'])('still rejects the corrupted %s', (w) => {
    expect(unknownWords(`Mən ${w} üçün`, []).length).toBeGreaterThan(0);
  });
});

describe('restored diacritics keep vowel harmony (11 October 2026)', () => {
  it('accepts a real restoration and refuses a corrupted vowel', () => {
    expect(unknownWords('Mühasibat sənədlərini hazırladım', ['mühasibatliq sənədlərini hazirladim'])).toEqual([]);
    expect(unknownWords('iştirak etdim', ['iştirak etdim'])).toEqual([]);
    expect(unknownWords('iştirak etdım', ['iştirak etdim'])).toEqual(['etdım']);
    expect(unknownWords('hazırladim', ['hazirladim'])).toEqual(['hazırladim']);
  });
});

describe('known typos that parse as a root plus an ending', () => {
  it('refuses "rollunda" and keeps "rolunda" and a word the candidate wrote', () => {
    expect(unknownWords('Mühasib rollunda idim', ['Mühasib'])).toEqual(['rollunda']);
    expect(unknownWords('Mühasib rolunda idim', ['Mühasib'])).toEqual([]);
  });
});
