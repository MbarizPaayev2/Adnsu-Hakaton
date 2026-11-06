/**
 * Portals the browser agent understands. Each entry is a REVIEWED description of one real application flow: what an apply URL looks like, where
 * the confirmation page lives and what is known to be verified. Nothing here claims "any website": a vacancy whose link does not match a portal
 * is simply not supported.
 *
 * Lever (jobs.lever.co): public single-page apply form per posting (resume, name, e-mail, phone, links, employer questions, optional EEO survey),
 * an hCaptcha the candidate must pass themselves, and a confirmation page at `/<employer>/<posting>/thanks`. There is no candidate login and no
 * test environment: live submission has not been exercised against a real employer (see docs/browser-agent-2026-10-09.md).
 */
export type PortalKey = 'lever';

export interface PortalInfo {
  key: PortalKey;
  name: string;
  /** Hosts the extension may act on. */
  hosts: string[];
  /** What AISE can honestly say about this adapter today. */
  verification: { form: 'READ_ONLY_REAL_PAGE_AND_FIXTURE'; liveSubmission: 'UNVERIFIED' };
  limitations: string[];
}

export const PORTALS: Record<PortalKey, PortalInfo> = {
  lever: {
    key: 'lever',
    name: 'Lever (jobs.lever.co)',
    hosts: ['jobs.lever.co'],
    verification: { form: 'READ_ONLY_REAL_PAGE_AND_FIXTURE', liveSubmission: 'UNVERIFIED' },
    limitations: [
      'Hər işəgötürənin öz sualları var: təsdiqlənmiş cavablarınızın əhatə etmədiyi hər məcburi sual sizə verilir.',
      'Portalın CAPTCHA-sı, göstərilərsə, həmişə sizin tərəfinizdən həll edilir: AISE onu keçmir.',
      'Lever müraciətin statusunu göstərmir: AISE-nin qeyd edə biləcəyi yeganə sübut təsdiq səhifəsidir. Nəticə bəlli olmasa, siz təsdiq e-poçtuna baxıb özünüz bildirirsiniz.',
    ],
  },
};

export const SUPPORTED_PORTALS = Object.keys(PORTALS) as PortalKey[];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LEVER_POSTING = new RegExp(`^https://jobs\\.lever\\.co/([a-z0-9][a-z0-9-]{0,60})/(${UUID})(?:/(?:apply)?)?$`, 'i');

export interface PostingRef { portal: PortalKey; employer: string; postingId: string; postingUrl: string; applyUrl: string; thanksUrl: string }

/** The portal and posting a stored vacancy link points at, or null when it is not a supported posting (query strings and fragments are ignored). */
export function postingOf(url: string | null | undefined): PostingRef | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const m = LEVER_POSTING.exec(`${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`);
  if (!m) return null;
  const employer = m[1].toLowerCase(), postingId = m[2].toLowerCase();
  const base = `https://jobs.lever.co/${employer}/${postingId}`;
  return { portal: 'lever', employer, postingId, postingUrl: base, applyUrl: `${base}/apply`, thanksUrl: `${base}/thanks` };
}

/**
 * Confirmation evidence is accepted only from the portal's own confirmation URL for THIS posting. A URL that merely looks similar, belongs to another
 * posting, or carries credentials is not evidence.
 */
export function isConfirmationUrl(ref: PostingRef, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length > 400) return false;
  let u: URL;
  try { u = new URL(candidate); } catch { return false; }
  if (u.protocol !== 'https:' || u.host.toLowerCase() !== 'jobs.lever.co' || u.username || u.password) return false;
  return u.pathname.replace(/\/+$/, '').toLowerCase() === new URL(ref.thanksUrl).pathname;
}
