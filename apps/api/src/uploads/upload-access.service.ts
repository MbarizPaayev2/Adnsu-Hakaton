import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.service';

export type UploadPrincipal =
  | { kind: 'admin' }
  | { kind: 'user'; userId: string }
  | { kind: 'business'; businessId: string };

@Injectable()
export class UploadAccessService {
  constructor(private prisma: PrismaService) {}

  async canRead(principal: UploadPrincipal, filename: string): Promise<boolean> {
    const fileUrl = `/uploads/${filename}`;

    if (principal.kind === 'admin') {
      return true;
    }

    if (principal.kind === 'user') {
      const { userId } = principal;
      const [resume, profile, appFile, appAnswer, screenshot] = await Promise.all([
        this.prisma.resume.findFirst({ where: { userId, fileUrl } }),
        this.prisma.profile.findFirst({ where: { userId, idDocumentUrl: fileUrl } }),
        this.prisma.applicationFile.findFirst({
          where: { fileUrl, application: { userId } },
        }),
        this.prisma.applicationAnswer.findFirst({
          where: { fileUrl, application: { userId } },
        }),
        this.prisma.externalApplication.findFirst({
          where: { userId, reviewScreenshotUrl: fileUrl },
        }),
      ]);
      return Boolean(resume || profile || appFile || appAnswer || screenshot);
    }

    const { businessId } = principal;
    const [company, appFile, appAnswer] = await Promise.all([
      this.prisma.company.findFirst({ where: { businessId, logo: fileUrl } }),
      this.prisma.applicationFile.findFirst({
        where: { fileUrl, application: { vacancy: { company: { businessId } } } },
      }),
      this.prisma.applicationAnswer.findFirst({
        where: { fileUrl, application: { vacancy: { company: { businessId } } } },
      }),
    ]);
    return Boolean(company || appFile || appAnswer);
  }
}
