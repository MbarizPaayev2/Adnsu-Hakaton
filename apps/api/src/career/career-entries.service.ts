import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CareerEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import type { CareerSuggestion } from '../resumes/cv-parser';
import { CAREER_PARSER_VERSION } from '../resumes/cv-parser';
import type { CreateCareerEntryDto, UpdateCareerEntryDto } from './career-entries.dto';

const fold = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').replace(/ə/g, 'e').replace(/\s+/g, ' ').trim();
const MAX_ENTRIES = 150;

/** What the API returns for one entry (everything the owner needs to review it; nothing about other users). */
export function present(e: CareerEntry) {
  return {
    id: e.id, kind: e.kind, status: e.status, origin: e.origin, title: e.title, organization: e.organization, role: e.role,
    startDate: e.startDate, endDate: e.endDate, current: e.current, issuedAt: e.issuedAt, datePrecision: e.datePrecision, level: e.level,
    description: e.description, result: e.result, situation: e.situation, action: e.action, url: e.url,
    alwaysInclude: e.alwaysInclude, sortOrder: e.sortOrder, confirmedAt: e.confirmedAt, editedAt: e.editedAt,
    // Where an extracted entry came from, so the candidate can compare it with the document.
    evidence: (e.sourceEvidence as { excerpt?: string; extractedAt?: string } | null)
      ? { excerpt: (e.sourceEvidence as any).excerpt ?? null, extractedAt: (e.sourceEvidence as any).extractedAt ?? null }
      : null,
  };
}

function checkDates(d: { startDate?: string | null; endDate?: string | null; current?: boolean }) {
  if (d.startDate && d.endDate && new Date(d.endDate) < new Date(d.startDate)) throw new BadRequestException('Bitmə tarixi başlama tarixindən əvvəl ola bilməz');
  if (d.current && d.endDate) throw new BadRequestException('Davam edən qeydin bitmə tarixi olmamalıdır');
}

const date = (v?: string | null) => (v ? new Date(v) : v === null ? null : undefined);

