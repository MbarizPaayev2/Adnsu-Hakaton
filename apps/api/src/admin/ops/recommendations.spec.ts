import { backupRules, documentRules, emailRules, importRules, moderationRules, queueRules, serviceRules, sortRecommendations, type RecommendationDraft } from './recommendations';

const now = new Date('2026-10-04T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const ids = (items: RecommendationDraft[]) => items.map((i) => i.id);

describe('backup rules — missing evidence is unknown, never ok', () => {
  it('reports an unreadable status file as unknown, not as healthy and not as a failure', () => {
    const [item, ...rest] = backupRules({ known: false, reason: 'Status faylı oxunmadı' }, now);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ id: 'backup.unknown', status: 'unknown', severity: 'medium', freshness: { asOf: null, ageSeconds: null } });
  });
  it('is silent only when every fact is fresh and good', () => {
    expect(backupRules({ known: true, lastBackupAt: ago(3), lastRestoreTestAt: ago(24), lastRestoreTestResult: 'PASSED', lastOffhostCopyAt: ago(3), lastOffhostResult: 'VERIFIED' }, now)).toEqual([]);
  });
  it('flags a stale backup, a never-tested restore (unknown), a failed restore test and a stale off-host copy, each with its own age', () => {
    const items = backupRules({ known: true, lastBackupAt: ago(40), lastRestoreTestAt: null, lastOffhostCopyAt: ago(60), lastOffhostResult: 'VERIFIED', lastBackupFailureAt: ago(2) }, now);
    expect(ids(items)).toEqual(['backup.failed', 'backup.stale', 'backup.restore-untested', 'backup.offhost-stale']);
    expect(items.find((i) => i.id === 'backup.stale')).toMatchObject({ status: 'attention', severity: 'high', freshness: { ageSeconds: 40 * 3600, stale: true } });
    expect(items.find((i) => i.id === 'backup.restore-untested')).toMatchObject({ status: 'unknown' });
    expect(ids(backupRules({ known: true, lastBackupAt: ago(1), lastRestoreTestAt: ago(2), lastRestoreTestResult: 'FAILED: checksum', lastOffhostCopyAt: ago(1) }, now))).toEqual(['backup.restore-failed']);
  });
});

describe('service rules', () => {
  it('lists only services that did not respond, with severity by importance', () => {
    const items = serviceRules([{ name: 'database', ok: true, ms: 3 }, { name: 'redis', ok: false, ms: 3000 }, { name: 'matching', ok: false, ms: 5 }, { name: 'applyWorker', ok: false, ms: 5 }], now);
    expect(items.map((i) => [i.id, i.severity])).toEqual([['service.redis.down', 'critical'], ['service.matching.down', 'high'], ['service.applyWorker.down', 'medium']]);
  });
});

describe('import rules', () => {
  const source = (over: object = {}) => ({ key: 's', name: 'Source', scheduled: true, paused: false, consecutiveFailures: 0, staleness: 'fresh', lastSuccessAt: new Date(ago(2)), lastRunStatus: 'SUCCEEDED', completeness: 'verified_complete', openFreshnessUnknown: 0, open: 3, ...over });
  it('treats "no import record" as unknown and a failed or stale Glorri run as attention', () => {
    expect(importRules(null, [], false, now)[0]).toMatchObject({ id: 'imports.glorri.unknown', status: 'unknown' });
    expect(importRules({ lastRunAt: new Date(ago(1)), lastStatus: 'FAILED', lastError: true }, [], false, now)[0]).toMatchObject({ id: 'imports.glorri.failed', severity: 'high' });
    expect(importRules({ lastRunAt: new Date(ago(9)), lastStatus: 'SUCCEEDED', lastError: false }, [], false, now)[0]).toMatchObject({ id: 'imports.glorri.stale' });
    expect(importRules({ lastRunAt: new Date(ago(1)), lastStatus: 'SUCCEEDED', lastError: false }, [], false, now)).toEqual([]);
  });
  it('flags scheduled sources that keep failing or never complete, and ignores unscheduled or paused ones', () => {
    const glorri = { lastRunAt: new Date(ago(1)), lastStatus: 'SUCCEEDED', lastError: false };
    const items = importRules(glorri, [source({ key: 'a', consecutiveFailures: 4 }), source({ key: 'b', staleness: 'never_completed' }), source({ key: 'c', scheduled: false, consecutiveFailures: 9 }), source({ key: 'd', paused: true, consecutiveFailures: 9 }), source({ key: 'e' })], false, now);
    expect(ids(items)).toEqual(['source.a.failing', 'source.b.stale']);
    expect(items[0].nextStep).toMatch(/məhdudiyyət/i); // never suggests getting around a restriction
  });
});

