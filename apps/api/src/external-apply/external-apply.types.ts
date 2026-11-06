// HTTP contract between apps/api and apps/apply-worker. apps/api never
// touches Playwright itself — it calls this contract and persists results.
// The worker never decides that an application was received: it reports what
// it observed and apps/api validates that against the destination registry.

export interface GlorriFillData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  citizenship: string;
  dob: string; // ISO date string
  salary: string;
  netGross: string;
  currency: string;
  resumeFilePath: string;
  idPhotoFilePath: string;
  motivationLetter: string;
  questionAnswers?: Record<string, string>;
}

export interface CreateSessionRequest {
  applicationId: string;
  applyUrl: string;
  fillData: GlorriFillData;
  /** The candidate's recorded authority for the recipient's declaration. */
  privacyAuthority: { noticeHash: string; noticeVersion: string };
}

export interface MissingField {
  fieldKey: string;
  label: string;
  type: string;
  options?: string[];
}

// Shared response shape for POST /sessions and PATCH /sessions/:id/answers.
export interface SessionResponse {
  status: 'READY_FOR_REVIEW' | 'NEEDS_INPUT' | 'FAILED';
  previewData?: Record<string, string>;
  missingFields?: MissingField[];
  /** Machine code for a FAILED fill, e.g. NOTICE_CHANGED. */
  code?: string;
  errorMessage?: string;
}

export interface AnswerInput {
  fieldKey: string;
  value: string;
}

export interface SubmitAnswersRequest {
  answers: AnswerInput[];
  motivationLetter?: string;
}

export interface SendObservation {
  url?: string;
  text?: string;
}

/**
 * NOT_SENT: the worker is certain the final control was not activated.
 * SENT_OBSERVED: the control was activated; `observation` is what the page
 *   showed afterwards (unvalidated — apps/api decides whether it is a receipt).
 * REJECTED: activated and the destination visibly refused it.
 * AWAITING_OTP: activated and the destination asks for a one-time code.
 * DRY_RUN_COMPLETE: rehearsal reached the final control and did not activate it.
 */
export type ConfirmOutcome = 'NOT_SENT' | 'SENT_OBSERVED' | 'REJECTED' | 'AWAITING_OTP' | 'DRY_RUN_COMPLETE';
export type OtpOutcome = 'NOT_SENT' | 'SENT_OBSERVED' | 'REJECTED' | 'OTP_INVALID';

export interface ConfirmSubmitRequest {
  attemptId: string;
  dryRun: boolean;
}

export interface ConfirmSubmitResponse {
  attemptId: string;
  outcome: ConfirmOutcome;
  code?: string;
  observation?: SendObservation;
}

export interface OtpRequest {
  attemptId: string;
  code: string;
}

export interface OtpResponse {
  attemptId: string;
  outcome: OtpOutcome;
  code?: string;
  observation?: SendObservation;
}

export interface ListLiveSessionsResponse {
  liveIds: string[];
}
