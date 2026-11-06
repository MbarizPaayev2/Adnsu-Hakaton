/**
 * Synthetic data for manual and scripted UI checks against a LOCAL database:
 * one candidate with matches and applications in several states, one
 * approved employer with a vacancy and an application, and one operator.
 * Idempotent: rerunning replaces the previous ux-* fixture rows.
 *
 *   DATABASE_URL=…/aise_ux npx ts-node --transpile-only test/support/ux-fixture.ts [--remove]
 *
 * Its own database, never the shared e2e one: its active vacancy and jobs
 * would be matched to e2e users and use up their plan quota. Refuses anything
 * but a local aise_ux or aise_release_rehearsal database.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const UX_PASSWORD = 'Synthetic-UX-Pass-1';
export const UX_EMAILS = { candidate: 'ux-candidate@example.com', employer: 'ux-employer@example.com', admin: 'ux-admin@example.com' };

function writeUpload(bytes: Buffer, ext: string) {
  const dir = process.env.UX_UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, name), bytes);
  return `/uploads/${name}`;
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 58>>stream\nBT /F1 18 Tf 72 760 Td (Sintetik Namized - Backend CV) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** Removes every ux-* fixture row (and nothing else). */
export async function removeUxFixture(prisma: PrismaClient) {
  await prisma.user.deleteMany({ where: { email: UX_EMAILS.candidate } });
  await prisma.business.deleteMany({ where: { email: UX_EMAILS.employer } });
  const oldAdmin = await prisma.adminUser.findUnique({ where: { email: UX_EMAILS.admin } });
  if (oldAdmin) {
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: oldAdmin.id } });
    await prisma.adminUser.delete({ where: { id: oldAdmin.id } });
  }
  await prisma.job.deleteMany({ where: { externalId: { startsWith: 'glorri:ux-' } } });
}

export async function seedUxFixture(prisma: PrismaClient) {
  await removeUxFixture(prisma);

  const hashedPassword = await bcrypt.hash(UX_PASSWORD, 10);
  const cvUrl = writeUpload(PDF, '.pdf');

  const candidate = await prisma.user.create({
    data: {
      email: UX_EMAILS.candidate, name: 'Sintetik Namizəd', hashedPassword, emailVerified: new Date(),
      subscription: { create: { plan: 'FREE', status: 'active', matchesUsedThisPeriod: 2 } },
      profile: { create: { headline: 'Backend proqramçı', location: 'Bakı', skills: ['Node.js', 'TypeScript', 'PostgreSQL'], jobPreferences: {}, onboardingCompletedAt: new Date() } },
      resumes: { create: { isBase: true, status: 'READY', fileUrl: cvUrl } },
    },
  });

  const jobs = await Promise.all(
    [
      { slug: 'backend', title: 'Backend proqramçı (Node.js)', company: 'Sintetik Texnologiya MMC', location: 'Bakı' },
      { slug: 'fullstack', title: 'Full-stack mühəndis', company: 'Nümunə Rəqəmsal', location: 'Bakı' },
      { slug: 'data', title: 'Verilənlər analitiki', company: 'Test Analitika', location: 'Gəncə' },
    ].map((j) =>
      prisma.job.create({
        data: {
          externalId: `glorri:ux-${j.slug}`, title: j.title, company: j.company, location: j.location,
          description: 'Sintetik vakansiya təsviri: Node.js, TypeScript və PostgreSQL ilə backend xidmətləri.',
          url: `https://jobs.glorri.com/vacancies/ux-fixture/${j.slug}`, postedAt: new Date(), lastSeenAt: new Date(),
        } as any,
      }),
    ),
  );
  const matches = await Promise.all(
    jobs.map((job, i) =>
      prisma.match.create({
        data: {
          userId: candidate.id, jobId: job.id, score: [0.91, 0.78, 0.64][i], status: i === 0 ? 'NEW' : i === 2 ? 'APPLIED' : 'VIEWED',
          details: { score: [0.91, 0.78, 0.64][i], matchedKeywords: ['Node.js', 'TypeScript'], gaps: i === 2 ? ['Power BI'] : [] },
        },
      }),
    ),
  );
  await prisma.externalApplication.create({
    data: {
      userId: candidate.id, matchId: matches[1].id, status: 'DELIVERY_UNCONFIRMED', applyUrl: jobs[1].url,
      // Snapshot/screenshot columns, so backup and restore checks cover them.
      cvSnapshotUrl: writeUpload(PDF, '.pdf'), reviewScreenshotUrl: writeUpload(Buffer.from('89504e470d0a1a0a synthetic screenshot'), '.png'),
    },
  });

  const business = await prisma.business.create({ data: { email: UX_EMAILS.employer, hashedPassword, emailVerified: new Date() } as any });
  const company = await prisma.company.create({
    data: { businessId: business.id, name: 'Sintetik İşəgötürən MMC', status: 'APPROVED', location: 'Bakı', industry: 'İnformasiya texnologiyaları', description: 'Yalnız test üçün yaradılmış şirkət.' },
  });
  const vacancy = await prisma.vacancy.create({
    data: { companyId: company.id, title: 'Junior QA mühəndisi', description: 'Sintetik vakansiya.', location: 'Bakı', skills: ['Test', 'SQL'], employmentType: 'Tam ştat' },
  });
  const applicationCv = writeUpload(PDF, '.pdf');
  await prisma.application.create({
    data: { vacancyId: vacancy.id, userId: candidate.id, files: { create: { fileUrl: applicationCv, fieldName: 'cv', originalName: 'CV.pdf', mimeType: 'application/pdf' } } },
  });

  await prisma.adminUser.create({ data: { email: UX_EMAILS.admin, hashedPassword, role: 'SUPER_ADMIN', name: 'UX Operator' } });
  return { candidateId: candidate.id, companyId: company.id };
}

if (require.main === module) {
  const url = new URL(process.env.DATABASE_URL || '');
  // Local, and only the test database or a throwaway release-rehearsal one.
  const removeOnly = process.argv.includes('--remove');
  // --remove may also clean the shared e2e database.
  const allowed = ['/aise_ux', '/aise_release_rehearsal', ...(removeOnly ? ['/aise_phase2_test'] : [])];
  if (url.hostname !== '127.0.0.1' || !allowed.includes(url.pathname)) {
    console.error('Refusing: ux-fixture only runs against a local aise_ux or rehearsal database.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  (removeOnly ? removeUxFixture(prisma) : seedUxFixture(prisma))
    .then(() => console.log(removeOnly ? 'UX fixture removed.' : 'UX fixture ready (synthetic data only).'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
