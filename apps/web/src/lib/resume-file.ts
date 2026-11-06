export const RESUME_MAX_BYTES = 10 * 1024 * 1024;
export const RESUME_ACCEPT_HINT = 'PDF və ya DOCX · maksimum 10MB';

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function resumeFileError(file: { name: string; size: number; type: string }): string | null {
  if (!file.size) {
    return 'Fayl boşdur. PDF və ya DOCX yükləyin (maksimum 10MB).';
  }
  if (file.size > RESUME_MAX_BYTES) {
    return 'Fayl 10MB-dan böyükdür. Daha kiçik PDF və ya DOCX yükləyin.';
  }
  const lower = file.name.toLowerCase();
  const okExt = lower.endsWith('.pdf') || lower.endsWith('.docx');
  const okMime =
    !file.type ||
    file.type === 'application/pdf' ||
    file.type === DOCX ||
    file.type === 'application/octet-stream';
  if (!okExt || !okMime) {
    return 'Yalnız PDF və DOCX faylları qəbul edilir (maksimum 10MB).';
  }
  return null;
}
