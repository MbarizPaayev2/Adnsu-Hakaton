/**
 * Career evidence types and utilities for candidate profile, onboarding,
 * tailored resumes, and motivation letters.
 *
 * All evidence preserves provenance ('EXTRACTED' from CV or 'USER' added)
 * and confirmation status. Unconfirmed items show 'Təsdiq gözləyir'.
 */

export interface ProjectEvidence {
  id: string;
  name: string;
  period: string;
  description: string;
  source: 'EXTRACTED' | 'USER';
  confirmed: boolean;
}

export interface VolunteeringEvidence {
  id: string;
  organization: string;
  role: string;
  period: string;
  description: string;
  source: 'EXTRACTED' | 'USER';
  confirmed: boolean;
}

export interface CertificationEvidence {
  id: string;
  title: string;
  issuer: string;
  date: string;
  description?: string;
  source: 'EXTRACTED' | 'USER';
  confirmed: boolean;
}

export interface LanguageEvidence {
  id: string;
  language: string;
  level: string; // e.g., 'Ana dili', 'C1 - Sərbəst', 'B2 - Yaxşı', 'B1 - Orta'
  source: 'EXTRACTED' | 'USER';
  confirmed: boolean;
}

export interface AwardEvidence {
  id: string;
  title: string;
  issuer: string;
  date: string;
  description?: string;
  source: 'EXTRACTED' | 'USER';
  confirmed: boolean;
}

export interface CareerEvidenceState {
  projects: ProjectEvidence[];
  volunteering: VolunteeringEvidence[];
  certifications: CertificationEvidence[];
  languages: LanguageEvidence[];
  awards: AwardEvidence[];
  deletedEntryIds?: string[];
}

export const EMPTY_CAREER_EVIDENCE: CareerEvidenceState = {
  projects: [],
  volunteering: [],
  certifications: [],
  languages: [],
  awards: [],
  deletedEntryIds: [],
};

let nextIdCounter = 1;
export function generateEvidenceId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
}

export const EVIDENCE_SECTION_EXPLANATION =
  'Bu məlumatlar vakansiyaya uyğunlaşdırılmış CV və motivasiya məktubunda faktiki sübut kimi istifadə olunur.';

export interface BackendCareerEntry {
  id: string;
  kind: 'PROJECT' | 'VOLUNTEERING' | 'LEADERSHIP' | 'EXTRACURRICULAR' | 'CERTIFICATION' | 'LANGUAGE' | 'AWARD' | 'STORY' | 'OTHER';
  status: 'SUGGESTED' | 'CONFIRMED' | 'HIDDEN';
  origin: 'EXTRACTED' | 'USER_ADDED';
  title: string;
  organization?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  current?: boolean;
  datePrecision?: 'YEAR' | 'MONTH';
  issuedAt?: string | null;
  level?: string | null;
  description?: string | null;
  result?: string | null;
  situation?: string | null;
  action?: string | null;
  url?: string | null;
  alwaysInclude?: boolean;
  sortOrder?: number;
  confirmedAt?: string | null;
  editedAt?: string | null;
  evidence?: { excerpt?: string; extractedAt?: string } | null;
}

export function formatPeriod(
  startDate?: string | null,
  endDate?: string | null,
  current?: boolean,
  precision?: 'YEAR' | 'MONTH',
): string {
  if (!startDate) return '';
  const startStr = precision === 'YEAR' ? startDate.slice(0, 4) : startDate.slice(0, 7);
  if (current) return `${startStr} - Davam edir`;
  if (!endDate) return startStr;
  const endStr = precision === 'YEAR' ? endDate.slice(0, 4) : endDate.slice(0, 7);
  return `${startStr} - ${endStr}`;
}

export function formatSingleDate(date?: string | null, precision?: 'YEAR' | 'MONTH'): string {
  if (!date) return '';
  return precision === 'YEAR' ? date.slice(0, 4) : date.slice(0, 7);
}

export interface ParsedPeriod {
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  datePrecision: 'YEAR' | 'MONTH';
}

