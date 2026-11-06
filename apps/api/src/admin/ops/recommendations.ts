import type { AdminPermissionName } from '../permissions';

/**
 * Admin "recommended actions": observed conditions with a plain next step. Rules here are pure so they can be tested with fixed facts.
 *
 * Principles (each is tested):
 *  - An item states what was OBSERVED, how fresh that observation is and where it came from. It never states a cause it did not observe.
 *  - Unknown stays unknown: a status file that is missing, a service that could not be asked, a check that threw — each is its own `unknown` item,
 *    never silence and never "ok". Zero recorded failures is not health; `checked[]` says per area whether it was actually checked.
 *  - A next step is something a person decides and does through an existing, guarded admin action or page. It never contains a shell command,
 *    a secret, a destructive instruction, or a promise that an action is safe.
 *  - Items name the permission an action needs; whether the current admin holds it (`canAct`) is computed from the role, and the action itself keeps
 *    its own permission, confirmation, MFA and audit rules.
 */
export type Area = 'services' | 'backup' | 'imports' | 'queues' | 'documents' | 'email' | 'moderation';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Fact = string | number | boolean | null;

export interface RecommendationDraft {
  id: string;
  area: Area;
  status: 'attention' | 'unknown';
  severity: Severity;
  title: string;
  condition: string;
  facts: Record<string, Fact>;
  /** Where the observation came from and how old it is (null age = the source does not date its observation). */
  freshness: { source: string; asOf: string | null; ageSeconds: number | null; stale: boolean };
  nextStep: string;
  link: { page: string | null; runbook: string | null };
  requiredPermission: AdminPermissionName;
}

export interface Recommendation extends RecommendationDraft {
  observedAt: string;
  canAct: boolean;
}

const hours = (h: number) => h * 3600_000;
const age = (at: string | Date | null | undefined, now: Date) => (at ? Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 1000)) : null);
const fresh = (source: string, asOf: string | Date | null | undefined, now: Date, staleAfterMs: number) => {
  const seconds = age(asOf, now);
  return { source, asOf: asOf ? new Date(asOf).toISOString() : null, ageSeconds: seconds, stale: seconds === null ? false : seconds * 1000 > staleAfterMs };
};

const PAGES = { system: '/admin/system', sources: '/admin/sources', email: '/admin/email', operations: '/admin/operations', businesses: '/admin/businesses', applications: '/admin/applications' } as const;
const RUNBOOKS = {
  launch: 'docs/launch-runbook.md', backups: 'docs/host-hardening-and-backups.md', email: 'docs/email-applications-release-2026-10-02.md',
  sources: 'docs/source-integration-and-census-2026-10-02.md', documents: 'docs/documents-and-allowances-2026-10-04.md',
} as const;

export interface ServiceFacts { name: 'database' | 'redis' | 'matching' | 'applyWorker'; ok: boolean; ms: number }

export function serviceRules(services: ServiceFacts[], checkedAt: Date): RecommendationDraft[] {
  const meta = {
    database: { sev: 'critical' as Severity, label: 'Verilənlər bazası', step: 'Verilənlər bazası konteynerinin işlədiyini və API-nin ona qoşula bildiyini yoxlayın. Bərpa olunmasa, host runbook-undakı bərpa addımlarını izləyin.' },
    redis: { sev: 'critical' as Severity, label: 'Redis (növbələr)', step: 'Redis xidmətinin işlədiyini yoxlayın. Növbələr bərpa olunana qədər yeni uyğunluq, sənəd və e-poçt tapşırıqları icra olunmur.' },
    matching: { sev: 'high' as Severity, label: 'Uyğunluq xidməti', step: 'Uyğunluq xidmətinin sağlamlıq ünvanının cavab verdiyini yoxlayın. Yeni elanlar üçün uyğunluq hesablanması bu müddət ərzində dayanır.' },
    applyWorker: { sev: 'medium' as Severity, label: 'Xarici müraciət işçisi', step: 'Xarici müraciət işçisinin işlədiyini yoxlayın. Yalnız avtomatik xarici müraciətlər təsirlənir.' },
  };
  return services.filter((s) => !s.ok).map((s) => ({
    id: `service.${s.name}.down`, area: 'services' as const, status: 'attention' as const, severity: meta[s.name].sev,
    title: `${meta[s.name].label} cavab vermir`, condition: `Sağlamlıq yoxlaması uğursuz oldu (${s.ms} ms).`,
    facts: { service: s.name, responding: false, checkMs: s.ms },
    freshness: fresh('live health probe', checkedAt, checkedAt, 60_000), nextStep: meta[s.name].step,
    link: { page: PAGES.system, runbook: RUNBOOKS.launch }, requiredPermission: 'ops.read' as const,
  }));
}