@Injectable()
export class CareerEntriesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, filter: { status?: string; kind?: string } = {}) {
    const rows = await this.prisma.careerEntry.findMany({
      where: { userId, ...(filter.status ? { status: filter.status as any } : {}), ...(filter.kind ? { kind: filter.kind as any } : {}) },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const all = filter.status || filter.kind ? await this.prisma.careerEntry.groupBy({ by: ['status'], where: { userId }, _count: true }) : null;
    const counts = { suggested: 0, confirmed: 0, hidden: 0 };
    const source = all ?? (await this.prisma.careerEntry.groupBy({ by: ['status'], where: { userId }, _count: true }));
    for (const g of source) counts[g.status.toLowerCase() as 'suggested' | 'confirmed' | 'hidden'] = g._count;
    return { entries: rows.map(present), counts };
  }

  private async owned(userId: string, id: string): Promise<CareerEntry> {
    // Another candidate's id is indistinguishable from a missing one.
    const row = await this.prisma.careerEntry.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Qeyd tapılmadı');
    return row;
  }

  async create(userId: string, dto: CreateCareerEntryDto) {
    checkDates(dto);
    if ((await this.prisma.careerEntry.count({ where: { userId } })) >= MAX_ENTRIES) throw new BadRequestException(`Ən çox ${MAX_ENTRIES} qeyd saxlamaq olar`);
    const existing = await this.prisma.careerEntry.findMany({ where: { userId, kind: dto.kind as any } });
    const twin = existing.find((e) => fold(e.title) === fold(dto.title) && fold(e.organization) === fold(dto.organization));
    if (twin) throw new ConflictException({ message: 'Bu qeyd artıq mövcuddur', existingId: twin.id, status: twin.status });
    const row = await this.prisma.careerEntry.create({
      data: {
        userId, kind: dto.kind as any, status: dto.status ?? 'CONFIRMED', origin: 'USER_ADDED', title: dto.title, organization: dto.organization ?? null, role: dto.role ?? null,
        startDate: date(dto.startDate) ?? null, endDate: date(dto.endDate) ?? null, current: !!dto.current, issuedAt: date(dto.issuedAt) ?? null, datePrecision: dto.datePrecision ?? 'MONTH',
        level: dto.level ?? null, description: dto.description ?? null, result: dto.result ?? null, situation: dto.situation ?? null, action: dto.action ?? null,
        url: dto.url ?? null, alwaysInclude: !!dto.alwaysInclude, sortOrder: dto.sortOrder ?? 0, confirmedAt: dto.status === 'SUGGESTED' ? null : new Date(),
      },
    });
    return present(row);
  }

  async update(userId: string, id: string, dto: UpdateCareerEntryDto) {
    const row = await this.owned(userId, id);
    checkDates({ startDate: dto.startDate !== undefined ? dto.startDate : row.startDate?.toISOString(), endDate: dto.endDate !== undefined ? dto.endDate : row.endDate?.toISOString(), current: dto.current ?? row.current });
    const data: Prisma.CareerEntryUpdateInput = { editedAt: new Date() };
    const copy = ['title', 'organization', 'role', 'level', 'description', 'result', 'situation', 'action', 'url', 'alwaysInclude', 'sortOrder', 'current', 'datePrecision'] as const;
    for (const key of copy) if (dto[key] !== undefined) (data as any)[key] = dto[key];
    for (const key of ['startDate', 'endDate', 'issuedAt'] as const) if (dto[key] !== undefined) (data as any)[key] = date(dto[key]);
    if (dto.current) data.endDate = null;
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'CONFIRMED') data.confirmedAt = row.confirmedAt ?? new Date();
    }
    return present(await this.prisma.careerEntry.update({ where: { id }, data }));
  }

  async confirm(userId: string, id: string) {
    const row = await this.owned(userId, id);
    return present(await this.prisma.careerEntry.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: row.confirmedAt ?? new Date() } }));
  }

  async hide(userId: string, id: string) {
    await this.owned(userId, id);
    return present(await this.prisma.careerEntry.update({ where: { id }, data: { status: 'HIDDEN' } }));
  }

  /** Back to the state it had before hiding: confirmed if it ever was, otherwise a suggestion again. */
  async restore(userId: string, id: string) {
    const row = await this.owned(userId, id);
    return present(await this.prisma.careerEntry.update({ where: { id }, data: { status: row.confirmedAt ? 'CONFIRMED' : 'SUGGESTED' } }));
  }

  /** Bulk review of extracted suggestions in one transaction: every id must be the caller's, or nothing changes. */
  async review(userId: string, body: { confirm?: string[]; hide?: string[] }) {
    const confirm = [...new Set(body.confirm ?? [])];
    const hide = [...new Set(body.hide ?? [])];
    if (confirm.some((id) => hide.includes(id))) throw new BadRequestException('Eyni qeyd həm təsdiqlənə, həm gizlədilə bilməz');
    const ids = [...confirm, ...hide];
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.careerEntry.findMany({ where: { userId, id: { in: ids } }, select: { id: true, confirmedAt: true } });
      if (owned.length !== ids.length) throw new NotFoundException('Qeyd tapılmadı');
      const now = new Date();
      for (const row of owned) {
        if (confirm.includes(row.id)) await tx.careerEntry.update({ where: { id: row.id }, data: { status: 'CONFIRMED', confirmedAt: row.confirmedAt ?? now } });
        else await tx.careerEntry.update({ where: { id: row.id }, data: { status: 'HIDDEN' } });
      }
    });
    return this.list(userId);
  }

  /**
   * Removing an entry the candidate wrote deletes it. Removing one that was extracted from a document hides it instead, so a later upload of the
   * same document does not suggest it again (and its source evidence is kept).
   */
  async remove(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.origin === 'EXTRACTED') {
      await this.prisma.careerEntry.update({ where: { id }, data: { status: 'HIDDEN' } });
      return { removed: false, hidden: true };
    }
    await this.prisma.careerEntry.delete({ where: { id } });
    return { removed: true, hidden: false };
  }

  /**
   * Stores suggestions read from an uploaded document. Idempotent: a suggestion that matches an existing entry (same kind, title and organisation,
   * whatever its status) is skipped, so re-uploading never duplicates, resurrects a hidden entry or touches a confirmed or corrected one.
   * On a parser upgrade, only untouched suggestions from this same CV may be refreshed; wrapped-line fragments are hidden as superseded.
   */
  async addSuggestionsFromUpload(userId: string, suggestions: CareerSuggestion[] | undefined, resumeId: string): Promise<{ created: number; skipped: number; limited: number }> {
    const list = (suggestions ?? []).filter((s) => s && s.title);
    if (!list.length) return { created: 0, skipped: 0, limited: 0 };
    const readExisting = () => this.prisma.careerEntry.findMany({ where: { userId }, select: { id: true, kind: true, title: true, organization: true, status: true, origin: true, editedAt: true, sourceEvidence: true } });
    let existing = await readExisting();
    const refresh = existing.flatMap((e) => {
      const source = e.sourceEvidence as { resumeId?: string; parserVersion?: number; excerpt?: string } | null;
      if (e.origin !== 'EXTRACTED' || e.status !== 'SUGGESTED' || e.editedAt || source?.resumeId !== resumeId ||
          !source.parserVersion || source.parserVersion >= CAREER_PARSER_VERSION ||
          !['PROJECT', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR'].includes(e.kind)) return [];
      const title = fold(e.title);
      const firstSourceLine = fold(source.excerpt?.split('\n')[0]);
      const replacement = list.find((s) => s.kind === e.kind && title.length >= 8 && firstSourceLine &&
        fold(s.evidence).includes(firstSourceLine) && fold(s.evidence).includes(title));
      return replacement ? [{ entry: e, replacement }] : [];
    });
    if (refresh.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const { entry: e, replacement: s } of refresh) {
          const sameHeader = fold(e.title) === fold(s.title) && fold(e.organization) === fold(s.organization);
          // Compare-and-set protects a candidate who edits/confirms/hides the entry while this upload is being parsed.
          await tx.careerEntry.updateMany({
            where: { id: e.id, userId, status: 'SUGGESTED', origin: 'EXTRACTED', editedAt: null },
            data: sameHeader ? {
              description: s.description, role: s.role,
              startDate: s.startDate ? new Date(s.startDate) : null, endDate: s.endDate ? new Date(s.endDate) : null,
              current: s.current, datePrecision: s.precision,
              sourceEvidence: { resumeId, excerpt: s.evidence.slice(0, 800), extractedAt: new Date().toISOString(), parserVersion: CAREER_PARSER_VERSION },
            } : {
              status: 'HIDDEN',
              sourceEvidence: { ...(e.sourceEvidence as Record<string, unknown>), supersededByParser: CAREER_PARSER_VERSION } as any,
            },
          });
        }
      });
      existing = await readExisting();
    }
    // User-hidden entries still suppress re-import. Only parser-superseded fragments cease to count as existing suggestions.
    const retained = existing.filter((e) => !(e.sourceEvidence as { supersededByParser?: number } | null)?.supersededByParser);
    const seen = new Set(retained.map((e) => `${e.kind}|${fold(e.title)}|${fold(e.organization)}`));
    // An entry the candidate retitled still came from the same lines: those lines must not be suggested again as a new entry.
    const seenEvidence = new Set(retained.map((e) => fold((e.sourceEvidence as { excerpt?: string } | null)?.excerpt)).filter(Boolean));
    let created = 0;
    // Suggestions that were new but did not fit under the entry limit: reported to the candidate, distinct from ones already known.
    let limited = 0;
    let room = MAX_ENTRIES - existing.length;
    for (const s of list) {
      const key = `${s.kind}|${fold(s.title)}|${fold(s.organization)}`;
      if (seen.has(key) || seenEvidence.has(fold(s.evidence.slice(0, 800)))) continue;
      if (room <= 0) { limited++; continue; }
      seen.add(key); seenEvidence.add(fold(s.evidence.slice(0, 800))); room--;
      await this.prisma.careerEntry.create({
        data: {
          userId, kind: s.kind as any, status: 'SUGGESTED', origin: 'EXTRACTED', title: s.title, organization: s.organization, role: s.role,
          startDate: s.startDate ? new Date(s.startDate) : null, endDate: s.endDate ? new Date(s.endDate) : null, current: s.current,
          issuedAt: s.issuedAt ? new Date(s.issuedAt) : null, datePrecision: s.precision, level: s.level, description: s.description,
          sourceEvidence: { resumeId, excerpt: s.evidence.slice(0, 800), extractedAt: new Date().toISOString(), parserVersion: CAREER_PARSER_VERSION } as any,
        },
      });
      created++;
    }
    return { created, skipped: list.length - created - limited, limited };
  }

  /** Confirmed entries only: what document generation may use. */
  confirmedFor(userId: string) {
    return this.prisma.careerEntry.findMany({ where: { userId, status: 'CONFIRMED' }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }
}
