import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { TimelineService } from './timeline.service';

export const TRACKER_STAGES = [
  'PLANNED',
  'APPLIED',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export const ACTIVE_TRACKER_STAGES = [
  'PLANNED',
  'APPLIED',
  'INTERVIEW',
  'OFFER',
] as const;

export const CLOSED_TRACKER_STAGES = [
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
type Fields = {
  title?: string;
  company?: string;
  url?: string;
  date?: string;
  stage?: string;
  notes?: string;
  custom?: Record<string, string>;
};
export interface TrackerColumn {
  id: string;
  name: string;
  hidden?: boolean;
}
export interface TrackerRow {
  key: string;
  title: string;
  company: string;
  url: string;
  date: string;
  stage: string;
  notes: string;
  custom: Record<string, string>;
  source: string;
  evidence: string;
  hidden: boolean;
}
const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const own = (x: object, k: string) =>
  Object.prototype.hasOwnProperty.call(x, k);
const keyOk = (k: string) =>
  /^(manual|email|native|external|browser|reported):[a-zA-Z0-9-]{1,100}$/.test(
    k,
  );

export function trackerColumns(input: unknown): TrackerColumn[] {
  if (!Array.isArray(input) || input.length > 20)
    throw new BadRequestException('Sütunların sayı ən çox 20 ola bilər.');
  const ids = new Set<string>();
  return input.map((c) => {
    if (
      !isObject(c) ||
      typeof c.id !== 'string' ||
      !/^c_[a-zA-Z0-9_-]{1,50}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      c.name.length > 60 ||
      (c.hidden !== undefined && typeof c.hidden !== 'boolean')
    )
      throw new BadRequestException('Sütun məlumatları yanlışdır.');
    ids.add(c.id);
    return { id: c.id, name: c.name.trim(), hidden: c.hidden === true };
  });
}
export function trackerFields(
  input: unknown,
  columns: TrackerColumn[],
): Fields {
  if (!isObject(input))
    throw new BadRequestException('Sətir məlumatları yanlışdır.');
  const out: Fields = {};
  for (const [key, max] of [
    ['title', 300],
    ['company', 300],
    ['url', 2000],
    ['date', 10],
    ['stage', 20],
    ['notes', 5000],
  ] as const) {
    if (!own(input, key)) continue;
    const v = input[key];
    if (typeof v !== 'string' || v.length > max || v.includes('\0'))
      throw new BadRequestException('Sətir məlumatları yanlışdır.');
    out[key] = v.trim();
  }
  if (out.stage && !TRACKER_STAGES.includes(out.stage as any))
    throw new BadRequestException('Mərhələ yanlışdır.');
  if (
    out.date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) ||
      !Number.isFinite(Date.parse(out.date)) ||
      new Date(out.date).toISOString().slice(0, 10) !== out.date)
  )
    throw new BadRequestException('Tarix yanlışdır.');
  if (out.url) {
    try {
      const u = new URL(out.url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw new Error();
    } catch {
      throw new BadRequestException('Yalnız http/https keçidi istifadə edin.');
    }
  }
  if (own(input, 'custom')) {
    if (!isObject(input.custom) || Object.keys(input.custom).length > 20)
      throw new BadRequestException('Əlavə sahələr yanlışdır.');
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.custom)) {
      if (
        !columns.some((c) => c.id === k) ||
        typeof v !== 'string' ||
        v.length > 2000
      )
        throw new BadRequestException('Əlavə sahələr yanlışdır.');
      custom[k] = v;
    }
    out.custom = custom;
  }
  return out;
}
export const csvCell = (v: unknown) =>
  '"' +
  String(v ?? '')
    .replace(/^[\s\u0000-\u001f]*[=+@-]/, "'$&")
    .replace(/"/g, '""') +
  '"';

@Injectable()
export class TrackerService {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  async all(userId: string) {
    // No per-channel 200-row truncation: the tracker represents the whole application history.
    const [timeline, records, settings, reported] = await Promise.all([
      this.timeline.timeline(userId, new Date(), null),
      this.prisma.applicationTrackerRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.applicationTrackerSettings.findUnique({ where: { userId } }),
      this.prisma.match.findMany({
        where: {
          userId,
          status: 'APPLIED',
          externalApplications: { none: {} },
          OR: [
            {
              job: {
                emailApplications: { none: { userId } },
                agentApplications: { none: { userId } },
              },
            },
            { vacancy: { applications: { none: { userId } } } },
          ],
        },
        include: {
          job: { select: { title: true, company: true, url: true } },
          vacancy: {
            select: { title: true, company: { select: { name: true } } },
          },
        },
      }),
    ]);
    const columns = trackerColumns(settings?.columns ?? []);
    const rows = new Map<string, TrackerRow>();
    for (const e of timeline) {
      const stage = ['INTERVIEW', 'OFFER', 'HIRED'].includes(e.current)
        ? e.current
        : ['REJECTED', 'WITHDRAWN'].includes(e.problem?.key ?? '')
          ? e.problem!.key
          : [
                'PROVIDER_ACCEPTED',
                'DELIVERED',
                'REPLY_RECEIVED',
                'IN_REVIEW',
              ].includes(e.current) && !e.dryRun
            ? 'APPLIED'
            : 'PLANNED';
      rows.set(e.id, {
        key: e.id,
        title: e.title,
        company: e.company,
        url: '',
        date: e.createdAt.toISOString().slice(0, 10),
        stage,
        notes: '',
        custom: {},
        source: e.channel,
        evidence: e.dryRun ? 'DRY_RUN' : (e.problem?.key ?? e.current),
        hidden: false,
      });
    }
    for (const m of reported) {
      rows.set(`reported:${m.id}`, {
        key: `reported:${m.id}`,
        title: m.job?.title ?? m.vacancy?.title ?? 'Vakansiya',
        company: m.job?.company ?? m.vacancy?.company.name ?? '',
        url: m.job?.url ?? '',
        date: '',
        stage: 'APPLIED',
        notes: '',
        custom: {},
        source: 'reported',
        evidence: 'CANDIDATE_REPORTED',
        hidden: false,
      });
    }
    for (const r of records) {
      const base = rows.get(r.sourceKey);
      // An override is not proof that a deleted system application still exists.
      if (!base && !r.sourceKey.startsWith('manual:')) continue;
      rows.set(r.sourceKey, {
        key: r.sourceKey,
        title: '',
        company: '',
        url: '',
        date: r.createdAt.toISOString().slice(0, 10),
        stage: 'PLANNED',
        notes: '',
        custom: {},
        source: 'manual',
        evidence: 'CANDIDATE_REPORTED',
        ...base,
        ...(r.fields as Fields),
        hidden: r.hidden,
      });
    }
    return { columns, rows: [...rows.values()] };
  }

  async list(
    userId: string,
    query: {
      q?: string;
      stage?: string;
      group?: string;
      page?: string;
      hidden?: string;
    },
  ) {
    const data = await this.all(userId);
    const q = (typeof query.q === 'string' ? query.q : '')
      .slice(0, 200)
      .toLocaleLowerCase('az');
    const group = (typeof query.group === 'string' ? query.group : '')
      .trim()
      .toLowerCase();
    const groupStages: readonly string[] | null =
      group === 'active'
        ? ACTIVE_TRACKER_STAGES
        : group === 'closed'
          ? CLOSED_TRACKER_STAGES
          : null;

    const rows = data.rows.filter(
      (r) =>
        (query.hidden === 'true' || !r.hidden) &&
        (!groupStages || groupStages.includes(r.stage)) &&
        (!query.stage || r.stage === query.stage) &&
        (!q ||
          `${r.title} ${r.company} ${r.notes}`
            .toLocaleLowerCase('az')
            .includes(q)),
    );
    const page = Math.max(
      1,
      Math.min(
        Math.ceil(rows.length / 50) || 1,
        Number.parseInt(query.page ?? '1', 10) || 1,
      ),
    );
    return {
      columns: data.columns,
      rows: rows.slice((page - 1) * 50, page * 50),
      total: rows.length,
      page,
      pages: Math.ceil(rows.length / 50) || 1,
    };
  }

  async create(userId: string, input: unknown) {
    const columns = trackerColumns(
      (
        await this.prisma.applicationTrackerSettings.findUnique({
          where: { userId },
        })
      )?.columns ?? [],
    );
    const fields = trackerFields(input, columns);
    if (!fields.title || !fields.company)
      throw new BadRequestException('Vəzifə və şirkəti yazın.');
    const key = `manual:${randomUUID()}`;
    await this.prisma.applicationTrackerRecord.create({
      data: { userId, sourceKey: key, fields: fields as Prisma.InputJsonValue },
    });
    return { key };
  }

  async edit(userId: string, key: string, input: unknown) {
    if (!keyOk(key)) throw new NotFoundException('Sətir tapılmadı.');
    const data = await this.all(userId);
    const current = data.rows.find((r) => r.key === key);
    if (!current)
      throw new NotFoundException('Sətir tapılmadı.');
    const fields = trackerFields(input, data.columns);
    if (
      isObject(input) &&
      own(input, 'hidden') &&
      typeof input.hidden !== 'boolean'
    )
      throw new BadRequestException('Sətir məlumatları yanlışdır.');
    const hidden =
      isObject(input) && typeof input.hidden === 'boolean'
        ? input.hidden
        : null;
    const patch = JSON.stringify(fields);
    const custom = JSON.stringify(fields.custom ?? {});
    // Merge inside Postgres, so simultaneous edits to different cells cannot lose one another.
    await this.prisma.$executeRaw`
      INSERT INTO "ApplicationTrackerRecord" ("id", "userId", "sourceKey", "fields", "hidden", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${key}, ${patch}::jsonb, COALESCE(${hidden}::boolean, false), NOW(), NOW())
      ON CONFLICT ("userId", "sourceKey") DO UPDATE SET
        "fields" = "ApplicationTrackerRecord"."fields" || ${patch}::jsonb || jsonb_build_object('custom', COALESCE("ApplicationTrackerRecord"."fields"->'custom', '{}'::jsonb) || ${custom}::jsonb),
        "hidden" = COALESCE(${hidden}::boolean, "ApplicationTrackerRecord"."hidden"), "updatedAt" = NOW()
    `;
    return { saved: true };
  }

  async configure(userId: string, input: unknown) {
    const columns = trackerColumns(input);
    await this.prisma.applicationTrackerSettings.upsert({
      where: { userId },
      create: { userId, columns: columns as unknown as Prisma.InputJsonValue },
      update: { columns: columns as unknown as Prisma.InputJsonValue },
    });
    return { columns };
  }

  async csv(userId: string) {
    const data = await this.all(userId);
    const columns = data.columns.filter((c) => !c.hidden);
    const header = [
      'Vəzifə',
      'Şirkət',
      'Keçid',
      'Tarix',
      'Mərhələ',
      'Qeydlər',
      'Mənbə',
      'Sistem sübutu',
      ...columns.map((c) => c.name),
    ];
    const lines = [
      header,
      ...data.rows
        .filter((r) => !r.hidden)
        .map((r) => [
          r.title,
          r.company,
          r.url,
          r.date,
          r.stage,
          r.notes,
          r.source,
          r.evidence,
          ...columns.map((c) => r.custom[c.id] ?? ''),
        ]),
    ];
    return (
      '\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n')
    );
  }
}