export interface BackupFacts { known: boolean; reason?: string; lastBackupAt?: string | null; lastRestoreTestAt?: string | null; lastRestoreTestResult?: string | null; lastOffhostCopyAt?: string | null; lastOffhostResult?: string | null; lastBackupFailureAt?: string | null }

export function backupRules(b: BackupFacts, now: Date): RecommendationDraft[] {
  const link = { page: PAGES.system, runbook: RUNBOOKS.backups };
  if (!b.known) {
    return [{
      id: 'backup.unknown', area: 'backup', status: 'unknown', severity: 'medium', title: 'Ehtiyat nüsxə vəziyyəti bilinmir',
      condition: `Ehtiyat nüsxə status faylı oxuna bilmədi (${b.reason ?? 'səbəb göstərilməyib'}). Bu, ehtiyat nüsxənin işlədiyini göstərmir.`,
      facts: { statusFileReadable: false }, freshness: { source: 'backup status file', asOf: null, ageSeconds: null, stale: false },
      nextStep: 'Status faylının hostdan API-yə qoşulduğunu və gündəlik ehtiyat işinin onu yenilədiyini yoxlayın. Əl ilə yoxlama olmadan ehtiyat nüsxə mövcud sayılmamalıdır.',
      link, requiredPermission: 'ops.read',
    }];
  }
  const out: RecommendationDraft[] = [];
  const f = (asOf: string | null | undefined, staleAfter: number) => fresh('backup status file', asOf, now, staleAfter);
  if (b.lastBackupFailureAt) {
    out.push({ id: 'backup.failed', area: 'backup', status: 'attention', severity: 'high', title: 'Son ehtiyat nüsxə cəhdi uğursuz olub', condition: 'Status faylı ehtiyat nüsxə mərhələsinin uğursuz olduğunu və sonrakı uğurla təmizlənmədiyini göstərir.', facts: { lastBackupFailureAt: b.lastBackupFailureAt, lastBackupAt: b.lastBackupAt ?? null }, freshness: f(b.lastBackupFailureAt, hours(36)), nextStep: 'Hostda ehtiyat nüsxə jurnalına baxın, səbəbi aradan qaldırın və ehtiyat nüsxəni yenidən işə salın.', link, requiredPermission: 'ops.read' });
  }
  if (!b.lastBackupAt) {
    out.push({ id: 'backup.never', area: 'backup', status: 'attention', severity: 'high', title: 'Heç bir ehtiyat nüsxə qeydə alınmayıb', condition: 'Status faylı oxunur, lakin tamamlanmış ehtiyat nüsxə vaxtı yoxdur.', facts: { lastBackupAt: null }, freshness: f(null, hours(36)), nextStep: 'İlk ehtiyat nüsxənin hostda işə salındığını və tamamlandığını təsdiqləyin.', link, requiredPermission: 'ops.read' });
  } else if (now.getTime() - new Date(b.lastBackupAt).getTime() > hours(36)) {
    out.push({ id: 'backup.stale', area: 'backup', status: 'attention', severity: 'high', title: 'Son ehtiyat nüsxə köhnəlib', condition: 'Ən son tamamlanmış ehtiyat nüsxə 36 saatdan əvvəl olub (gündəlik iş gözlənilir).', facts: { lastBackupAt: b.lastBackupAt, ageHours: Math.round((age(b.lastBackupAt, now) ?? 0) / 3600) }, freshness: f(b.lastBackupAt, hours(36)), nextStep: 'Gündəlik ehtiyat işinin niyə işləmədiyini hostda yoxlayın.', link, requiredPermission: 'ops.read' });
  }
  if (!b.lastRestoreTestAt) {
    out.push({ id: 'backup.restore-untested', area: 'backup', status: 'unknown', severity: 'medium', title: 'Ehtiyat nüsxənin bərpası heç vaxt sınanmayıb', condition: 'Bərpa sınağı qeydə alınmayıb; ehtiyat nüsxənin bərpa oluna bildiyi bilinmir.', facts: { lastRestoreTestAt: null }, freshness: f(null, 14 * 24 * 3600_000), nextStep: 'Bərpa sınağını təcrid olunmuş mühitdə aparın və nəticəsini qeyd edin.', link, requiredPermission: 'ops.read' });
  } else if (b.lastRestoreTestResult && b.lastRestoreTestResult !== 'PASSED') {
    out.push({ id: 'backup.restore-failed', area: 'backup', status: 'attention', severity: 'high', title: 'Son bərpa sınağı uğursuz olub', condition: `Son bərpa sınağının nəticəsi: ${b.lastRestoreTestResult.slice(0, 60)}.`, facts: { lastRestoreTestAt: b.lastRestoreTestAt, result: b.lastRestoreTestResult.slice(0, 60) }, freshness: f(b.lastRestoreTestAt, 14 * 24 * 3600_000), nextStep: 'Bərpa sınağının səbəbini araşdırın; düzəlməyənə qədər ehtiyat nüsxəyə etibar etməyin.', link, requiredPermission: 'ops.read' });
  } else if (now.getTime() - new Date(b.lastRestoreTestAt).getTime() > 14 * 24 * 3600_000) {
    out.push({ id: 'backup.restore-stale', area: 'backup', status: 'attention', severity: 'medium', title: 'Bərpa sınağı köhnəlib', condition: 'Son bərpa sınağı 14 gündən əvvəl olub.', facts: { lastRestoreTestAt: b.lastRestoreTestAt }, freshness: f(b.lastRestoreTestAt, 14 * 24 * 3600_000), nextStep: 'Yeni bərpa sınağı aparın.', link, requiredPermission: 'ops.read' });
  }
  if (!b.lastOffhostCopyAt) {
    out.push({ id: 'backup.offhost-unknown', area: 'backup', status: 'unknown', severity: 'medium', title: 'Host xaricində təsdiqlənmiş surət yoxdur', condition: 'Host xarici saxlama üçün təsdiqlənmiş surət vaxtı qeydə alınmayıb.', facts: { lastOffhostCopyAt: null }, freshness: f(null, hours(48)), nextStep: 'Host xarici sinxronizasiyanın qurulduğunu və uğurlu olduğunu yoxlayın.', link, requiredPermission: 'ops.read' });
  } else if (now.getTime() - new Date(b.lastOffhostCopyAt).getTime() > hours(48) || (b.lastOffhostResult && b.lastOffhostResult !== 'VERIFIED')) {
    out.push({ id: 'backup.offhost-stale', area: 'backup', status: 'attention', severity: 'medium', title: 'Host xarici surət köhnəlib və ya uğursuzdur', condition: 'Host xaricindəki son təsdiqlənmiş surət 48 saatdan köhnədir və ya nəticəsi uğursuzdur.', facts: { lastOffhostCopyAt: b.lastOffhostCopyAt, result: b.lastOffhostResult ?? null }, freshness: f(b.lastOffhostCopyAt, hours(48)), nextStep: 'Host xarici sinxronizasiya jurnalını yoxlayın.', link, requiredPermission: 'ops.read' });
  }
  return out;
}

