import lexicon from './az-lexicon.json';

/**
 * A deterministic "does this word exist" check for model-written Azerbaijani.
 *
 * Measured (10 Oct 2026, real writer models, synthetic candidates): a hosted model that is asked to re-express confirmed evidence sometimes returns a word
 * that does not exist ("məşğələlər" → "məşğülələr", "məsləhətçi" → "məshələtçi", "bütçəni" → "bütlər", two words run together), and neither a second model
 * acting as proofreader nor as fact-checker reliably noticed (the same proofreaders also flagged correct words). So the check is mechanical:
 *
 *   a word is KNOWN when its folded form is
 *     1. a word of the candidate's own evidence, motivation, the vacancy title or the employer's name (the "sources"), or
 *     2. in the lexicon: word forms that occur at least twice in the published vacancy texts of the AISE catalogue (12k forms, no sentences), or
 *     3. in a short list of function words and everyday letter vocabulary, or
 *     4. a known root plus a well-formed run of Azerbaijani noun or verb endings (vowel harmony is not enforced; the ORDER of endings is).
 *
 * Everything else is "unknown" and the rewrite is rejected. This does not prove a text is natural or correct Azerbaijani; it removes garbled and misspelled
 * words. It can reject a correct rare word: the cost is a fallback to the candidate's own wording, never a wrong word on the page.
 */
const FOLD: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };
const lower = (s: string) => String(s ?? '').toLocaleLowerCase('az');
/** Letters folded to ASCII: used only for the endings (vowel harmony is not enforced) and for "the candidate wrote the same word without diacritics". */
export const foldWord = (s: string) => lower(String(s ?? '').normalize('NFC')).replace(/[əığşöüç]/g, (c) => FOLD[c] || c);

/** Function words and the everyday vocabulary of an application letter, in correct Azerbaijani spelling. */
const FUNCTION_WORDS = `
və ilə üçün ya yaxud amma lakin çünki ona görə buna bunun bunu bundan onun ondan onu mən mənim mənə məndən bizim biz özüm özümü özünün özümdən bu o bir daha çox az hər bütün həm həmçinin eyni zamanda sonra əvvəl əvvəlki indi hazırda hələ artıq yalnız ancaq belə elə necə nə niyə harada burada orada həmin digər başqa olaraq kimi qədər dək indiyədək yana bəri ərzində zamanı üzrə barədə haqqında tərəfindən vasitəsilə əsasında çərçivəsində ilk son sonuncu yeni əsas ən olan olub oldu olduğu idi imiş deyil var yox ola bilər daxil xaricində arasında üzərində altında yaxın yaxşı yüksək aşağı gündəlik aylıq həftəlik illik gündə həftədə ayda ildə ildən ilin ili illərdə illər il ay həftə gün saat dəqiqə tək birlikdə birgə ayrı iki üç dörd beş altı yeddi səkkiz doqquz on iyirmi otuz qırx əlli yüz min ikinci üçüncü birinci
yanvar fevral mart aprel may iyun iyul avqust sentyabr oktyabr noyabr dekabr yanvarın fevralın martın aprelin mayın iyunun iyulun avqustun sentyabrın oktyabrın noyabrın dekabrın yanvarından fevralından martından aprelindən mayından iyunundan iyulundan avqustundan sentyabrından oktyabrından noyabrından dekabrından
müraciət vakansiya vakansiyasına vəzifə vəzifəyə vəzifəsi vəzifəsində vəzifədə təklif şirkət şirkəti şirkətdə şirkətin komanda komandada komandanın təcrübə təcrübəm təcrübəmi təcrübəmin təcrübədə bilik biliklər bacarıq bacarıqlar bacarığım bacarıqlarım sertifikat sertifikatı sertifikatım diplom tələbə tələbəyəm məzun məzunam təhsil təhsili bakalavr magistr universitet
işləyirəm işləyirdim işləmişəm işlədim çalışıram çalışırdım çalışmışam çalışdım istəyirəm istəyirdim istədim etmişəm edirəm etdim edirdim edə bilərəm
xahiş edirəm diqqət nəzərə nəzərinizə çatdırmaq çox sağ olun hörmətlə
`.split(/\s+/).filter(Boolean);

