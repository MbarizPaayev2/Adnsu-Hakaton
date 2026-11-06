/**
 * Read-only readiness check for a controlled live e-mail pilot. It inspects this process's configuration and prints
 * pass/fail with non-secret facts only (booleans, counts, the sender's DOMAIN). It sends nothing, calls no provider,
 * and never prints a key, secret, token or recipient address.
 */
import { emailApplyConfigProblems, loadEmailApplyConfig, type EmailApplyConfig } from '../email-applications/email-apply.config';

export interface PilotCheck { name: string; ok: boolean; detail: string }

export function pilotChecks(cfg: EmailApplyConfig): PilotCheck[] {
  const fromDomain = cfg.from ? /@([^>\s]+)>?\s*$/.exec(cfg.from)?.[1]?.toLowerCase() : undefined;
  const check = (name: string, ok: boolean, detail: string): PilotCheck => ({ name, ok, detail });
  const live = cfg.transport === 'live';
  return [
    check('feature enabled', cfg.enabled, cfg.enabled ? 'EMAIL_APPLY_ENABLED is on' : 'EMAIL_APPLY_ENABLED is off (the safe default)'),
    check('live transport selected', live, live ? 'EMAIL_APPLY_TRANSPORT=live' : 'sink transport: nothing leaves the machine'),
    check('provider key present', !!cfg.apiKey, cfg.apiKey ? 'RESEND_API_KEY is set (value not shown)' : 'RESEND_API_KEY missing or a placeholder'),
    check('verified sender configured', !!fromDomain, fromDomain ? `sender domain ${fromDomain} (verify it in the provider dashboard: SPF, DKIM, and DMARC alignment)` : 'EMAIL_APPLY_FROM missing'),
    check('webhook signing secret well-formed', !!cfg.webhookSecret?.startsWith('whsec_'), cfg.webhookSecret ? 'EMAIL_APPLY_WEBHOOK_SECRET present (value not shown)' : 'EMAIL_APPLY_WEBHOOK_SECRET missing'),
    check('recipient policy limits the pilot', !cfg.realRecipients && cfg.recipientAllowlist.length > 0, cfg.realRecipients ? 'REAL RECIPIENTS ARE AUTHORIZED: not a controlled pilot' : `${cfg.recipientAllowlist.length} allowlisted address or domain entries`),
    check('automation off', !cfg.automationEnabled, cfg.automationEnabled ? 'EMAIL_APPLY_AUTOMATION_ENABLED is on' : 'off'),
    check('inbound replies off', !cfg.inboundEnabled, cfg.inboundEnabled ? 'inbound is on' : 'off'),
    check('sending limits bounded', cfg.userDailyLimit <= 10 && cfg.globalDailyLimit <= 50, `per candidate ${cfg.userDailyLimit}/day, global ${cfg.globalDailyLimit}/day, per recipient ${cfg.recipientDailyLimit}/day`),
    check('configuration accepted by the startup guard', emailApplyConfigProblems(cfg).length === 0, emailApplyConfigProblems(cfg).join('; ') || 'no problems'),
  ];
}

if (require.main === module) {
  const checks = pilotChecks(loadEmailApplyConfig());
  console.log(JSON.stringify({ readyForControlledPilot: checks.every((c) => c.ok), checks }, null, 2));
}
