'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** How many entries of a section the CV reader found but did not keep because the section hit its size limit (`parsedContent.omitted`). */
export type Omitted = Partial<Record<'skills' | 'workExperience' | 'education' | 'careerSuggestions', number>>;

const SECTION_TEXT: Record<keyof Omitted, string> = {
  workExperience: 'iş yeri',
  education: 'təhsil qeydi',
  skills: 'bacarıq',
  careerSuggestions: 'layihə/sertifikat/könüllülük təklifi',
};

export function omittedItems(parsed: unknown): { section: keyof Omitted; count: number }[] {
  const omitted = (parsed as { omitted?: Omitted } | null | undefined)?.omitted;
  if (!omitted || typeof omitted !== 'object') return [];
  return (Object.keys(SECTION_TEXT) as (keyof Omitted)[])
    .map((section) => ({ section, count: Number(omitted[section]) || 0 }))
    .filter((x) => x.count > 0);
}

/**
 * Shown when the CV reader had to stop at a size limit: something real from the candidate's CV is NOT in the form below. This is different from the
 * fact check on a generated document, which is about what a model left out or removed. Actionable: it says what to add and where.
 */
export function ExtractionNotice({ parsed }: { parsed: unknown }) {
  const items = omittedItems(parsed);
  if (!items.length) return null;
  return (
    <div role="alert" data-testid="extraction-notice" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> CV-nizin hamısı oxunmadı</p>
      <p className="mt-1 text-xs">
        CV-nizdə oxuya bildiyimiz limitdən çox qeyd var: {items.map((x) => `${x.count} ${SECTION_TEXT[x.section]}`).join(', ')} əlavə edilmədi.
        Bunlar qaralamalara düşməyəcək. Vacib olanları aşağıda əl ilə əlavə edin (iş yerləri və təhsil üçün bu forma, layihə və sertifikatlar üçün “Karyera Sübutları” bölməsi).
      </p>
    </div>
  );
}