export interface SourceFacts { key: string; name: string; scheduled: boolean; paused: boolean; consecutiveFailures: number; staleness: string; lastSuccessAt: Date | null; lastRunStatus: string | null; completeness: string; openFreshnessUnknown: number; open: number; cooldownUntil?: Date | null; cooldownReason?: string | null; cooldownCount?: number }

export function importRules(glorri: { lastRunAt: Date | null; lastStatus: string | null; lastError: boolean } | null, sources: SourceFacts[], schedulerPaused: boolean, now: Date): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  const link = { page: PAGES.sources, runbook: RUNBOOKS.sources };
  if (!glorri || !glorri.lastRunAt) {
    out.push({ id: 'imports.glorri.unknown', area: 'imports', status: 'unknown', severity: 'low', title: 'Glorri idxalı haqqında qeyd yoxdur', condition: 'Bu bazada heç bir Glorri idxal icrası qeydə alınmayıb.', facts: { lastRunAt: null }, freshness: { source: 'import run records', asOf: null, ageSeconds: null, stale: false }, nextStep: 'Glorri idxalının bu mühitdə gözlənildiyini təsdiqləyin; gözlənilirsə, idxalı əl ilə işə salın.', link: { page: PAGES.operations, runbook: RUNBOOKS.sources }, requiredPermission: 'ops.control' });
  } else {
    if (glorri.lastStatus === 'FAILED') out.push({ id: 'imports.glorri.failed', area: 'imports', status: 'attention', severity: 'high', title: 'Son Glorri idxalı uğursuz olub', condition: 'Ən son qeydə alınmış Glorri icrası uğursuz statusla bitib.', facts: { lastStatus: 'FAILED', lastRunAt: glorri.lastRunAt.toISOString() }, freshness: fresh('import run records', glorri.lastRunAt, now, hours(6)), nextStep: 'Əməliyyatlar səhifəsində icranın xəta qeydinə baxın; səbəb aydın olandan sonra idxalı yenidən işə salın.', link: { page: PAGES.operations, runbook: RUNBOOKS.sources }, requiredPermission: 'ops.control' });
    else if (now.getTime() - glorri.lastRunAt.getTime() > hours(6)) out.push({ id: 'imports.glorri.stale', area: 'imports', status: 'attention', severity: 'medium', title: 'Glorri idxalı 6 saatdan çoxdur işləməyib', condition: 'Ən son Glorri icrası 6 saatdan əvvəl başlayıb (saatlıq sinxronizasiya gözlənilir).', facts: { lastRunAt: glorri.lastRunAt.toISOString(), lastStatus: glorri.lastStatus }, freshness: fresh('import run records', glorri.lastRunAt, now, hours(6)), nextStep: 'İdxalın dayandırılmadığını (funksiya açarı) və planlaşdırıcının işlədiyini yoxlayın; lazım olsa idxalı əl ilə işə salın.', link: { page: PAGES.operations, runbook: RUNBOOKS.sources }, requiredPermission: 'ops.control' });
  }
  if (schedulerPaused && sources.some((s) => s.scheduled)) {
    out.push({ id: 'imports.scheduler.paused', area: 'imports', status: 'attention', severity: 'info', title: 'Cədvəllə mənbə yenilənməsi dayandırılıb', condition: 'Cədvəllə yenilənmə funksiya açarı ilə dayandırılıb; cədvələ salınmış mənbələr yenilənmir.', facts: { scheduledSources: sources.filter((s) => s.scheduled).length }, freshness: fresh('feature switch', null, now, 0), nextStep: 'Dayandırma qəsdəndirsə, heç nə etməyin; deyilsə, səbəbi yoxlayıb funksiyanı davam etdirin.', link: { page: PAGES.operations, runbook: RUNBOOKS.sources }, requiredPermission: 'ops.control' });
  }
  for (const s of sources.filter((x) => x.scheduled && !x.paused)) {
    if (s.cooldownUntil && s.cooldownUntil > now) {
      // A durable pause after a block or five failures in a row. This item replaces the generic "failing" one.
      out.push({ id: `source.${s.key}.cooling-down`, area: 'imports', status: 'attention', severity: 'high', title: `${s.name}: soyutma rejimində`, condition: `Mənbə ${s.cooldownUntil.toISOString()} tarixinə qədər dayandırılıb (${(s.cooldownReason ?? 'səbəb qeyd olunmayıb').slice(0, 160)}); ${s.consecutiveFailures} ardıcıl uğursuz yenilənmə. Bu müddətdə heç bir elan yenilənmir və heç biri bağlanmır.`, facts: { source: s.key, cooldownUntil: s.cooldownUntil.toISOString(), cooldownCount: s.cooldownCount ?? 1, consecutiveFailures: s.consecutiveFailures, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null }, freshness: fresh('import run records', s.lastSuccessAt, now, hours(48)), nextStep: 'Mənbə səhifəsində son icranın xətasına baxın. Səbəb mənbənin blokudursa və ya qaydaları dəyişibsə, mənbəni cədvəldən çıxarın və məhdudiyyəti aşmağa cəhd etməyin. Səbəb müvəqqətidirsə, soyutma bitəndə mənbə özü bir yoxlama icrası edəcək; ya da “Bərpa et” ilə soyutmanı əl ilə sıfırlayın.', link, requiredPermission: 'ops.control' });
      continue;
    }
    if (s.consecutiveFailures >= 3) out.push({ id: `source.${s.key}.failing`, area: 'imports', status: 'attention', severity: 'high', title: `${s.name}: ardıcıl uğursuz yenilənmələr`, condition: `${s.consecutiveFailures} ardıcıl cədvəlli yenilənmə uğursuz olub; mənbənin elanları yenilənmir və heç bir elan bağlanmır.`, facts: { source: s.key, consecutiveFailures: s.consecutiveFailures, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null }, freshness: fresh('import run records', s.lastSuccessAt, now, hours(48)), nextStep: 'Mənbə səhifəsində son icranın xətasına baxın. Mənbə blok edirsə və ya qaydaları dəyişibsə, onu cədvəldən çıxarın; hər hansı məhdudiyyəti aşmağa cəhd etməyin.', link, requiredPermission: 'ops.control' });
    else if (s.staleness === 'stale' || s.staleness === 'never_completed') out.push({ id: `source.${s.key}.stale`, area: 'imports', status: 'attention', severity: 'medium', title: `${s.name}: tam siyahı yenilənməsi köhnəlib`, condition: s.staleness === 'never_completed' ? 'Cədvələ salınıb, lakin heç vaxt tam siyahı ilə bitməyib; elanların açıq olduğu təsdiqlənmir.' : 'Son tam siyahı yenilənməsi iki interval əvvəl olub.', facts: { source: s.key, openFreshnessUnknown: s.openFreshnessUnknown, open: s.open, staleness: s.staleness }, freshness: fresh('import run records', s.lastSuccessAt, now, hours(48)), nextStep: 'Mənbənin son icrasına baxın; yenilənmə tamamlanmırsa limitləri və ya mənbənin dəyişikliyini araşdırın.', link, requiredPermission: 'ops.control' });
  }
  return out;
}

