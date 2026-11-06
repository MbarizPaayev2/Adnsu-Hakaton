import { isLetter, type DocumentContent } from './resume-tailor.types';
import { DESCRIPTIVE_WORDS, ENGLISH_FUNCTION_WORDS, GENERIC_TITLE_WORDS, TRANSLATABLE, looksEnglish, type TranslateItem } from './az-translate';

/** Common labels are translated without a provider; organisation, product and tool identities stay intact. */
const LABELS: Record<string, string> = {
  'backend developer': 'Backend proqramçısı', 'backend engineer': 'Backend mühəndisi', 'senior accountant': 'Baş mühasib', 'software engineer': 'Proqram təminatı mühəndisi',
  'business analyst': 'Biznes analitiki', 'business analyst intern': 'Biznes təhlili üzrə təcrübəçi',
  'data analyst': 'Məlumat analitiki', 'data analyst intern': 'Məlumatların təhlili üzrə təcrübəçi',
  'co-founder & product lead': 'Həmtəsisçi və məhsul rəhbəri', 'co-founder & ceo': 'Həmtəsisçi və baş icraçı direktor',
  'co-founder and product lead': 'Həmtəsisçi və məhsul rəhbəri', 'product lead': 'Məhsul rəhbəri',
  'co-founder': 'Həmtəsisçi', founder: 'Təsisçi', 'product builder': 'Məhsul yaradıcısı',
  'sustainability & esg research analyst': 'Dayanıqlılıq və ESG üzrə tədqiqat analitiki',
  bachelor: 'Bakalavr', master: 'Magistr', 'business administration': 'Biznesin idarə edilməsi',
  'business analysis': 'Biznes təhlili', 'requirements definition': 'Tələblərin müəyyənləşdirilməsi',
  'financial modeling': 'Maliyyə modelləşdirilməsi', 'scenario analysis': 'Ssenari təhlili',
  'cohort and retention analysis': 'Kohort və müştəri saxlama təhlili', 'ai product strategy': 'Süni intellekt məhsulları üzrə strategiya',
  'analytical skills': 'Analitik bacarıqlar', 'time management': 'Vaxtın idarə edilməsi',
  'market and industry research': 'Bazar və sahə araşdırması', 'product discovery': 'Məhsul imkanlarının araşdırılması',
  'competitive benchmarking': 'Rəqiblərlə müqayisəli təhlil', 'kpi design': 'KPI-lərin hazırlanması',
  'go-to-market planning': 'Bazara çıxışın planlaşdırılması', 'data cleaning': 'Məlumatların təmizlənməsi',
  segmentation: 'Seqmentləşdirmə', 'generative ai tools': 'Generativ süni intellekt alətləri',
  'prompt design': 'Sorğuların hazırlanması', 'ai use-case research': 'Süni intellektin tətbiq imkanlarının araşdırılması',
  'workflow design': 'İş axınının hazırlanması', 'rapid prototyping': 'Sürətli prototipləşdirmə',
  'communication skills': 'Ünsiyyət bacarıqları', teamwork: 'Komanda işi', skills: 'Bacarıqlar',
  remote: 'Məsafədən', baku: 'Bakı', azerbaijan: 'Azərbaycan', 'baku, azerbaijan': 'Bakı, Azərbaycan', english: 'İngilis dili', russian: 'Rus dili', azerbaijani: 'Azərbaycan dili',
  turkish: 'Türk dili', advanced: 'İrəli səviyyə', intermediate: 'Orta səviyyə', beginner: 'Başlanğıc səviyyə',
  fluent: 'Sərbəst', native: 'Ana dili', 'native or bilingual proficiency': 'Ana dili və ya ikidilli səviyyə',
  'professional working proficiency': 'Peşəkar iş səviyyəsi',
};
const LABEL_WORDS = new Set(('business analyst intern founder product lead sustainability research bachelor master administration skills financial modeling analysis requirements strategy management communication teamwork english russian advanced intermediate beginner remote market industry planning definition development engineer developer science senior junior professional fluent native').split(' '));
export function labelTranslation(text: string): string | undefined {
  const value = text.trim();
  if (LABELS[value.toLowerCase()]) return LABELS[value.toLowerCase()];
  if (value.includes('|')) {
    const pieces = value.split('|').map(x => x.trim());
    const translated = pieces.map(x => LABELS[x.toLowerCase()] ?? x);
    if (translated.some((x, i) => x !== pieces[i])) return translated.join(' | ');
  }
  return undefined;
}
/** Localize a retained title only where Azerbaijani prose explicitly identifies it as a role or vacancy. */
const ROLE_LABELS = ['backend developer', 'backend engineer', 'senior accountant', 'software engineer', 'business analyst intern', 'business analyst', 'data analyst intern', 'data analyst', 'co-founder & product lead', 'co-founder and product lead', 'co-founder & ceo', 'co-founder', 'product lead', 'product builder', 'sustainability & esg research analyst', 'founder'];
export function translatedRoleVocabulary(source: string): string[] {
  return ROLE_LABELS.filter(role => new RegExp(`(?<![\\p{L}\\p{N}])${role}(?![\\p{L}\\p{N}])`, 'iu').test(source.replace(/[‐‑–]/g, '-').replace(/-\s+/g, '-'))).map(role => LABELS[role]);
}
export function translateEmbeddedRoleLabels(text: string): string {
  let translated = text;
  for (const role of [...ROLE_LABELS].sort((a, b) => b.length - a.length)) {
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-‐‑–]\\s*');
    translated = translated.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?=\\s+(?:vəzifə[\\p{L}]*|vakansiya[\\p{L}]*|rolunda|kimi)(?![\\p{L}]))`, 'giu'), LABELS[role]);
  }
  return translated;
}
export function needsTranslation(text: string, kind: TranslateItem['kind']): boolean {
  if (Object.values(LABELS).includes(text)) return false;
  if (looksEnglish(text)) return true;
  if (kind !== 'label' && kind !== 'headline') return false;
  if (labelTranslation(text)) return true;
  if (['Power BI', 'MS Office', 'Visual Studio', 'Random Forest', 'Isolation Forest', 'Logistic Regression', 'Google Vision', 'Azure Form Recognizer'].includes(text)) return false;
  // A tool or technology written with an acronym ("REST API", "SQL Server", "AWS Lambda") is kept as written, like the names above; a CV in the
  // preview could not be approved because its skill "REST API" counted as untranslated English.
  if (/\b[A-Z]{2,}\b/.test(text) && !text.toLowerCase().split(/[^a-z]+/).some(w => LABEL_WORDS.has(w))) return false;
  return !!labelTranslation(text) || text.toLowerCase().split(/[^a-z]+/).some(w => LABEL_WORDS.has(w)) || (!/[əğıöşüç]/i.test(text) && /[a-z]{3,}\s+[a-z]{3,}/i.test(text) && !azerbaijaniCompound(text));
}

/**
 * An Azerbaijani title can be written without any of ə ğ ı ö ş ü ç ("Restoran administratoru", "Anbar operatoru"). Its head noun then still carries
 * the possessive ending of an izafet compound (-ı/-i/-u/-ü or -sı/-si/-su/-sü after a longer stem), which English titles do not end in.
 */
function azerbaijaniCompound(text: string): boolean {
  const words = text.trim().split(/\s+/);
  const head = words[words.length - 1].toLowerCase();
  return words.length >= 2 && head.length >= 6 && /[bcdfgjklmnpqrstvxyz](?:u|i|ı|ü)$|(?:su|si|sı|sü)$/.test(head);
}
/** Distinguishes a likely organization/product name from a short English description in legacy “name | description” fields. */
export function nameLike(text: string): boolean {
  const value = String(text ?? '').trim();
  if (!value || /[əğıöşüçƏĞİÖŞÜÇ]/.test(value)) return false;
  const words = value.toLowerCase().split(/[^a-z0-9+#&]+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return !words.some((word) => ENGLISH_FUNCTION_WORDS.has(word) || LABEL_WORDS.has(word) || GENERIC_TITLE_WORDS.has(word) || TRANSLATABLE.has(word) || DESCRIPTIVE_WORDS.has(word) || !!LABELS[word]);
}
/** An English descriptive phrase of at least two words (not a single brand or acronym). */
const looksEnglishLabel = (text: string) => !/[əğıöşüçƏĞİÖŞÜÇ]/.test(text) && /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(text) && needsTranslation(text, 'label');
export interface DocumentField extends TranslateItem { section: string; set: (value: string) => void }
/** One inventory shared by generation, retry and approval checks: no missing sections. */
export function documentFields(content: DocumentContent): DocumentField[] {
  const fields: DocumentField[] = [];
  const add = (id: string, value: unknown, kind: TranslateItem['kind'], section: string, set: (v: string) => void, current?: boolean) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) fields.push({ id, text, kind, section, role: section, set, current });
  };
  if (isLetter(content)) {
    content.paragraphs.forEach((p, i) => add(`paragraphs.${i}.text`, p.text, 'project', 'letter', v => { p.text = v; p.approved = false; }));
    // Keep the employer's vacancy title as supplied; it is reference metadata, not candidate-authored prose.
    add('basics.location', content.basics?.location, 'label', 'location', v => { content.basics.location = v; });
    add('salutation', content.salutation, 'label', 'salutation', v => { content.salutation = v; });
    add('closing', content.closing, 'label', 'closing', v => { content.closing = v; });
    return fields;
  }
  add('headline', content.basics?.headline, 'headline', 'headline', v => { content.basics.headline = v; });
  add('basics.location', content.basics?.location, 'label', 'location', v => { content.basics.location = v; });
  add('summary', content.summary, 'summary', 'summary', v => { content.summary = v; });
  // "LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers": the name before the bar stays as written, the English description after it is translated.
  const descriptor = (id: string, value: unknown, section: string, set: (v: string) => void) => {
    const m = typeof value === 'string' ? /^(.+?)\s+\|\s+(.+)$/.exec(value.trim()) : null;
    if (!m) return;
    const [, left, right] = m;
    if (looksEnglishLabel(right) && !nameLike(right)) add(id, right, 'label', section, v => set(`${left} | ${v}`));
    else if (nameLike(right) && looksEnglishLabel(left) && !nameLike(left)) add(id, left, 'label', section, v => set(`${v} | ${right}`));
  };
  (content.experience ?? []).forEach((e, i) => {
    const section = `${e.position}, ${e.company}`;
    add(`experience.${i}.position`, e.position, 'label', section, v => { e.position = v; });
    descriptor(`experience.${i}.company`, e.company, section, v => { e.company = v; });
    add(`experience.${i}.location`, e.location, 'label', section, v => { e.location = v; });
    (e.highlights ?? []).forEach((h, j) => add(`experience.${i}.highlights.${j}`, h, 'bullet', section, v => { e.highlights[j] = v; }, /present|hazırda/i.test(e.period)));
  });
  (content.education ?? []).forEach((e, i) => {
    add(`education.${i}.degree`, e.degree, 'label', e.school, v => { e.degree = v; });
    add(`education.${i}.area`, e.area, 'label', e.school, v => { e.area = v; });
    add(`education.${i}.location`, e.location, 'label', e.school, v => { e.location = v; });
  });
  (content.skills ?? []).forEach((s, i) => {
    add(`skills.${i}.name`, s.name, 'label', 'skills', v => { s.name = v; });
    add(`skills.${i}.proficiency`, s.proficiency, 'label', 'skills', v => { s.proficiency = v; });
    (s.keywords ?? []).forEach((k, j) => add(`skills.${i}.keywords.${j}`, k, 'label', 'skills', v => { s.keywords[j] = v; }));
  });
  (content.languages ?? []).forEach((l, i) => {
    add(`languages.${i}.language`, l.language, 'label', 'languages', v => { l.language = v; });
    add(`languages.${i}.fluency`, l.fluency, 'label', 'languages', v => { l.fluency = v; });
  });
  (content.projects ?? []).forEach((p, i) => {
    descriptor(`projects.${i}.name`, p.name, p.name, v => { p.name = v; });
    add(`projects.${i}.description`, p.description, 'project', p.name, v => { p.description = v; });
    add(`projects.${i}.result`, p.result, 'project', p.name, v => { p.result = v; });
  });
  (content.activities ?? []).forEach((a, i) => {
    add(`activities.${i}.title`, a.title, 'label', a.title, v => { a.title = v; });
    add(`activities.${i}.role`, a.role, 'label', a.title, v => { a.role = v; });
    add(`activities.${i}.description`, a.description, 'project', a.title, v => { a.description = v; });
    add(`activities.${i}.result`, a.result, 'project', a.title, v => { a.result = v; });
  });
  (content.certifications ?? []).forEach((c, i) => {
    add(`certifications.${i}.title`, c.title, 'label', 'certifications', v => { c.title = v; });
    add(`certifications.${i}.description`, c.description, 'project', c.title, v => { c.description = v; });
  });
  // Award titles are read like headings ("Winner, Startup Pitch Competition"); a named award ("Erasmus+ Scholarship") is kept as written by needsTranslation.
  (content.awards ?? []).forEach((a, i) => add(`awards.${i}.title`, a.title, 'label', 'awards', v => { a.title = v; }));
  return fields;
}