const PERIOD_HINT = 'Dövr formatı: 2022, 2022 - 2024, 2022-05 - 2023-01 və ya 2023 - indiki';

/** One date token: "2022" (year) or a month ("2022-05", "05/2022", "2022.05"); an exact day is kept as given. */
function parseDateToken(tok: string): { iso: string; precision: 'YEAR' | 'MONTH' } | null {
  const t = tok.trim();
  if (!t) return null;
  if (/^\d{4}$/.test(t)) return { iso: `${t}-01-01`, precision: 'YEAR' };
  const ym = t.match(/^(\d{4})[-./](\d{1,2})$/);
  if (ym && +ym[2] >= 1 && +ym[2] <= 12) return { iso: `${ym[1]}-${ym[2].padStart(2, '0')}-01`, precision: 'MONTH' };
  const my = t.match(/^(\d{1,2})[-./](\d{4})$/);
  if (my && +my[1] >= 1 && +my[1] <= 12) return { iso: `${my[2]}-${my[1].padStart(2, '0')}-01`, precision: 'MONTH' };
  const iso = t.match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (iso && +iso[2] >= 1 && +iso[2] <= 12 && +iso[3] >= 1 && +iso[3] <= 31) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, precision: 'MONTH' };
  return null;
}

/** Splits "start - end" without cutting inside a date: a hyphen separates only when it has spaces around it, is an en/em dash, or joins two bare years. */
function splitRange(text: string): string[] {
  if (/^\d{4}\s*-\s*\d{4}$/.test(text)) return text.split('-').map((x) => x.trim());
  return text.split(/\s+[-–—]\s+|\s*[–—]\s*/).map((x) => x.trim());
}

export type PeriodResult = { ok: true; value: ParsedPeriod | null } | { ok: false; error: string };

/**
 * Reads what the candidate typed. Empty means "no period". Anything it cannot read exactly is an ERROR, never a silent guess: a period that
 * cannot be read must not be saved as if it had been, and a year-only start must never become a month because the end names one (the server keeps
 * one precision per entry, so mixed precision is refused rather than invented).
 */
export function parsePeriodStrict(periodStr?: string | null): PeriodResult {
  if (!periodStr || !periodStr.trim()) return { ok: true, value: null };
  const p = periodStr.trim();
  const isCurrent = /davam\s*edir|haz[ıi]rda|indiki|indi|present|current/i.test(p);
  const parts = splitRange(p.replace(/\s*(davam\s*edir|haz[ıi]rda|indiki|indi|present|current)\s*$/i, ' ').trim().replace(/[-–—]\s*$/, '').trim());
  if (parts.length > 2) return { ok: false, error: PERIOD_HINT };
  const start = parseDateToken(parts[0] || '');
  if (!start) return { ok: false, error: PERIOD_HINT };
  if (isCurrent) {
    if (parts.length > 1 && parts[1]) return { ok: false, error: PERIOD_HINT };
    return { ok: true, value: { startDate: start.iso, endDate: null, current: true, datePrecision: start.precision } };
  }
  if (parts.length === 1) return { ok: true, value: { startDate: start.iso, endDate: null, current: false, datePrecision: start.precision } };
  const end = parseDateToken(parts[1] || '');
  if (!end) return { ok: false, error: PERIOD_HINT };
  if (end.iso < start.iso) return { ok: false, error: 'Bitmə tarixi başlanğıc tarixindən əvvəl ola bilməz' };
  if (start.precision !== end.precision) return { ok: false, error: 'Başlanğıc və bitmə tarixi eyni dəqiqlikdə olmalıdır: ikisi də il (2022 - 2024) və ya ikisi də ay (2022-05 - 2024-01)' };
  return { ok: true, value: { startDate: start.iso, endDate: end.iso, current: false, datePrecision: start.precision } };
}

/** Lenient form kept for callers that only want a value: null when the text cannot be read. */
export function parsePeriod(periodStr?: string | null): ParsedPeriod | null {
  const r = parsePeriodStrict(periodStr);
  return r.ok ? r.value : null;
}

