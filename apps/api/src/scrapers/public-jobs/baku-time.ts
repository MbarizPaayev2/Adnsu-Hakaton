/**
 * Source dates are calendar dates (or zone-less local times) in Azerbaijan, which is UTC+4 all year (no DST). Converting them without naming the zone
 * silently depends on the machine's own timezone, and a date-only DEADLINE read as UTC midnight closes a posting four hours into its own last day.
 *
 * - a date-only start (publication date) is the start of that day in Baku;
 * - a date-only deadline is the END of that day in Baku (the posting is open for the whole stated day);
 * - a zone-less date-time is Baku local time; an explicit zone or Z is respected;
 * - anything that is not a real calendar date is `undefined` (unknown stays unknown, never guessed).
 */
const BAKU_OFFSET_HOURS = 4;

export function bakuInstant(text: string | null | undefined, edge: 'start' | 'end' = 'start'): string | undefined {
  const cleaned = String(text ?? '').replace(/[\s﻿]+/g, ' ').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(cleaned);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined; // 2026-02-30 etc.
  if (m[4] === undefined) {
    const ms = edge === 'end' ? Date.UTC(year, month - 1, day, 23 - BAKU_OFFSET_HOURS, 59, 59, 999) : Date.UTC(year, month - 1, day, -BAKU_OFFSET_HOURS, 0, 0, 0);
    return new Date(ms).toISOString();
  }
  const [h, min, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || min > 59 || sec > 59) return undefined;
  const zone = m[7];
  let offsetMinutes = BAKU_OFFSET_HOURS * 60;
  if (zone === 'Z') offsetMinutes = 0;
  else if (zone) { const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!; offsetMinutes = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])); }
  return new Date(Date.UTC(year, month - 1, day, h, min, sec) - offsetMinutes * 60_000).toISOString();
}

const AZ_MONTHS: Record<string, number> = { yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avqust: 8, sentyabr: 9, oktyabr: 10, noyabr: 11, dekabr: 12 };

export function azMonthNumber(name: string): number | undefined {
  const key = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/ə/g, 'e');
  return AZ_MONTHS[key];
}

const bakuYmd = (now: Date) => { const t = new Date(now.getTime() + BAKU_OFFSET_HOURS * 3_600_000); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * "3 Oktyabr" (no year) shown for a PUBLICATION date: the most recent such date that is not after today in Baku (a posting cannot be published in the
 * future). Returns undefined for an impossible day/month or for a date that would be more than a year old (not "recent" evidence).
 */
export function inferPublishedFromDayMonth(day: number, month: number, now: Date): string | undefined {
  const today = bakuYmd(now);
  for (const year of [today.y, today.y - 1]) {
    const candidate = bakuInstant(iso(year, month, day), 'start');
    if (!candidate) continue;
    if (new Date(candidate).getTime() <= now.getTime() + 24 * 3_600_000 - 1) {
      return now.getTime() - new Date(candidate).getTime() <= 366 * 86_400_000 ? candidate : undefined;
    }
  }
  return undefined;
}

/** "3 Noyabr" (no year) shown for a DEADLINE: the first such date on or after the publication date's day; end of that day in Baku. */
export function inferDeadlineFromDayMonth(day: number, month: number, publishedIso: string): string | undefined {
  const pub = bakuYmd(new Date(publishedIso));
  for (const year of [pub.y, pub.y + 1]) {
    const candidate = bakuInstant(iso(year, month, day), 'end');
    if (candidate && new Date(candidate).getTime() >= new Date(publishedIso).getTime()) return candidate;
  }
  return undefined;
}
