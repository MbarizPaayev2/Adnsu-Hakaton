// Browser agent: shared types and the exact wording shown to the candidate. Statuses are never softened: a candidate-reported submission is not a
// portal confirmation, and an unclear outcome is shown as unclear.
export type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad';
export const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-50 text-neutral-800 border-neutral-200',
  progress: 'bg-blue-50 text-blue-800 border-blue-200',
  good: 'bg-green-50 text-green-800 border-green-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
};

export interface AgentCapabilities {
  enabled: boolean; assisted: boolean; autonomous: boolean; pausedByOperator: boolean; pairedDevices: number;
  limits: { userDailyLimit: number; maxCampaignDays: number };
  /** The plan entitlement as the server holds it: whether this account may use the assistant and this month's use against the cap. */
  entitlement?: { included: boolean; plan: string; monthlyLimit: number | null; usedThisMonth: number; remainingThisMonth: number | null };
  portals: { key: string; name: string; limitations: string[]; autonomousAvailable: boolean; verification: { form: string; liveSubmission: string } }[];
  /** The extension the API hands out, and the oldest version still allowed to act (null: no floor). */
  extension?: { latestVersion: string | null; minVersion: string | null };
}
/** `update`: 'required' when the version is below the floor (the assistant refuses to act), 'available' when a newer ZIP exists. */
export interface AgentDevice { id: string; name: string; createdAt: string; lastSeenAt: string | null; extensionVersion?: string | null; update?: 'required' | 'available' | null }
export interface AgentCampaign {
  id: string; name: string; mode: 'ASSISTED' | 'AUTONOMOUS'; status: 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXPIRED' | 'STOPPED'; portals: string[];
  employerAllow: string[]; employerDeny: string[]; targetRoles: string[]; locations: string[]; dailyLimit: number; submissionsToday: number; expiresAt: string;
  consentedAt: string; counts: Record<string, number>; hasCoverNote: boolean; useApprovedLetters?: boolean; resumeId: string;
}
export interface AgentQuestion { key: string; label: string; type: string; required: boolean; category: string; askReason?: string; options?: { value: string; label: string }[]; answer?: unknown }
export interface AgentEvent { id: string; actor: string; kind: string; detail: Record<string, unknown> | null; createdAt: string }
export interface AgentApplication {
  id: string; jobId: string; title: string; company: string; jobUrl: string; portal: string; applyUrl: string; mode: 'ASSISTED' | 'AUTONOMOUS'; state: string; stateReason: string | null;
  matchScore: number | null; matchedKeywords: unknown; campaign: { id: string; name: string; status: string };
  plan: { key: string; label: string; type: string; action: string; value: unknown; category: string; source?: string }[] | null; planHash: string | null;
  questions: AgentQuestion[]; approval: { required: boolean; approved: boolean; approvedAt: string | null };
  documents: { resume: { id: string; sha256: string }; coverNote: { sha256: string } | null; letter?: { enabled: boolean; approved: boolean; documentId?: string; sha256?: string } | null };
  confirmation: 'PORTAL' | 'CANDIDATE' | null; evidence: { confirmationUrl: string; capturedAt: string; portalReference?: string | null } | null;
  submittedAt: string | null; uncertainAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; nextActions: string[]; events: AgentEvent[];
}

export const STATE: Record<string, { tone: Tone; label: string }> = {
  QUEUED: { tone: 'neutral', label: 'Növbədə' },
  PREPARING: { tone: 'progress', label: 'Forma oxunur' },
  AWAITING_INPUT: { tone: 'warn', label: 'Sizin cavabınız lazımdır' },
  READY: { tone: 'progress', label: 'Hazırdır' },
  SUBMITTING: { tone: 'progress', label: 'Göndərilir…' },
  SUBMITTED: { tone: 'good', label: 'Göndərildi' },
  FAILED: { tone: 'bad', label: 'Alınmadı' },
  CANCELLED: { tone: 'neutral', label: 'Ləğv edildi' },
  UNCERTAIN: { tone: 'warn', label: 'Nəticə bəlli deyil' },
};