export function parseSingleDate(dateStr?: string | null): {
  issuedAt: string | null;
  datePrecision: 'YEAR' | 'MONTH';
} | null {
  if (!dateStr || !dateStr.trim()) return null;
  const t = parseDateToken(dateStr);
  return t ? { issuedAt: t.iso, datePrecision: t.precision } : null;
}

export function careerEntriesToEvidenceState(entries: BackendCareerEntry[]): CareerEvidenceState {
  const visible = (entries || []).filter((e) => e.status !== 'HIDDEN');

  const projects: ProjectEvidence[] = [];
  const volunteering: VolunteeringEvidence[] = [];
  const certifications: CertificationEvidence[] = [];
  const languages: LanguageEvidence[] = [];
  const awards: AwardEvidence[] = [];

  for (const e of visible) {
    if (e.kind === 'PROJECT') {
      projects.push({
        id: e.id,
        name: e.title,
        period: formatPeriod(e.startDate, e.endDate, e.current, e.datePrecision),
        description: e.description || e.result || '',
        source: e.origin === 'USER_ADDED' ? 'USER' : 'EXTRACTED',
        confirmed: e.status === 'CONFIRMED',
      });
    } else if (e.kind === 'VOLUNTEERING' || e.kind === 'LEADERSHIP' || e.kind === 'EXTRACURRICULAR') {
      volunteering.push({
        id: e.id,
        organization: e.organization || '',
        role: e.role || e.title,
        period: formatPeriod(e.startDate, e.endDate, e.current, e.datePrecision),
        description: e.description || '',
        source: e.origin === 'USER_ADDED' ? 'USER' : 'EXTRACTED',
        confirmed: e.status === 'CONFIRMED',
      });
    } else if (e.kind === 'CERTIFICATION') {
      certifications.push({
        id: e.id,
        title: e.title,
        issuer: e.organization || '',
        date: formatSingleDate(e.issuedAt, e.datePrecision),
        description: e.description || undefined,
        source: e.origin === 'USER_ADDED' ? 'USER' : 'EXTRACTED',
        confirmed: e.status === 'CONFIRMED',
      });
    } else if (e.kind === 'LANGUAGE') {
      languages.push({
        id: e.id,
        language: e.title,
        level: e.level || '', // Unknown stays unknown / empty
        source: e.origin === 'USER_ADDED' ? 'USER' : 'EXTRACTED',
        confirmed: e.status === 'CONFIRMED',
      });
    } else if (e.kind === 'AWARD') {
      awards.push({
        id: e.id,
        title: e.title,
        issuer: e.organization || '',
        date: formatSingleDate(e.issuedAt, e.datePrecision),
        description: e.description || undefined,
        source: e.origin === 'USER_ADDED' ? 'USER' : 'EXTRACTED',
        confirmed: e.status === 'CONFIRMED',
      });
    }
  }

  return { projects, volunteering, certifications, languages, awards, deletedEntryIds: [] };
}

/**
 * Normalizes raw items extracted from resume parsedContent or profile data.
 * Extracted items default to confirmed: false unless explicitly marked confirmed.
 * Unknown language level remains empty string (never invented).
 */