/** Everyday nouns and adjectives of CVs and letters (the vacancy-text lexicon is formal and third person, so some very common words are rare in it). */
const COMMON_WORDS = `
nəfər insan əməkdaş işçi şəxs üzv rəhbər menecer mütəxəssis mühəndis mühasib hüquqşünas həkim müəllim tələbə məzun stajyor təcrübəçi namizəd müştəri tərəfdaş iştirakçı təşkilatçı könüllü mentor qalib direktor müdir köməkçi assistent konsultant məsləhətçi analitik proqramçı dizayner operator satıcı kassir inzibatçı
təhsil universitet institut kollec lisey məktəb fakültə ixtisas bakalavr magistr doktorantura magistratura bakalavriat kurs təlim sertifikat diplom dissertasiya tədqiqat elmi imtahan qiymət
iş vəzifə təcrübə layihə hesabat sənəd müqavilə plan büdcə proses sistem platforma xidmət məhsul satış marketinq maliyyə uçot audit kadr adaptasiya məzuniyyət cədvəl qrafik panel təhlil analiz nəticə göstərici hədəf strategiya kampaniya reklam məzmun kontent səhifə şəbəkə kassa anbar qaimə inventar tədarük logistika istehsal keyfiyyət nəzarət təhlükəsizlik hüquq vergi bank kredit sığorta investisiya risk sorğu məmnuniyyət təqdimat görüş sənədləşmə rəsmiləşdirmə əməliyyat əməliyyatlar hesablama ödəniş faktura inventarizasiya
proqram proqramlaşdırma verilənlər baza bazası server tətbiq interfeys test avtomatlaşdırma kod alqoritm bulud mobil veb dizayn vizuallaşdırma təmizləmə
aylıq illik həftəlik gündəlik yeni ilkin əsas ümumi xüsusi geniş aktiv real rəqəmsal elektron sosial beynəlxalq yerli aparıcı baş kiçik böyük orta
bakı gəncə sumqayıt azərbaycan türkiyə rusiya gürcüstan
`.split(/\s+/).filter(Boolean);

/** Everyday verb roots a letter or CV uses; endings are generated (so "işləyirəm" needs only "işlə"). */
/** Further common words of natural letters, written by hand (not extracted from any candidate's text). */
const MORE_COMMON_WORDS = `
təxminən məhdud məhdudlaşdır minnətdar missiya inanc yoxsa məcbur bəzən əslində həqiqətən milyon milyard həmişə cəmi şey şeylər hekayə nöqtə mərhələ artım funksiya tranzaksiya yəni xeyli tamam bəzi adətən hamı fürsət ümid adlı fərq fərqi rol rolu rola rolun rəqəm rəqəmlər güc gücü addım əmin əsas yanaşma yanaşmalar məsələ məsələlər sual suallar cavab cavablar nəticə nəticələr səbəb səbəblər məqsəd məqsədlər təklif təkliflər problem problemlər həll həllər qərar qərarlar dəyər dəyərlər keyfiyyət müqayisə təhlil təhlillər tədqiqat araşdırma hesabat hesabatlar məlumat məlumatlar metrik metrikalar proqnoz fərziyyə hipotez nümunə nümunələr təcrübə təcrübələr səviyyə səviyyələr sahə sahələr bölmə bölmələr şöbə şöbələr departament idarə müəssisə təşkilat qurum
ilə üçün kimi haqqında barədə görə qədər sonra əvvəl zaman vaxt müddət dövr il ay gün saat həftə
mən sən o biz siz onlar mənim sənin onun bizim sizin onların özüm özün özü özümüz özünüz özləri
bu həmin elə belə necə nə niyə nəyə harada haradan hansı hər heç bütün bəzi çox az daha ən çoxlu bir ikinci
və ya yaxud amma lakin ancaq çünki ona görə ki əgər onda yenə hələ artıq yalnız təkcə həm də
`.split(/\s+/).filter(Boolean);

