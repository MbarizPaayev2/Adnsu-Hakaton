/**
 * Deployment switches for application e-mail. Everything is OFF unless a
 * deployment enables it explicitly, and a live deployment must also say which
 * recipients may be contacted.
 */
export type EmailApplyTransportKind = 'sink' | 'live';

export interface EmailApplyConfig {
  /** Master switch. Off: no preparation, approval or sending is possible. */
  enabled: boolean;
  /** `sink` talks to a local capture server; `live` talks to the e-mail provider. */
  transport: EmailApplyTransportKind;
  sinkUrl: string;
  apiKey: string | undefined;
  from: string | undefined;
  /** Exact addresses or `@domain` entries. Required in live mode unless realRecipients is true. */
  recipientAllowlist: string[];
  /** Explicit authorization to contact recipients outside the allowlist (employers). */
  realRecipients: boolean;
  userDailyLimit: number;
  globalDailyLimit: number;
  recipientDailyLimit: number;
  webhookSecret: string | undefined;
  /** Mode B (automatic applications). A second, separate switch. */
  automationEnabled: boolean;
  candidateAliasesEnabled?: boolean;
  inboundEnabled: boolean;
  /** Domain whose `track+<token>@` addresses receive forwarded employer replies (provider inbound routing). */
  inboundDomain: string | undefined;
  maxAttempts: number;
  /** Days after which the stored copy of a sent CV is deleted (the record of the application stays). */
  retentionDays: number;
  /** How long one provider call may take before its outcome is treated as unknown. */
  providerTimeoutMs: number;
  /** A listing not seen by any import for this many days is not trusted to still be open: it can be neither prepared nor sent. */
  listingMaxAgeDays: number;
}

const flag = (value: string | undefined) => value?.trim().toLowerCase() === 'true';
const count = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
};

export function loadEmailApplyConfig(env: NodeJS.ProcessEnv = process.env): EmailApplyConfig {
  const key = env.RESEND_API_KEY?.trim();
  return {
    enabled: flag(env.EMAIL_APPLY_ENABLED),
    transport: env.EMAIL_APPLY_TRANSPORT?.trim().toLowerCase() === 'live' ? 'live' : 'sink',
    sinkUrl: env.EMAIL_APPLY_SINK_URL?.trim() || 'http://127.0.0.1:4599',
    apiKey: key && !key.toLowerCase().includes('mock') ? key : undefined,
    from: env.EMAIL_APPLY_FROM?.trim() || undefined,
    recipientAllowlist: (env.EMAIL_APPLY_RECIPIENT_ALLOWLIST ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
    realRecipients: flag(env.EMAIL_APPLY_REAL_RECIPIENTS),
    userDailyLimit: count(env.EMAIL_APPLY_USER_DAILY_LIMIT, 10, 100),
    globalDailyLimit: count(env.EMAIL_APPLY_GLOBAL_DAILY_LIMIT, 200, 10_000),
    recipientDailyLimit: count(env.EMAIL_APPLY_RECIPIENT_DAILY_LIMIT, 5, 100),
    webhookSecret: env.EMAIL_APPLY_WEBHOOK_SECRET?.trim() || undefined,
    automationEnabled: flag(env.EMAIL_APPLY_AUTOMATION_ENABLED),
    candidateAliasesEnabled: flag(env.EMAIL_APPLY_CANDIDATE_ALIASES_ENABLED),
    inboundEnabled: flag(env.EMAIL_APPLY_INBOUND_ENABLED),
    inboundDomain: env.EMAIL_APPLY_INBOUND_DOMAIN?.trim().toLowerCase() || undefined,
    maxAttempts: count(env.EMAIL_APPLY_MAX_ATTEMPTS, 3, 5) || 3,
    retentionDays: count(env.EMAIL_APPLY_RETENTION_DAYS, 180, 3650) || 180,
    listingMaxAgeDays: count(env.EMAIL_APPLY_LISTING_MAX_AGE_DAYS, 30, 365) || 30,
    providerTimeoutMs: Math.min(Math.max(count(env.EMAIL_APPLY_PROVIDER_TIMEOUT_MS, 30_000, 120_000), 500), 120_000),
  };
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Problems that make an enabled configuration unsafe to start with. Empty means usable. */
export function emailApplyConfigProblems(cfg: EmailApplyConfig): string[] {
  if (!cfg.enabled) return [];
  const problems: string[] = [];
  if (cfg.transport === 'sink') {
    if (!isLoopbackUrl(cfg.sinkUrl)) problems.push('EMAIL_APPLY_SINK_URL must be a loopback http URL');
  } else {
    if (!cfg.apiKey) problems.push('RESEND_API_KEY is required for live sending');
    if (!cfg.from) problems.push('EMAIL_APPLY_FROM (a verified sender) is required for live sending');
    if (!cfg.webhookSecret || !cfg.webhookSecret.startsWith('whsec_')) problems.push('EMAIL_APPLY_WEBHOOK_SECRET (whsec_...) is required for live sending');
    if (!cfg.realRecipients && cfg.recipientAllowlist.length === 0) problems.push('Live sending needs EMAIL_APPLY_RECIPIENT_ALLOWLIST until real recipients are explicitly authorized');
  }
  if (cfg.candidateAliasesEnabled && cfg.transport === 'live' && !/@aisehr\.com>?$/i.test(cfg.from ?? '')) problems.push('Candidate aliases require a verified aisehr.com sending domain');
  if (cfg.inboundEnabled && !cfg.inboundDomain) problems.push('EMAIL_APPLY_INBOUND_DOMAIN is required for inbound replies');
  if (cfg.automationEnabled && !cfg.enabled) problems.push('Automation requires EMAIL_APPLY_ENABLED');
  return problems;
}

/** Whether this deployment may contact `address`. Sink mode never leaves the machine, so any address is fine. */
export function recipientAllowed(cfg: EmailApplyConfig, address: string): boolean {
  if (cfg.transport === 'sink') return true;
  if (cfg.realRecipients) return true;
  const a = address.trim().toLowerCase();
  return cfg.recipientAllowlist.some((entry) => (entry.startsWith('@') ? a.endsWith(entry) : a === entry));
}
