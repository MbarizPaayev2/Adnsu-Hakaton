import { BadRequestException } from '@nestjs/common';
import { extractApplicationEmail, type ApplicationEmailEvidence } from '../../jobs/job-facts';
import { bakuInstant } from './baku-time';
import { validateLinkedInJobUrl } from './linkedin-job.parser';

export const MAX_PASTED_JOB_TEXT_CHARS = 40_000;
const MIN_PASTED_JOB_TEXT_CHARS = 50;

/** A user-supplied, transient parse. Missing facts stay null; this is deliberately not an IngestJobDto. */
export interface PastedJobParse {
  title: string | null;
  company: string | null;
  description: string;
  location: string | null;
  sourceUrl: string | null;
  postedAt: null;
  capturedAt: string;
  deadline: string | null;
  applicationEmail: string | null;
  applicationEmailEvidence: ApplicationEmailEvidence | null;
  source: 'candidate-paste';
  needsReview: string[];
}

const LABELS = {
  title: /^(?:vəzifə(?:nin adı)?|vakansiya(?:nın adı)?|position|job title|vacancy|должность|вакансия)\s*[:：\-–]\s*(.+)$/i,
  company: /^(?:şirkət|işəgötürən|company|employer|organization|организация|компания|работодатель)\s*[:：\-–]\s*(.+)$/i,
  location: /^(?:yer|məkan|iş yeri|location|место работы|локация)\s*[:：\-–]\s*(.+)$/i,
  deadline: /^(?:son müraciət tarixi|müraciət üçün son tarix|son tarix|deadline|apply by|application deadline|дедлайн|срок подачи заявок|приём заявок до)\s*[:：\-–]?\s*(.+)$/i,
};

const SECTION = /^(?:about (?:the )?(?:job|role)|job description|description|responsibilities|requirements|qualifications|what you(?:'|’)ll do|what we(?:'|’)re looking for|haqqında|vəzifə öhdəlikləri|tələblər|öhdəliklər|требования|обязанности|описание вакансии)\s*[:：]?$/i;

const AZ_CITIES = [
  'Baku', 'Bakı', 'Azerbaijan', 'Azərbaycan', 'Sumqayıt', 'Sumgayit', 'Gəncə', 'Ganja',
  'Mingəçevir', 'Mingachevir', 'Şirvan', 'Shirvan', 'Naxçıvan', 'Nakhchivan', 'Xırdalan', 'Khirdalan',
  'Quba', 'Qəbələ', 'Qabala', 'Lənkəran', 'Lankaran', 'Şəki', 'Sheki', 'Şamaxı', 'Shamakhi',
];

function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/[\u00a0\u2007\u202f\t]+/g, ' ')
    .split('\n').map((line) => line.replace(/ {2,}/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function cleanField(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[|•·]+$/g, '').trim().slice(0, 500);
}

function findLabel(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return cleanField(match[1]);
  }
  return null;
}

function titleFromHeading(lines: string[]): string | null {
  const labelled = findLabel(lines, LABELS.title);
  if (labelled) return labelled;
  for (const line of lines.slice(0, 8)) {
    const candidate = line.replace(/\s*[|–—]\s*LinkedIn\s*$/i, '').trim();
    if (!candidate || SECTION.test(candidate) || candidate.length > 140 || candidate.length < 4) continue;
    if (/^(?:linkedin|jobs|about the company|company overview)\b/i.test(candidate)) continue;
    // LinkedIn copied headers commonly look like "Role · Company · Location".
    const first = candidate.split(/\s*[·|]\s*/)[0]?.trim();
    if (first && first.length <= 100) return cleanField(first);
  }
  return null;
}

function locationFromText(text: string, labelled: string | null): string | null {
  if (labelled) return labelled.slice(0, 256);
  const headerLines = text.split('\n').slice(0, 10).filter((line) => line.length <= 120);
  for (const line of headerLines) {
    const found = AZ_CITIES.find((city) => new RegExp(`(?:^|[^\\p{L}])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}])`, 'iu').test(line));
    if (found) return line.slice(0, 256);
  }
  return null;
}

