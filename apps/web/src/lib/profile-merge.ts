/**
 * Merging a second import (a LinkedIn profile, another CV) into what the candidate already has. Nothing is dropped silently and nothing is
 * duplicated: an entry that is the same role is kept once, missing fields are filled from the import, and an entry whose content differs is listed
 * as a conflict that the candidate resolves.
 */
export interface MergeExperience { title: string; company: string; location?: string; startDate: string; endDate: string | null; description: string }
export interface MergeEducation { institution: string; degree: string; fieldOfStudy: string; location?: string; startDate: string; endDate: string | null }

const fold = (s: string) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const month = (d: string) => (d || '').slice(0, 7);
const words = (s: string) => new Set(fold(s).split(' ').filter((w) => w.length > 2));
const overlap = (a: string, b: string) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
};

/** The same role: same company and (the same title or the same start month). Company names are compared by shared words so "Acme" and "Acme MMC" meet. */
export function sameExperience(a: MergeExperience, b: MergeExperience): boolean {
  const company = overlap(a.company, b.company) >= 0.6 || fold(a.company).includes(fold(b.company)) || fold(b.company).includes(fold(a.company));
  if (!company || !fold(a.company) || !fold(b.company)) return false;
  return overlap(a.title, b.title) >= 0.6 || (!!a.startDate && month(a.startDate) === month(b.startDate));
}

export interface ExperienceConflict { index: number; existing: MergeExperience; incoming: MergeExperience; fields: ('description' | 'dates' | 'title')[] }
export interface ExperienceMerge { merged: MergeExperience[]; added: number; duplicates: number; conflicts: ExperienceConflict[] }

export function mergeExperiences(existing: MergeExperience[], incoming: MergeExperience[]): ExperienceMerge {
  const merged = existing.map((e) => ({ ...e }));
  const conflicts: ExperienceConflict[] = [];
  let added = 0, duplicates = 0;
  for (const inc of incoming) {
    const i = merged.findIndex((e) => sameExperience(e, inc));
    if (i < 0) {
      merged.push({ ...inc });
      added++;
      continue;
    }
    duplicates++;
    const cur = merged[i];
    // Fill what the saved entry lacks; never overwrite what the candidate has.
    if (!cur.location && inc.location) cur.location = inc.location;
    if (!cur.description.trim() && inc.description.trim()) cur.description = inc.description;
    const fields: ExperienceConflict['fields'] = [];
    if (cur.description.trim() && inc.description.trim() && overlap(cur.description, inc.description) < 0.7 && fold(cur.description) !== fold(inc.description)) fields.push('description');
    if (cur.startDate && inc.startDate && month(cur.startDate) !== month(inc.startDate)) fields.push('dates');
    else if ((cur.endDate ?? '') !== (inc.endDate ?? '') && cur.endDate && inc.endDate && month(cur.endDate) !== month(inc.endDate)) fields.push('dates');
    if (fold(cur.title) !== fold(inc.title)) fields.push('title');
    if (fields.length) conflicts.push({ index: i, existing: { ...cur }, incoming: { ...inc }, fields });
  }
  return { merged, added, duplicates, conflicts };
}

export function mergeEducation(existing: MergeEducation[], incoming: MergeEducation[]): { merged: MergeEducation[]; added: number; duplicates: number } {
  const merged = existing.map((e) => ({ ...e }));
  let added = 0, duplicates = 0;
  for (const inc of incoming) {
    const i = merged.findIndex((e) => overlap(e.institution, inc.institution) >= 0.6 && (overlap(e.degree, inc.degree) >= 0.5 || !e.degree || !inc.degree));
    if (i < 0) { merged.push({ ...inc }); added++; continue; }
    duplicates++;
    if (!merged[i].location && inc.location) merged[i].location = inc.location;
    if (!merged[i].fieldOfStudy && inc.fieldOfStudy) merged[i].fieldOfStudy = inc.fieldOfStudy;
  }
  return { merged, added, duplicates };
}

/** Union of skills, one entry per skill (case and spacing ignored; the saved spelling wins). */
export function mergeSkills(existing: string[], incoming: string[]): { merged: string[]; added: string[] } {
  const seen = new Set(existing.map((s) => fold(s)));
  const added: string[] = [];
  for (const s of incoming) {
    const key = fold(s);
    if (key && !seen.has(key)) { seen.add(key); added.push(s); }
  }
  return { merged: [...existing, ...added], added };
}
