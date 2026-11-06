import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.service';

/**
 * Durable operator switches that can only PAUSE a capability. Resuming one
 * never bypasses the environment gates (e.g. EXTERNAL_APPLY_LIVE_ENABLED),
 * consent or receipt requirements — those are checked separately.
 */
export const FEATURE_FLAGS = {
  'external_apply.submissions': 'Avtomatik xarici müraciətlər (hazırlıq, göndəriş və OTP)',
  'import.glorri': 'Glorri vakansiya idxalı',
  'import.scheduled': 'Cədvəllə vakansiya mənbələrinin yenilənməsi',
  'email_apply.sending': 'Namizədlərin təsdiqlədiyi e-poçt müraciətlərinin göndərilməsi',
  'email_apply.automation': 'Avtomatik e-poçt müraciətləri (Rejim B)',
  'agent.submissions': 'Brauzer agentinin müraciətlərinin göndərilməsi (təcili dayandırma)',
  'agent.review_queue': 'Müraciətlərin arxa planda hazırlanması (namizədin təsdiqi üçün)',
} as const;
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

@Injectable()
export class FeatureFlagsService {
  constructor(private prisma: PrismaService) {}

  async isPaused(key: FeatureFlagKey): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return !!flag?.paused;
  }

  async list() {
    const rows = await this.prisma.featureFlag.findMany();
    return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => {
      const row = rows.find((r) => r.key === key);
      return { key, label: FEATURE_FLAGS[key], paused: !!row?.paused, reason: row?.reason ?? null, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
    });
  }

  async set(key: FeatureFlagKey, paused: boolean, reason: string | undefined, actorId: string) {
    const before = await this.isPaused(key);
    await this.prisma.$transaction([
      this.prisma.featureFlag.upsert({
        where: { key },
        create: { key, paused, reason: reason ?? null, updatedById: actorId },
        update: { paused, reason: reason ?? null, updatedById: actorId },
      }),
      this.prisma.adminAuditLog.create({
        data: { adminUserId: actorId, action: paused ? 'FEATURE_PAUSED' : 'FEATURE_RESUMED', targetType: 'FeatureFlag', targetId: key, metadata: { before: before ? 'paused' : 'running', after: paused ? 'paused' : 'running', reason } },
      }),
    ]);
    return this.list();
  }
}
