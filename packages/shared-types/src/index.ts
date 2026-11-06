export type SubscriptionPlan = 'FREE' | 'BASIC' | 'STANDARD' | 'Limitsiz' | 'PREMIUM' | 'PLUS';

// Retired offers keep their rolling 30-day allowance. Free is weekly; paid daily
// offers have no separate monthly cap: their daily limit below always applies.
export const PLAN_MATCH_QUOTAS: Record<SubscriptionPlan, number | null> = {
  FREE: null, BASIC: 10, STANDARD: 30, Limitsiz: null, PREMIUM: null, PLUS: null,
};
export const PLAN_WEEKLY_MATCH_QUOTAS: Partial<Record<SubscriptionPlan, number>> = { FREE: 3 };
export function matchWeekStart(now = new Date()): Date {
  const start = matchDayStart(now);
  const day = new Date(start.getTime() + 4 * 3_600_000).getUTCDay();
  return new Date(start.getTime() - ((day + 6) % 7) * 86_400_000);
}
export const PLAN_DAILY_MATCH_QUOTAS: Partial<Record<SubscriptionPlan, number>> = { PLUS: 1, PREMIUM: 5 };
/** Baku calendar day (UTC+4, no daylight saving), as a UTC instant. */
export function matchDayStart(now = new Date()): Date {
  return new Date(Math.floor((now.getTime() + 4 * 3_600_000) / 86_400_000) * 86_400_000 - 4 * 3_600_000);
}

// Monthly price in Azerbaijani manat (AZN).
// Current candidate offers: Plus 8 AZN, Premium 50 AZN. Retired offers are unchanged.
export const PLAN_PRICES_AZN: Record<SubscriptionPlan, number | null> = {
  FREE: 0,
  BASIC: 5,
  STANDARD: 10,
  Limitsiz: 40,
  PREMIUM: 50,
  PLUS: 8,
};

export type MatchStatus = 'NEW' | 'VIEWED' | 'DISMISSED' | 'APPLIED';

export type NotificationType = 'NEW_MATCH' | 'DIGEST';

export interface JobPreferences {
  roles: string[];
  locations: string[];
  types: ('remote' | 'onsite' | 'hybrid')[];
  salaryMin?: number;
  salaryMax?: number;
}

export interface IngestJobDto {
  externalId: string;
  title: string;
  company: string;
  description: string;
  location: string;
  url: string;
  postedAt: string; // ISO date
  rawPayload?: Record<string, any>;
}

export interface MatchScoreDetails {
  score: number;
  matchedKeywords: string[];
  /** Which posting kind was scored — the Match row links the corresponding side. */
  source?: 'job' | 'vacancy';
  breakdown?: {
    semantic: number;
    roleFit: number;
    skillDemand: number;
    keyword: number;
    filters: Record<string, boolean>;
  };
  gaps?: string[];
}

export type NeedLevel = 'required' | 'preferred';

export interface SkillNeedItem {
  skill: string;
  level: NeedLevel;
  requirement?: string;
}

export interface EvidencedSkillItem extends SkillNeedItem {
  via?: 'skills' | 'experience';
  where?: string;
}

export interface OtherRequirementItem {
  kind: 'degree' | 'experience' | 'other';
  text: string;
  level: NeedLevel;
}

export interface GuidedPromptItem {
  id: string;
  title: string;
  description: string;
  section: 'skills' | 'experience' | 'education' | 'projects';
  link: string;
}

export interface MatchSkillsGuidanceResponse {
  matchId: string;
  hasProfile: boolean;
  evidenced: EvidencedSkillItem[];
  missingRequired: SkillNeedItem[];
  missingPreferred: SkillNeedItem[];
  other: OtherRequirementItem[];
  sourceRequirements?: { text: string; level: NeedLevel; needsReview: boolean }[];
  guidedPrompts: GuidedPromptItem[];
}