export function normalizeExtractedEvidence(
  raw: any,
): CareerEvidenceState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CAREER_EVIDENCE };

  const rawProjects = Array.isArray(raw.projects) ? (raw.projects as Record<string, unknown>[]) : [];
  const projects: ProjectEvidence[] = rawProjects.map((p) => ({
    id: (p.id as string) || generateEvidenceId('proj'),
    name: (p.name as string) || (p.title as string) || '',
    period: (p.period as string) || '',
    description: (p.description as string) || '',
    source: (p.source as 'EXTRACTED' | 'USER') || 'EXTRACTED',
    confirmed: typeof p.confirmed === 'boolean' ? p.confirmed : false,
  }));

  const rawVolunteering = Array.isArray(raw.volunteering)
    ? (raw.volunteering as Record<string, unknown>[])
    : [];
  const volunteering: VolunteeringEvidence[] = rawVolunteering.map((v) => ({
    id: (v.id as string) || generateEvidenceId('vol'),
    organization: (v.organization as string) || (v.company as string) || '',
    role: (v.role as string) || (v.title as string) || '',
    period: (v.period as string) || '',
    description: (v.description as string) || '',
    source: (v.source as 'EXTRACTED' | 'USER') || 'EXTRACTED',
    confirmed: typeof v.confirmed === 'boolean' ? v.confirmed : false,
  }));

  const rawCerts = Array.isArray(raw.certifications)
    ? (raw.certifications as Record<string, unknown>[])
    : [];
  const certifications: CertificationEvidence[] = rawCerts.map((c) => ({
    id: (c.id as string) || generateEvidenceId('cert'),
    title: (c.title as string) || (c.name as string) || '',
    issuer: (c.issuer as string) || '',
    date: (c.date as string) || '',
    description: (c.description as string) || '',
    source: (c.source as 'EXTRACTED' | 'USER') || 'EXTRACTED',
    confirmed: typeof c.confirmed === 'boolean' ? c.confirmed : false,
  }));

  const rawLangs = Array.isArray(raw.languages) ? raw.languages : [];
  const languages: LanguageEvidence[] = rawLangs.map((l: any) => {
    if (typeof l === 'string') {
      return {
        id: generateEvidenceId('lang'),
        language: l,
        level: '', // Unknown stays unknown
        source: 'EXTRACTED',
        confirmed: false,
      };
    }
    const item = (l ?? {}) as Record<string, unknown>;
    return {
      id: (item.id as string) || generateEvidenceId('lang'),
      language: (item.language as string) || (item.name as string) || '',
      level: (item.level as string) || (item.fluency as string) || '', // Unknown stays unknown
      source: (item.source as 'EXTRACTED' | 'USER') || 'EXTRACTED',
      confirmed: typeof item.confirmed === 'boolean' ? item.confirmed : false,
    };
  });

  const rawAwards = Array.isArray(raw.awards) ? (raw.awards as Record<string, unknown>[]) : [];
  const awards: AwardEvidence[] = rawAwards.map((a) => ({
    id: (a.id as string) || generateEvidenceId('award'),
    title: (a.title as string) || (a.name as string) || '',
    issuer: (a.issuer as string) || '',
    date: (a.date as string) || '',
    description: (a.description as string) || '',
    source: (a.source as 'EXTRACTED' | 'USER') || 'EXTRACTED',
    confirmed: typeof a.confirmed === 'boolean' ? a.confirmed : false,
  }));

  return { projects, volunteering, certifications, languages, awards };
}

/**
 * Persists career evidence changes to Claude's validated backend contract at /profile/career-entries.
 * Syncs additions, updates, confirmations, and deletions.
 * Throws on any error so caller never claims "saved" on failure.
 */
const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ə/g, 'e')
    .replace(/\s+/g, ' ')
    .trim();

/** Date fields for an edited period; a period that cannot be read stops the save with a message naming the entry. */
function periodFields(text: string, label: string): ParsedPeriod {
  const r = parsePeriodStrict(text);
  if (!r.ok) throw new Error(`${label}: ${r.error}`);
  return r.value ?? { startDate: null, endDate: null, current: false, datePrecision: 'YEAR' };
}

function singleDateFields(text: string, label: string): { issuedAt: string | null; datePrecision: 'YEAR' | 'MONTH' } {
  if (!text.trim()) return { issuedAt: null, datePrecision: 'YEAR' };
  const parsed = parseSingleDate(text);
  if (!parsed) throw new Error(`${label}: tarix formatı 2022 və ya 2022-05 olmalıdır`);
  return parsed;
}