export function stateOf(a: Pick<AgentApplication, 'state' | 'mode' | 'approval' | 'confirmation'>): { tone: Tone; label: string } {
  if (a.state === 'READY' && a.approval.required && !a.approval.approved) return { tone: 'warn', label: 'Təsdiqinizi gözləyir' };
  if (a.state === 'SUBMITTED') return a.confirmation === 'PORTAL' ? { tone: 'good', label: 'Göndərildi — portalın təsdiq səhifəsi saxlanıldı' } : { tone: 'warn', label: 'Göndərildi — sizin bildirişinizlə, portal təsdiqləməyib' };
  return STATE[a.state] ?? { tone: 'neutral', label: a.state };
}

export const REASON: Record<string, string> = {
  CONSENT_REVOKED: 'Razılığı geri götürdünüz; göndərilməyib.',
  EMERGENCY_STOP: 'Təcili dayandırma; göndərilməyib.',
  CAMPAIGN_EXPIRED: 'İcazənin müddəti bitdi; göndərilməyib.',
  JOB_CLOSED: 'Vakansiya bağlanıb; göndərilməyib.',
  CANCELLED_BY_CANDIDATE: 'Siz ləğv etdiniz.',
  DUPLICATE_ELSEWHERE: 'Bu vakansiyaya başqa yolla artıq müraciət var.',
  QUESTIONS: 'Forma, təsdiqlənmiş cavablarınızın əhatə etmədiyi suallar verdi.',
  CAPTCHA: 'Portal CAPTCHA göstərdi. Açıq qalan səhifədə onu özünüz həll edin.',
  CAPTCHA_PENDING: 'Portal CAPTCHA göstərir. Açıq qalan səhifədə onu özünüz həll edin; təsdiq səhifəsi görünən kimi AISE onu qeyd edəcək.',
  LOGIN_REQUIRED: 'Portal giriş tələb edir. Açıq səhifədə özünüz daxil olun.',
  DECLARATION_CHANGED: 'Portalın hüquqi/süni intellekt bildirişi dəyişib. Yeni mətni yoxlayıb yenidən təsdiqləyin.',
  VALIDATION_FAILED: 'Doldurulmuş forma planla üst-üstə düşmədi və ya məcburi sahə boş qaldı. Heç nə göndərilməyib.',
  VALIDATION_ERROR: 'Portal formanı qəbul etmədi (xəta göstərdi). Heç nə göndərilməyib.',
  FORM_CHANGED: 'Forma gözlənildiyi kimi deyil. Heç nə göndərilməyib.',
  RESUME_CHANGED: 'CV faylı razılaşdırdığınız versiyadan fərqlənir; göndərilmədi.',
  UNSUPPORTED_FORM: 'Bu forma dəstəklənmir.',
  PREPARE_ATTEMPTS_EXHAUSTED: 'Forma bir neçə cəhdə oxuna bilmədi.',
  PORTAL_ERROR: 'Portal cavab vermədi; yenidən cəhd olunacaq.',
  LEASE_EXPIRED_DURING_SUBMIT: 'Göndərmə zamanı brauzer cavab verməyi dayandırdı: müraciət çatmış ola bilər.',
  NO_CONFIRMATION: 'Göndər düyməsi basıldı, amma portal təsdiq səhifəsi göstərmədi: müraciət çatmış ola bilər.',
  EVIDENCE_NOT_ACCEPTED: 'Təsdiq səhifəsi qəbul edilmədi: müraciət çatmış ola bilər.',
  REPORTED_BY_CANDIDATE: 'Siz göndərildiyini bildirdiniz; portal təsdiqləməyib.',
  RETRY_AFTER_RECONCILIATION: 'Göndərilmədiyini bildirdiniz; forma yenidən oxunacaq.',
};

