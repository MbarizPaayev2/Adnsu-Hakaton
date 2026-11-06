/**
 * Coverage-reporting segments read from a posting's own words. These are heuristics for measuring gaps in the catalogue (internships, part-time work,
 * trades, public sector, education and health), not facts shown to candidates: a posting matches a segment only when its title or description says so.
 */
import { foldAz } from './az-regions';

export type VacancySegment = 'internship' | 'graduate' | 'part-time' | 'trades' | 'public-sector' | 'education' | 'health' | 'hospitality' | 'retail';

const RULES: [VacancySegment, 'title' | 'any', RegExp][] = [
  ['internship', 'any', /\b(intern|internship|trainee|tecrubeci|tecrube proqrami|staj|stajyor|stajor|praktikant)[a-z]{0,3}\b/],
  ['graduate', 'any', /\b(graduate programme|graduate program|mezun proqrami|mezunlar ucun|yeni mezun|gencler proqrami|young professionals?)[a-z]{0,3}\b/],
  ['part-time', 'any', /\b(part[- ]time|yarim ?stat|yarim gun|yarimstat|qismen mesgulluq|saatliq)[a-z]{0,3}\b/],
  ['trades', 'title', /\b(usta|surucu|elektrik|elektrikci|qaynaqci|kaynakci|mexanik|santexnik|dulger|boyaqci|cilingir|tornaci|fehle|anbardar|yukleyici|kuryer|ekspeditor|operator|texnik(?!i)|technician|welder|driver|electrician|mechanic|plumber|forklift|asbaz|aspaz|cook|chef|qarson|ofisiant|waiter|barista|kassir|cashier|xadime|temizlik|cleaner|muhafiz|security guard|tikisci|bagban|qaynaq)[a-z]{0,3}\b/],
  ['public-sector', 'any', /\b(dovlet qullugu|dovlet orqan|nazirliyi|nazirlik|agentliyi|ictimai huquqi sexs|publik huquqi sexs|civil service|ministry of)[a-z]{0,3}\b/],
  ['education', 'title', /\b(muellim|teacher|lecturer|professor|dosent|bas muellim|tyutor|tutor|terbiyeci|pedaqoq|instructor|telimci)[a-z]{0,3}\b/],
  ['health', 'title', /\b(hekim|hekimi|doctor|physician|nurse|tibb bacisi|feldser|eczaci|pharmacist|stomatoloq|dentist|laborant|radioloq|cerrah|surgeon|pediatr|terapevt|tibbi)[a-z]{0,3}\b/],
  ['hospitality', 'title', /\b(hotel|otel|resepsiyon|reception|housekeeping|restoran|restaurant|bartender|qonaqlama|front desk|concierge)[a-z]{0,3}\b/],
  ['retail', 'title', /\b(satici|satis meslehetcisi|sales assistant|merchandiser|mercendayzer|magaza|store manager|kassir|cashier)[a-z]{0,3}\b/],
];

/** Every segment (Azerbaijani case endings of up to three letters are accepted: "müəllimi", "sürücüsü") the posting's own title (or, where noted, description) states. */
export function vacancySegments(title: string, description = ''): VacancySegment[] {
  const t = foldAz(title), d = foldAz(description.slice(0, 4000));
  return RULES.filter(([, where, re]) => re.test(t) || (where === 'any' && re.test(d))).map(([segment]) => segment);
}
