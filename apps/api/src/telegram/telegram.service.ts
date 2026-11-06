import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/database.service';
import { AlertsService, ChannelSender } from '../alerts/alerts.service';
import { TelegramClient } from './telegram.client';
import { telegramConfig } from './telegram.config';

const TOKEN_TTL_MS = 15 * 60_000;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

const REPLY = {
  noToken: 'AISE bildirişləri üçün saytda Parametrlər bölməsindən yeni bağlantı yaradın.',
  badToken: 'Bağlantının vaxtı bitib və ya yanlışdır. Saytda yeni bağlantı yaradın.',
  linked: 'Hesabınız bağlandı. Yeni vakansiya bildirişləri bu söhbətə gələcək. /pause, /resume, /stop, /status komandaları var.',
  taken: 'Bu söhbət artıq başqa hesaba bağlıdır.',
  notLinked: 'Bu söhbət AISE hesabına bağlı deyil.',
  paused: 'Bildirişlər dayandırıldı. Davam etmək üçün /resume yazın.',
  resumed: 'Bildirişlər davam edir.',
  stopped: 'Bağlantı kəsildi. Bir daha bildiriş göndərilməyəcək.',
  noFiles: 'AISE bu botda CV və ya fayl qəbul etmir. CV-nizi yalnız saytda yükləyin.',
};

/**
 * Telegram as a notification channel only (alerts, pause, disconnect). Linking uses a random, expiring, single-use token stored as a hash; the
 * webhook is authenticated by the secret header and each update is processed once. It never accepts files or CVs.
 */
@Injectable()
export class TelegramService implements OnModuleInit, ChannelSender {
  readonly channel = 'TELEGRAM' as const;
  private readonly log = new Logger(TelegramService.name);

  constructor(private prisma: PrismaService, private client: TelegramClient, private alerts: AlertsService) {}

  onModuleInit() { this.alerts.registerChannel(this); }

  enabled() { return telegramConfig().enabled; }

  // ── ChannelSender ───────────────────────────────────────────────────────────────────────────────────
  async isActiveFor(userId: string): Promise<boolean> {
    if (!this.enabled()) return false;
    return !!(await this.prisma.telegramLink.findFirst({ where: { userId, status: 'ACTIVE', chatId: { not: null } }, select: { id: true } }));
  }

  async send(userId: string, lines: { title: string; company: string; url: string }[]): Promise<void> {
    const link = await this.prisma.telegramLink.findFirst({ where: { userId, status: 'ACTIVE', chatId: { not: null } } });
    if (!link?.chatId) throw Object.assign(new Error('no active link'), { code: 'telegram_not_linked' });
    const body = lines.map((l) => `• ${l.title} — ${l.company}\n${l.url}`).join('\n\n');
    await this.client.sendMessage(link.chatId, `Yeni vakansiya${lines.length > 1 ? 'lar' : ''}:\n\n${body}\n\n/pause — dayandır, /stop — bağlantını kəs`);
  }

  // ── authenticated user actions ──────────────────────────────────────────────────────────────────────
  async status(userId: string) {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    return { enabled: this.enabled(), status: link?.status ?? 'NOT_LINKED', linkedAt: link?.linkedAt ?? null, pausedAt: link?.pausedAt ?? null, tokenExpiresAt: link?.status === 'PENDING' ? link.tokenExpiresAt : null };
  }