export interface QueueFacts { name: string; waiting: number; active: number; delayed: number; failed: number; retryable: boolean; unavailable?: boolean }

export function queueRules(queues: QueueFacts[], now: Date): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  const f = fresh('queue counters (live)', now, now, 60_000);
  for (const q of queues) {
    if (q.unavailable) out.push({ id: `queue.${q.name}.unknown`, area: 'queues', status: 'unknown', severity: 'medium', title: `${q.name} növbəsi oxuna bilmədi`, condition: 'Növbənin sayğacları oxuna bilmədi; boş növbə kimi göstərilmir.', facts: { queue: q.name }, freshness: f, nextStep: 'Redis bağlantısını yoxlayın.', link: { page: PAGES.operations, runbook: RUNBOOKS.launch }, requiredPermission: 'ops.read' });
    else if (q.failed > 0) out.push({ id: `queue.${q.name}.failed`, area: 'queues', status: 'attention', severity: 'medium', title: `${q.name} növbəsində uğursuz tapşırıqlar`, condition: `${q.failed} uğursuz tapşırıq var.`, facts: { queue: q.name, failed: q.failed, safeToRetryFromAdmin: q.retryable }, freshness: f, nextStep: q.retryable ? 'Uğursuz tapşırıqların səbəbinə baxın; bu növbənin tapşırıqları əməliyyatlar səhifəsindən təkrarlana bilər (təkrar yoxlanışdan sonra).' : 'Uğursuz tapşırıqların səbəbinə baxın. Bu növbənin tapşırıqları buradan təkrarlanmır: təkrar göndəriş təhlükəli ola bilər.', link: { page: PAGES.operations, runbook: RUNBOOKS.launch }, requiredPermission: q.retryable ? 'ops.control' : 'ops.read' });
    if (!q.unavailable && q.waiting > 500) out.push({ id: `queue.${q.name}.backlog`, area: 'queues', status: 'attention', severity: 'medium', title: `${q.name} növbəsində yığılma`, condition: `${q.waiting} tapşırıq gözləyir.`, facts: { queue: q.name, waiting: q.waiting, active: q.active }, freshness: f, nextStep: 'İşçinin işlədiyini və tapşırıqların icra olunduğunu yoxlayın.', link: { page: PAGES.operations, runbook: RUNBOOKS.launch }, requiredPermission: 'ops.read' });
  }
  return out;
}

