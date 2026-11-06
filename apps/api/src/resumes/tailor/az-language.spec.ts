import { allowedVocabulary, languageFeedback, languageProblems, tenseProblems } from './az-language';

const words = (text: string, allowed = new Set<string>()) => languageProblems(text, allowed).map((p) => p.word);

describe('Azerbaijani language checks (mechanical: they catch known slips, they do not prove naturalness)', () => {
  it('rejects new non-Latin prose, including the Hindi verb observed in the real writer comparison', () => {
    expect(languageProblems('Satış məsləhətçisi हूँ.')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'foreign_script', word: 'हूँ' })]));
    expect(words('Müştərilərə помогал və hesabat hazırladı.')).toContain('помогал');
    expect(words('Müştərilərə kоmək edirəm.')).toContain('kоmək'); // Cyrillic о inside a Latin word
  });

  it('preserves a foreign-script employer or tool explicitly supplied in the source', () => {
    const allowed = allowedVocabulary('Компания Пример', '東京');
    expect(words('Компания Пример şirkətində işlədim. 東京 layihəsində iştirak etdim.', allowed)).toEqual([]);
    expect(words('Компания Пример şirkətində помогал.', allowed)).toContain('помогал');
    expect(words('Əməkdaşlara kömək edirəm və hesabat hazırlayıram.')).toEqual([]);
  });
  it('allows Azerbaijani case suffixes on supplied foreign names, but not invented names or prose', () => {
    const allowed = allowedVocabulary('Яндекс Баку', '東京');
    expect(words('Яндекс Баку-da işlədim. 東京-dan gəldim.', allowed)).toEqual([]);
    expect(words('Москва-da işlədim.', allowed)).toContain('Москва-da');
    expect(words('Баку-помогал.', allowed)).toContain('Баку-помогал');
  });
  it('flags Turkish function words, forms and verbs with the Azerbaijani counterpart', () => {
    const found = languageProblems('Hesabat için çok vaxt apardı, değil ki sorun var. Bunu yapmak olarak gördü; hazırlıyor, destekler.');
    const bad = found.map((p) => p.word);
    for (const w of ['için', 'çok', 'değil', 'yapmak', 'olarak', 'hazırlıyor', 'destekler']) expect(bad).toContain(w);
    expect(found.find((p) => p.word === 'için')?.suggestion).toBe('üçün');
    expect(found.find((p) => p.word === 'olarak')?.suggestion).toMatch(/kimi/);
  });

  it('does not confuse Azerbaijani words that fold to the same letters as Turkish ones (və, dəstək, üçün, kimi, etmək, işləmək)', () => {
    expect(words('Hesabat və təhlil üçün dəstək verdi, komandada işləmək və nəticə əldə etmək kimi məsuliyyət daşıdı. Müştərilərlə əlaqə qurur, hesabat hazırlayır.')).toEqual([]);
    expect(words('Leyla Bakıda yaşayır və Power BI ilə panel qurub; hazırlayıram, hazırladım, azaltdım.')).toEqual([]);
  });

  it('flags English function words and phrases but never names or terms the candidate or vacancy use themselves', () => {
    expect(words('Bu təcrübə actionable insight verir with the team.')).toEqual(expect.arrayContaining(['actionable', 'insight', 'with', 'the']));
    const allowed = allowedVocabulary('Google Data Analytics sertifikatı', 'Microsoft Power BI, SQL, dbt, stakeholder reporting for finance');
    // a company, tools, a certificate and a phrase the vacancy itself uses are legitimate foreign material
    expect(words('Google Data Analytics sertifikatı aldı, Microsoft Power BI və SQL ilə işlədi, stakeholder reporting for finance qurdu.', allowed)).toEqual([]);
    expect(words('Microsoft Power BI ilə panel qurdu.')).toEqual([]);
  });

  it('flags Turkish present tense and -mak/-mek infinitives but not Azerbaijani -ır / -maq / -mək', () => {
    expect(words('Satış planını yerine getiriyor və rapor hazırlamak istiyor.')).toEqual(expect.arrayContaining(['getiriyor', 'hazırlamak', 'istiyor']));
    expect(words('Satış planını yerinə yetirir və hesabat hazırlamaq, təhlil etmək istəyir.')).toEqual([]);
  });

  it('does not flag the candidate\'s own wording, even when it is Turkish-looking', () => {
    const own = allowedVocabulary('Haftalık satış hesabatları hazırladı. Sorumlu oldu.');
    expect(words('Haftalık satış hesabatları hazırladı.', own)).toEqual([]);
    expect(words('Haftalık satış hesabatları hazırladı.')).toEqual(['Haftalık']);
  });

  it('feeds the offending words and their Azerbaijani forms back, without the candidate\'s text', () => {
    const feedback = languageFeedback(languageProblems('Bu iş için olarak gördü.'));
    expect(feedback).toMatch(/"için" → üçün/);
    expect(feedback).toMatch(/"olarak"/);
    expect(feedback).not.toMatch(/gördü/);
  });

  it('flags a present-tense bullet for a role that has ended, never a past-tense one or the candidate\'s own wording', () => {
    expect(tenseProblems(['Excel-də hesabat şablonları hazırlayır.', 'Aylıq göstəriciləri yeniləyir']).map((p) => p.word)).toEqual(['hazırlayır', 'yeniləyir']);
    expect(tenseProblems(['Excel-də hesabat şablonları hazırladı.', 'Göstəriciləri yenilədi.'])).toEqual([]);
    expect(tenseProblems(['Hesabatları hazırlayır.'], allowedVocabulary('Hesabatları hazırlayır.'))).toEqual([]);
  });
});