/** More everyday words of CVs and letters, in correct spelling (added after a measured gap: correct words such as "asan", "güvən", "detal" were refused). */
const EVERYDAY_WORDS = `
narahat qarışıq deyil üsul üstə yad rəf rəflər rəfə rəfdə asan asanlıq asanlıqla çətin çətinlik günahkar detal detallar detallarla güvən güvənmək güvənilən güvənli səs səsli ölçü ölçmə ölçüb bacı alıcı alıcılar qayğı qayğılar fasilə sakit
gözəl razı narazı razılıq qırmızı ucuz yorucu təəssürat müəllif hörmət vərdiş variant formal standart etiket məqam məna mənanı söhbət söz sözlər kitab kitabxana oxucu oxucular düymə səhifə hərəkət
növbə növbələr tələsik tələb tələblər təsadüfi təklik təkbaşına özbaşına yanlış doğru düz əsər sayğac say saylar sayla sayı miqdar müddət dəqiq dəqiqlik aydın aydınlıq sadə sadəlik tez
sürət sürətli ağıllı yeni köhnə böyük kiçik yaxşı pis gözəl uzun qısa ağır yüngül isti soyuq tez-tez heç vaxt həmişə bəzən bəlkə əlbəttə əlavə əlavələr nümunə nümunələr misal
yadda xatırlatma xatırlat narahatlıq rahatlıq rahat qarışıq qarışıqlıq vədlər vəd
`.split(/\s+/).filter(Boolean);

const FRAME_VERB_STEMS = `
et ed ol ola bil istə çalış işlə öyrən öyrət qur apar götür keçir başla davam tamamla qazan yaz yarat ver al gör oxu hazırla təqdim tətbiq iştirak təşkil idarə həll artır azalt yoxla yenilə planla razılaşdır çək təsdiq nəzarət qeydə dəstək kömək paylaş təhlil analiz
`.split(/\s+/).filter(Boolean);

const LEXICON = new Set<string>(lexicon as string[]);
const FUNCTION = new Set<string>([...FUNCTION_WORDS, ...COMMON_WORDS, ...MORE_COMMON_WORDS, ...EVERYDAY_WORDS].map(lower));

// Verb stems from the lexicon's infinitives (-mək / -maq) and the frame list.
const VERB_STEMS = new Set<string>([...'sadələşdir sadələş sürətlən sürətləndir gücləndir güclən yaxşılaş yaxşılaşdır genişlən genişləndir inkişaf sev inan istə yaran yarat qal çıx get gir otur dur maraqlan maraqlandır düş düşün qayıt gəl qarşılaş yaşa dəyiş izlə ölç anla bax araşdır birləşdir ayır dayan təsirlən qaynaqlan edil olun gətir al ver gör bil de yaz oxu göstər çatdır çatıdır tap tut saxla yönəl yönəlt məşğul seç sına yoxla yenilə böyüt azalt artır yüksəlt öyrən öyrət izah müzakirə tövsiyə təşəkkür həyata'.split(' '), ...FRAME_VERB_STEMS, ...'hazırla təşkil idarə apar yaz qur tətbiq təqdim iştirak nəzarət təhlil yoxla planla razılaşdır yarat inkişaf təkmilləşdir optimallaşdır avtomatlaşdır öyrət öyrən başa vur qəbul işlə çalış keçir həyata əlaqələndir koordinasiya monitorinq dəstək ver kömək həll artır azalt qazan mənimsə istifadə tərtib formalaşdır təmizlə vizuallaşdır məşğul ol saxla göndər cavabla cavablandır hesabla uyğunlaşdır rəsmiləşdir art azal uzan düz çevril cəmlən bəzə güvən səslən gizlət arzula dinlə düzəlt itir qat ertələ işarələ soruş gözlə qarşıla tutuşdur formalaşdır dəstəklə göz qoy saxla əldə et tap bitir başla bağla aç dəy dəyiş ayrıl sevin narahat ol'.split(' ')].map(lower));
for (const w of LEXICON) {
  if (w.length > 5 && (w.endsWith('mək') || w.endsWith('maq'))) VERB_STEMS.add(w.slice(0, -3));
}

