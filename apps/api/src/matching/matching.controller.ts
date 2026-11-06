import { isRecommendationRelevant } from './recommendation-policy';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { MatchingService, MATCH_SCORE_THRESHOLD } from './matching.service';
import { PrismaService } from '../database/database.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { UpdateMatchStatusDto } from './dto/update-match-status.dto';
import type { MatchStatus } from '@aise/shared-types';
import { isJobActionable } from '../jobs/jobs.service';
import { matchDayStart, matchWeekStart, PLAN_DAILY_MATCH_QUOTAS, PLAN_WEEKLY_MATCH_QUOTAS } from '@aise/shared-types';

export function nextRecommendationSelectionAt(cadence: 'daily' | 'weekly', now = new Date()): Date {
  const periodMs = (cadence === 'daily' ? 1 : 7) * 86_400_000;
  const offsetMs = cadence === 'daily' ? 5 * 60_000 : 10 * 60_000;
  const start = cadence === 'daily' ? matchDayStart(now) : matchWeekStart(now);
  const scheduled = new Date(start.getTime() + offsetMs);
  return scheduled > now ? scheduled : new Date(scheduled.getTime() + periodMs);
}

@Controller('matches')
@UseGuards(SessionAuthGuard)
export class MatchingController {
  constructor(
    private matchingService: MatchingService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getMatches(
    @GetUser('id') userId: string,
    @Query('status') status?: MatchStatus,
  ) {
    // Validate status if provided
    const validStatuses: MatchStatus[] = ['NEW', 'VIEWED', 'DISMISSED', 'APPLIED'];
    if (status && !validStatuses.includes(status)) {
      throw new BadRequestException('Status parametri yanlışdır');
    }

    const matches = await this.prisma.match.findMany({
      // The status filter is applied AFTER the plan entitlement below, never in the query: filtering first let a FREE account page
      // through more than its three visible recommendations by asking for each status in turn.
      where: { userId },
      include: {
        job: true,
        vacancy: { include: { company: true } },
        tailoredResumes: true,
      },
      orderBy: [
        { score: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    // A match is only a recommendation while its posting can still be acted
    // on. Closed/expired postings drop out, except ones the candidate already
    // marked as applied, which stay visible as history (actionable: false).
    const now = new Date();
    const visible = matches
      .map((match) => ({ ...match, actionable: this.isActionable(match, now) }))
      .filter((match) => (match.actionable && match.score >= MATCH_SCORE_THRESHOLD && isRecommendationRelevant(match.details)) || match.status === 'APPLIED');

    // Check plan limits (Free tier limit check)
    // "Free: limited active matches shown, no digest customization, base resume only"
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, planOverrides: activePlanOverrides() },
    });

    let entitled = visible;
    if (effectivePlan(user) === 'FREE') {
      // The free entitlement is three newly ranked recommendations per Baku
      // week. Keep at most three active recommendations visible, filling any
      // unused space with the latest still-actionable older matches so a small
      // weekly batch does not abruptly hide useful recommendations. Applied
      // rows remain visible as history and do not consume weekly slots.
      const weekStart = matchWeekStart(now);
      const currentWeek = visible.filter((match) => match.status !== 'APPLIED' && match.createdAt >= weekStart);
      const older = visible.filter((match) => match.status !== 'APPLIED' && match.createdAt < weekStart);
      const recommendationIds = new Set([
        ...currentWeek.slice(0, 3),
        ...older.slice(0, Math.max(0, 3 - Math.min(3, currentWeek.length))),
      ].map((match) => match.id));
      entitled = visible.filter((match) => match.status === 'APPLIED' || recommendationIds.has(match.id));
    }

    return status ? entitled.filter((match) => match.status === status) : entitled;
  }

  @Get('selection-status')
  async getSelectionStatus(@GetUser('id') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, planOverrides: activePlanOverrides() },
    });
    const plan = effectivePlan(user);
    const cadence: 'daily' | 'weekly' | null = PLAN_DAILY_MATCH_QUOTAS[plan] !== undefined ? 'daily'
      : PLAN_WEEKLY_MATCH_QUOTAS[plan] !== undefined ? 'weekly' : null;
    const pendingCount = cadence
      ? await this.prisma.matchCandidate.count({ where: { userId, scoredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } })
      : 0;
    const quota = (cadence === 'daily' ? PLAN_DAILY_MATCH_QUOTAS[plan] : cadence === 'weekly' ? PLAN_WEEKLY_MATCH_QUOTAS[plan] : 0) ?? 0;
    const periodStart = cadence === 'daily' ? matchDayStart() : cadence === 'weekly' ? matchWeekStart() : null;
    const periodWhere = periodStart ? {
      userId,
      createdAt: { gte: periodStart, lt: new Date(periodStart.getTime() + (cadence === 'daily' ? 1 : 7) * 86_400_000) },
    } : null;
    const periodTotal = periodWhere ? await this.prisma.match.count({ where: periodWhere }) : 0;
    const periodRejected = periodWhere && periodTotal ? await this.prisma.match.count({
      where: { ...periodWhere, status: { not: 'APPLIED' }, details: { path: ['breakdown', 'filters', 'role_relevant'], equals: false } },
    }) : 0;
    const nextSelectionAt = cadence ? nextRecommendationSelectionAt(cadence) : null;
    const firstBatchAvailable = !!cadence && pendingCount > 0 && quota > 0 && periodTotal - periodRejected === 0;
    return { cadence, pendingCount, nextSelectionAt: nextSelectionAt?.toISOString() ?? null, firstBatchAvailable };
  }

  @Post('first-batch')
  async selectFirstBatch(@GetUser('id') userId: string) {
    // Explicit user action; only already-scored candidates are considered.
    // The shared ranked publisher and atomic quota transaction prevent this
    // path from rescoring inventory or spending more than the normal period cap.
    const selection = await this.getSelectionStatus(userId);
    if (!selection.cadence) return { status: 'not_available', published: 0 };
    if (!selection.pendingCount) return { status: 'no_pending_candidates', published: 0 };
    if (!selection.firstBatchAvailable) return { status: 'selection_already_used', published: 0 };
    const published = await this.matchingService.publishRankedRecommendations(selection.cadence, userId);
    return { status: published ? 'published' : 'no_eligible_candidates', published };
  }

  private isActionable(
    match: { job: Parameters<typeof isJobActionable>[0] | null; vacancy: { status: string; deadline: Date | null; expiresAt?: Date | null; company: { status: string } } | null },
    now: Date,
  ): boolean {
    if (match.job) return isJobActionable(match.job, now);
    if (match.vacancy) {
      return (
        match.vacancy.status === 'ACTIVE' &&
        match.vacancy.company.status === 'APPROVED' &&
        (!match.vacancy.deadline || match.vacancy.deadline.getTime() >= now.getTime()) &&
        (!match.vacancy.expiresAt || match.vacancy.expiresAt.getTime() > now.getTime())
      );
    }
    return false;
  }

  @Get(':id/skills')
  async getMatchSkills(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.matchingService.getMatchSkills(userId, id);
  }

  @Get(':id')
  async getMatch(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        job: true,
        vacancy: { include: { company: true } },
      },
    });

    if (!match || match.userId !== userId) {
      throw new NotFoundException('Uyğunluq tapılmadı');
    }

    const now = new Date();
    const actionable = this.isActionable(match, now);
    const ref = match.jobId ? `imported:${match.jobId}` : match.vacancyId ? `native:${match.vacancyId}` : undefined;

    return {
      id: match.id,
      score: match.score,
      status: match.status,
      actionable,
      ref,
      job: match.job ? { id: match.job.id, title: match.job.title, company: match.job.company, location: match.job.location } : undefined,
      vacancy: match.vacancy ? { id: match.vacancy.id, title: match.vacancy.title, company: match.vacancy.company ? { name: match.vacancy.company.name } : undefined, location: match.vacancy.location } : undefined,
    };
  }

  @Patch(':id')
  async updateMatchStatus(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: UpdateMatchStatusDto,
  ) {
    const { status } = body;

    const match = await this.prisma.match.findUnique({
      where: { id },
    });

    if (!match || match.userId !== userId) {
      throw new NotFoundException('Uyğunluq tapılmadı');
    }

    return this.prisma.match.update({
      where: { id },
      data: { status },
      include: {
        job: true,
        vacancy: { include: { company: true } },
      },
    });
  }
}
