import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { Injectable } from '@nestjs/common';
import { actionableJobWhere } from '../jobs/jobs.service';
import { MATCH_SCORE_THRESHOLD } from '../matching/matching.service';
import { PrismaService } from '../database/database.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary(userId: string) {
    const recommendations = { userId, score: { gte: MATCH_SCORE_THRESHOLD }, OR: [
      { job: { is: actionableJobWhere() } },
      { vacancy: { is: { status: 'ACTIVE' as const, company: { status: 'APPROVED' as const }, AND: [{ OR: [{ deadline: null }, { deadline: { gte: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] } } },
    ] };
    const [user, totalMatches, newMatches, totalResumes, recentMatches] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true, planOverrides: activePlanOverrides() },
      }),
      this.prisma.match.count({ where: recommendations }),
      this.prisma.match.count({ where: { ...recommendations, status: 'NEW' } }),
      this.prisma.resume.count({ where: { userId } }),
      this.prisma.match.findMany({
        where: recommendations,
        include: { job: true, vacancy: { include: { company: true } } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: 3,
      }),
    ]);

    return {
      user: user ? { name: user.name, email: user.email } : null,
      plan: effectivePlan(user),
      stats: {
        totalMatches,
        newMatches,
        totalResumes,
      },
      recentMatches,
    };
  }
}
