import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.service';

/**
 * Counts, never rates: how many applications have interview evidence, split by WHO supplied it, so a future public claim can name its evidence.
 * Candidate-confirmed and employer-confirmed counts are kept apart and never summed. No personal data is returned.
 */
@Injectable()
export class OutcomeStatsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const interviewStates = ['INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED'] as const;
    const sentStates = ['PROVIDER_ACCEPTED', 'DELIVERED'] as const;
    const [emailSent, emailSentTailored, emailInterviewRows, nativeSubmitted, extSubmitted, events] = await Promise.all([
      this.prisma.emailApplication.count({ where: { deliveryState: { in: [...sentStates] } } }),
      this.prisma.emailApplication.count({ where: { deliveryState: { in: [...sentStates] }, cvKind: 'tailored' } }),
      this.prisma.applicationStatusEvent.findMany({ where: { toState: { in: [...interviewStates] }, evidence: { in: ['CANDIDATE_REPORTED', 'REPLY_CONFIRMED_BY_CANDIDATE'] } }, select: { emailApplicationId: true, emailApplication: { select: { cvKind: true } } } }),
      this.prisma.application.count(),
      this.prisma.externalApplication.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.applicationOutcomeEvent.findMany({ where: { outcome: 'INTERVIEW' }, select: { channel: true, applicationId: true, evidence: true } }),
    ]);
    const emailInterview = new Map(emailInterviewRows.map((r) => [r.emailApplicationId, r.emailApplication.cvKind]));
    const distinct = (channel: string, evidence: string) => new Set(events.filter((e) => e.channel === channel && e.evidence === evidence).map((e) => e.applicationId)).size;
    const nativeBoth = new Set(events.filter((e) => e.channel === 'native' && e.evidence === 'EMPLOYER_CONFIRMED').map((e) => e.applicationId));
    const nativeCandOnly = new Set(events.filter((e) => e.channel === 'native' && e.evidence === 'CANDIDATE_REPORTED' && !nativeBoth.has(e.applicationId)).map((e) => e.applicationId)).size;
    return {
      note: 'Counts of applications with interview evidence, by who supplied the evidence. Not rates, not a measure of any product effect, and candidate-confirmed and employer-confirmed counts are not additive.',
      email: { sent: emailSent, sentWithTailoredCv: emailSentTailored, interviewCandidateConfirmed: emailInterview.size, interviewCandidateConfirmedTailoredCv: [...emailInterview.values()].filter((k) => k === 'tailored').length, interviewEmployerConfirmed: 0 },
      native: { submitted: nativeSubmitted, interviewEmployerConfirmed: distinct('native', 'EMPLOYER_CONFIRMED'), interviewCandidateReportedOnly: nativeCandOnly },
      external: { submitted: extSubmitted, interviewCandidateConfirmed: distinct('external', 'CANDIDATE_REPORTED'), interviewEmployerConfirmed: 0 },
    };
  }
}
