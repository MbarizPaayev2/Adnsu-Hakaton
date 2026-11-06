import { timingSafeEqual } from 'node:crypto';

/**
 * The Telegram adapter is OFF unless explicitly and fully configured: TELEGRAM_ENABLED=true, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and
 * TELEGRAM_WEBHOOK_SECRET (≥ 16 characters of [A-Za-z0-9_-], Telegram's own constraint). Nothing in this repository creates a bot or sends a
 * message; it needs credentials the founder provides and a live verification that has not happened.
 */
export function telegramConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const username = (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  const secret = env.TELEGRAM_WEBHOOK_SECRET || '';
  const enabled = env.TELEGRAM_ENABLED === 'true' && !!token && /^[A-Za-z0-9_]{3,32}$/.test(username) && /^[A-Za-z0-9_-]{16,256}$/.test(secret);
  return { enabled, token, username, secret };
}

export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
