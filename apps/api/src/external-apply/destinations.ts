import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Server-side registry of external application destinations. Nothing here can
 * be supplied by a client: hosts, the recipient's privacy declaration and the
 * receipt contract are code-reviewed configuration.
 *
 * A destination is only eligible for automated preparation when the
 * recipient's own declaration has been captured (`notice`), because the
 * candidate must see that exact text before AISE transmits anything and the
 * worker re-checks it on the live form before ticking the box.
 *
 * Without a `receipt` contract nothing can ever be marked as a confirmed
 * receipt: every real send ends as DELIVERY_UNCONFIRMED.
 */

export interface DestinationNotice {
  /** The recipient's privacy/terms page linked from its declaration. */
  url: string;
  /** Operator-assigned version label for this capture (e.g. capture date). */
  version: string;
  /** Declaration text exactly as the destination shows it next to its checkbox. */
  declarationText: string;
}

export interface ReceiptContract {
  /** Must contain one capture group: the destination's receipt/reference id. */
  textPattern: RegExp;
  /** Optional path the confirmation page must be on. */
  urlPathPattern?: RegExp;
  /**
   * Optional: text the destination shows when it refuses an application.
   * Without it, error-like text after a send stays an unconfirmed delivery.
   */
  rejectionPattern?: RegExp;
}

export interface DisclosureFieldSpec {
  key: string;
  label: string;
}

export interface ExternalDestination {
  key: string;
  displayName: string;
  /** Job.externalId prefix for postings this destination can receive. */
  sourcePrefix: string;
  /** Exact https hosts allowed as application destinations. */
  hosts: string[];
  notice: DestinationNotice | null;
  receipt: ReceiptContract | null;
  identityDocument: { required: boolean; reason: string };
  /** Profile-derived fields the destination form asks for, in display order. */
  fields: DisclosureFieldSpec[];
}

export const GLORRI_FIELDS: DisclosureFieldSpec[] = [
  { key: 'firstName', label: 'Ad' },
  { key: 'lastName', label: 'Soyad' },
  { key: 'email', label: 'E-poçt' },
  { key: 'phone', label: 'Mobil nömrə' },
  { key: 'address', label: 'Faktiki ünvan' },
  { key: 'citizenship', label: 'Vətəndaşlıq' },
  { key: 'dob', label: 'Təvəllüd' },
  { key: 'salary', label: 'Minimum maaş tələbi' },
  { key: 'netGross', label: 'Net/gross' },
  { key: 'currency', label: 'Valyuta' },
];

export const GLORRI_DESTINATION: ExternalDestination = {
  key: 'glorri',
  displayName: 'Glorri (jobs.glorri)',
  sourcePrefix: 'glorri:',
  // Stored postings link to jobs.glorri.com; the original worker targeted
  // jobs.glorri.az. Neither has been verified live (no permission to contact
  // Glorri), so both are allowed and the actual host comes from the posting.
  hosts: ['jobs.glorri.com', 'jobs.glorri.az'],
  // NOT CAPTURED. The declaration next to Glorri's `isDataPrivacyAccepted`
  // checkbox has never been read from the live form by an authorised person,
  // so AISE cannot show it to a candidate. Automated preparation stays
  // unavailable (assisted apply only) until an operator records it here.
  notice: null,
  // NOT KNOWN. No real Glorri confirmation page has been observed; until a
  // controlled recipient test (Phase 6) documents one, no send can be
  // recorded as a confirmed receipt.
  receipt: null,
  // The reference prototype's form had a second, mandatory-looking file input
  // for an identity-document photo. Re-verify on the live form in Phase 6.
  identityDocument: {
    required: true,
    reason: 'Glorri müraciət forması şəxsiyyət vəsiqəsinin şəklini ayrıca fayl kimi tələb edir.',
  },
  fields: GLORRI_FIELDS,
};

export function normalizeNoticeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Fingerprint of a recipient declaration. The worker computes the same value
 * from the live form (apps/apply-worker glorri-apply.adapter.ts
 * `noticeFingerprint`); keep the two in step.
 */
export function noticeFingerprint(declarationText: string, url: string): string {
  return createHash('sha256').update(`${normalizeNoticeText(declarationText)}\n${url.trim()}`).digest('hex');
}

/**
 * What a destination can do for a candidate, derived only from the reviewed
 * registry entry above. It is the same for every candidate and vacancy; the
 * per-match answer (plan, pilot, live gate, operator pause) is layered on top
 * by ExternalApplyService.capabilities.
 *
 * - preparation: AVAILABLE only when the recipient's declaration has been
 *   captured, because the candidate must read it before AISE sends anything.
 * - receipt: VERIFIED_BY_CONTRACT only with a receipt contract. Without one,
 *   every real send ends as DELIVERY_UNCONFIRMED and the candidate is told so
 *   before consenting and again before the final send.
 * - rejection: whether a refusal page can be recognised; otherwise an error
 *   after the send also stays an unconfirmed delivery.
 */
export interface DestinationCapability {
  key: string;
  displayName: string;
  preparation: 'AVAILABLE' | 'NOTICE_NOT_CAPTURED';
  receipt: 'VERIFIED_BY_CONTRACT' | 'NOT_VERIFIABLE';
  rejection: 'DETECTED_BY_CONTRACT' | 'NOT_DETECTABLE';
  identityDocumentRequired: boolean;
}

