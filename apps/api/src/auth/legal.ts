/** The version of the Terms of Use and Privacy Policy a sign-up accepts (bump when either changes in substance). */
export const LEGAL_VERSION = '2026-10-07';

/** Sign-up must carry an explicit acceptance in production (or when forced); local development and tests are not blocked. */
export function termsAcceptanceRequired(): boolean {
  const forced = process.env.TERMS_ACCEPTANCE_REQUIRED;
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return process.env.APP_ENV === 'production';
}