describe('queue rules', () => {
  it('shows failed jobs with whether a retry is offered, backlog, and an unreadable queue as unknown', () => {
    const items = queueRules([
      { name: 'job-ingested', waiting: 0, active: 0, delayed: 0, failed: 2, retryable: true },
      { name: 'resume-tailor', waiting: 800, active: 1, delayed: 0, failed: 1, retryable: false },
      { name: 'match-created', waiting: 0, active: 0, delayed: 0, failed: 0, retryable: false, unavailable: true },
      { name: 'external-apply', waiting: 0, active: 0, delayed: 0, failed: 0, retryable: false },
    ], now);
    expect(ids(items)).toEqual(['queue.job-ingested.failed', 'queue.resume-tailor.failed', 'queue.resume-tailor.backlog', 'queue.match-created.unknown']);
    expect(items.find((i) => i.id === 'queue.job-ingested.failed')).toMatchObject({ requiredPermission: 'ops.control', facts: { safeToRetryFromAdmin: true } });
    expect(items.find((i) => i.id === 'queue.resume-tailor.failed')).toMatchObject({ requiredPermission: 'ops.read', facts: { safeToRetryFromAdmin: false } });
    expect(items.find((i) => i.id === 'queue.match-created.unknown')).toMatchObject({ status: 'unknown' });
  });
});

describe('document rules', () => {
  const base = { providerConfigured: true, stalePending: 0, strandedReservations: 0, generated24h: 10, failed24h: 0, oldestPendingAt: null };
  it('is silent when documents are generating normally', () => expect(documentRules(base, now)).toEqual([]));
  it('reports a missing provider, lost workers, stranded reservations and a high failure rate — and says failures do not consume allowance', () => {
    const items = documentRules({ providerConfigured: false, stalePending: 2, strandedReservations: 3, generated24h: 4, failed24h: 6, oldestPendingAt: new Date(ago(1)) }, now);
    expect(ids(items)).toEqual(['documents.provider.not-configured', 'documents.stale-pending', 'documents.stranded-reservations', 'documents.failure-rate']);
    expect(items.find((i) => i.id === 'documents.failure-rate')).toMatchObject({ severity: 'high', facts: { failedPercent: 60 } });
    expect(documentRules({ ...base, generated24h: 1, failed24h: 3 }, now)).toEqual([]); // fewer than five requests: no rate is claimed
  });
});

describe('e-mail rules', () => {
  const base = { enabled: true, transport: 'live' as const, environment: 'production', emergencyPaused: false, staleSending: 0, oldestQueuedAgeMinutes: null, uncertain: 0, oldestUncertainAt: null, accepted7d: 0, delivered7d: 0, bounced7d: 0, complained7d: 0 };
  it('says nothing when the feature is off, and nothing when it is healthy', () => {
    expect(emailRules({ ...base, enabled: false, staleSending: 9 }, now)).toEqual([]);
    expect(emailRules(base, now)).toEqual([]);
  });
  it('flags a test sink in production, a stuck queue, uncertain outcomes and rates — and "no delivery evidence" stays unknown', () => {
    const items = emailRules({ ...base, transport: 'sink', staleSending: 1, oldestQueuedAgeMinutes: 90, uncertain: 2, accepted7d: 30, bounced7d: 5, complained7d: 1 }, now);
    expect(ids(items)).toEqual(['email.sink-in-production', 'email.stale-sending', 'email.queue-stuck', 'email.uncertain', 'email.bounce-rate', 'email.complaint-rate']);
    const none = emailRules({ ...base, accepted7d: 12 }, now);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ id: 'email.no-delivery-evidence', status: 'unknown' });
    expect(emailRules({ ...base, emergencyPaused: true, oldestQueuedAgeMinutes: 500 }, now).map((i) => i.id)).toEqual(['email.sending-paused']); // a deliberate pause explains the queue
  });
  it('never offers to resend an uncertain delivery', () => {
    const [item] = emailRules({ ...base, uncertain: 1 }, now);
    expect(item.nextStep).toMatch(/namizədindir/);
    expect(item.requiredPermission).toBe('ops.read');
  });
});

describe('moderation rules and ordering', () => {
  it('flags companies waiting more than 72 hours only', () => {
    expect(moderationRules(2, new Date(ago(10)), now)).toEqual([]);
    expect(moderationRules(2, new Date(ago(80)), now)[0]).toMatchObject({ id: 'moderation.companies-waiting', requiredPermission: 'companies.moderate', severity: 'low' });
  });
  it('orders by severity, then attention before unknown, then id', () => {
    const mk = (id: string, severity: any, status: string) => ({ id, severity, status });
    expect(sortRecommendations([mk('b', 'low', 'attention'), mk('z', 'high', 'unknown'), mk('a', 'high', 'attention'), mk('c', 'critical', 'unknown')]).map((i) => i.id)).toEqual(['c', 'a', 'z', 'b']);
  });
});