/**
 * Persists career evidence changes to Claude's validated backend contract at /profile/career-entries.
 * Syncs additions, updates, confirmations, and deletions.
 * - Preserves undisplayed entries (STORY, OTHER, unmapped kinds).
 * - Deletes ONLY entries explicitly removed by the user in deletedEntryIds.
 * - Preserves dates, date precision, original kind and other fields outside the editor's scope.
 * - Sends edited project/activity periods and certificate/award dates through supported fields.
 * - Checks every PATCH response, including the conflict-resolution branch.
 * - Reconciles partial-save retries safely without duplicating or deleting entries.
 * - Throws on any error so caller never claims "saved" on failure.
 */
export async function syncCareerEntriesToBackend(
  current: CareerEvidenceState,
  existingEntries: BackendCareerEntry[],
  apiFetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<BackendCareerEntry[]> {
  const existingMap = new Map<string, BackendCareerEntry>(existingEntries.map((e) => [e.id, e]));
  const currentItemIds = new Set<string>();

  const findTwin = (kind: string, title: string, org?: string | null) => {
    return existingEntries.find(
      (e) =>
        e.kind === kind &&
        fold(e.title) === fold(title) &&
        fold(e.organization) === fold(org)
    );
  };

  interface ItemProcessor {
    item: any;
    defaultKind: BackendCareerEntry['kind'];
    toPayload: (existing?: BackendCareerEntry) => {
      kind: BackendCareerEntry['kind'];
      title: string;
      organization?: string | null;
      role?: string | null;
      level?: string | null;
      description?: string | null;
      situation?: string | null;
      action?: string | null;
      result?: string | null;
      url?: string | null;
      alwaysInclude?: boolean;
      sortOrder?: number;
      status: 'CONFIRMED' | 'SUGGESTED';
      startDate?: string | null;
      endDate?: string | null;
      current?: boolean;
      datePrecision?: 'YEAR' | 'MONTH';
      issuedAt?: string | null;
    };
  }

  const toProcess: ItemProcessor[] = [
    ...current.projects.map((p) => ({
      item: p,
      defaultKind: 'PROJECT' as const,
      toPayload: (existing?: BackendCareerEntry) => {
        let dateFields = {
          startDate: existing?.startDate ?? null,
          endDate: existing?.endDate ?? null,
          current: existing?.current ?? false,
          datePrecision: existing?.datePrecision ?? 'YEAR',
        };
        const currentPeriodStr = formatPeriod(existing?.startDate, existing?.endDate, existing?.current, existing?.datePrecision);
        if (p.period !== undefined && p.period !== currentPeriodStr) dateFields = periodFields(p.period, `Layihə "${p.name}"`);
        return {
          kind: existing?.kind || ('PROJECT' as const),
          title: (p.name || '').trim(),
          organization: existing?.organization ?? null,
          role: existing?.role ?? null,
          level: existing?.level ?? null,
          situation: existing?.situation ?? null,
          action: existing?.action ?? null,
          result: existing?.result ?? null,
          url: existing?.url ?? null,
          alwaysInclude: existing?.alwaysInclude ?? false,
          sortOrder: existing?.sortOrder ?? 0,
          description: (p.description || '').trim() || null,
          status: (p.confirmed ? 'CONFIRMED' : 'SUGGESTED') as 'CONFIRMED' | 'SUGGESTED',
          ...dateFields,
        };
      },
    })),
    ...current.volunteering.map((v) => ({
      item: v,
      defaultKind: 'VOLUNTEERING' as const,
      toPayload: (existing?: BackendCareerEntry) => {
        let dateFields = {
          startDate: existing?.startDate ?? null,
          endDate: existing?.endDate ?? null,
          current: existing?.current ?? false,
          datePrecision: existing?.datePrecision ?? 'YEAR',
        };
        const currentPeriodStr = formatPeriod(existing?.startDate, existing?.endDate, existing?.current, existing?.datePrecision);
        if (v.period !== undefined && v.period !== currentPeriodStr) dateFields = periodFields(v.period, `Fəaliyyət "${v.role || v.organization}"`);
        // Preserve original kind (VOLUNTEERING, LEADERSHIP, or EXTRACURRICULAR)
        const kind = existing?.kind || ('VOLUNTEERING' as const);
        return {
          kind,
          title: (v.role || v.organization || 'Könüllü').trim(),
          role: (v.role || '').trim() || null,
          organization: (v.organization || '').trim() || null,
          level: existing?.level ?? null,
          situation: existing?.situation ?? null,
          action: existing?.action ?? null,
          result: existing?.result ?? null,
          url: existing?.url ?? null,
          alwaysInclude: existing?.alwaysInclude ?? false,
          sortOrder: existing?.sortOrder ?? 0,
          description: (v.description || '').trim() || null,
          status: (v.confirmed ? 'CONFIRMED' : 'SUGGESTED') as 'CONFIRMED' | 'SUGGESTED',
          ...dateFields,
        };
      },
    })),
    ...current.certifications.map((c) => ({
      item: c,
      defaultKind: 'CERTIFICATION' as const,
      toPayload: (existing?: BackendCareerEntry) => {
        let dateFields = {
          issuedAt: existing?.issuedAt ?? null,
          datePrecision: existing?.datePrecision ?? 'YEAR',
        };
        const currentDateStr = formatSingleDate(existing?.issuedAt, existing?.datePrecision);
        if (c.date !== undefined && c.date !== currentDateStr) dateFields = singleDateFields(c.date, `Sertifikat "${c.title}"`);
        return {
          kind: existing?.kind || ('CERTIFICATION' as const),
          title: (c.title || '').trim(),
          organization: (c.issuer || '').trim() || null,
          role: existing?.role ?? null,
          level: existing?.level ?? null,
          situation: existing?.situation ?? null,
          action: existing?.action ?? null,
          result: existing?.result ?? null,
          url: existing?.url ?? null,
          alwaysInclude: existing?.alwaysInclude ?? false,
          sortOrder: existing?.sortOrder ?? 0,
          description: (c.description || '').trim() || null,
          status: (c.confirmed ? 'CONFIRMED' : 'SUGGESTED') as 'CONFIRMED' | 'SUGGESTED',
          ...dateFields,
        };
      },
    })),
    ...current.languages.map((l) => ({
      item: l,
      defaultKind: 'LANGUAGE' as const,
      toPayload: (existing?: BackendCareerEntry) => ({
        kind: existing?.kind || ('LANGUAGE' as const),
        title: (l.language || '').trim(),
        organization: existing?.organization ?? null,
        role: existing?.role ?? null,
        level: (l.level || '').trim() || null,
        situation: existing?.situation ?? null,
        action: existing?.action ?? null,
        result: existing?.result ?? null,
        url: existing?.url ?? null,
        alwaysInclude: existing?.alwaysInclude ?? false,
        sortOrder: existing?.sortOrder ?? 0,
        description: existing?.description ?? null,
        status: (l.confirmed ? 'CONFIRMED' : 'SUGGESTED') as 'CONFIRMED' | 'SUGGESTED',
        startDate: existing?.startDate ?? null,
        endDate: existing?.endDate ?? null,
        current: existing?.current ?? false,
        datePrecision: existing?.datePrecision ?? 'YEAR',
        issuedAt: existing?.issuedAt ?? null,
      }),
    })),
    ...current.awards.map((a) => ({
      item: a,
      defaultKind: 'AWARD' as const,
      toPayload: (existing?: BackendCareerEntry) => {
        let dateFields = {
          issuedAt: existing?.issuedAt ?? null,
          datePrecision: existing?.datePrecision ?? 'YEAR',
        };
        const currentDateStr = formatSingleDate(existing?.issuedAt, existing?.datePrecision);
        if (a.date !== undefined && a.date !== currentDateStr) dateFields = singleDateFields(a.date, `Mükafat "${a.title}"`);
        return {
          kind: existing?.kind || ('AWARD' as const),
          title: (a.title || '').trim(),
          organization: (a.issuer || '').trim() || null,
          role: existing?.role ?? null,
          level: existing?.level ?? null,
          situation: existing?.situation ?? null,
          action: existing?.action ?? null,
          result: existing?.result ?? null,
          url: existing?.url ?? null,
          alwaysInclude: existing?.alwaysInclude ?? false,
          sortOrder: existing?.sortOrder ?? 0,
          description: (a.description || '').trim() || null,
          status: (a.confirmed ? 'CONFIRMED' : 'SUGGESTED') as 'CONFIRMED' | 'SUGGESTED',
          ...dateFields,
        };
      },
    })),
  ];

  // Validate everything the candidate typed BEFORE the first request, so an unreadable period or date never leaves a half-saved profile behind.
  for (const { item, defaultKind, toPayload } of toProcess) {
    toPayload(existingMap.get(item.id) ?? findTwin(defaultKind, item.name || item.title || item.language || item.role, item.issuer || item.organization));
  }

  for (const { item, defaultKind, toPayload } of toProcess) {
    let existing = existingMap.get(item.id);
    let targetId = item.id;

    // Partial save / retry reconciliation: if item.id is temporary, check for matching twin
    if (!existing) {
      const twin = findTwin(defaultKind, item.name || item.title || item.language || item.role, item.issuer || item.organization);
      if (twin) {
        existing = twin;
        targetId = twin.id;
        item.id = twin.id;
      }
    }

    const payload = toPayload(existing);
    if (!payload.title) continue;

    if (existing) {
      currentItemIds.add(targetId);
      const needsUpdate =
        existing.title !== payload.title ||
        (existing.organization ?? null) !== (payload.organization ?? null) ||
        (existing.role ?? null) !== (payload.role ?? null) ||
        (existing.level ?? null) !== (payload.level ?? null) ||
        (existing.description ?? null) !== (payload.description ?? null) ||
        existing.status !== payload.status ||
        (existing.startDate ? existing.startDate.slice(0, 10) : null) !== (payload.startDate ? payload.startDate.slice(0, 10) : null) ||
        (existing.endDate ? existing.endDate.slice(0, 10) : null) !== (payload.endDate ? payload.endDate.slice(0, 10) : null) ||
        Boolean(existing.current) !== Boolean(payload.current) ||
        (existing.issuedAt ? existing.issuedAt.slice(0, 10) : null) !== (payload.issuedAt ? payload.issuedAt.slice(0, 10) : null) ||
        (existing.datePrecision ?? 'YEAR') !== (payload.datePrecision ?? 'YEAR');

      if (needsUpdate) {
        const res = await apiFetchFn(`/profile/career-entries/${targetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Qeyd yenilənmədi: ${payload.title}`);
        }
      }
    } else {
      // New entry -> POST
      const res = await apiFetchFn('/profile/career-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 409) {
          const conflictData = await res.json().catch(() => ({}));
          if (conflictData.existingId) {
            currentItemIds.add(conflictData.existingId);
            item.id = conflictData.existingId;
            const patchRes = await apiFetchFn(`/profile/career-entries/${conflictData.existingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!patchRes.ok) {
              const pErr = await patchRes.json().catch(() => ({}));
              throw new Error(pErr.message || `Qeyd yenilənmədi: ${payload.title}`);
            }
            continue;
          }
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Qeyd yaradılmadı: ${payload.title}`);
      }
      const created = await res.json();
      if (created?.id) {
        currentItemIds.add(created.id);
        item.id = created.id;
      }
    }
  }

  // Deletions: ONLY delete entries that were explicitly removed by the user in deletedEntryIds!
  // Undisplayed kinds (STORY, OTHER, unmapped entries) are NEVER deleted.
  const explicitDeletions = new Set(current.deletedEntryIds || []);
  for (const delId of explicitDeletions) {
    if (existingMap.has(delId)) {
      const existing = existingMap.get(delId)!;
      const res = await apiFetchFn(`/profile/career-entries/${existing.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Qeyd silinmədi: ${existing.title}`);
      }
    }
  }

  // Refetch fresh entries from backend
  const refreshRes = await apiFetchFn('/profile/career-entries');
  if (!refreshRes.ok) throw new Error('Yenilənmiş qeydlər alına bilmədi');
  const freshData = await refreshRes.json();
  return (freshData.entries || []) as BackendCareerEntry[];
}

