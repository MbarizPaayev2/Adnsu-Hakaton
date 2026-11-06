import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationPreference, NotifyFrequency } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { ProductService } from '../billing/product.service';

export const BAKU_OFFSET_MIN = 240; // UTC+4, no DST
const FREQ: NotifyFrequency[] = ['OFF', 'DAILY', 'INSTANT'];
const MAX_PAUSE_DAYS = 90;

export type EffectivePreferences = Omit<NotificationPreference, 'id' | 'userId' | 'updatedAt'> & { emailEnabled: boolean };

const DEFAULTS = {
  matchInApp: true, matchEmail: true, planOffersEmail: false, newJobInApp: true, newJobEmail: 'DAILY' as NotifyFrequency, newJobTelegram: 'OFF' as NotifyFrequency, matchTelegram: false,
  instantDailyCap: 5, quietStartMinute: null, quietEndMinute: null, pausedUntil: null, emailUnsubscribedAt: null,
};

/** Minutes after midnight, Baku time. */
export function bakuMinutes(now: Date): number {
  return (((now.getUTCHours() * 60 + now.getUTCMinutes() + BAKU_OFFSET_MIN) % 1440) + 1440) % 1440;
}

/** If `now` is inside the user's quiet hours, the instant they end; otherwise null. Handles windows that wrap midnight (e.g. 22:00-07:00). */
export function quietUntil(prefs: Pick<NotificationPreference, 'quietStartMinute' | 'quietEndMinute'>, now: Date): Date | null {
  const { quietStartMinute: s, quietEndMinute: e } = prefs;
  if (s == null || e == null || s === e) return null;
  const m = bakuMinutes(now);
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return null;
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(minuteStart + ((e - m + 1440) % 1440) * 60_000);
}

@Injectable()
export class PreferencesService {
  constructor(private prisma: PrismaService, private products: ProductService) {}

  async get(userId: string): Promise<EffectivePreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    const { id: _i, userId: _u, updatedAt: _t, ...rest } = row ?? { ...DEFAULTS, id: '', userId, updatedAt: new Date() };
    return { ...rest, emailEnabled: !rest.emailUnsubscribedAt } as EffectivePreferences;
  }

  /** View with what the plan allows, for the settings screen. */
  async view(userId: string) {
    const prefs = await this.get(userId);
    const instant = await this.products.grantForUser(userId, 'alerts.instant');
    return { ...prefs, instant: { available: !!instant?.enabled, dailyLimit: instant?.enabled ? instant.limit ?? null : 0 } };
  }

  async update(userId: string, body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    const bool = (k: string) => {
      if (body[k] === undefined) return;
      if (typeof body[k] !== 'boolean') throw new BadRequestException('Bildiriş seçimi yanlışdır');
      data[k] = body[k];
    };
    for (const k of ['planOffersEmail', 'matchInApp', 'matchEmail', 'newJobInApp', 'matchTelegram']) bool(k);
    for (const k of ['newJobEmail', 'newJobTelegram']) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== 'string' || !FREQ.includes(body[k] as NotifyFrequency)) throw new BadRequestException('Tezlik seçimi yanlışdır');
      data[k] = body[k];
    }
    if (data.newJobEmail === 'INSTANT' || data.newJobTelegram === 'INSTANT') {
      const grant = await this.products.grantForUser(userId, 'alerts.instant');
      if (!grant?.enabled) throw new BadRequestException('Ani bildirişlər planınıza daxil deyil');
    }
    if (body.instantDailyCap !== undefined) {
      const cap = body.instantDailyCap;
      if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > 50) throw new BadRequestException('Gündəlik limit 1-50 arasında olmalıdır');
      data.instantDailyCap = cap;
    }
    if (body.quietStartMinute !== undefined || body.quietEndMinute !== undefined) {
      const ok = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440);
      if (!ok(body.quietStartMinute) || !ok(body.quietEndMinute) || (body.quietStartMinute === null) !== (body.quietEndMinute === null) || (body.quietStartMinute !== null && body.quietStartMinute === body.quietEndMinute)) {
        throw new BadRequestException('Sakit saatlar yanlışdır');
      }
      data.quietStartMinute = body.quietStartMinute;
      data.quietEndMinute = body.quietEndMinute;
    }
    if (body.pausedUntil !== undefined) {
      if (body.pausedUntil === null) data.pausedUntil = null;
      else {
        const t = typeof body.pausedUntil === 'string' ? new Date(body.pausedUntil) : null;
        if (!t || Number.isNaN(t.getTime()) || t.getTime() > Date.now() + MAX_PAUSE_DAYS * 86_400_000) throw new BadRequestException(`Fasilə ən çox ${MAX_PAUSE_DAYS} gün ola bilər`);
        data.pausedUntil = t.getTime() <= Date.now() ? null : t;
      }
    }
    if (body.emailEnabled !== undefined) {
      if (typeof body.emailEnabled !== 'boolean') throw new BadRequestException('E-poçt seçimi yanlışdır');
      data.emailUnsubscribedAt = body.emailEnabled ? null : new Date();
    }
    await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.view(userId);
  }

  // ── unsubscribe links ───────────────────────────────────────────────────────────────────────────────
  private secret(): string | null {
    const s = process.env.NOTIFICATION_LINK_SECRET;
    return s && s.length >= 32 ? s : null;
  }
  /** Signed, non-expiring unsubscribe token (an unsubscribe must keep working from an old e-mail). Null when no secret is configured: then no non-essential e-mail is sent. */
  unsubscribeToken(userId: string): string | null {
    const secret = this.secret();
    if (!secret) return null;
    const sig = createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url');
    return `${Buffer.from(userId).toString('base64url')}.${sig}`;
  }
  verifyUnsubscribeToken(token: string): string | null {
    const secret = this.secret();
    if (!secret || typeof token !== 'string' || token.length > 300) return null;
    const [idPart, sig] = token.split('.');
    if (!idPart || !sig) return null;
    const userId = Buffer.from(idPart, 'base64url').toString();
    const expected = createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b) ? userId : null;
  }
  async unsubscribeWithToken(token: string): Promise<boolean> {
    const userId = this.verifyUnsubscribeToken(token);
    if (!userId) return false;
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) return true; // deleted account: nothing left to unsubscribe, same answer
    await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, emailUnsubscribedAt: new Date() }, update: { emailUnsubscribedAt: new Date() } });
    return true;
  }
}