describe('every rule keeps to the safety principles', () => {
  const everything: RecommendationDraft[] = [
    ...backupRules({ known: true, lastBackupAt: ago(99), lastRestoreTestAt: null, lastOffhostCopyAt: null, lastBackupFailureAt: ago(1) }, now),
    ...backupRules({ known: false }, now),
    ...serviceRules([{ name: 'database', ok: false, ms: 1 }, { name: 'redis', ok: false, ms: 1 }, { name: 'matching', ok: false, ms: 1 }, { name: 'applyWorker', ok: false, ms: 1 }], now),
    ...importRules(null, [{ key: 'x', name: 'X', scheduled: true, paused: false, consecutiveFailures: 5, staleness: 'stale', lastSuccessAt: null, lastRunStatus: null, completeness: 'failed', openFreshnessUnknown: 1, open: 1 }], true, now),
    ...queueRules([{ name: 'q', waiting: 900, active: 0, delayed: 0, failed: 3, retryable: true }, { name: 'u', waiting: 0, active: 0, delayed: 0, failed: 0, retryable: false, unavailable: true }], now),
    ...documentRules({ providerConfigured: false, stalePending: 1, strandedReservations: 1, generated24h: 0, failed24h: 9, oldestPendingAt: new Date(ago(1)) }, now),
    ...emailRules({ enabled: true, transport: 'sink', environment: 'production', emergencyPaused: true, staleSending: 1, oldestQueuedAgeMinutes: 99, uncertain: 1, oldestUncertainAt: new Date(ago(30)), accepted7d: 40, delivered7d: 0, bounced7d: 8, complained7d: 2 }, now),
    ...moderationRules(3, new Date(ago(100)), now),
  ];
  it.each(everything.map((i) => [i.id, i] as const))('%s: complete, honest, safe', (_id, item) => {
    expect(item).toMatchObject({ title: expect.any(String), condition: expect.any(String), nextStep: expect.any(String), requiredPermission: expect.any(String) });
    expect(['attention', 'unknown']).toContain(item.status);
    expect(item.freshness.source).toEqual(expect.any(String));
    expect(item.link.page !== null || item.link.runbook !== null).toBe(true);
    const text = `${item.title} ${item.condition} ${item.nextStep}`;
    // No shell, no destructive instruction, no credential material, no promise that an action is safe.
    expect(text).not.toMatch(/\b(rm -|sudo|docker |DROP |DELETE |TRUNCATE|curl |chmod|kill -9|--force|password|secret|token|api[_ ]?key\s*[:=])/i);
    expect(text).not.toMatch(/təhlükəsizdir|zərərsizdir/i);
    expect(JSON.stringify(item.facts)).not.toMatch(/whsec_|re_[A-Za-z0-9]{8}|nvapi-|Bearer /);
  });
  it('has unique ids', () => expect(new Set(everything.map((i) => i.id)).size).toBe(everything.length));
});

describe('source cooldown recommendation', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const base = { key: 'boss', name: 'Boss.az', scheduled: true, paused: false, consecutiveFailures: 5, staleness: 'fresh', lastSuccessAt: null, lastRunStatus: 'FAILED', completeness: 'x', openFreshnessUnknown: 0, open: 10 };
  it('one high-severity item states the cooldown and replaces the generic failing item; no outbound alert is implied', () => {
    const items = importRules({ lastRunAt: now, lastStatus: 'SUCCEEDED', lastError: false }, [{ ...base, cooldownUntil: new Date('2026-10-05T12:00:00Z'), cooldownReason: 'BLOCKED: 403', cooldownCount: 1 }], false, now).filter((i) => i.id.startsWith('source.boss.'));
    expect(items.map((i) => i.id)).toEqual(['source.boss.cooling-down']);
    expect(items[0]).toMatchObject({ status: 'attention', severity: 'high', requiredPermission: 'ops.control', facts: { cooldownCount: 1, consecutiveFailures: 5 } });
    expect(items[0].nextStep).toMatch(/Bərpa et/);
    expect(items[0].nextStep).toMatch(/aşmağa cəhd etməyin/); // never advises getting around a block
    expect(JSON.stringify(items[0])).not.toMatch(/https?:\/\/|password|token/i);
  });
  it('after the cooldown ends the ordinary failing item applies again, and a paused source raises nothing', () => {
    expect(importRules({ lastRunAt: now, lastStatus: 'SUCCEEDED', lastError: false }, [{ ...base, cooldownUntil: new Date('2026-10-04T11:00:00Z'), cooldownReason: 'x', cooldownCount: 1 }], false, now).map((i) => i.id)).toContain('source.boss.failing');
    expect(importRules({ lastRunAt: now, lastStatus: 'SUCCEEDED', lastError: false }, [{ ...base, paused: true, cooldownUntil: new Date('2026-10-05T12:00:00Z') }], false, now).filter((i) => i.id.startsWith('source.boss.'))).toEqual([]);
  });
});