/** A privacy-filtered academy metric. Null is never presented as a measured zero. */
export type AcademyMetricStatus = 'MEASURED' | 'NOT_YET_REPORTED' | 'SUPPRESSED';
export type AcademyMetricUnit = 'students' | 'applications' | 'documents' | 'days' | 'percent';

export interface AcademyMetric {
  value: number | null;
  status: AcademyMetricStatus;
  unit: AcademyMetricUnit;
  denominator: { value: number | null; unit: 'students'; label: string };
  definition: string;
  provenance: string[];
}

export interface AcademyReportingWindow {
  training: { start: string; end: string };
  observation: { start: string; end: string };
  asOf: string;
  preEnrollmentActivity: 'EXCLUDED';
}

export interface AcademyCohortMetrics {
  eligibleStudents: AcademyMetric;
  applicants: AcademyMetric;
  submittedApplications: AcademyMetric;
  preparedStudents: AcademyMetric;
  interviewedStudents: AcademyMetric;
  studentsWithOffers: AcademyMetric;
  acceptedOffers: AcademyMetric;
  studentsStartedWork: AcademyMetric;
  medianDaysToFirstApplication: AcademyMetric;
}

export interface AcademyCohortReport {
  reportingWindow: AcademyReportingWindow;
  metrics: AcademyCohortMetrics;
}


export interface AcademyCohortKpisResponse {
  reportingWindow: AcademyReportingWindow;
  metrics: AcademyCohortReport['metrics'];
  dateRange: { start: string; end: string };
  reportingPeriod: string;
  cohortId: string;
  cohortName: string;
  /** Legacy compatibility fields; null when revealing the exact cohort size is unsafe. */
  enrolledTotal: number | null;
  activeConsented: number | null;
  minAggregationThreshold: number;
  isSuppressed: boolean;
  suppressionReason: string | null;
  dataCompleteness: {
    studentsWithReportedOutcomes: number | null;
    completenessPct: number | null;
    status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
    definition: string;
  };
  preparation: {
    activeStudents: number | null;
    totalDocumentsPrepared: number | null;
    status?: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
    definition: string;
  };
  applications: {
    totalSubmitted: number | null;
    distinctStudentsApplied: number | null;
    status?: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
    byChannel: {
      native: number | null;
      external: number | null;
      email: number | null;
      browserAgent: number | null;
      manualTracker: number | null;
    };
    definition: string;
  };
  funnel: {
    applied: number | null;
    distinctApplied: number | null;
    interviews: {
      count: number | null;
      distinctStudents: number | null;
      totalEvents: number | null;
      employerConfirmed: number | null;
      candidateReported: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      ratePct: number | null;
      definition: string;
    };
    offersReceived: {
      count: number | null;
      distinctStudents: number | null;
      totalEvents: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      ratePct: number | null;
      definition: string;
    };
    offersAccepted: {
      count: number | null;
      distinctStudents: number | null;
      totalEvents: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      ratePct: number | null;
      definition: string;
    };
    jobStarted: {
      count: number | null;
      distinctStudents: number | null;
      totalEvents: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      employerConfirmed: number | null;
      candidateReported: number | null;
      ratePct: number | null;
      definition: string;
    };
    // Aliases for compatibility
    offers: {
      count: number | null;
      employerConfirmed: number | null;
      candidateReported: number | null;
      ratePct: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      definition: string;
    };
    hires: {
      count: number | null;
      status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
      employerConfirmed: number | null;
      candidateReported: number | null;
      ratePct: number | null;
      definition: string;
    };
  };
  timeToFirstApplicationDays: {
    medianDays: number | null;
    definition: string;
    status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA';
  };
}

/** Academy-level KPIs are intentionally unavailable until overlap-safe aggregation exists. */
export interface AcademyKpisResponse {
  academyId: string;
  cohortCount: number;
  aggregate: {
    status: 'SUPPRESSED';
    values: null;
    definition: string;
  };
  cohorts: Array<{
    id: string;
    name: string;
    trainingStart: string;
    trainingEnd: string;
  }>;
}

export * from './product-spec';