export interface DocumentFacts { providerConfigured: boolean; stalePending: number; strandedReservations: number; generated24h: number; failed24h: number; oldestPendingAt: Date | null }

export function documentRules(d: DocumentFacts, now: Date): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  const f = fresh('document records (live query)', now, now, 60_000);
  const link = { page: PAGES.operations, runbook: RUNBOOKS.documents };
  if (!d.providerConfigured) out.push({ id: 'documents.provider.not-configured', area: 'documents', status: 'attention', severity: 'medium', title: 'Sənəd yaratma xidməti qoşulmayıb', condition: 'Süni intellekt provayderinin açarı qurulmayıb: CV, rezümə və məktub yaratma sorğuları uğursuz olacaq (və limit sərf etməyəcək).', facts: { providerConfigured: false }, freshness: f, nextStep: 'Provayder açarının mühitdə qurulduğunu yoxlayın (açar bu cavabda göstərilmir).', link, requiredPermission: 'ops.read' });
  if (d.stalePending > 0) out.push({ id: 'documents.stale-pending', area: 'documents', status: 'attention', severity: 'medium', title: 'İşçisi itmiş sənəd sorğuları', condition: `${d.stalePending} sənəd 15 dəqiqədən çoxdur hazırlanır; növbə işçisi cavab vermir ola bilər.`, facts: { stalePending: d.stalePending, oldestPendingAt: d.oldestPendingAt?.toISOString() ?? null }, freshness: fresh('document records (live query)', d.oldestPendingAt, now, 15 * 60_000), nextStep: 'Sənəd növbəsinin işçisini yoxlayın. Namizəd növbəti açılışda sənədi uğursuz görəcək və limit avtomatik qaytarılacaq.', link, requiredPermission: 'ops.read' });
  if (d.strandedReservations > 0) out.push({ id: 'documents.stranded-reservations', area: 'documents', status: 'attention', severity: 'low', title: 'Qaytarılmamış sənəd rezervləri', condition: `${d.strandedReservations} müddəti keçmiş rezerv hələ qaytarılmayıb (namizəd hesabına növbəti baxışda avtomatik qaytarılır).`, facts: { strandedReservations: d.strandedReservations }, freshness: f, nextStep: 'Əlavə addım tələb olunmur; say azalmırsa sənəd növbəsini yoxlayın.', link, requiredPermission: 'ops.read' });
  const total = d.generated24h + d.failed24h;
  if (total >= 5 && d.failed24h / total >= 0.4) out.push({ id: 'documents.failure-rate', area: 'documents', status: 'attention', severity: 'high', title: 'Sənəd yaratmada yüksək uğursuzluq nisbəti', condition: `Son 24 saatda ${total} sorğudan ${d.failed24h} uğursuz olub.`, facts: { failed24h: d.failed24h, generated24h: d.generated24h, failedPercent: Math.round((d.failed24h / total) * 100) }, freshness: f, nextStep: 'Uğursuz sorğuların səbəb kodlarına (provayder, çıxış yoxlaması) baxın. Uğursuz sorğular namizədin limitini sərf etmir.', link, requiredPermission: 'ops.read' });
  return out;
}

