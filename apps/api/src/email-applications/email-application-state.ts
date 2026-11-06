import { createHash } from 'crypto';
import type { EmailDeliveryState, RecruitmentState } from '@prisma/client';

export const sha256Hex = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');

/** The consent text the candidate agrees to on approval; bump the version when its meaning changes. */
export const CONSENT_VERSION = '2026-10-email-application-v1';

export interface PayloadParts {
  recipient: string;
  subject: string;
  body: string;
  cvSha256: string;
  cvFileName: string;
  replyTo: string;
  senderName: string;
  senderEmail?: string | null;
  copyToSelf: boolean;
  /** The optional motivation-letter attachment. Absent or null means none, and the hash is then identical to the one computed before letters existed. */
  letterSha256?: string | null;
  letterFileName?: string | null;
}

/**
 * One hash over everything the candidate approves; any later change to it is detectable. An application without a letter hashes exactly as it
 * always did ('v1'), so applications approved before letters existed still verify; one with a letter hashes the letter's bytes and name too ('v2').
 */
export function payloadHash(p: PayloadParts): string {
  if (p.senderEmail) return sha256Hex(JSON.stringify(['v3', p.recipient, p.subject, p.body, p.cvSha256, p.cvFileName, p.replyTo, p.senderName, p.copyToSelf, p.letterSha256 ?? '', p.letterFileName ?? '', p.senderEmail]));
  if (p.letterSha256) {
    return sha256Hex(JSON.stringify(['v2', p.recipient, p.subject, p.body, p.cvSha256, p.cvFileName, p.replyTo, p.senderName, p.copyToSelf, p.letterSha256, p.letterFileName ?? '']));
  }
  return sha256Hex(JSON.stringify(['v1', p.recipient, p.subject, p.body, p.cvSha256, p.cvFileName, p.replyTo, p.senderName, p.copyToSelf]));
}

type PartsRow = {
  recipient: string; subject: string; body: string; replyTo: string; senderName: string; senderEmail?: string | null; copyToSelf: boolean;
  cvFileName: string; cvPreviewSha256: string; cvSha256: string | null;
  letterFileName: string | null; letterPreviewSha256: string | null; letterSha256: string | null;
};

/** The parts of a stored application. `preview` uses the hashes of what the candidate was shown; `approved` those of the private copies taken at approval. */
export function payloadPartsOf(row: PartsRow, stage: 'preview' | 'approved'): PayloadParts {
  const approved = stage === 'approved';
  const letterSha256 = approved ? row.letterSha256 : row.letterPreviewSha256;
  return {
    recipient: row.recipient, subject: row.subject, body: row.body, replyTo: row.replyTo, senderName: row.senderName, copyToSelf: row.copyToSelf,
    cvFileName: row.cvFileName, cvSha256: approved ? row.cvSha256! : row.cvPreviewSha256,
    ...(row.senderEmail ? { senderEmail: row.senderEmail } : {}),
    ...(letterSha256 ? { letterSha256, letterFileName: row.letterFileName } : {}),
  };
}

export interface DeliveryFacts {
  providerAcceptedAt: Date | null;
  deliveredAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  providerFailedAt: Date | null;
}

/**
 * The delivery state implied by provider evidence, strongest first. Evidence
 * only accumulates, so an event that arrives late or twice cannot move the
 * state backwards (a "delivered" after a "bounced" stays bounced).
 */
export function stateFromEvidence(facts: DeliveryFacts, current: EmailDeliveryState): EmailDeliveryState {
  if (facts.complainedAt) return 'COMPLAINED';
  if (facts.bouncedAt) return 'BOUNCED';
  if (facts.providerFailedAt) return 'FAILED';
  if (facts.deliveredAt) return 'DELIVERED';
  if (facts.providerAcceptedAt) return 'PROVIDER_ACCEPTED';
  return current;
}

/** Delivery states in which provider evidence about the message can legitimately arrive. */
export const EVIDENCE_STATES: readonly EmailDeliveryState[] = ['SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNCERTAIN'];

/** States that still allow the candidate to cancel without any message having left. */
export const CANCELLABLE_STATES: readonly EmailDeliveryState[] = ['AWAITING_APPROVAL', 'QUEUED'];

/** States that count as "an application was (or may have been) sent" for duplicate protection. */
export const LIVE_STATES: readonly EmailDeliveryState[] = ['QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'BOUNCED', 'COMPLAINED'];

const FORWARD: Record<RecruitmentState, RecruitmentState[]> = {
  NOT_SENT: [],
  SENT: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  ACKNOWLEDGED: ['INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  INTERVIEW_INVITED: ['ACKNOWLEDGED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  INTERVIEW_SCHEDULED: ['INTERVIEW_INVITED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  OFFER: ['INTERVIEW_SCHEDULED', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  REJECTED: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER'], // a correction; history keeps both
  WITHDRAWN: [],
  HIRED: ['OFFER'],
};

/** Candidate-reported transitions. The history keeps every change, so a correction is allowed but visible. */
export function canTransition(from: RecruitmentState, to: RecruitmentState): boolean {
  return from !== to && FORWARD[from].includes(to);
}

/** Outcomes AI or keyword analysis may only SUGGEST: they change nothing until the candidate confirms. */
export const CONFIRMATION_REQUIRED: readonly RecruitmentState[] = ['INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'HIRED'];
