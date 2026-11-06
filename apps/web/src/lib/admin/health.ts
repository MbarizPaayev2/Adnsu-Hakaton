/**
 * One evaluation of the admin health payload (`GET /admin/ops/health`), shared by the overview and the system page.
 * Four distinct outcomes: `ok` (positive evidence for everything), `warn` (stale evidence), `bad` (a failed check or a recorded failure),
 * `unknown` (evidence missing or unreadable). Zero recorded failures is never evidence of health, and missing evidence is never "ok".
 * Vocabulary comes from the host scripts: off-host result `VERIFIED`, restore test `PASSED`.
 */
export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface HealthCheck { ok: boolean; ms: number; error?: string | null }
export interface HealthBackup {
  known: boolean;
  reason?: string;
  lastBackupAt?: string | null;
  lastBackupAgeHours?: number | null;
  lastRestoreTestAt?: string | null;
  lastRestoreTestAgeHours?: number | null;
  lastRestoreTestResult?: string | null;
  lastRestoreTestNote?: string | null;
  lastOffhostCopyAt?: string | null;
  lastOffhostCopyAgeHours?: number | null;
  lastOffhostResult?: string | null;
  lastBackupFailureAt?: string | null;
  lastBackupError?: string | null;
}
export interface HealthPayload {
  environment?: string;
  release?: { sha: string | null; builtAt: string | null };
  uptimeSeconds?: number;
  services?: Partial<Record<'database' | 'redis' | 'matching' | 'applyWorker', HealthCheck>>;
  backup?: HealthBackup;
}

export const SERVICE_KEYS = ['database', 'redis', 'matching', 'applyWorker'] as const;
export const BACKUP_FRESH_HOURS = 26;
export const BACKUP_BAD_HOURS = 72;
export const RESTORE_TEST_MAX_DAYS = 8;

/** Age thresholds for a backup or off-host copy. A missing or non-numeric age is unknown, never fresh. */
export function ageTone(hours: unknown): HealthTone {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return 'unknown';
  if (hours <= BACKUP_FRESH_HOURS) return 'ok';
  if (hours <= BACKUP_BAD_HOURS) return 'warn';
  return 'bad';
}

const RANK: Record<HealthTone, number> = { ok: 0, warn: 1, unknown: 2, bad: 3 };
const worst = (a: HealthTone, b: HealthTone): HealthTone => (RANK[b] > RANK[a] ? b : a);

export interface HealthVerdict { tone: HealthTone; label: string; detail: string }

export function evaluateHealth(input: { loading: boolean; error?: string; health: HealthPayload | null }): HealthVerdict {
  const { loading, error, health } = input;
  if (loading && !health) return { tone: 'unknown', label: 'Yoxlanılır...', detail: 'Canlı monitorinq sorğulanır' };
  if (error || !health) return { tone: 'unknown', label: 'Məlum deyil', detail: error ? `Yoxlama xətası: ${error}` : 'Sağlamlıq sübutu əlçatan deyil' };

  const services = health.services ?? {};
  const failing = SERVICE_KEYS.filter((k) => services[k]?.ok === false);
  const missing = SERVICE_KEYS.filter((k) => !services[k] || typeof services[k]?.ok !== 'boolean');
  if (failing.length) return { tone: 'bad', label: `${failing.length} servisdə xəta`, detail: `${failing.join(', ')} cavab vermir` };
  if (missing.length) return { tone: 'unknown', label: 'Servis vəziyyəti məlum deyil', detail: `${missing.join(', ')} üçün yoxlama nəticəsi gəlmədi` };

  const b = health.backup;
  if (!b || b.known !== true) return { tone: 'unknown', label: 'Ehtiyat nüsxə məlum deyil', detail: b?.reason || 'Servislər aktivdir, lakin backup vəziyyəti təsdiqlənməyib' };
  if (b.lastBackupFailureAt) return { tone: 'bad', label: 'Backup xətası', detail: b.lastBackupError || 'Sonuncu ehtiyat nüsxə çıxarışı uğursuz olub' };
  if (b.lastOffhostResult && b.lastOffhostResult !== 'VERIFIED') return { tone: 'bad', label: 'Xarici nüsxə uğursuz', detail: `Xarici yaddaşa surətin nəticəsi: ${b.lastOffhostResult}` };
  if (b.lastRestoreTestResult && b.lastRestoreTestResult !== 'PASSED') return { tone: 'bad', label: 'Bərpa testi uğursuz', detail: `Son bərpa testinin nəticəsi: ${b.lastRestoreTestResult}` };

  let tone: HealthTone = 'ok';
  const notes: string[] = [];
  const backup = ageTone(b.lastBackupAgeHours);
  if (backup === 'unknown') notes.push('son ehtiyat nüsxənin vaxtı məlum deyil');
  else if (backup !== 'ok') notes.push(`son nüsxə ${b.lastBackupAgeHours} saat əvvəl`);
  tone = worst(tone, backup);

  if (b.lastOffhostResult === 'VERIFIED') {
    const t = ageTone(b.lastOffhostCopyAgeHours);
    if (t !== 'ok') notes.push(t === 'unknown' ? 'xarici nüsxənin vaxtı məlum deyil' : `xarici nüsxə ${b.lastOffhostCopyAgeHours} saat əvvəl`);
    tone = worst(tone, t);
  } else {
    notes.push('xarici yaddaşa doğrulanmış nüsxə qeydi yoxdur');
    tone = worst(tone, 'unknown');
  }

  if (b.lastRestoreTestResult === 'PASSED') {
    const age = b.lastRestoreTestAgeHours;
    if (typeof age !== 'number' || !Number.isFinite(age)) { notes.push('bərpa testinin vaxtı məlum deyil'); tone = worst(tone, 'unknown'); }
    else if (age > RESTORE_TEST_MAX_DAYS * 24) { notes.push(`bərpa testi ${RESTORE_TEST_MAX_DAYS} gündən köhnədir`); tone = worst(tone, 'warn'); }
  } else {
    notes.push('bərpa testi qeydi yoxdur');
    tone = worst(tone, 'unknown');
  }

  if (tone === 'ok') return { tone, label: 'Bütün servislər aktiv', detail: 'Servislər cavab verir; ehtiyat nüsxə, xarici surət və bərpa testi təsdiqlənib' };
  const label = tone === 'warn' ? 'Köhnəlmiş sübut' : tone === 'bad' ? 'Ehtiyat nüsxə köhnəlib' : 'Ehtiyat sübutu natamamdır';
  return { tone, label, detail: `Servislər cavab verir, lakin: ${notes.join('; ')}` };
}
