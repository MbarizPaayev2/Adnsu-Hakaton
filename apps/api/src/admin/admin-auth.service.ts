import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AdminUser } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { decryptSecret, mfaKey, normalizeRecoveryCode, sha256Hex, verifyTotp } from './mfa.util';
import { permissionsFor } from './permissions';

const SESSION_DAYS = 7; // shorter-lived than user/business sessions
const CHALLENGE_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
export const MIN_ADMIN_PASSWORD = 12;
// Compared against when the email is unknown, so timing does not reveal
// which addresses are operators.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function publicAdmin(user: AdminUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    mfaEnabled: !!user.mfaEnabledAt,
    permissions: permissionsFor(user.role),
    // Shown in the panel so production is never mistaken for staging.
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  };
}

export function assertStrongPassword(password: string, email?: string) {
  if (typeof password !== 'string' || password.length < MIN_ADMIN_PASSWORD || password.length > 200) {
    throw new BadRequestException(`Şifrə ən azı ${MIN_ADMIN_PASSWORD} simvol olmalıdır`);
  }
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
    throw new BadRequestException('Şifrə e-poçt ünvanınızı ehtiva etməməlidir');
  }
}

// No register() here on purpose — operators join only through a
// SUPER_ADMIN's single-use invitation, or the private CLI (src/scripts).
@Injectable()
export class AdminAuthService {
  constructor(private prisma: PrismaService) {}

  private async issueSession(adminUserId: string, mfaVerified: boolean, userAgent?: string) {
    const sessionToken = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await this.prisma.adminSession.create({
      data: { sessionToken, adminUserId, expires, mfaVerified, userAgent: userAgent?.slice(0, 200) },
    });
    const user = await this.prisma.adminUser.update({ where: { id: adminUserId }, data: { lastLoginAt: new Date() } });
    return { adminUser: publicAdmin(user), sessionToken };
  }

  async login(email: string, password: string, userAgent?: string) {
    if (!email || !password) {
      throw new BadRequestException('E-poçt və şifrə tələb olunur');
    }
    const adminUser = await this.prisma.adminUser.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    const valid = await bcrypt.compare(password, adminUser?.hashedPassword ?? DUMMY_HASH);
    // Unknown, wrong password and disabled look the same from outside.
    if (!adminUser || !valid || adminUser.disabledAt) {
      throw new UnauthorizedException('E-poçt və ya şifrə yanlışdır');
    }

    if (adminUser.mfaEnabledAt) {
      const challengeToken = randomBytes(32).toString('hex');
      await this.prisma.adminLoginChallenge.deleteMany({ where: { adminUserId: adminUser.id } });
      await this.prisma.adminLoginChallenge.create({
        data: { tokenHash: sha256Hex(challengeToken), adminUserId: adminUser.id, expiresAt: new Date(Date.now() + CHALLENGE_MS) },
      });
      return { mfaRequired: true as const, challengeToken };
    }
    return this.issueSession(adminUser.id, false, userAgent);
  }

