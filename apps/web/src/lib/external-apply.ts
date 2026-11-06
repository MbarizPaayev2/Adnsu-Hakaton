/**
 * What an external destination can do, as reported by the API
 * (apps/api/src/external-apply/destinations.ts `destinationCapability`).
 * The UI only words it; it never decides eligibility itself.
 */
export interface DestinationCapability {
  key: string;
  displayName: string;
  preparation: 'AVAILABLE' | 'NOTICE_NOT_CAPTURED';
  receipt: 'VERIFIED_BY_CONTRACT' | 'NOT_VERIFIABLE';
  rejection: 'DETECTED_BY_CONTRACT' | 'NOT_DETECTABLE';
  identityDocumentRequired: boolean;
}

/** The per-match answer from GET /external-applications/capabilities. */
export interface ApplyCapability {
  available: boolean;
  reason: string | null;
  message: string | null;
  applicationId?: string;
  applicationStatus?: string;
  destination?: DestinationCapability;
  applyYourselfUrl?: string | null;
}

/** True unless the destination has a receipt contract AISE can validate. */
export function receiptUnverifiable(capability: DestinationCapability | null | undefined): boolean {
  return capability?.receipt !== 'VERIFIED_BY_CONTRACT';
}

export const RECEIPT_UNVERIFIABLE_TITLE = 'Qəbul təsdiqlənə bilməz';

export function receiptUnverifiableText(displayName: string): string {
  return `${displayName} göndərişin qəbulunu AISE-nin yoxlaya biləcəyi şəkildə təsdiqləmir. `
    + 'Göndərişdən sonra status «Çatdırılma təsdiqlənməyib» olaraq qalacaq; müraciətin çatdığını saytda özünüz yoxlamalısınız.';
}

export const APPLY_YOURSELF_AFTER = 'Özünüz müraciət etsəniz, «Müraciət etdim» ilə qeyd edin.';

/**
 * Refusals that come from the destination itself rather than from the
 * candidate's account or AISE's rollout gates (apps/api external-apply.service
 * MESSAGES). Only these are explained on a vacancy card.
 */
export const DESTINATION_REASONS: ReadonlySet<string> = new Set([
  'NOTICE_NOT_CAPTURED',
  'DESTINATION_DATA_MISSING',
  'DESTINATION_NOT_ALLOWED',
]);
