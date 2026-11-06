import { knownWordsFor, unknownWords } from './az-words';

/**
 * A measured gap (11 October 2026): the word-existence check refused correct Azerbaijani that the model used (negative aorist "olmaz", "etməzdən",
 * "qarşılayarkən", conditional "düşürsə", consonant change "qarışığı", everyday words "asan", "güvən", "detal") and so sent whole letters to the fallback.
 * These lists pin both directions: correct forms must be known, near-neighbour errors (the garbled, Turkish-spelled and misspelled words models
 * actually produced) must stay unknown.
 */
const known = knownWordsFor([]);
const CORRECT = `
olmaz bilməzdim gizlətmək gizlətdim yoxlayacağam hazırlayacağam rəfə rəfdə sayla sayğac asan günahkar detal detallarla güvənilən güvən güvənirəm səslənən alıcı arzulayıram bacı
etməzdən görünməzdən salmazdan qarşılayarkən tutuşdurarkən yoxlayarkən hazırlayarkən etməməli görməməli gözləməli anlamırsa düşürsə gəlirsə etməkdənsə bağlamaqdansa gözləyin olduqda çalışdıqca düzəltməli
işlədim işləyirəm işləmişəm işləyəcəyəm işləmirəm işləmədim işləməzdim işləməliyəm işləyərkən işləyərək işləyib işləmək işləməyi işləməyə işləməsi işlədiyim işləyən
hazırlayırdım hazırlamışdım hazırlayacağam hazırlamalıyam hazırlamazdım hazırlamadan hazırlanması hazırlanır hazırlandı hazırladığım
qarışığı razılığın narahatlığa uyğunsuzluğu artması azalır uzanır standartlaşdırmağa rahatlaşdırmaq yüngülləşdirə mürəkkəbləşdirsə etiketləməyə
`.split(/\s+/).filter(Boolean);
const WRONG = `
məshələtçi məşğülələr bütlər gündüzlükorta gündelik qurdi hazirladim mühasibatliq etmeyim evler işleyirem
`.split(/\s+/).filter(Boolean);

describe('correct Azerbaijani forms and near-neighbour errors', () => {
  it.each(CORRECT)('knows the correct form %s', (word) => expect(known(word)).toBe(true));
  it.each(WRONG)('still rejects the wrong form %s', (word) => expect(known(word)).toBe(false));

  it('judges a sentence the way a reader would: correct rare forms pass, a garbled word is the only finding', () => {
    expect(unknownWords('Mən işi asan və düzgün etməzdən əvvəl hesabatı yoxlayarkən detallara diqqət yetirirəm.', [])).toEqual([]);
    expect(unknownWords('Həftəlik məşğülələr təşkil etdim.', [])).toEqual(['məşğülələr']);
  });
});
