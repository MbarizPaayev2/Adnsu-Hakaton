/**
 * Single source of truth for the facts that appear across every legal page.
 *
 * Everything the legal documents assert about who operates AISE, how to reach
 * us, and which version is in force lives here — so it is changed in one place
 * and cannot drift between /terms, /privacy, /refund and the rest.
 *
 * ---------------------------------------------------------------------------
 * Operator identity
 * ---------------------------------------------------------------------------
 * The owner's instruction is to identify the operator only as "AISE": no
 * registration number, no VÖEN, no named individual, because the business
 * registration has not been accepted yet.
 *
 * That is implemented literally below, and it is deliberately NOT dressed up
 * as something it isn't — there is no invented "AISE LLC", no placeholder
 * registration number, and no address. "AISE" is a real trading name, so
 * nothing here is fictional.
 *
 * What it does mean, recorded here because it is a legal consequence and not a
 * styling choice: these documents name no registered legal person as the
 * contracting party. Consumer and distance-selling rules generally require a
 * trader to identify itself (name and geographic address) before a consumer
 * is bound, and a contract with no identified counterparty is materially
 * harder to enforce — in AISE's favour as much as the user's. The commissioned
 * legal pack treats establishing entity identity as a launch blocker.
 *
 * When the registration completes, fill in `registration` below and the
 * identity paragraphs will render automatically wherever they belong.
 */

export const LEGAL = {
  /** Trading name used throughout the documents. */
  operator: "AISE",

  /** Public service domain. */
  domain: "aisehr.com",
  siteUrl: "https://aisehr.com",

  /**
   * Registration details, once the entity exists. While this is `null`, the
   * pages omit the identity paragraph entirely rather than printing a
   * placeholder or an empty label.
   */
  registration: null as null | {
    legalName: string;
    legalForm: string;
    registrationNumber: string;
    voen: string;
    registeredAddress: string;
  },

  /**
   * Contact mailboxes.
   *
   * These must be live and monitored before publication — a legal document
   * that lists an address nobody reads is worse than one that lists none,
   * because it advertises a complaints route that silently fails. They are
   * all pointed at one address on purpose: one staffed mailbox is more honest
   * than four aliases nobody watches. Split them out once there is someone to
   * own each.
   */
  email: {
    support: "support@aisehr.com",
    privacy: "support@aisehr.com",
    billing: "support@aisehr.com",
    abuse: "support@aisehr.com",
  },

  /** Document version and the date it takes effect. */
  version: "1.0",
  effectiveDate: "2026-09-07",

  /** Jurisdiction and audience at launch. */
  governingLaw: "Azərbaycan Respublikasının qanunvericiliyi",
  servedCountry: "Azərbaycan",
  minimumAge: 18,

  /** Currency and the refund window offered on a first purchase. */
  currency: "AZN",
  refundWindowDays: 14,

  /** Notice period for changes that affect the agreement or a price. */
  changeNoticeDays: 30,
} as const;

/** True once a registered entity has been recorded above. */
export function hasRegisteredEntity(): boolean {
  return LEGAL.registration !== null;
}
