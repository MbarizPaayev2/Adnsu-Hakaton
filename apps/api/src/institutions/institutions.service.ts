import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/text.util';
import type { InstitutionEnquiryDto } from './institution-enquiry.dto';

const TIMING: Record<string, string> = { this_month: 'bu ay', next_month: 'gələn ay', later: 'daha sonra', exploring: 'yalnız məlumat' };

/**
 * Pilot enquiries from academies, training providers and universities. Stored, and the team is told by email. Nothing is sent to the enquirer
 * automatically and nothing is purchased: a person replies. No student data is collected here.
 */
@Injectable()
export class InstitutionsService {
  private readonly logger = new Logger(InstitutionsService.name);
  constructor(private prisma: PrismaService, private email: EmailService, private config: ConfigService) {}

  async enquire(dto: InstitutionEnquiryDto): Promise<{ received: true }> {
    // A filled honeypot is answered the same way and stored nowhere.
    if (dto.website?.trim()) return { received: true };
    const row = await this.prisma.institutionEnquiry.create({
      data: {
        organization: dto.organization.trim(),
        contactName: dto.contactName.trim(),
        role: dto.role?.trim() || null,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        cohortSize: dto.cohortSize ?? null,
        timing: dto.timing ?? null,
        message: dto.message?.trim() || null,
      },
    });
    const to = this.config.get<string>('INSTITUTION_ENQUIRY_EMAIL') || 'ceo@aisehr.com';
    const lines: [string, string | null][] = [
      ['Təşkilat', row.organization], ['Əlaqə şəxsi', row.contactName], ['Vəzifə', row.role], ['E-poçt', row.email], ['Telefon', row.phone],
      ['Qrup ölçüsü', row.cohortSize ? String(row.cohortSize) : null], ['Vaxt', row.timing ? TIMING[row.timing] : null], ['Mesaj', row.message],
    ];
    const html = `<p>Yeni pilot sorğusu (${escapeHtml(row.id)}).</p><table>${lines.filter(([, v]) => v).map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
    await this.email.send(to, `AISE pilot sorğusu: ${row.organization.slice(0, 80)}`, html, { idempotencyKey: `institution-enquiry-${row.id}` }).catch((error) => {
      // The enquiry is stored either way; the team sees it in the database if the notice fails.
      this.logger.warn(`institution enquiry ${row.id}: notice not sent (${(error as Error)?.constructor?.name ?? 'Error'})`);
    });
    return { received: true };
  }
}
