import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AdminRole, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/database.service';
import { EmailDeliveryError, EmailService } from '../common/email.service';
import { sha256Hex } from './mfa.util';
import { FOUNDER_EMAIL } from './permissions';

const INVITE_HOURS = 72;
const RESET_HOURS = 2;
const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
const ROLE_LABELS: Record<AdminRole, string> = { SUPER_ADMIN: 'Super-admin', ADMIN: 'Admin', SUPPORT: 'Dəstək (yalnız baxış)' };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** SUPER_ADMIN-only operator management. Every change is audited with before/after. */
@Injectable()
export class AdminOperatorsService {
  private readonly logger = new Logger(AdminOperatorsService.name);

  constructor(private prisma: PrismaService, private email: EmailService) {}

  private audit(tx: Prisma.TransactionClient | PrismaService, actorId: string, action: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
    return tx.adminAuditLog.create({ data: { adminUserId: actorId, action, targetType, targetId, metadata: metadata as any } });
  }

  async list() {
    const [operators, invitations] = await Promise.all([
      this.prisma.adminUser.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, name: true, role: true, disabledAt: true, mfaEnabledAt: true, lastLoginAt: true, createdAt: true },
      }),
      this.prisma.adminInvitation.findMany({
        where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, email: true, role: true, expiresAt: true, deliveryStatus: true, createdAt: true },
      }),
    ]);
    return { operators: operators.map(({ mfaEnabledAt, ...o }) => ({ ...o, mfaEnabled: !!mfaEnabledAt })), invitations };
  }

  private setupUrl(token: string) {
    const base = (process.env.ADMIN_WEB_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/admin/setup?token=${token}`;
  }

  /** Creates a single-use link (only its hash is stored) and delivers it by email. */
  private async issueLink(actorId: string, kind: 'INVITE' | 'RESET', email: string, role: AdminRole) {
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.$transaction(async (tx) => {
      // A newer link replaces any open link for the same address and purpose.
      await tx.adminInvitation.updateMany({ where: { email, kind, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const created = await tx.adminInvitation.create({
        data: { kind, email, role, tokenHash: sha256Hex(token), invitedById: actorId, expiresAt: new Date(Date.now() + (kind === 'INVITE' ? INVITE_HOURS : RESET_HOURS) * 3_600_000) },
      });
      await this.audit(tx, actorId, kind === 'INVITE' ? 'ADMIN_INVITED' : 'ADMIN_RESET_LINK_ISSUED', 'AdminInvitation', created.id, { email, role });
      return created;
    });

    const link = this.setupUrl(token);
    const subject = kind === 'INVITE' ? 'AISE admin paneli: hesabınızı quraşdırın' : 'AISE admin paneli: şifrənin bərpası';
    const html = kind === 'INVITE'
      ? `<p>Sizi AISE admin panelinə <strong>${escapeHtml(ROLE_LABELS[role])}</strong> rolu ilə dəvət ediblər.</p><p><a href="${link}">Hesabı quraşdırın</a> (keçid ${INVITE_HOURS} saat etibarlıdır və bir dəfə istifadə olunur).</p><p>Bu dəvəti gözləmirdinizsə, məktubu nəzərə almayın.</p>`
      : `<p>AISE admin hesabınız üçün şifrənin bərpası tələb olunub.</p><p><a href="${link}">Yeni şifrə təyin edin</a> (keçid ${RESET_HOURS} saat etibarlıdır və bir dəfə istifadə olunur). Bütün aktiv sessiyalar bağlanacaq.</p>`;
    let deliveryStatus: 'SENT' | 'MOCK' | 'FAILED' = 'FAILED';
    try {
      const result = await this.email.send(email, subject, html);
      deliveryStatus = result.mock ? 'MOCK' : 'SENT';
    } catch (error) {
      this.logger.warn(`Admin ${kind} delivery failed: ${error instanceof EmailDeliveryError ? error.code : 'unknown'}`);
    }
    await this.prisma.adminInvitation.update({ where: { id: invitation.id }, data: { deliveryStatus } });
    if (deliveryStatus === 'FAILED') {
      // The link was not delivered: revoke it rather than leave a live secret nobody holds.
      await this.prisma.adminInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      throw new BadGatewayException('E-poçt göndərilə bilmədi. Keçid ləğv edildi; bir az sonra yenidən cəhd edin.');
    }
    return { id: invitation.id, kind, email, role, expiresAt: invitation.expiresAt, deliveryStatus };
  }

  async invite(actorId: string, rawEmail: string, role: AdminRole) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('E-poçt ünvanı düzgün deyil');
    if (!ROLES.includes(role)) throw new BadRequestException('Rol düzgün deyil');
    const existing = await this.prisma.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existing) throw new ConflictException('Bu e-poçt üçün operator hesabı artıq var');
    return this.issueLink(actorId, 'INVITE', email, role);
  }

  async resendInvitation(actorId: string, invitationId: string) {
    const invitation = await this.prisma.adminInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.usedAt || invitation.kind !== 'INVITE') throw new NotFoundException('Dəvət tapılmadı');
    return this.invite(actorId, invitation.email, invitation.role);
  }

  async revokeInvitation(actorId: string, invitationId: string) {
    const revoked = await this.prisma.adminInvitation.updateMany({ where: { id: invitationId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!revoked.count) throw new NotFoundException('Aktiv dəvət tapılmadı');
    await this.audit(this.prisma, actorId, 'ADMIN_INVITATION_REVOKED', 'AdminInvitation', invitationId);
    return { success: true };
  }

  async sendResetLink(actorId: string, targetId: string) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target || target.disabledAt) throw new NotFoundException('Aktiv operator tapılmadı');
    if (target.id === actorId) throw new ConflictException('Öz şifrənizi "Hesabım" səhifəsində dəyişin');
    return this.issueLink(actorId, 'RESET', target.email, target.role);
  }

  /**
   * Runs `change` for a target operator while holding a lock over the set of
   * super-admins, and refuses if it would leave no active SUPER_ADMIN.
   */
  private async guardedChange(actorId: string, targetId: string, change: (tx: Prisma.TransactionClient, before: { role: AdminRole; disabledAt: Date | null; email: string }) => Promise<{ role: AdminRole; disabledAt: Date | null }>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('admin-super-admins'))`;
      const before = await tx.adminUser.findUnique({ where: { id: targetId } });
      if (!before) throw new NotFoundException('Operator tapılmadı');
      const after = await change(tx, before);
      if (before.role === 'SUPER_ADMIN' && !before.disabledAt && (after.role !== 'SUPER_ADMIN' || after.disabledAt)) {
        const others = await tx.adminUser.count({ where: { role: 'SUPER_ADMIN', disabledAt: null, id: { not: targetId } } });
        if (others === 0) throw new ConflictException('Son aktiv super-admin silinə, deaktiv edilə və ya aşağı salına bilməz');
      }
      return { before, after };
    });
  }

  async changeRole(actorId: string, targetId: string, role: AdminRole) {
    if (!ROLES.includes(role)) throw new BadRequestException('Rol düzgün deyil');
    const { before } = await this.guardedChange(actorId, targetId, async (tx, before) => {
      if (before.role === role) return before;
      const updated = await tx.adminUser.update({ where: { id: targetId }, data: { role } });
      await this.audit(tx, actorId, 'ADMIN_ROLE_CHANGED', 'AdminUser', targetId, { email: before.email, before: before.role, after: role });
      return updated;
    });
    return { id: targetId, role, previousRole: before.role };
  }

  async disable(actorId: string, targetId: string, reason?: string) {
    if (targetId === actorId) throw new ConflictException('Öz hesabınızı deaktiv edə bilməzsiniz');
    await this.guardedChange(actorId, targetId, async (tx, before) => {
      if (before.disabledAt) return before;
      const updated = await tx.adminUser.update({ where: { id: targetId }, data: { disabledAt: new Date() } });
      await tx.adminSession.deleteMany({ where: { adminUserId: targetId } });
      await tx.adminInvitation.updateMany({ where: { email: before.email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actorId, 'ADMIN_DISABLED', 'AdminUser', targetId, { email: before.email, role: before.role, reason: reason?.slice(0, 300) });
      return updated;
    });
    return { success: true };
  }

  /**
   * Removes an operator account for good (sessions, login challenges and open links go with it; the audit entries it wrote stay, unattributed).
   * Refused for yourself, for the founder address and for the last active super-admin.
   */
  async remove(actorId: string, targetId: string, reason?: string) {
    if (targetId === actorId) throw new ConflictException('Öz hesabınızı silə bilməzsiniz');
    const { before } = await this.guardedChange(actorId, targetId, async (tx, before) => {
      if (before.email.toLowerCase() === FOUNDER_EMAIL) throw new ConflictException('Təsisçi hesabı silinə bilməz');
      await tx.adminInvitation.updateMany({ where: { email: before.email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actorId, 'ADMIN_REMOVED', 'AdminUser', targetId, { email: before.email, role: before.role, reason: reason?.slice(0, 300) });
      await tx.adminUser.delete({ where: { id: targetId } });
      // the guard treats a removed super-admin like a disabled one
      return { ...before, disabledAt: new Date() };
    });
    return { removed: true, email: before.email };
  }

  async enable(actorId: string, targetId: string) {
    const updated = await this.prisma.adminUser.updateMany({ where: { id: targetId, disabledAt: { not: null } }, data: { disabledAt: null } });
    if (!updated.count) throw new NotFoundException('Deaktiv operator tapılmadı');
    await this.audit(this.prisma, actorId, 'ADMIN_ENABLED', 'AdminUser', targetId);
    return { success: true };
  }

  async revokeSessions(actorId: string, targetId: string) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Operator tapılmadı');
    const removed = await this.prisma.adminSession.deleteMany({ where: { adminUserId: targetId } });
    await this.audit(this.prisma, actorId, 'ADMIN_SESSIONS_REVOKED', 'AdminUser', targetId, { count: removed.count });
    return { revoked: removed.count };
  }

  /** For an operator who lost their authenticator: clears MFA and ends their sessions. */
  async resetMfa(actorId: string, targetId: string) {
    if (targetId === actorId) throw new ConflictException('Öz iki mərhələli təsdiqinizi bərpa kodları ilə idarə edin');
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Operator tapılmadı');
    await this.prisma.$transaction([
      this.prisma.adminUser.update({ where: { id: targetId }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryCodeHashes: [], mfaLastUsedStep: null } }),
      this.prisma.adminSession.deleteMany({ where: { adminUserId: targetId } }),
    ]);
    await this.audit(this.prisma, actorId, 'ADMIN_MFA_RESET', 'AdminUser', targetId, { email: target.email });
    return { success: true };
  }
}