  /** Creates (replacing any earlier pending one) a single-use token. Refused while the adapter is disabled. */
  async createLinkToken(userId: string, now = new Date()) {
    const cfg = telegramConfig();
    if (!cfg.enabled) throw new ServiceUnavailableException('Telegram bildirişləri hələ aktiv deyil');
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + TOKEN_TTL_MS);
    const existing = await this.prisma.telegramLink.findUnique({ where: { userId } });
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'PAUSED')) throw new BadRequestException('Hesab artıq Telegram-a bağlıdır. Əvvəlcə bağlantını kəsin.');
    await this.prisma.telegramLink.upsert({ where: { userId }, create: { userId, status: 'PENDING', tokenHash: sha(token), tokenExpiresAt: expires }, update: { status: 'PENDING', tokenHash: sha(token), tokenExpiresAt: expires, chatId: null, telegramUserId: null, disconnectedAt: null, pausedAt: null } });
    return { deepLink: `https://t.me/${cfg.username}?start=${token}`, expiresAt: expires };
  }

  async setPaused(userId: string, paused: boolean) {
    const r = await this.prisma.telegramLink.updateMany({ where: { userId, status: paused ? 'ACTIVE' : 'PAUSED' }, data: paused ? { status: 'PAUSED', pausedAt: new Date() } : { status: 'ACTIVE', pausedAt: null } });
    if (!r.count) throw new BadRequestException('Aktiv Telegram bağlantısı tapılmadı');
    return this.status(userId);
  }

  async disconnect(userId: string) {
    await this.prisma.telegramLink.updateMany({ where: { userId, status: { not: 'DISCONNECTED' } }, data: { status: 'DISCONNECTED', chatId: null, telegramUserId: null, tokenHash: null, tokenExpiresAt: null, disconnectedAt: new Date() } });
    return this.status(userId);
  }

  // ── webhook ─────────────────────────────────────────────────────────────────────────────────────────
  /** Processes one update exactly once. A failure releases the claim so Telegram's retry is processed. */
  async handleUpdate(update: any, now = new Date()): Promise<{ ok: true; duplicate?: boolean; ignored?: string }> {
    const updateId = update?.update_id;
    if (!Number.isSafeInteger(updateId) || updateId < 0) return { ok: true, ignored: 'no_update_id' };
    try {
      await this.prisma.telegramUpdate.create({ data: { updateId: BigInt(updateId) } });
    } catch (e: any) {
      if (e?.code === 'P2002') return { ok: true, duplicate: true };
      throw e;
    }
    try {
      const ignored = await this.process(update, now);
      return ignored ? { ok: true, ignored } : { ok: true };
    } catch (e) {
      await this.prisma.telegramUpdate.deleteMany({ where: { updateId: BigInt(updateId) } });
      throw e;
    }
  }

  private async reply(chatId: string, text: string) {
    try { await this.client.sendMessage(chatId, text); } catch (e: any) { this.log.warn(`reply not sent (${e?.code || 'error'})`); } // a failed reply never fails the update
  }

  private async process(update: any, now: Date): Promise<string | undefined> {
    const msg = update?.message;
    if (!msg || typeof msg !== 'object') return 'not_a_message';
    const chat = msg.chat, from = msg.from;
    // Only a PRIVATE chat with the account's owner can be linked or commanded: the chat id must equal the sender's own id.
    if (!chat || chat.type !== 'private' || !from || from.is_bot === true || String(from.id) !== String(chat.id)) return 'not_private_chat';
    const chatId = String(chat.id);
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text.startsWith('/')) { await this.reply(chatId, REPLY.noFiles); return undefined; } // text, files, photos, documents: never stored or processed
    const [cmd, arg] = text.split(/\s+/, 2);
    const command = cmd.toLowerCase().replace(/@\w+$/, '');
    if (command === '/start') return this.start(chatId, String(from.id), arg, now);
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId } });
    if (!link) { await this.reply(chatId, REPLY.notLinked); return undefined; }
    if (command === '/pause' && link.status === 'ACTIVE') { await this.setPaused(link.userId, true); await this.reply(chatId, REPLY.paused); }
    else if (command === '/resume' && link.status === 'PAUSED') { await this.setPaused(link.userId, false); await this.reply(chatId, REPLY.resumed); }
    else if (command === '/stop') { await this.disconnect(link.userId); await this.reply(chatId, REPLY.stopped); }
    else if (command === '/status') await this.reply(chatId, link.status === 'ACTIVE' ? 'Bildirişlər aktivdir.' : link.status === 'PAUSED' ? REPLY.paused : REPLY.notLinked);
    return undefined;
  }

  private async start(chatId: string, telegramUserId: string, token: string | undefined, now: Date): Promise<string | undefined> {
    if (!token) { await this.reply(chatId, REPLY.noToken); return undefined; }
    const taken = await this.prisma.telegramLink.findUnique({ where: { chatId } });
    // The token decides which account; the chat decides nothing. A chat already bound to an account can never be bound to another.
    const pending = await this.prisma.telegramLink.findFirst({ where: { tokenHash: sha(token), status: 'PENDING', tokenExpiresAt: { gt: now } } });
    if (!pending) { await this.reply(chatId, REPLY.badToken); return undefined; }
    if (taken && taken.userId !== pending.userId) { await this.reply(chatId, REPLY.taken); return undefined; }
    // Single use: only the first redemption of this token updates a row.
    const claimed = await this.prisma.telegramLink.updateMany({ where: { id: pending.id, tokenHash: sha(token), status: 'PENDING', tokenExpiresAt: { gt: now } }, data: { status: 'ACTIVE', chatId, telegramUserId, linkedAt: now, tokenHash: null, tokenExpiresAt: null } });
    await this.reply(chatId, claimed.count ? REPLY.linked : REPLY.badToken);
    return undefined;
  }
}