  /** Second step: a TOTP code or one unused recovery code. */
  async verifyMfa(challengeToken: string, code: string, userAgent?: string) {
    if (!challengeToken || !code) throw new BadRequestException('Kod tələb olunur');
    const challenge = await this.prisma.adminLoginChallenge.findUnique({ where: { tokenHash: sha256Hex(challengeToken) } });
    if (!challenge || challenge.expiresAt < new Date() || challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Təsdiq müddəti bitib. Yenidən daxil olun.');
    }
    // Count the attempt first, conditionally, so parallel guesses cannot
    // exceed the limit.
    const counted = await this.prisma.adminLoginChallenge.updateMany({
      where: { id: challenge.id, attempts: { lt: CHALLENGE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (!counted.count) throw new UnauthorizedException('Təsdiq müddəti bitib. Yenidən daxil olun.');

    const user = await this.prisma.adminUser.findUnique({ where: { id: challenge.adminUserId } });
    if (!user || user.disabledAt || !user.mfaEnabledAt || !user.mfaSecretEnc) {
      throw new UnauthorizedException('Təsdiq müddəti bitib. Yenidən daxil olun.');
    }
    if (!(await this.consumeSecondFactor(user, code))) {
      throw new UnauthorizedException('Kod yanlışdır');
    }
    const used = await this.prisma.adminLoginChallenge.deleteMany({ where: { id: challenge.id } });
    if (!used.count) throw new UnauthorizedException('Təsdiq müddəti bitib. Yenidən daxil olun.');
    return this.issueSession(user.id, true, userAgent);
  }

  /**
   * Accepts a TOTP code (never the same time step twice) or burns one
   * recovery code. Both updates are conditional, so a code races itself at
   * most once.
   */
  async consumeSecondFactor(user: AdminUser, code: string): Promise<boolean> {
    const key = mfaKey();
    const trimmed = code.trim();
    if (/^[0-9]{6}$/.test(trimmed)) {
      if (!key || !user.mfaSecretEnc) return false;
      const step = verifyTotp(decryptSecret(user.mfaSecretEnc, key), trimmed, user.mfaLastUsedStep);
      if (step === null) return false;
      const updated = await this.prisma.adminUser.updateMany({
        where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
        data: { mfaLastUsedStep: step },
      });
      return updated.count === 1;
    }
    const hash = sha256Hex(normalizeRecoveryCode(trimmed));
    if (!user.mfaRecoveryCodeHashes.includes(hash)) return false;
    const remaining = user.mfaRecoveryCodeHashes.filter((h) => h !== hash);
    const updated = await this.prisma.adminUser.updateMany({
      where: { id: user.id, mfaRecoveryCodeHashes: { has: hash } },
      data: { mfaRecoveryCodeHashes: remaining },
    });
    if (updated.count === 1) {
      await this.prisma.adminAuditLog.create({
        data: { adminUserId: user.id, action: 'ADMIN_RECOVERY_CODE_USED', targetType: 'AdminUser', targetId: user.id, metadata: { remaining: remaining.length } },
      });
    }
    return updated.count === 1;
  }

  async logout(sessionToken: string) {
    await this.prisma.adminSession.delete({ where: { sessionToken } }).catch(() => {});
    return { success: true };
  }

  // ------------------------------------------------ setup / recovery links --

  private async usableInvitation(token: string) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const invitation = await this.prisma.adminInvitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt < new Date()) return null;
    return invitation;
  }

  async describeSetup(token: string) {
    const invitation = await this.usableInvitation(token);
    if (!invitation) throw new BadRequestException('Keçid etibarsızdır, istifadə olunub və ya müddəti bitib');
    return { kind: invitation.kind, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt };
  }

  /** Consumes an invitation (creates the operator) or a reset link (sets a new password). */
  async completeSetup(token: string, password: string, name?: string) {
    const invitation = await this.usableInvitation(token);
    if (!invitation) throw new BadRequestException('Keçid etibarsızdır, istifadə olunub və ya müddəti bitib');
    assertStrongPassword(password, invitation.email);
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      // Single use, even under concurrent submissions.
      const claimed = await tx.adminInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException('Keçid artıq istifadə olunub');

      const existing = await tx.adminUser.findFirst({ where: { email: { equals: invitation.email, mode: 'insensitive' } } });
      if (invitation.kind === 'INVITE') {
        if (existing) throw new ConflictException('Bu e-poçt üçün operator hesabı artıq var');
        const created = await tx.adminUser.create({
          data: { email: invitation.email, hashedPassword, role: invitation.role, name: name?.trim().slice(0, 100) || null, passwordChangedAt: new Date() },
        });
        await tx.adminAuditLog.create({
          data: { adminUserId: created.id, action: 'ADMIN_INVITATION_ACCEPTED', targetType: 'AdminUser', targetId: created.id, metadata: { role: invitation.role, invitationId: invitation.id } },
        });
        return created;
      }
      if (!existing || existing.disabledAt) throw new BadRequestException('Keçid etibarsızdır, istifadə olunub və ya müddəti bitib');
      const updated = await tx.adminUser.update({ where: { id: existing.id }, data: { hashedPassword, passwordChangedAt: new Date() } });
      // A reset ends every existing session of that operator.
      await tx.adminSession.deleteMany({ where: { adminUserId: existing.id } });
      await tx.adminAuditLog.create({
        data: { adminUserId: existing.id, action: 'ADMIN_PASSWORD_RESET_COMPLETED', targetType: 'AdminUser', targetId: existing.id, metadata: { invitationId: invitation.id } },
      });
      return updated;
    });
    return { success: true, email: user.email };
  }
}