// Endings, folded (e/ə → e, i/ı → i, o/ö → o, u/ü → u). Order matters: derivation, plural, possessive, case, copula.
const NOUN_RE = new RegExp(
  '^(?:(?:li|lu|siz|suz|liq|luq|lik|luk|ci|cu|ciq|cuq|ca|ce|la|le)){0,2}' + // derivation (before inflection)
  '(?:ler|lar)?' + // plural
  '(?:imiz|umuz|iniz|unuz|miz|muz|niz|nuz|im|um|in|un|si|su|sinin|sunun|i|u|m|n)?' + // possessive
  '(?:ndan|nden|nda|nde|nin|nun|ni|nu|na|ne|dan|den|da|de|ya|ye|yi|yu|in|un|i|u|a|e|la|le|ila|ile|ca|ce)?(?:ki(?:ler|lar)?)?' + // case, locative -ki
  '(?:(?:dir|dur)(?:ler|lar)?|di|du|yam|yem|am|em|san|sen|siniz|sunuz|yik|yuk|ik|uk|iq|uq)?$', // copula (also the past copula: deyildi)
);
const VOICE = '(?:il|in|ul|un|dir|dur|it|ut|ar|er|is|us|n|l)'; // passive / causative / reflexive infixes
const VERB_RE = new RegExp(
  `^(?:${VOICE}){0,2}(?:ma|me)?` + // voice, negative
  '(?:y?(?:ir|ur|i)|m(?:ir|ur)|r|di|du|ti|tu|mis|mus|dik|duk|y?(?:acaq|acag|acak|ecek|eceg|ecey)|ar|er|ib|ub|yib|yub|an|en|yan|yen|ma|me|maq|mek|mag|meg|mey|diq|duq|dig|dug|diy|duy|sa|se|yir|yur|araq|erek|yaraq|yerek|arken|erken|yarken|yerken' +
  // negative aorist (olmaz), obligation (işləməli), "without doing" (etmədən, görməzdən), "when/as long as" (olduqda, çalışdıqca, görünca), imperative (gözləyin)
  '|maz|mez|mali|meli|madan|meden|mazdan|mezden|duqda|diqda|dukde|dikde|diqca|duqca|dikce|dukce|inca|ince|unca|unce|y?(?:in|un))?' + // tense / participle / converb
  '(?:sa|se)?' + // conditional after a tense (gəlirsə, düşürsə)
  '(?:di|dim|du|dum)?' + // narrative past after -ir / -miş (işləyirdim, qurmuşduq)
  '(?:ler|lar)?' + // plural of a participle (öyrəndiklərim)
  '(?:am|em|im|um|san|sen|sin|sun|ik|iq|uk|uq|siniz|sunuz|lar|ler|m|k|q|niz|n)?' + // person
  '(?:imiz|umuz|iniz|unuz|im|um|in|un|si|su|i|u)?' + // possessive after a verbal noun / participle
  '(?:ndan|nden|nda|nde|nin|nun|ni|nu|na|ne|dan|den|da|de|ya|ye|yi|yu|a|e|la|le|ile|ca|ce)?' +
  '(?:sa|se)?$', // "etməkdənsə" (instead of doing)
);
// Consonants that change at a morpheme boundary: aç→ac, kitab→kitabı (b/p), qarışıq→qarışığı (ğ/q), gec→geci (c/ç), kök→köyü (y/k).
const ALTERNATIONS: [string, string][] = [['d', 't'], ['b', 'p'], ['g', 'k'], ['y', 'k'], ['q', 'x'], ['ğ', 'q'], ['c', 'ç']];

