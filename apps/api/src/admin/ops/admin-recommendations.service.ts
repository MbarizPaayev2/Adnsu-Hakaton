import { resolveAiProvider } from '../../resumes/tailor/ai-provider';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { PrismaService } from '../../database/database.service';
import { FeatureFlagsService } from '../../operations/feature-flags.service';
import { EMAIL_APPLY_CONFIG } from '../../email-applications/email-apply.tokens';
import type { EmailApplyConfig } from '../../email-applications/email-apply.config';
import { sourceHealth } from '../../jobs/job-source.service';
import { roleCan } from '../permissions';
import { AdminEmailOpsService } from './admin-email-ops.service';
import { AdminOpsService } from './admin-ops.service';
import {
  backupRules, documentRules, emailRules, importRules, moderationRules, queueRules, serviceRules, sortRecommendations,
  type Area, type BackupFacts, type Recommendation, type RecommendationDraft,
} from './recommendations';

export const RECOMMENDATIONS_CONTRACT_VERSION = 1;
const AREAS: Area[] = ['services', 'backup', 'imports', 'queues', 'documents', 'email', 'moderation'];

/**
 * Gathers read-only facts and turns them into recommended actions (see recommendations.ts for the rules and the principles they follow). Every area is
 * checked independently: a check that fails becomes an `unknown` item for that area and never a healthy one. Nothing here writes, retries, pauses or
 * sends anything; it only points at the existing guarded admin actions.
 */
@Injectable()
export class AdminRecommendationsService {
  constructor(
    private prisma: PrismaService,
    private ops: AdminOpsService,
    private emailOps: AdminEmailOpsService,
    private flags: FeatureFlagsService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
  ) {}