export function destinationCapability(destination: ExternalDestination): DestinationCapability {
  return {
    key: destination.key,
    displayName: destination.displayName,
    preparation: destination.notice ? 'AVAILABLE' : 'NOTICE_NOT_CAPTURED',
    receipt: destination.receipt ? 'VERIFIED_BY_CONTRACT' : 'NOT_VERIFIABLE',
    rejection: destination.receipt?.rejectionPattern ? 'DETECTED_BY_CONTRACT' : 'NOT_DETECTABLE',
    identityDocumentRequired: destination.identityDocument.required,
  };
}

/**
 * The posting's own page, for applying there yourself. Only an https URL on
 * one of the destination's hosts is offered; anything else is dropped rather
 * than linked.
 */
export function applyYourselfUrl(destination: ExternalDestination, postingUrl: string | null | undefined): string | null {
  if (!postingUrl) return null;
  try {
    const url = new URL(postingUrl);
    return url.protocol === 'https:' && destination.hosts.includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export type DestinationResolution =
  | { ok: true; destination: ExternalDestination; host: string; applyUrl: string }
  | { ok: false; reason: 'UNSUPPORTED_SOURCE' | 'DESTINATION_DATA_MISSING' | 'DESTINATION_NOT_ALLOWED' };

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;

@Injectable()
export class ExternalDestinationRegistry {
  protected readonly destinations: ExternalDestination[] = [GLORRI_DESTINATION];

  resolve(job: { externalId: string; url?: string | null; rawPayload?: unknown }): DestinationResolution {
    const destination = this.destinations.find((d) => job.externalId.startsWith(d.sourcePrefix));
    if (!destination) return { ok: false, reason: 'UNSUPPORTED_SOURCE' };
    const raw = job.rawPayload as any;
    const companySlug = raw?.company?.slug;
    const slug = raw?.slug;
    if (typeof companySlug !== 'string' || typeof slug !== 'string' || !SLUG.test(companySlug) || !SLUG.test(slug)) {
      return { ok: false, reason: 'DESTINATION_DATA_MISSING' };
    }
    let host = destination.hosts[0];
    if (job.url) {
      let parsed: URL;
      try {
        parsed = new URL(job.url);
      } catch {
        return { ok: false, reason: 'DESTINATION_NOT_ALLOWED' };
      }
      if (parsed.protocol !== 'https:' || !destination.hosts.includes(parsed.hostname)) {
        return { ok: false, reason: 'DESTINATION_NOT_ALLOWED' };
      }
      host = parsed.hostname;
    }
    return { ok: true, destination, host, applyUrl: `https://${host}/vacancies/${companySlug}/${slug}/apply` };
  }

  byKey(key: string | null | undefined): ExternalDestination | undefined {
    return this.destinations.find((d) => d.key === key);
  }

  /** The destination a posting belongs to, whether or not its data is complete. */
  forJob(job: { externalId: string }): ExternalDestination | undefined {
    return this.destinations.find((d) => job.externalId.startsWith(d.sourcePrefix));
  }

  /** Every registered destination's capability, for operators and the candidate UI. */
  capabilities(): DestinationCapability[] {
    return this.destinations.map(destinationCapability);
  }

  isAllowedApplyUrl(destination: ExternalDestination, applyUrl: string): boolean {
    try {
      const url = new URL(applyUrl);
      return url.protocol === 'https:' && destination.hosts.includes(url.hostname)
        && /^\/vacancies\/[a-z0-9-]+\/[a-z0-9-]+\/apply$/i.test(url.pathname) && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  currentNoticeHash(destination: ExternalDestination): string | null {
    return destination.notice ? noticeFingerprint(destination.notice.declarationText, destination.notice.url) : null;
  }

  /** True only when the observation is the destination's own documented refusal page. */
  isDocumentedRejection(destination: ExternalDestination, observation: { url?: unknown; text?: unknown } | undefined): boolean {
    const pattern = destination.receipt?.rejectionPattern;
    if (!pattern || !observation || typeof observation.url !== 'string' || typeof observation.text !== 'string') return false;
    try {
      const url = new URL(observation.url);
      return url.protocol === 'https:' && destination.hosts.includes(url.hostname) && pattern.test(observation.text.slice(0, 5000));
    } catch {
      return false;
    }
  }

  /**
   * Validates what the worker observed after a send against the destination's
   * receipt contract. Returns only a safe reference plus hashes, never the
   * observed text (it may contain the candidate's details).
   */
  validateReceipt(
    destination: ExternalDestination,
    observation: { url?: unknown; text?: unknown } | undefined,
  ): { reference: string; evidence: { method: string; urlPath: string; textSha256: string } } | null {
    if (!destination.receipt || !observation) return null;
    if (typeof observation.url !== 'string' || typeof observation.text !== 'string') return null;
    let url: URL;
    try {
      url = new URL(observation.url);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !destination.hosts.includes(url.hostname)) return null;
    if (destination.receipt.urlPathPattern && !destination.receipt.urlPathPattern.test(url.pathname)) return null;
    const match = destination.receipt.textPattern.exec(observation.text.slice(0, 5000));
    const reference = match?.[1]?.trim();
    if (!reference || !/^[A-Za-z0-9._-]{4,64}$/.test(reference)) return null;
    return {
      reference,
      evidence: {
        method: 'receipt-contract',
        urlPath: url.pathname,
        textSha256: createHash('sha256').update(observation.text).digest('hex'),
      },
    };
  }
}