const rootVariants = (root: string): string[] => {
  const out = [root];
  for (const [a, b] of ALTERNATIONS) if (root.endsWith(a)) out.push(root.slice(0, -1) + b);
  return out;
};

const BACK = new Set(['a', 'ı', 'o', 'u']);
const VOWELS = new Set(['a', 'ə', 'e', 'ı', 'i', 'o', 'ö', 'u', 'ü']);
const lastVowel = (w: string) => { for (let i = w.length - 1; i >= 0; i--) if (VOWELS.has(w[i])) return w[i]; return ''; };
/**
 * Vowel harmony of an ending written after a root: the two-way vowels (a/ə) follow back/front, the four-way vowels (ı/i/u/ü) follow the previous vowel.
 * Only a/ə and ı/i/u/ü in the ending are judged (e, o, ö are invariant or rare). Returns true when the ending is harmonious.
 */
export function harmonious(root: string, ending: string): boolean {
  // Azerbaijani endings are written with "ə", never with a plain "e" ("etmə-yim", not "etmeyim"; "evlər", not "evler"): a plain "e" is the Turkish spelling.
  if (/e/.test(ending)) return false;
  // "-arkən"/"-ərkən": the final "ə" of "kən" is part of the ending and does not follow harmony.
  if (/[aə]rkən$/.test(ending)) ending = ending.slice(0, -3);
  let prev = lastVowel(root);
  if (!prev) return true; // a root without a vowel (an abbreviation): nothing to judge
  for (const ch of ending) {
    if (!VOWELS.has(ch)) continue;
    if (ch === 'a' || ch === 'ə') {
      const expected = BACK.has(prev) ? 'a' : 'ə';
      if (ch !== expected) return false;
    } else if (ch === 'ı' || ch === 'i' || ch === 'u' || ch === 'ü') {
      const expected = prev === 'a' || prev === 'ı' ? 'ı' : prev === 'e' || prev === 'ə' || prev === 'i' ? 'i' : prev === 'o' || prev === 'u' ? 'u' : 'ü';
      if (ch !== expected) return false;
    }
    prev = ch;
  }
  return true;
}

/** Whether a word is one of the ordinary word forms of the AISE vacancy corpus (nouns such as "hədik" must not be mistaken for a verb ending). */
export const inLexicon = (word: string): boolean => LEXICON.has(lower(word));

/** Misspellings seen in model drafts that read as an English root plus an Azerbaijani ending. */
const KNOWN_TYPOS = new Set(['rollu', 'rollunda', 'rollunu', 'rollundan', 'rollarında']);

export interface KnownWords { (token: string): boolean; sourceWords: Set<string> }

/**
 * Builds the "is this word known" predicate for one piece of evidence. Letters are compared exactly (a Turkish "gündelik" is not "gündəlik"), except that a
 * word the candidate wrote without diacritics may come back with them.
 */