  async build(role: AdminRole, now = new Date()) {
    const environment = process.env.APP_ENV || process.env.NODE_ENV || 'development';
    // Health is asked once: services and backup both come from it.
    let health: Awaited<ReturnType<AdminOpsService['health']>> | null = null;
    let healthError = false;
    try { health = await this.ops.health(); } catch { healthError = true; }

    const areaChecks: Record<Area, () => Promise<RecommendationDraft[] | 'skipped'>> = {
      services: async () => {
        if (!health) throw new Error('health unavailable');
        return serviceRules((Object.entries(health.services) as [any, { ok: boolean; ms: number }][]).map(([name, v]) => ({ name, ok: v.ok, ms: v.ms })), now);
      },
      backup: async () => {
        if (!health) throw new Error('health unavailable');
        return backupRules(health.backup as BackupFacts, now);
      },
      imports: async () => {
        const [glorri, sources, schedulerPaused] = await Promise.all([
          this.prisma.jobImportRun.findFirst({ where: { source: 'glorri' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, status: true, error: true } }),
          sourceHealth(this.prisma, now),
          this.flags.isPaused('import.scheduled'),
        ]);
        return importRules(
          glorri ? { lastRunAt: glorri.startedAt, lastStatus: glorri.status, lastError: !!glorri.error } : null,
          sources.map((s) => ({ key: s.key, name: s.name, scheduled: s.scheduled, paused: s.schedule.mode === 'paused', consecutiveFailures: s.schedule.consecutiveFailures, staleness: s.schedule.staleness, lastSuccessAt: s.lastSuccessAt, lastRunStatus: s.lastRunStatus, completeness: s.completeness, openFreshnessUnknown: s.counts.openFreshnessUnknown, open: s.counts.open, cooldownUntil: s.schedule.cooldownUntil, cooldownReason: s.schedule.cooldownReason, cooldownCount: s.schedule.cooldownCount })),
          schedulerPaused, now,
        );
      },
      queues: async () => queueRules(await this.ops.queueCounts(), now),
      documents: async () => {
        const day = new Date(now.getTime() - 24 * 3600_000);
        const stale = new Date(now.getTime() - 15 * 60_000);
        const [stalePending, oldest, stranded, generated, failed] = await Promise.all([
          this.prisma.resume.count({ where: { isBase: false, status: 'PENDING', createdAt: { lt: stale } } }),
          this.prisma.resume.findFirst({ where: { isBase: false, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
          this.prisma.documentCharge.count({ where: { status: 'RESERVED', expiresAt: { lte: now } } }),
          this.prisma.resume.count({ where: { isBase: false, status: { in: ['NEEDS_REVIEW', 'READY'] }, createdAt: { gte: day } } }),
          this.prisma.resume.count({ where: { isBase: false, status: 'FAILED', createdAt: { gte: day } } }),
        ]);
        return documentRules({ providerConfigured: !!resolveAiProvider((n) => process.env[n]).apiKey, stalePending, strandedReservations: stranded, generated24h: generated, failed24h: failed, oldestPendingAt: oldest?.createdAt ?? null }, now);
      },
      email: async () => {
        if (!this.cfg.enabled) return 'skipped';
        const [h, paused] = await Promise.all([this.emailOps.emailHealth(now), this.flags.isPaused('email_apply.sending')]);
        return emailRules({
          enabled: true, transport: this.cfg.transport, environment, emergencyPaused: paused, staleSending: h.queue.staleSending, oldestQueuedAgeMinutes: h.queue.oldestQueuedAgeMinutes,
          uncertain: h.uncertain.length, oldestUncertainAt: h.uncertain[0]?.since ?? null,
          accepted7d: h.delivery7d.providerAccepted, delivered7d: h.delivery7d.delivered, bounced7d: h.delivery7d.bounced, complained7d: h.delivery7d.complained,
        }, now);
      },
      moderation: async () => {
        const [pending, oldest] = await Promise.all([
          this.prisma.company.count({ where: { status: 'PENDING' } }),
          this.prisma.company.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        ]);
        return moderationRules(pending, oldest?.createdAt ?? null, now);
      },
    };

    const drafts: RecommendationDraft[] = [];
    const checked: { area: Area; status: 'ok' | 'attention' | 'unknown' | 'skipped'; checkedAt: string; itemCount: number; note?: string }[] = [];
    for (const area of AREAS) {
      try {
        const result = await areaChecks[area]();
        if (result === 'skipped') { checked.push({ area, status: 'skipped', checkedAt: now.toISOString(), itemCount: 0, note: 'Bu mühitdə söndürülüb' }); continue; }
        drafts.push(...result);
        checked.push({ area, status: result.some((r) => r.status === 'attention') ? 'attention' : result.length ? 'unknown' : 'ok', checkedAt: now.toISOString(), itemCount: result.length });
      } catch {
        // A check that could not run is unknown, whatever it would have found: never silence, never "ok".
        drafts.push({
          id: `check.${area}.failed`, area, status: 'unknown', severity: area === 'services' || area === 'backup' ? 'high' : 'medium', title: 'Yoxlama icra oluna bilmədi',
          condition: `"${area}" bölməsi üçün yoxlama alınmadı${area === 'services' || area === 'backup' ? (healthError ? ' (sağlamlıq sorğusu uğursuz oldu)' : '') : ''}. Bu, problem olmadığını göstərmir.`,
          facts: { area }, freshness: { source: 'not available', asOf: null, ageSeconds: null, stale: false },
          nextStep: 'Yoxlamanı bir qədər sonra təkrarlayın; davam edərsə, API qeydlərinə və verilənlər bazası/Redis bağlantısına baxın.',
          link: { page: '/admin/system', runbook: 'docs/launch-runbook.md' }, requiredPermission: 'ops.read',
        });
        checked.push({ area, status: 'unknown', checkedAt: now.toISOString(), itemCount: 1, note: 'Yoxlama icra oluna bilmədi' });
      }
    }

    const items: Recommendation[] = sortRecommendations(drafts).map((d) => ({ ...d, observedAt: now.toISOString(), canAct: roleCan(role, d.requiredPermission) }));
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const i of items) bySeverity[i.severity]++;
    return {
      contractVersion: RECOMMENDATIONS_CONTRACT_VERSION, generatedAt: now.toISOString(), environment, role,
      summary: { attention: items.filter((i) => i.status === 'attention').length, unknown: items.filter((i) => i.status === 'unknown').length, bySeverity },
      checked, items,
    };
  }
}
