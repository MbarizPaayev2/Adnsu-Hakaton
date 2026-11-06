/**
 * Maps a posting's free-text location to a settlement and one of Azerbaijan's 14 economic regions (2021 division), for coverage reporting only.
 * Matching is by explicit place names (Azerbaijani spelling, ASCII folding and common English transliterations). A location that names no known place
 * (for example "Azerbaijan", "Remote" or an empty string) is reported as unknown, never assumed to be Bakı.
 */
export type EconomicRegion =
  | 'Bakı' | 'Abşeron-Xızı' | 'Dağlıq Şirvan' | 'Gəncə-Daşkəsən' | 'Qarabağ' | 'Qazax-Tovuz' | 'Quba-Xaçmaz'
  | 'Lənkəran-Astara' | 'Mərkəzi Aran' | 'Mil-Muğan' | 'Şəki-Zaqatala' | 'Şərqi Zəngəzur' | 'Naxçıvan' | 'Şirvan-Salyan';

export const ECONOMIC_REGIONS: readonly EconomicRegion[] = [
  'Bakı', 'Abşeron-Xızı', 'Dağlıq Şirvan', 'Gəncə-Daşkəsən', 'Qarabağ', 'Qazax-Tovuz', 'Quba-Xaçmaz',
  'Lənkəran-Astara', 'Mərkəzi Aran', 'Mil-Muğan', 'Şəki-Zaqatala', 'Şərqi Zəngəzur', 'Naxçıvan', 'Şirvan-Salyan',
];

/** Settlements by region; each string is one settlement's spellings separated by "|", the first being the display name. Bakı's districts count as Bakı. */
const PLACES: [EconomicRegion, string[]][] = [
  ['Bakı', ['Bakı|Baku|Baki|Bakou|Xətai|Nəsimi|Nərimanov|Yasamal|Səbail|Binəqədi|Nizami rayonu|Suraxanı|Sabunçu|Qaradağ|Xəzər|Pirallahı|Mərdəkan|Buzovna|Bilgəh|Zabrat|Hövsan|Lökbatan|Səngəçal|Sangachal|Bülbülə']],
  ['Abşeron-Xızı', ['Sumqayıt|Sumgait|Sumgayit|Sumqayit', 'Abşeron|Absheron|Xırdalan|Khirdalan|Masazır|Masazir', 'Xızı|Khizi']],
  ['Dağlıq Şirvan', ['Şamaxı|Shamakhi', 'İsmayıllı|Ismayilli', 'Ağsu|Agsu', 'Qobustan|Gobustan']],
  ['Gəncə-Daşkəsən', ['Gəncə|Ganja|Ganca', 'Daşkəsən|Dashkasan', 'Göygöl|Goygol', 'Samux|Samukh', 'Goranboy', 'Naftalan']],
  ['Qarabağ', ['Xankəndi|Khankendi', 'Şuşa|Shusha', 'Ağdam|Aghdam', 'Füzuli|Fuzuli', 'Xocalı|Khojaly', 'Xocavənd|Khojavend', 'Tərtər|Terter|Tartar', 'Bərdə|Barda', 'Ağcabədi|Aghjabadi|Agcabadi', 'Ağdərə']],
  ['Qazax-Tovuz', ['Qazax|Gazakh|Qazakh', 'Tovuz', 'Ağstafa|Aghstafa', 'Şəmkir|Shamkir', 'Gədəbəy|Gadabay|Gedebey']],
  ['Quba-Xaçmaz', ['Quba|Guba', 'Qusar|Gusar', 'Xaçmaz|Khachmaz', 'Şabran|Shabran', 'Siyəzən|Siyazan']],
  ['Lənkəran-Astara', ['Lənkəran|Lankaran|Lenkeran', 'Astara', 'Masallı|Masalli', 'Lerik', 'Yardımlı|Yardimli', 'Cəlilabad|Jalilabad']],
  ['Mərkəzi Aran', ['Mingəçevir|Mingachevir', 'Yevlax|Yevlakh', 'Ağdaş|Agdash', 'Göyçay|Goychay', 'Ucar|Ujar', 'Zərdab|Zardab', 'Kürdəmir|Kurdamir']],
  ['Mil-Muğan', ['İmişli|Imishli', 'Beyləqan|Beylagan', 'Saatlı|Saatli', 'Sabirabad', 'Biləsuvar|Bilasuvar']],
  ['Şəki-Zaqatala', ['Şəki|Shaki|Sheki', 'Zaqatala|Zagatala', 'Balakən|Balakan', 'Qax|Gakh', 'Qəbələ|Gabala|Qabala', 'Oğuz|Oghuz']],
  ['Şərqi Zəngəzur', ['Laçın|Lachin', 'Kəlbəcər|Kalbajar', 'Qubadlı|Gubadli', 'Zəngilan|Zangilan', 'Cəbrayıl|Jabrayil']],
  ['Naxçıvan', ['Naxçıvan|Nakhchivan|Nakhichevan', 'Şərur|Sharur', 'Ordubad', 'Culfa|Julfa', 'Şahbuz', 'Kəngərli', 'Sədərək']],
  ['Şirvan-Salyan', ['Şirvan|Shirvan', 'Salyan', 'Neftçala|Neftchala', 'Hacıqabul|Hajigabul']],
];

/** Lower-case ASCII folding of Azerbaijani/Turkish letters, so "Şəki", "Seki" and "SHEKI" compare consistently. */
export function foldAz(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

const INDEX: { pattern: RegExp; place: string; region: EconomicRegion }[] = PLACES.flatMap(([region, settlements]) =>
  settlements.flatMap((spellings) => {
    const names = spellings.split('|');
    // Folding makes several spellings identical ("Sumqayıt"/"Sumqayit"); each folded form is indexed once.
    return [...new Set(names.map(foldAz))].map((name) => ({ pattern: new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`), place: names[0], region }));
  }),
).sort((a, b) => b.pattern.source.length - a.pattern.source.length);

export interface LocationClass { place: string | null; region: EconomicRegion | null }

/** The first explicit place a location names, and its economic region. Unknown when the text names no settlement. */
export function classifyLocation(location: string | null | undefined): LocationClass {
  const text = foldAz(location ?? '');
  if (!text.trim()) return { place: null, region: null };
  let best: { at: number; place: string; region: EconomicRegion } | null = null;
  for (const entry of INDEX) {
    const m = entry.pattern.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, place: entry.place, region: entry.region };
  }
  return best ? { place: best.place, region: best.region } : { place: null, region: null };
}
