import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { EmailDeliveryError, EmailService } from '../common/email.service';
import { PostHogService } from '../common/posthog.service';
import { escapeHtml, sanitizeHeaderValue } from '../common/text.util';
import { BusinessVerificationTokenPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

// Mirrors AuthService's verification/reset flow (see apps/api/src/auth/auth.service.ts).
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const GENERIC_VERIFICATION_RESPONSE = { success: true, message: 'Əgər bu e-poçt ünvanı ilə biznes hesabı mövcuddursa və hələ təsdiqlənməyibsə, təsdiq e-poçtu göndərildi.' };
const GENERIC_RESET_RESPONSE = { success: true, message: 'Əgər bu e-poçt ünvanı ilə biznes hesabı mövcuddursa, şifrə sıfırlama e-poçtu göndərildi.' };

@Injectable()
export class BusinessAuthService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private postHogService: PostHogService,
  ) {}

  async register(email: string, password: string, companyName: string) {
    if (!email || !password || !companyName) {
      throw new BadRequestException('E-poçt, şifrə və şirkət adı tələb olunur');
    }

    const genericResponse = {
      email,
      message: 'Qeydiyyat uğurla tamamlandı. Daxil olmadan əvvəl zəhmət olmasa biznes e-poçtunuzu təsdiqləyin.',
    };

    const existing = await this.prisma.business.findUnique({
      where: { email },
    });

    // Don't create a duplicate account, and don't reveal whether the address
    // is already registered — same response either way.
    if (existing) {
      return genericResponse;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const business = await this.prisma.business.create({
      data: {
        email,
        hashedPassword,
        company: {
          create: {
            name: companyName,
            status: 'PENDING',
          },
        },
      },
    });

    await this.issueVerificationEmail(business.id, business.email);
    this.postHogService.capture(business.id, 'business_registered', { email: business.email });

    // Registration only creates the account — no session is issued here.
    // The business must verify its email before POST /business/auth/login succeeds.
    return genericResponse;
  }

  async verifyEmail(token: string) {
    const verificationToken = await this.prisma.businessVerificationToken.findUnique({
      where: { token },
    });

    if (!verificationToken || verificationToken.purpose !== BusinessVerificationTokenPurpose.EMAIL_VERIFY) {
      throw new BadRequestException('Təsdiq linki etibarsızdır və ya vaxtı bitib');
    }

    if (verificationToken.expires < new Date()) {
      await this.prisma.businessVerificationToken.delete({ where: { id: verificationToken.id } }).catch(() => {});
      throw new BadRequestException('Təsdiq linki etibarsızdır və ya vaxtı bitib');
    }

    await this.prisma.business.update({
      where: { id: verificationToken.businessId },
      data: { emailVerified: new Date() },
    });

    await this.prisma.businessVerificationToken.deleteMany({
      where: { businessId: verificationToken.businessId, purpose: BusinessVerificationTokenPurpose.EMAIL_VERIFY },
    });

    this.postHogService.capture(verificationToken.businessId, 'business_email_verified');

    return { success: true, message: 'E-poçt uğurla təsdiqləndi. İndi daxil ola bilərsiniz.' };
  }

  async resendVerification(email: string) {
    const business = await this.prisma.business.findUnique({ where: { email } });

    if (!business || business.emailVerified) {
      return GENERIC_VERIFICATION_RESPONSE;
    }

    await this.issueVerificationEmail(business.id, business.email);
    return GENERIC_VERIFICATION_RESPONSE;
  }

  async forgotPassword(email: string) {
    const business = await this.prisma.business.findUnique({ where: { email } });

    if (!business) {
      return GENERIC_RESET_RESPONSE;
    }

    const token = await this.issueToken(business.id, BusinessVerificationTokenPurpose.PASSWORD_RESET, PASSWORD_RESET_TOKEN_TTL_MS);

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/reset-password?token=${token}`;
    const subject = sanitizeHeaderValue('AISE biznes şifrənizi sıfırlayın');
    const html = `
      <h1>Şifrənizi sıfırlayın</h1>
      <p>Salam,</p>
      <p><strong>${escapeHtml(email)}</strong> biznes hesabı üçün şifrə sıfırlama tələbi aldıq. Yeni şifrə seçmək üçün aşağıdakı linkə klikləyin:</p>
      <p><a href="${resetUrl}">Şifrəmi sıfırla</a></p>
      <p>Bu link 1 saat ərzində etibarlıdır. Əgər bu tələbi siz göndərməmisinizsə, bu e-poçtu nəzərə almaya bilərsiniz — şifrəniz dəyişməyəcək.</p>
      <p>Hörmətlə,<br>AISE komandası</p>
    `;
    await this.dispatchEmail(email, subject, html);

    return GENERIC_RESET_RESPONSE;
  }

  async resetPassword(token: string, newPassword: string) {
    const resetToken = await this.prisma.businessVerificationToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.purpose !== BusinessVerificationTokenPurpose.PASSWORD_RESET) {
      throw new BadRequestException('Sıfırlama linki etibarsızdır və ya vaxtı bitib');
    }

    if (resetToken.expires < new Date()) {
      await this.prisma.businessVerificationToken.delete({ where: { id: resetToken.id } }).catch(() => {});
      throw new BadRequestException('Sıfırlama linki etibarsızdır və ya vaxtı bitib');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.business.update({
      where: { id: resetToken.businessId },
      data: { hashedPassword },
    });

    await this.prisma.businessVerificationToken.deleteMany({
      where: { businessId: resetToken.businessId, purpose: BusinessVerificationTokenPurpose.PASSWORD_RESET },
    });
    await this.prisma.businessSession.deleteMany({ where: { businessId: resetToken.businessId } });

    return { success: true, message: 'Şifrə uğurla sıfırlandı. İndi yeni şifrənizlə daxil ola bilərsiniz.' };
  }

  // Authenticated in-session password change (distinct from the forgot/reset
  // flow above, which is for a locked-out business).
  async changePassword(businessId: string, currentSessionToken: string, currentPassword: string, newPassword: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });

    if (!business) {
      throw new UnauthorizedException('Hesab tapılmadı');
    }

    const isValid = await bcrypt.compare(currentPassword, business.hashedPassword);
    if (!isValid) {
      throw new UnauthorizedException('Cari şifrə yanlışdır');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.business.update({ where: { id: businessId }, data: { hashedPassword } });

    // Same posture as the User-side changePassword/resetPassword: a changed
    // password is a strong signal any *other* session may not be the
    // account owner any more (stolen token, unattended device) — leave only
    // the session that made this request alone.
    await this.prisma.businessSession.deleteMany({
      where: { businessId, sessionToken: { not: currentSessionToken } },
    });

    return { success: true, message: 'Şifrə uğurla yeniləndi.' };
  }

  private async issueVerificationEmail(businessId: string, email: string) {
    const token = await this.issueToken(businessId, BusinessVerificationTokenPurpose.EMAIL_VERIFY, VERIFICATION_TOKEN_TTL_MS);

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/business/verify-email?token=${token}`;
    const subject = sanitizeHeaderValue('AISE biznes e-poçt ünvanınızı təsdiqləyin');
    const html = `
      <h1>Biznes e-poçtunuzu təsdiqləyin</h1>
      <p>Salam,</p>
      <p>Şirkətinizi AISE-də qeydiyyatdan keçirdiyiniz üçün təşəkkür edirik. <strong>${escapeHtml(email)}</strong> ünvanının sizə aid olduğunu təsdiqləmək üçün aşağıdakı linkə klikləyin:</p>
      <p><a href="${verifyUrl}">E-poçtumu təsdiqlə</a></p>
      <p>Bu link 24 saat ərzində etibarlıdır. Əgər bu hesabı siz yaratmamısınızsa, bu e-poçtu nəzərə almaya bilərsiniz.</p>
      <p>Hörmətlə,<br>AISE komandası</p>
    `;

    await this.dispatchEmail(email, subject, html);
  }

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

  private async issueToken(businessId: string, purpose: BusinessVerificationTokenPurpose, ttlMs: number): Promise<string> {
    await this.prisma.businessVerificationToken.deleteMany({ where: { businessId, purpose } });

    const token = randomBytes(32).toString('hex');
    await this.prisma.businessVerificationToken.create({
      data: {
        token,
        businessId,
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

    const business = await this.prisma.business.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!business) {
      throw new UnauthorizedException('E-poçt və ya şifrə yanlışdır');
    }

    const isPasswordValid = await bcrypt.compare(password, business.hashedPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('E-poçt və ya şifrə yanlışdır');
    }

    if (!business.emailVerified) {
      // Frontend matches on "e-poçtunuzu təsdiqləyin" — keep this exact
      // wording if you touch this message (see auth.service.ts's login()).
      throw new ForbiddenException('Daxil olmadan əvvəl zəhmət olmasa e-poçtunuzu təsdiqləyin');
    }

    const sessionToken = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);

    await this.prisma.businessSession.create({
      data: {
        sessionToken,
        businessId: business.id,
        expires,
      },
    });

    const { hashedPassword: _, ...result } = business;
    return { business: result, sessionToken };
  }

  async logout(sessionToken: string) {
    await this.prisma.businessSession.delete({
      where: { sessionToken },
    }).catch(() => {});
    return { success: true };
  }
}
