import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { LEGAL_VERSION, termsAcceptanceRequired } from './legal';
import { GoogleIdentityService, type GoogleProfile } from './google-identity.service';
import { PrismaService } from '../database/database.service';
import { EmailDeliveryError, EmailService } from '../common/email.service';
import { PostHogService } from '../common/posthog.service';
import { escapeHtml, sanitizeHeaderValue } from '../common/text.util';
import { VerificationTokenPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

// Verification links expire after this long; resend issues a fresh one.
const VERIFICATION_TOKEN_TTL_MS = 10 * 60 * 1000;
// Password reset links are shorter-lived than email verification — a stolen
// reset link is a full account takeover, not just an unverified nuisance.
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Generic responses for anything keyed by email, so the caller can never learn
// from the response whether an address is registered, verified, or unverified.
const GENERIC_VERIFICATION_RESPONSE = { success: true, message: 'Əgər bu e-poçt ünvanı ilə hesab mövcuddursa və hələ təsdiqlənməyibsə, təsdiq e-poçtu göndərildi.' };
const GENERIC_RESET_RESPONSE = { success: true, message: 'Əgər bu e-poçt ünvanı ilə hesab mövcuddursa, şifrə sıfırlama e-poçtu göndərildi.' };

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private postHogService: PostHogService,
    private google: GoogleIdentityService,
  ) {}

  async register(email: string, password: string, acceptTerms?: boolean, name?: string) {
    if (!email || !password) {
      throw new BadRequestException('E-poçt və şifrə tələb olunur');
    }
    if (termsAcceptanceRequired() && acceptTerms !== true) {
      throw new BadRequestException('Qeydiyyat üçün İstifadə Şərtləri və Məxfilik Siyasəti ilə razılaşmalısınız');
    }

    const genericResponse = {
      email,
      message: 'Qeydiyyat uğurla tamamlandı. Daxil olmadan əvvəl zəhmət olmasa e-poçtunuzu təsdiqləyin.',
    };

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    // Don't create a duplicate account, and don't reveal whether the address
    // is already registered — same response either way. But if they haven't
    // verified yet, treat this like a resend so a lost/expired first email
    // doesn't strand them with no way back in short of the throttled
    // resend-verification endpoint.
    if (existingUser) {
      if (!existingUser.emailVerified) {
        await this.issueVerificationEmail(existingUser.id, existingUser.email);
      }
      return genericResponse;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        hashedPassword,
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(acceptTerms === true ? { legalAcceptedAt: new Date(), legalVersion: LEGAL_VERSION, legalAcceptedVia: 'register-checkbox' } : {}),
        subscription: {
          create: {
            plan: 'FREE',
            status: 'active',
          },
        },
      },
      include: {
        subscription: true,
      },
    });

    await this.issueVerificationEmail(user.id, user.email);
    this.postHogService.capture(user.id, 'user_registered', { email: user.email });

    // Registration only creates the account — no session is issued here.
    // The user must verify their email (POST /auth/verify-email) before
    // they're able to log in at all.
    return genericResponse;
  }

  async verifyEmail(token: string) {
    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!verificationToken || verificationToken.purpose !== VerificationTokenPurpose.EMAIL_VERIFY) {
      throw new BadRequestException('Təsdiq linki etibarsızdır və ya vaxtı bitib');
    }

    if (verificationToken.expires < new Date()) {
      await this.prisma.verificationToken.delete({ where: { id: verificationToken.id } }).catch(() => {});
      throw new BadRequestException('Təsdiq linki etibarsızdır və ya vaxtı bitib');
    }

    await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: { emailVerified: new Date() },
    });

    // Consume every outstanding verification token for this user, not just the one used.
    await this.prisma.verificationToken.deleteMany({
      where: { userId: verificationToken.userId, purpose: VerificationTokenPurpose.EMAIL_VERIFY },
    });

    this.postHogService.capture(verificationToken.userId, 'user_email_verified');

    return { success: true, message: 'E-poçt uğurla təsdiqləndi. İndi daxil ola bilərsiniz.' };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Don't reveal whether the address is registered or already verified.
    if (!user || user.emailVerified) {
      return GENERIC_VERIFICATION_RESPONSE;
    }

    await this.issueVerificationEmail(user.id, user.email);
    return GENERIC_VERIFICATION_RESPONSE;
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Don't reveal whether the address is registered.
    if (!user) {
      return GENERIC_RESET_RESPONSE;
    }

    const token = await this.issueToken(user.id, VerificationTokenPurpose.PASSWORD_RESET, PASSWORD_RESET_TOKEN_TTL_MS);

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    const subject = sanitizeHeaderValue('AISE şifrənizi sıfırlayın');
    const html = `
      <h1>Şifrənizi sıfırlayın</h1>
      <p>Salam,</p>
      <p><strong>${escapeHtml(email)}</strong> hesabı üçün şifrə sıfırlama tələbi aldıq. Yeni şifrə seçmək üçün aşağıdakı linkə klikləyin:</p>
      <p><a href="${resetUrl}">Şifrəmi sıfırla</a></p>
      <p>Bu link 1 saat ərzində etibarlıdır. Əgər bu tələbi siz göndərməmisinizsə, bu e-poçtu nəzərə almaya bilərsiniz — şifrəniz dəyişməyəcək.</p>
      <p>Hörmətlə,<br>AISE komandası</p>
    `;
    await this.dispatchEmail(email, subject, html);

    return GENERIC_RESET_RESPONSE;
  }

  async resetPassword(token: string, newPassword: string) {
    const resetToken = await this.prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.purpose !== VerificationTokenPurpose.PASSWORD_RESET) {
      throw new BadRequestException('Sıfırlama linki etibarsızdır və ya vaxtı bitib');
    }

    if (resetToken.expires < new Date()) {
      await this.prisma.verificationToken.delete({ where: { id: resetToken.id } }).catch(() => {});
      throw new BadRequestException('Sıfırlama linki etibarsızdır və ya vaxtı bitib');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { hashedPassword },
    });

    // Consume every outstanding reset token, and sign the user out everywhere —
    // a password reset is a strong signal the old sessions may be compromised.
    await this.prisma.verificationToken.deleteMany({
      where: { userId: resetToken.userId, purpose: VerificationTokenPurpose.PASSWORD_RESET },
    });
    await this.prisma.session.deleteMany({ where: { userId: resetToken.userId } });

    return { success: true, message: 'Şifrə uğurla sıfırlandı. İndi yeni şifrənizlə daxil ola bilərsiniz.' };
  }

  private async issueVerificationEmail(userId: string, email: string) {
    const token = await this.issueToken(userId, VerificationTokenPurpose.EMAIL_VERIFY, VERIFICATION_TOKEN_TTL_MS);

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
    const subject = sanitizeHeaderValue('AISE e-poçt ünvanınızı təsdiqləyin');
    const html = `
      <h1>E-poçtunuzu təsdiqləyin</h1>
      <p>Salam,</p>
      <p>AISE-də qeydiyyatdan keçdiyiniz üçün təşəkkür edirik. <strong>${escapeHtml(email)}</strong> ünvanının sizə aid olduğunu təsdiqləmək üçün aşağıdakı linkə klikləyin:</p>
      <p><a href="${verifyUrl}">E-poçtumu təsdiqlə</a></p>
      <p>Bu link 10 dəqiqə ərzində etibarlıdır. Əgər bu hesabı siz yaratmamısınızsa, bu e-poçtu nəzərə almaya bilərsiniz.</p>
      <p>Hörmətlə,<br>AISE komandası</p>
    `;

    await this.dispatchEmail(email, subject, html);
  }

  // Email-keyed auth responses must stay generic even when delivery fails,
  // otherwise HTTP 5xx would reveal that an unverified account exists.
  private async dispatchEmail(email: string, subject: string, html: string): Promise<void> {
    try {
      await this.emailService.send(email, subject, html);
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        return;
      }
      throw error;
    }
  }

  private async issueToken(userId: string, purpose: VerificationTokenPurpose, ttlMs: number): Promise<string> {
    // Old tokens of the same purpose for this user are no longer valid once a new one is issued.
    await this.prisma.verificationToken.deleteMany({ where: { userId, purpose } });

    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        token,
        userId,
        purpose,
        expires: new Date(Date.now() + ttlMs),
      },
    });

    return token;
  }

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('E-poçt və şifrə tələb olunur');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        subscription: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('E-poçt və ya şifrə yanlışdır');
    }

    const isPasswordValid = await bcrypt.compare(password, user.hashedPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('E-poçt və ya şifrə yanlışdır');
    }

    if (user.suspendedAt) {
      throw new ForbiddenException('Hesabınız müvəqqəti dayandırılıb. Dəstək ilə əlaqə saxlayın.');
    }
    if (!user.emailVerified) {
      // The frontend matches on the phrase "e-poçtunuzu təsdiqləyin" (all
      // lowercase, no dotted/dotless-İ casing footgun) to show a resend
      // button — keep this exact wording if you touch this message.
      throw new ForbiddenException('Daxil olmadan əvvəl zəhmət olmasa e-poçtunuzu təsdiqləyin');
    }

    // Create session
    const sessionToken = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30); // 30 days session

    await this.prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    const { hashedPassword: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      sessionToken,
    };
  }

  /**
   * Sign in (or up) with Google. The ID token is verified here; only a Google-verified e-mail is trusted.
   *  1. A Google identity already linked (provider + subject) signs in to its account.
   *  2. Otherwise the e-mail decides, case-insensitively: no account -> a normal candidate account (same shape as e-mail registration, verified because Google verified it);
   *     exactly one account -> that account is LINKED (CV, profile, matches, saved jobs stay with it); more than one match, or an account already linked to a DIFFERENT
   *     Google identity, is ambiguous and refused (409) instead of merged or duplicated.
   *  3. Linking to an account whose e-mail was never verified first ends every session and replaces its password with an unusable one: whoever pre-registered the
   *     address (and knows that password) must not inherit the real owner's Google sign-in.
   * Returns the same { user, sessionToken } as /auth/login. Ordinary password login is untouched.
   */
  async googleSignIn(idToken: string, acceptTerms?: boolean) {
    const profile = await this.google.verify(idToken);
    const user = await this.resolveGoogleUser(profile, acceptTerms === true);
    if (user.suspendedAt) throw new ForbiddenException('Hesabınız müvəqqəti dayandırılıb. Dəstək ilə əlaqə saxlayın.');
    const sessionToken = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    await this.prisma.session.create({ data: { sessionToken, userId: user.id, expires } });
    const { hashedPassword: _, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, sessionToken };
  }

  private async resolveGoogleUser(profile: GoogleProfile, acceptedTerms: boolean) {
    const linked = await this.prisma.account.findUnique({ where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.sub } }, include: { user: { include: { subscription: true } } } });
    if (linked) return linked.user;

    const matches = await this.prisma.user.findMany({ where: { email: { equals: profile.email, mode: 'insensitive' } }, include: { subscription: true }, take: 2 });
    if (matches.length > 1) throw new ConflictException('Bu e-poçt ünvanı ilə bir neçə hesab tapıldı; dəstək ilə əlaqə saxlayın');
    const link = (userId: string) => this.prisma.account.create({ data: { userId, type: 'oauth', provider: 'google', providerAccountId: profile.sub } });

    if (matches.length === 1) {
      const existing = matches[0];
      const other = await this.prisma.account.findFirst({ where: { userId: existing.id, provider: 'google' } });
      if (other) throw new ConflictException('Bu hesab başqa Google hesabına bağlıdır');
      if (!existing.emailVerified) {
        const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
        await this.prisma.$transaction([
          this.prisma.session.deleteMany({ where: { userId: existing.id } }),
          this.prisma.verificationToken.deleteMany({ where: { userId: existing.id } }),
          this.prisma.user.update({ where: { id: existing.id }, data: { hashedPassword: unusable, emailVerified: new Date() } }),
        ]);
      }
      await link(existing.id);
      this.postHogService.capture(existing.id, 'google_account_linked');
      return this.prisma.user.findUniqueOrThrow({ where: { id: existing.id }, include: { subscription: true } });
    }

    if (termsAcceptanceRequired() && !acceptedTerms) {
      throw new BadRequestException('Hesab yaratmaq üçün İstifadə Şərtləri və Məxfilik Siyasəti ilə razılaşmalısınız');
    }
    const created = await this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        hashedPassword: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
        emailVerified: new Date(),
        ...(acceptedTerms ? { legalAcceptedAt: new Date(), legalVersion: LEGAL_VERSION, legalAcceptedVia: 'google-notice' } : {}),
        subscription: { create: { plan: 'FREE', status: 'active' } },
        accounts: { create: { type: 'oauth', provider: 'google', providerAccountId: profile.sub } },
      },
      include: { subscription: true },
    });
    this.postHogService.capture(created.id, 'user_registered', { email: created.email, provider: 'google' });
    return created;
  }

  async logout(sessionToken: string) {
    await this.prisma.session.delete({
      where: { sessionToken },
    }).catch(() => {});
    return { success: true };
  }

  async changePassword(userId: string, currentSessionToken: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Hesab tapılmadı');
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.hashedPassword);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Hazırkı şifrə yanlışdır');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { hashedPassword } });

    // Same posture as a forgot-password reset: a changed password is a strong
    // signal any *other* session may not be the account owner any more. The
    // session making this request is left alone so the user isn't logged
    // out of the tab they just used to change it.
    await this.prisma.session.deleteMany({
      where: { userId, sessionToken: { not: currentSessionToken } },
    });

    this.postHogService.capture(userId, 'user_password_changed');

    return { success: true, message: 'Şifrə uğurla dəyişdirildi.' };
  }
}
