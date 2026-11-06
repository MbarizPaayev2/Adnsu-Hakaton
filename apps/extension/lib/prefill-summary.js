/** What happened on the form, in the order the candidate needs it: what was filled (outlined on the page), what the profile lacks, what is still theirs to answer. */
export function prefillSummary(r) {
  const parts = [];
  parts.push(r.filled.length ? `Dolduruldu: ${r.filled.join(', ')} (səhifədə yaşıl çərçivə ilə göstərilib).` : 'Uyğun boş sahə tapılmadı; əvvəlki məlumatlar dəyişdirilmədi.');
  if (r.missing?.length) parts.push(`Profilinizdə yoxdur: ${[...new Set(r.missing)].join(', ')}. AISE profilinizə əlavə etsəniz, növbəti dəfə doldurulacaq.`);
  if (r.letterMissing) parts.push('Bu vakansiya üçün AISE-də təsdiqlənmiş motivasiya məktubu yoxdur: məktubu AISE-də hazırlayıb təsdiqləsəniz, bu addımda doldurulacaq; ya da özünüz yazın.');
  if (r.requiredLeft) parts.push(`${r.requiredLeft} məcburi sahə sizin cavabınızı gözləyir.`);
  parts.push('CV-ni əlavə etmək və göndərmək sizdədir; AISE heç nə göndərməyib.');
  return parts.join(' ');
}
