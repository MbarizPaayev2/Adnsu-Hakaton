/** All the fields the adapter can fill on the glorri apply form. */
export interface GlorriFillData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  citizenship?: string;
  dob?: string;
  salary?: string;
  netGross?: string;
  currency?: string;
  resumeFilePath?: string;
  idPhotoFilePath?: string;
  motivationLetter?: string;
  /**
   * Answers for per-vacancy custom questions (e.g. step-3 radio-group
   * questions), keyed by a stable field key. Today that key is the field's DOM
   * `name` attribute (e.g. "questions.0.answer"), since that's the only stable
   * handle fill.js's testing found on the real form - see
   * findUnansweredRadioGroups in glorri-apply.adapter.ts.
   */
  questionAnswers?: Record<string, string>;
}

/** The candidate's recorded authority for the recipient's own declaration. */
export interface PrivacyAuthority {
  noticeHash: string;
  noticeVersion: string;
}

/** A field the adapter could not confidently fill and needs a human answer for. */
export interface FieldDescriptor {
  fieldKey: string;
  label: string;
  type: 'text' | 'radio' | 'checkbox';
  options?: string[];
}

export interface FillResult {
  status: 'READY_FOR_REVIEW' | 'NEEDS_INPUT' | 'FAILED';
  previewData?: Record<string, string>;
  missingFields?: FieldDescriptor[];
  /** Machine code for a FAILED fill, e.g. NOTICE_CHANGED. */
  code?: string;
  errorMessage?: string;
}

/** What the page showed after the final control was activated. Unvalidated. */
export interface SendObservation {
  url: string;
  text: string;
}

/**
 * The worker never decides that an application was received — apps/api
 * validates `observation` against the destination's receipt contract.
 *
 * NOT_SENT: certain the final control was not activated.
 * SENT_OBSERVED: activated; observation attached when the page was readable.
 * REJECTED: activated and the destination visibly refused it.
 * AWAITING_OTP: activated and the destination asks for a one-time code.
 * DRY_RUN_COMPLETE: rehearsal found the final control and did not activate it.
 */
export interface ConfirmResult {
  outcome: 'NOT_SENT' | 'SENT_OBSERVED' | 'REJECTED' | 'AWAITING_OTP' | 'DRY_RUN_COMPLETE';
  code?: string;
  observation?: SendObservation;
}

export interface OtpResult {
  outcome: 'NOT_SENT' | 'SENT_OBSERVED' | 'REJECTED' | 'OTP_INVALID';
  code?: string;
  observation?: SendObservation;
}
