import { loadEmailApplyConfig } from '../email-applications/email-apply.config';
import { pilotChecks } from './email-pilot-check';

const cfg = (env: Record<string, string>) => loadEmailApplyConfig(env as never);
const ready = { EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'live', RESEND_API_KEY: 're_SECRETVALUE123', EMAIL_APPLY_FROM: 'AISE <applications@pilot.example>', EMAIL_APPLY_WEBHOOK_SECRET: 'whsec_SECRETSIGNING', EMAIL_APPLY_RECIPIENT_ALLOWLIST: 'tester@inbox.example', EMAIL_APPLY_USER_DAILY_LIMIT: '3', EMAIL_APPLY_GLOBAL_DAILY_LIMIT: '10' };

describe('controlled pilot readiness check', () => {
  it('passes only for a limited, allowlisted live configuration and prints no secret or address', () => {
    const checks = pilotChecks(cfg(ready));
    expect(checks.every((c) => c.ok)).toBe(true);
    const text = JSON.stringify(checks);
    for (const secret of ['SECRETVALUE123', 'SECRETSIGNING', 'tester@inbox.example']) expect(text).not.toContain(secret);
    expect(text).toContain('pilot.example'); // the sender's domain is not a secret and is what must be verified
  });
  it('fails by default (everything off) and explains why', () => {
    const checks = pilotChecks(cfg({}));
    expect(checks.find((c) => c.name === 'feature enabled')).toMatchObject({ ok: false });
    expect(checks.find((c) => c.name === 'live transport selected')).toMatchObject({ ok: false });
  });
  it('refuses to call a real-recipient or automatic configuration a controlled pilot', () => {
    expect(pilotChecks(cfg({ ...ready, EMAIL_APPLY_REAL_RECIPIENTS: 'true', EMAIL_APPLY_RECIPIENT_ALLOWLIST: '' })).find((c) => c.name === 'recipient policy limits the pilot')?.ok).toBe(false);
    expect(pilotChecks(cfg({ ...ready, EMAIL_APPLY_AUTOMATION_ENABLED: 'true' })).find((c) => c.name === 'automation off')?.ok).toBe(false);
  });
});