function parseDate(value: string): string | null {
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return bakuInstant(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`, 'end') ?? null;
  const numeric = value.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (numeric) return bakuInstant(`${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`, 'end') ?? null;
  const months: Record<string, string> = {
    yanvar: '01', january: '01', январ: '01', fevral: '02', february: '02', феврал: '02',
    mart: '03', march: '03', марта: '03', aprel: '04', april: '04', апрел: '04',
    may: '05', мая: '05', iyun: '06', june: '06', июн: '06', iyul: '07', july: '07', июл: '07',
    avqust: '08', august: '08', август: '08', sentyabr: '09', september: '09', сентябр: '09',
    oktyabr: '10', october: '10', октябр: '10', noyabr: '11', november: '11', ноябр: '11',
    dekabr: '12', december: '12', декабр: '12',
  };
  const monthFirst = value.match(/\b([\p{L}]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s*(20\d{2})?\b/iu);
  if (monthFirst) {
    const month = months[monthFirst[1].toLocaleLowerCase('az')];
    if (month && monthFirst[3]) return bakuInstant(`${monthFirst[3]}-${month}-${monthFirst[2].padStart(2, '0')}`, 'end') ?? null;
  }
  const named = value.match(/\b(\d{1,2})\s+([\p{L}]+)(?:\s*,?\s*(20\d{2}))?\b/iu);
  if (!named) return null;
  const month = months[named[2].toLocaleLowerCase('az')];
  if (!month) return null;
  if (!named[3]) return null;
  return bakuInstant(`${named[3]}-${month}-${named[1].padStart(2, '0')}`, 'end') ?? null;
}

export function parsePastedJobText(
  rawText: string,
  options: { sourceUrl?: string; fetchedAt?: Date } = {},
): PastedJobParse {
  if (typeof rawText !== 'string') throw new BadRequestException('Vakansiya mətnini yapışdırın');
  if (rawText.length > MAX_PASTED_JOB_TEXT_CHARS) throw new BadRequestException('Vakansiya mətni 40 000 simvoldan uzun ola bilməz');
  const text = normalizeText(rawText);
  if (text.replace(/\s/g, '').length < MIN_PASTED_JOB_TEXT_CHARS) {
    throw new BadRequestException('Daha dəqiq çıxarış üçün vakansiyanın ən azı 50 simvolunu əlavə edin');
  }
  let sourceUrl: string | null = null;
  if (options.sourceUrl?.trim()) {
    const checked = validateLinkedInJobUrl(options.sourceUrl);
    if (!checked.valid || !checked.normalizedUrl) throw new BadRequestException(checked.error ?? 'LinkedIn vakansiya keçidi düzgün deyil');
    sourceUrl = checked.normalizedUrl;
  }
  const lines = text.split('\n').filter(Boolean);
  const title = titleFromHeading(lines);
  const company = findLabel(lines, LABELS.company);
  const location = locationFromText(text, findLabel(lines, LABELS.location));
  const deadlineLine = findLabel(lines, LABELS.deadline);
  const deadline = deadlineLine ? parseDate(deadlineLine) : null;
  const email = extractApplicationEmail(text);
  const needsReview = [
    ...(!title ? ['title'] : []),
    ...(!company ? ['company'] : []),
    ...(!location ? ['location'] : []),
    ...(deadlineLine && !deadline ? ['deadline'] : []),
  ];
  return {
    title, company, description: text.slice(0, MAX_PASTED_JOB_TEXT_CHARS), location,
    sourceUrl, postedAt: null, capturedAt: (options.fetchedAt ?? new Date()).toISOString(), deadline,
    applicationEmail: email?.email ?? null, applicationEmailEvidence: email?.evidence ?? null,
    source: 'candidate-paste', needsReview,
  };
}
