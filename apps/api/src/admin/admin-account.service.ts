import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/database.service';
import { AdminAuthService, assertStrongPassword, publicAdmin } from './admin-auth.service';
import { base32Encode, decryptSecret, encryptSecret, mfaKey, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, sha256Hex, verifyTotp } from './mfa.util';

/** The signed-in operator's own account: password, sessions and MFA. */
@Injectable()
export class AdminAccountService {
  constructor(private prisma: PrismaService, private auth: AdminAuthService) {}

  private async load(adminUserId: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!user || user.disabledAt) throw new UnauthorizedException('Etibarsız sessiya');
    return user;
  }

  private audit(adminUserId: string, action: string, metadata?: Record<string, unknown>) {
    return this.prisma.adminAuditLog.create({ data: { adminUserId, action, targetType: 'AdminUser', targetId: adminUserId, metadata: metadata as any } });
  }

  async me(adminUserId: string) {
    return publicAdmin(await this.load(adminUserId));
  }

  /** Rotating the password ends every other session of this operator. */
  async changePassword(adminUserId: string, sessionId: string, currentPassword: string, newPassword: string, code?: string) {
    const user = await this.load(adminUserId);
    if (!(await bcrypt.compare(currentPassword || '', user.hashedPassword))) {
      throw new UnauthorizedException('Cari şifrə yanlışdır');
    }
    if (user.mfaEnabledAt && !(code && (await this.auth.consumeSecondFactor(user, code)))) {
      throw new UnauthorizedException('İki mərhələli təsdiq kodu yanlışdır');
    }
    assertStrongPassword(newPassword, user.email);
    if (await bcrypt.compare(newPassword, user.hashedPassword)) {
      throw new BadRequestException('Yeni şifrə köhnəsi ilə eyni ola bilməz');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({ where: { id: user.id }, data: { hashedPassword, passwordChangedAt: new Date() } }),
      this.prisma.adminSession.deleteMany({ where: { adminUserId: user.id, id: { not: sessionId } } }),
    ]);
    await this.audit(user.id, 'ADMIN_PASSWORD_CHANGED');
    return { success: true };
  }

  async listSessions(adminUserId: string, currentSessionId: string) {
    const sessions = await this.prisma.adminSession.findMany({
      where: { adminUserId, expires: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, expires: true, userAgent: true, mfaVerified: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async revokeSession(adminUserId: string, sessionId: string) {
    const removed = await this.prisma.adminSession.deleteMany({ where: { id: sessionId, adminUserId } });
    if (!removed.count) throw new NotFoundException('Sessiya tapılmadı');
    await this.audit(adminUserId, 'ADMIN_SESSION_REVOKED', { sessionId });
    return { success: true };
  }

  async revokeOtherSessions(adminUserId: string, currentSessionId: string) {
    const removed = await this.prisma.adminSession.deleteMany({ where: { adminUserId, id: { not: currentSessionId } } });
    await this.audit(adminUserId, 'ADMIN_OTHER_SESSIONS_REVOKED', { count: removed.count });
    return { revoked: removed.count };
  }

  // -------------------------------------------------------------------- MFA --

  private requireKey() {
    const key = mfaKey();
    if (!key) throw new ServiceUnavailableException('İki mərhələli təsdiq serverdə konfiqurasiya edilməyib (ADMIN_MFA_ENCRYPTION_KEY).');
    return key;
  }

  /** Starts enrollment: a new pending secret, shown once to the operator. */
  async startMfa(adminUserId: string) {
    const key = this.requireKey();
    const user = await this.load(adminUserId);
    if (user.mfaEnabledAt) throw new ConflictException('İki mərhələli təsdiq artıq aktivdir');
    const secret = newTotpSecret();
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret, key), mfaLastUsedStep: null } });
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) };
  }

  /**
   * Confirms enrollment with a code from the app. Returns recovery codes once;
   * only their hashes are stored. Other sessions (created without the second
   * factor) are ended and this one is marked verified.
   */
  async enableMfa(adminUserId: string, sessionId: string, code: string) {
    const key = this.requireKey();
    const user = await this.load(adminUserId);
    if (user.mfaEnabledAt) throw new ConflictException('İki mərhələli təsdiq artıq aktivdir');
    if (!user.mfaSecretEnc) throw new BadRequestException('Əvvəlcə quraşdırmanı başladın');
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc, key), (code || '').trim(), null);
    if (step === null) throw new BadRequestException('Kod yanlışdır. Tətbiqdəki cari kodu daxil edin.');
    const recoveryCodes = newRecoveryCodes();
    const enabled = await this.prisma.adminUser.updateMany({
      where: { id: user.id, mfaEnabledAt: null, mfaSecretEnc: user.mfaSecretEnc },
      data: { mfaEnabledAt: new Date(), mfaLastUsedStep: step, mfaRecoveryCodeHashes: recoveryCodes.map((c) => sha256Hex(normalizeRecoveryCode(c))) },
    });
    if (!enabled.count) throw new ConflictException('Quraşdırma dəyişib. Yenidən başlayın.');
    await this.prisma.$transaction([
      this.prisma.adminSession.updateMany({ where: { id: sessionId }, data: { mfaVerified: true } }),
      this.prisma.adminSession.deleteMany({ where: { adminUserId: user.id, id: { not: sessionId } } }),
    ]);
    await this.audit(user.id, 'ADMIN_MFA_ENABLED');
    return { recoveryCodes };
  }

  async regenerateRecoveryCodes(adminUserId: string, code: string) {
    const user = await this.load(adminUserId);
    if (!user.mfaEnabledAt) throw new BadRequestException('İki mərhələli təsdiq aktiv deyil');
    if (!(await this.auth.consumeSecondFactor(user, code || ''))) throw new UnauthorizedException('Kod yanlışdır');
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { mfaRecoveryCodeHashes: recoveryCodes.map((c) => sha256Hex(normalizeRecoveryCode(c))) } });
    await this.audit(user.id, 'ADMIN_RECOVERY_CODES_REGENERATED');
    return { recoveryCodes };
  }

  /** SUPER_ADMIN accounts must keep MFA; others may turn it off with password + code. */
  async disableMfa(adminUserId: string, password: string, code: string) {
    const user = await this.load(adminUserId);
    if (!user.mfaEnabledAt) throw new BadRequestException('İki mərhələli təsdiq aktiv deyil');
    if (user.role === 'SUPER_ADMIN') throw new ConflictException('Super-admin hesabında iki mərhələli təsdiq söndürülə bilməz');
    if (!(await bcrypt.compare(password || '', user.hashedPassword))) throw new UnauthorizedException('Şifrə yanlışdır');
    if (!(await this.auth.consumeSecondFactor(user, code || ''))) throw new UnauthorizedException('Kod yanlışdır');
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryCodeHashes: [], mfaLastUsedStep: null } });
    await this.prisma.adminSession.updateMany({ where: { adminUserId: user.id }, data: { mfaVerified: false } });
    await this.audit(user.id, 'ADMIN_MFA_DISABLED');
    return { success: true };
  }
}