export interface EmailFacts {
  enabled: boolean; transport: 'sink' | 'live'; environment: string; emergencyPaused: boolean;
  staleSending: number; oldestQueuedAgeMinutes: number | null; uncertain: number; oldestUncertainAt: Date | null;
  accepted7d: number; delivered7d: number; bounced7d: number; complained7d: number;
}

export function emailRules(e: EmailFacts, now: Date): RecommendationDraft[] {
  if (!e.enabled) return [];
  const out: RecommendationDraft[] = [];
  const f = fresh('e-mail application records (live query)', now, now, 60_000);
  const link = { page: PAGES.email, runbook: RUNBOOKS.email };
  if (e.transport === 'sink' && /^prod/i.test(e.environment)) out.push({ id: 'email.sink-in-production', area: 'email', status: 'attention', severity: 'high', title: 'İstehsal mühitində e-poçt müraciətləri sınaq qəbulediciyə yönləndirilir', condition: 'E-poçt müraciətləri açıqdır, lakin nəqliyyat yerli sınaq qəbulediciyədir: heç bir məktub işəgötürənə çatmır.', facts: { transport: 'sink', environment: e.environment }, freshness: f, nextStep: 'Bu qəsdən deyilsə, funksiyanı söndürün və canlı göndərməyə keçid qərarını ayrıca verin; canlı göndərmə bu paneldən aktivləşdirilmir.', link, requiredPermission: 'ops.read' });
  if (e.emergencyPaused) out.push({ id: 'email.sending-paused', area: 'email', status: 'attention', severity: 'info', title: 'E-poçt müraciətlərinin göndərilməsi dayandırılıb', condition: 'Təcili dayandırma açıqdır; növbədəki müraciətlər gözləyir və itirilmir.', facts: { paused: true }, freshness: f, nextStep: 'Dayandırma qəsdəndirsə, heç nə etməyin. Deyilsə, səbəbi yoxlayıb əməliyyatlar səhifəsindən davam etdirin (səbəb qeyd olunur).', link: { page: PAGES.operations, runbook: RUNBOOKS.email }, requiredPermission: 'ops.control' });
  if (e.staleSending > 0) out.push({ id: 'email.stale-sending', area: 'email', status: 'attention', severity: 'high', title: 'Göndərmə zamanı ilişmiş müraciətlər', condition: `${e.staleSending} müraciət 10 dəqiqədən çoxdur "göndərilir" vəziyyətindədir.`, facts: { staleSending: e.staleSending }, freshness: f, nextStep: 'Növbə işçisini yoxlayın. Nəticəsi təsdiqlənməyən göndərmələr avtomatik təkrarlanmır; namizəd özü qərar verir.', link, requiredPermission: 'ops.read' });
  if ((e.oldestQueuedAgeMinutes ?? 0) > 60 && !e.emergencyPaused) out.push({ id: 'email.queue-stuck', area: 'email', status: 'attention', severity: 'high', title: 'E-poçt növbəsində uzun gözləyən müraciət', condition: `Ən köhnə növbəli müraciət ${e.oldestQueuedAgeMinutes} dəqiqədir gözləyir.`, facts: { oldestQueuedAgeMinutes: e.oldestQueuedAgeMinutes }, freshness: f, nextStep: 'Gözləmə səbəbinə (gündəlik limit, namizəd dayandırması, təkrar cəhd) baxın.', link, requiredPermission: 'ops.read' });
  if (e.uncertain > 0) out.push({ id: 'email.uncertain', area: 'email', status: 'attention', severity: 'medium', title: 'Nəticəsi təsdiqlənməyən e-poçt müraciətləri', condition: `${e.uncertain} müraciətin göndərilib-göndərilmədiyi bilinmir; heç biri avtomatik təkrarlanmayıb.`, facts: { uncertain: e.uncertain, oldestUncertainAt: e.oldestUncertainAt?.toISOString() ?? null }, freshness: fresh('e-mail application records (live query)', e.oldestUncertainAt, now, 24 * 3600_000), nextStep: 'Provayderin əlçatanlığını yoxlayın. Təkrar göndərmə qərarı namizədindir və təkrar riskini təsdiqləməsini tələb edir.', link, requiredPermission: 'ops.read' });
  if (e.accepted7d >= 5 && e.delivered7d + e.bounced7d + e.complained7d === 0) out.push({ id: 'email.no-delivery-evidence', area: 'email', status: 'unknown', severity: 'medium', title: 'Çatdırılma sübutu gəlmir', condition: `Son 7 gündə ${e.accepted7d} məktub provayder tərəfindən qəbul edilib, lakin heç bir çatdırılma/geri qayıtma hadisəsi alınmayıb. Bu, çatdırılmanın uğurlu və ya uğursuz olduğunu göstərmir.`, facts: { accepted7d: e.accepted7d, delivered7d: 0, bounced7d: 0 }, freshness: f, nextStep: 'Provayderin webhook ünvanını və imza açarını yoxlayın (açar göstərilmir).', link, requiredPermission: 'ops.read' });
  if (e.accepted7d >= 20 && e.bounced7d / e.accepted7d > 0.1) out.push({ id: 'email.bounce-rate', area: 'email', status: 'attention', severity: 'high', title: 'Yüksək geri qayıtma nisbəti', condition: `Son 7 gündə qəbul edilən ${e.accepted7d} məktubdan ${e.bounced7d} geri qayıdıb.`, facts: { accepted7d: e.accepted7d, bounced7d: e.bounced7d, bouncedPercent: Math.round((e.bounced7d / e.accepted7d) * 1000) / 10 }, freshness: f, nextStep: 'Geri qayıdan ünvanlar avtomatik bloklanır. Göndərici reputasiyasını qorumaq üçün göndərməni müvəqqəti dayandırmağı və səbəbləri araşdırmağı düşünün.', link, requiredPermission: 'ops.control' });
  if (e.accepted7d >= 20 && e.complained7d / e.accepted7d > 0.005) out.push({ id: 'email.complaint-rate', area: 'email', status: 'attention', severity: 'high', title: 'Şikayət nisbəti yüksəkdir', condition: `Son 7 gündə ${e.complained7d} şikayət qeydə alınıb.`, facts: { accepted7d: e.accepted7d, complained7d: e.complained7d }, freshness: f, nextStep: 'Şikayət edən ünvanlar bloklanır. Göndərməni dayandırıb məzmunu və seçim qaydalarını nəzərdən keçirin.', link, requiredPermission: 'ops.control' });
  return out;
}

export function moderationRules(pendingCompanies: number, oldestPendingAt: Date | null, now: Date): RecommendationDraft[] {
  if (pendingCompanies === 0 || !oldestPendingAt || now.getTime() - oldestPendingAt.getTime() < 72 * 3600_000) return [];
  return [{ id: 'moderation.companies-waiting', area: 'moderation', status: 'attention', severity: 'low', title: 'Uzun gözləyən şirkət müraciətləri', condition: `${pendingCompanies} şirkət təsdiq gözləyir; ən köhnəsi 72 saatdan çoxdur.`, facts: { pending: pendingCompanies, oldestPendingAt: oldestPendingAt.toISOString() }, freshness: fresh('company records (live query)', oldestPendingAt, now, 72 * 3600_000), nextStep: 'Şirkət profillərini nəzərdən keçirib təsdiqləyin və ya rədd edin (səbəb qeyd olunur).', link: { page: PAGES.businesses, runbook: null }, requiredPermission: 'companies.moderate' }];
}

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const sortRecommendations = <T extends { severity: Severity; status: string; id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.status === b.status ? 0 : a.status === 'attention' ? -1 : 1) || a.id.localeCompare(b.id));
