import { PrismaClient, AcademyRole, EnrollmentStatus } from '@prisma/client';
import { AcademySponsorshipService } from './sponsorship.service';

const integrationDescribe = process.env.RUN_ACADEMY_SPONSORSHIP_INTEGRATION === '1' ? describe : describe.skip;

integrationDescribe('academy sponsorship on local PostgreSQL', () => {
  let prisma: PrismaClient;
  let service: AcademySponsorshipService;
  let academyId: string;
  let adminId: string;
  const userIds: string[] = [];
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5433/aise?schema=public';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await prisma.$connect();
    service = new AcademySponsorshipService(prisma as never);
    const stamp = Date.now();
    const admin = await prisma.adminUser.create({ data: { email: `sponsor-admin-${stamp}@integration.test`, hashedPassword: 'hash', role: 'ADMIN' } });
    adminId = admin.id;
    const owner = await prisma.user.create({ data: { email: `sponsor-owner-${stamp}@integration.test`, hashedPassword: 'hash' } });
    userIds.push(owner.id);
    const academy = await prisma.academy.create({ data: {
      name: `Sponsor Test ${stamp}`, slug: `sponsor-test-${stamp}`, contactEmail: `academy-${stamp}@integration.test`,
      members: { create: { userId: owner.id, role: AcademyRole.OWNER } },
    } });
    academyId = academy.id;
    const cohort = await prisma.academyCohort.create({ data: { academyId, name: 'Sponsor cohort', slug: 'sponsor-cohort', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.create({ data: { email: `sponsor-student-${i}-${stamp}@integration.test`, hashedPassword: 'hash', emailVerified: new Date() } });
      userIds.push(user.id);
      await prisma.academyEnrollment.create({ data: { academyId, cohortId: cohort.id, userId: user.id, invitedEmail: user.email, inviteToken: `sponsor-token-${i}-${stamp}`, status: EnrollmentStatus.ACTIVE, joinedAt: new Date() } });
    }
  });

  afterAll(async () => {
    if (academyId) await prisma.academy.delete({ where: { id: academyId } }).catch(() => {});
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    if (adminId) await prisma.adminUser.delete({ where: { id: adminId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('serializes the final seat, deduplicates a student across cohorts, and keeps access after analytics consent withdrawal', async () => {
    const end = new Date(Date.now() + 30 * 86_400_000);
    await service.provision(academyId, adminId, { plan: 'PLUS', seatCapacity: 1, startsAt: new Date(Date.now() - 60_000), endsAt: end });
    const students = userIds.slice(1);
    const claims = await Promise.allSettled(students.map((id) => service.grant(academyId, adminId, id)));
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(1);

    const winnerId = students[claims.findIndex((claim) => claim.status === 'fulfilled')];
    const anotherCohort = await prisma.academyCohort.create({ data: { academyId, name: 'Second cohort', slug: 'sponsor-cohort-2', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    const winner = await prisma.user.findUniqueOrThrow({ where: { id: winnerId } });
    const secondEnrollment = await prisma.academyEnrollment.create({ data: { academyId, cohortId: anotherCohort.id, userId: winnerId, invitedEmail: winner.email, inviteToken: `sponsor-repeat-${Date.now()}`, status: EnrollmentStatus.ACTIVE, joinedAt: new Date() } });
    const duplicate = await service.grant(academyId, adminId, winnerId);
    expect(duplicate.alreadyGranted).toBe(true);
    expect(await prisma.academySeatGrant.count({ where: { academyId, userId: winnerId, status: 'ACTIVE' } })).toBe(1);

    await prisma.academyConsent.create({ data: { academyId, enrollmentId: secondEnrollment.id, userId: winnerId, scope: 'AGGREGATE_ONLY', revokedAt: new Date() } });
    expect(await prisma.academySeatGrant.count({ where: { academyId, userId: winnerId, status: 'ACTIVE', endsAt: { gt: new Date() } } })).toBe(1);
    expect(await prisma.planOverride.count({ where: { userId: winnerId, academySeatGrantId: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } } })).toBe(1);
    expect(await prisma.subscription.findUnique({ where: { userId: winnerId } })).toBeNull();
  });
});
