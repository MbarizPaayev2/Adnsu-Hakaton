/** Source lines with their posting section. Headings are structural, never skills or candidate facts. */
export type PostingSection =
  'required' | 'preferred' | 'responsibility' | 'other' | 'unknown';
export interface PostingLine {
  text: string;
  section: PostingSection;
}
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i');
const HEADINGS: [PostingSection, RegExp][] = [
  [
    'other',
    /^(?:biz ne teklif edirik|ne teklif edirik|teklif edirik|is sertlerimiz|is sertleri|is seraiti|sertler|emek haqqi|sirket haqqinda|muraciet qaydasi|we offer|what we offer|benefits|working conditions|about (?:us|the company)|how to apply|мы предлагаем|условия работы)(?=\s*[:：]|$)/iu,
  ],
  [
    'responsibility',
    /^(?:(?:esas )?vezife (?:ohdelikleri|funksiyalari)|vezifeler|ohdelikler|is funksiyalari|isin tesviri|responsibilities|key responsibilities|duties|what you(?:'|’)?ll do|обязанности)(?=\s*[:：]|$)/iu,
  ],
  [
    'preferred',
    /^(?:ustunlukler|ustunluk|elave ustunlukler|namizedin ustunlukleri|arzu olunur|arzuolunan|advantages?|desired|good to have|preferred(?: qualifications)?|nice[- ]to[- ]have|bonus|желательно)(?=\s*[:：]|$)/iu,
  ],
  [
    'required',
    /^(?:telebler|namizede telebler|teleb olunan (?:bilik ve bacariqlar|tehsil(?:,? is tecrubesi)? ve dil bilikleri|bacariqlar)|requirements?|qualifications?|must[- ]have|what you(?:'|’)?ll need|what we(?:'|’)re looking for|about you|required(?: qualifications| skills| knowledge and skills)?|education,? experience and languages|требования)(?=\s*[:：]|$)/iu,
  ],
];

export function postingLines(
  raw: string,
  initial: PostingSection = 'unknown',
): PostingLine[] {
  let section = initial;
  const out: PostingLine[] = [];
  const lines = String(raw ?? '')
    .replace(/<\/?(?:p|div|li|ul|ol|br|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split(/\r?\n+|\s+[•▪●◦‣]\s+/u)
    .map((line) => line.replace(/^[\s•▪●◦‣·*]+|^[-–—]\s+/u, '').trim())
    .filter(Boolean);
  for (const line of lines) {
    const normalized = fold(line);
    const heading = HEADINGS.find(([, re]) => re.test(normalized));
    if (heading) {
      section = heading[0];
      // Keep inline requirements after a heading such as "Requirements: SQL and Python".
      const separator = line.search(/[:：]/u);
      const rest = separator < 0 ? '' : line.slice(separator + 1).trim();
      if (rest) out.push({ text: rest, section });
    } else out.push({ text: line, section });
  }
  return out;
}