export function knownWordsFor(sources: string[]): KnownWords {
  const sourceWords = new Set<string>();
  const sourceFolded = new Set<string>();
  for (const s of sources) for (const w of lower(s).split(/[^\p{L}]+/u)) if (w) { sourceWords.add(w); if (foldWord(w) === w) sourceFolded.add(w); } // only a word the candidate wrote WITHOUT diacritics may regain them
  // A word the candidate wrote without diacritics may come back with them ("hazirladim" → "hazırladım"), but only in a form that keeps vowel harmony: "etdim" → "etdım"
  // is a corrupted word (11 October 2026, a written letter), not a restoration.
  const restoredPlausibly = (w: string) => {
    const v = [...w].findIndex((ch) => VOWELS.has(ch));
    if (v < 0 || v === w.length - 1) return true;
    return harmonious(w.slice(0, v + 1), w.slice(v + 1));
  };
  const rootKnown = (r: string) => sourceWords.has(r) || (sourceFolded.has(foldWord(r)) && restoredPlausibly(r)) || LEXICON.has(r) || FUNCTION.has(r);
  // Productive verb derivation: a known noun or adjective + -laş/-ləş (become), -laşdır/-ləşdir (make), -lan/-lən, -la/-lə ("standartlaşdır", "rahatlaşdır", "etiketlə").
  const derived = (r: string) => {
    for (const sfx of ['laşdır', 'ləşdir', 'laş', 'ləş', 'lan', 'lən', 'la', 'lə']) {
      if (r.length - sfx.length >= 3 && r.endsWith(sfx) && harmonious(r.slice(0, -sfx.length), sfx) && rootKnown(r.slice(0, -sfx.length))) return true;
    }
    return false;
  };
  const verbStem = (r: string) => VERB_STEMS.has(r) || sourceWords.has(r) || sourceFolded.has(foldWord(r)) || derived(r);
  const known = (token: string): boolean => {
    const w = lower(token);
    if (w.length <= 3) return true;
    if (sourceWords.has(w) || LEXICON.has(w) || FUNCTION.has(w) || (sourceFolded.has(foldWord(w)) && restoredPlausibly(w))) return true;
    // root + endings: a root of at least 2 letters (il, ay, gün ...) and a well-formed run of endings
    for (let i = w.length - 1; i >= 2; i--) {
      const root = w.slice(0, i), ending = w.slice(i), rest = foldWord(ending);
      if (!harmonious(root, ending)) continue; // a Turkish-style or garbled ending such as "qurdi" (should be "qurdu")
      const variants = rootVariants(root);
      if (variants.some(rootKnown) && NOUN_RE.test(rest)) return true;
      if (variants.some(verbStem) && VERB_RE.test(rest)) return true;
    }
    return false;
  };
  (known as KnownWords).sourceWords = sourceWords;
  return known as KnownWords;
}

/** Words of `text` that are not known. Proper nouns (capitalised inside a sentence), numbers, tokens with digits and short tokens are not judged here. */
export function unknownWords(text: string, sources: string[]): string[] {
  const known = knownWordsFor(sources);
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const sentence of String(text ?? '').split(/(?<=[.!?;:])\s+|\n+/)) {
    const tokens = sentence.match(/[\p{L}][\p{L}\p{M}'’-]*/gu) ?? [];
    tokens.forEach((raw, index) => {
      // "MMC-de", "Java-da": a case ending after a hyphen is written with ə, never with a plain e (a Turkish-style ending).
      const pieces = raw.split(/['’-]/).filter(Boolean);
      const suffix = pieces.length > 1 ? pieces[pieces.length - 1] : '';
      if (suffix && /^[a-zəıöüçşğ]+$/.test(lower(suffix)) && lower(suffix).includes('e') && !seen.has(lower(raw))) { seen.add(lower(raw)); unknown.push(raw); return; }
      for (const part of pieces) {
        if (part.length <= 3) continue;
        const proper = /^\p{Lu}/u.test(part) && (index > 0 || /^\p{Lu}{2,}/u.test(part));
        if (proper || /^\p{Lu}{2,}$/u.test(part)) continue; // names and abbreviations: validated by the name gates
        const f = lower(part);
        if (seen.has(f)) continue;
        // Typos that parse as a known root plus an ending ("roll" + "unda"): refused unless the candidate wrote the word.
        if (KNOWN_TYPOS.has(f) && !known.sourceWords.has(f)) { seen.add(f); unknown.push(part); continue; }
        if (!known(part)) { seen.add(f); unknown.push(part); }
      }
    });
  }
  return unknown;
}
