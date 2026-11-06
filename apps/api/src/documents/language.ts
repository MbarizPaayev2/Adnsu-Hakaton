export type DocumentLanguage = 'az' | 'en' | 'ru' | 'tr';
export const DOCUMENT_LANGUAGES: DocumentLanguage[] = ['az', 'en', 'ru', 'tr'];

const WORDS: Record<'az' | 'tr' | 'en', RegExp> = {
  az: /\b(və|üçün|ilə|olan|və ya|iş|təcrübə|tələblər|bacarıq|şirkət|vəzifə|məsuliyyət|namizəd)\b/gi,
  tr: /\b(ve|için|ile|olan|bir|veya|deneyim|şirket|aranan|gereken|çalışma|pozisyon)\b/gi,
  en: /\b(the|and|for|with|will|you|our|experience|requirements|responsibilities|team|skills|work)\b/gi,
};

/** A heuristic default for the language of a vacancy; the candidate can always choose another. Never used as a fact. */
export function detectLanguage(text: string): DocumentLanguage {
  const t = String(text || '').slice(0, 4000);
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (!letters) return 'en';
  const cyrillic = (t.match(/[Ѐ-ӿ]/g) || []).length;
  if (cyrillic / letters > 0.3) return 'ru';
  const score = (re: RegExp) => (t.match(re) || []).length;
  let az = score(WORDS.az) + 2 * (t.match(/[əƏ]/g) || []).length;
  const tr = score(WORDS.tr) + (t.match(/[İ]/g) || []).length;
  const en = score(WORDS.en);
  if (az === 0 && tr === 0 && en === 0) return 'en';
  if (az >= tr && az > en) return 'az';
  if (tr > az && tr > en) return 'tr';
  return en >= az && en >= tr ? 'en' : az >= tr ? 'az' : 'tr';
}