export const CATEGORY: Record<string, string> = {
  resume: 'CV', name: 'Ad', email: 'E-poçt', phone: 'Telefon', location: 'Yer', org: 'Hazırkı şirkət', link_linkedin: 'LinkedIn', link_github: 'GitHub', link_twitter: 'Twitter',
  link_portfolio: 'Portfolio', link_other: 'Digər sayt', work_authorization: 'İş icazəsi', salary: 'Maaş', notice: 'Başlama müddəti', cover: 'Motivasiya qeydi', sensitive: 'Həssas məlumat', declaration: 'Razılıq/bəyannamə', unknown: 'İşəgötürənin sualı',
};
export const ASK_REASON: Record<string, string> = {
  missing: 'Təsdiqlənmiş cavablarınızda yoxdur', unknown: 'İşəgötürənin öz sualı: AISE cavab uydurmur', sensitive: 'Həssas məlumat: AISE heç vaxt sizin əvəzinizə cavablamır', declaration: 'Hüquqi bəyannamə: yalnız siz qəbul edə bilərsiniz',
  always_ask: 'Bu kateqoriyanı hər dəfə soruşmağı seçmisiniz', unsupported_control: 'AISE bu sahə növünü doldura bilmir: özünüz doldurun', ambiguous_option: 'Seçimlər birmənalı deyil',
};
export const EVENT: Record<string, string> = {
  queued: 'İcazəniz çərçivəsində növbəyə qoyuldu', claimed: 'Brauzeriniz işi götürdü', awaiting_input: 'Cavabınız lazımdır', plan_ready: 'Doldurma planı hazır oldu', answers_given: 'Siz suallara cavab verdiniz', approved: 'Siz planı təsdiqlədiniz',
  permit_issued: 'Göndərmə icazəsi verildi (bir dəfəlik)', permit_refused: 'Göndərmə icazəsi verilmədi', submitted_with_evidence: 'Göndərildi: portalın təsdiq səhifəsi saxlanıldı', evidence_rejected: 'Təsdiq səhifəsi qəbul edilmədi', uncertain: 'Nəticə bəlli deyil',
  cancelled: 'Ləğv edildi', failed: 'Alınmadı', handoff: 'Portal sizin addımınızı gözləyir', blocked: 'Dayandırıldı', blocked_before_submit: 'Göndərmədən əvvəl dayandırıldı', reported_submitted: 'Siz göndərildiyini bildirdiniz', reported_not_submitted: 'Siz göndərilmədiyini bildirdiniz', lease_expired: 'Brauzer cavab vermədi', portal_error: 'Portal xətası',
};

export async function errorOf(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const raw = (Array.isArray(data.message) ? data.message.join(', ') : data.message) || `Xəta (${res.status})`;
  return String(raw).replace(/\s*\([A-Z_:,.a-z0-9]+\)\s*$/, '');
}

/**
 * Whether a paired browser is reachable now, from when the extension last called AISE (it checks in every few minutes while the browser is open).
 * "online" within 10 minutes; "idle" when it was seen today (browser closed or asleep); "stale" after that. Nothing is claimed beyond what was seen.
 */
export function deviceConnection(lastSeenAt: string | null | undefined, now = Date.now()): { state: 'online' | 'idle' | 'stale' | 'never'; label: string; hint: string } {
  if (!lastSeenAt) return { state: 'never', label: 'Hələ əlaqə olmayıb', hint: 'Genişlənmədə cütləmə kodunu yazın; brauzer AISE ilə ilk dəfə əlaqə saxlayanda burada görünəcək.' };
  const age = now - new Date(lastSeenAt).getTime();
  if (age <= 10 * 60_000) return { state: 'online', label: 'Qoşulub', hint: 'Brauzer açıqdır və AISE ilə əlaqədədir.' };
  if (age <= 24 * 3_600_000) return { state: 'idle', label: 'Hazırda əlaqə yoxdur', hint: 'Brauzer bağlıdır və ya kompüter yuxu rejimindədir. Chrome-u açanda köməkçi özü yenidən qoşulur.' };
  return { state: 'stale', label: 'Uzun müddətdir görünmür', hint: 'Chrome-da genişlənmənin aktiv olduğunu yoxlayın (chrome://extensions). Lazım olsa, brauzeri ayırıb yenidən cütləyin.' };
}
