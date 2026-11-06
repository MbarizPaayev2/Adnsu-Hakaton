/**
 * Wording for e-mail applications. Delivery evidence and recruitment progress are different things and
 * are always worded as such: the provider accepting a message is not delivery, delivery is not review.
 */
export type DeliveryState =
  | 'DRAFT' | 'AWAITING_APPROVAL' | 'QUEUED' | 'SENDING' | 'PROVIDER_ACCEPTED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED' | 'UNCERTAIN' | 'CANCELLED';
export type RecruitmentState = 'NOT_SENT' | 'SENT' | 'ACKNOWLEDGED' | 'INTERVIEW_INVITED' | 'INTERVIEW_SCHEDULED' | 'OFFER' | 'REJECTED' | 'WITHDRAWN' | 'HIRED';
export type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad';

export const DELIVERY: Record<DeliveryState, { tone: Tone; label: string; explain: string }> = {
  DRAFT: { tone: 'neutral', label: 'Hazırlanır', explain: 'Hələ heç nə göndərilməyib.' },
  AWAITING_APPROVAL: { tone: 'neutral', label: 'Təsdiqiniz gözlənilir', explain: 'Siz təsdiq etməyincə heç nə göndərilməyəcək.' },
  QUEUED: { tone: 'progress', label: 'Göndəriş növbəsindədir', explain: 'Təsdiqlənib, hələ göndərilməyib. Bu mərhələdə ləğv edə bilərsiniz.' },
  SENDING: { tone: 'progress', label: 'Göndərilir...', explain: 'Mesaj e-poçt xidmətinə təhvil verilir.' },
  PROVIDER_ACCEPTED: { tone: 'warn', label: 'E-poçt xidməti qəbul etdi', explain: 'Bu, işəgötürənin mesajı aldığı və ya oxuduğu demək deyil. Çatdırılma təsdiqi hələ yoxdur.' },
  DELIVERED: { tone: 'good', label: 'Qəbuledicinin poçt serveri qəbul etdi', explain: 'Bu, e-poçt xidmətinin məlumatıdır. İşəgötürənin mesajı oxuduğunu göstərmir.' },
  BOUNCED: { tone: 'bad', label: 'Çatdırılmadı', explain: 'Qəbuledicinin serveri mesajı rədd etdi. Bu ünvana təkrar göndərilməyəcək.' },
  COMPLAINED: { tone: 'bad', label: 'Spam kimi bildirildi', explain: 'Qəbuledici mesajı şikayət etdi. Bu ünvana təkrar göndərilməyəcək.' },
  FAILED: { tone: 'bad', label: 'Göndərilmədi', explain: 'Mesaj göndərilmədi.' },
  UNCERTAIN: { tone: 'warn', label: 'Nəticə bəlli deyil', explain: 'Göndərilib-göndərilmədiyini təsdiq edə bilmirik. Təkrar göndərməyi özünüz qərara alırsınız; biz avtomatik təkrarlamırıq.' },
  CANCELLED: { tone: 'neutral', label: 'Ləğv edildi', explain: 'Heç nə göndərilmədi.' },
};

export const RECRUITMENT: Record<RecruitmentState, string> = {
  NOT_SENT: 'Göndərilməyib',
  SENT: 'Göndərilib',
  ACKNOWLEDGED: 'Qəbul təsdiqi alındı',
  INTERVIEW_INVITED: 'Müsahibəyə dəvət',
  INTERVIEW_SCHEDULED: 'Müsahibə təyin edilib',
  OFFER: 'Təklif',
  REJECTED: 'Rədd edildi',
  WITHDRAWN: 'Geri çəkildi',
  HIRED: 'İşə qəbul',
};

export const EVIDENCE: Record<string, string> = {
  PROVIDER_ACCEPTED: 'E-poçt xidməti',
  PROVIDER_EVENT: 'E-poçt xidmətinin hadisəsi',
  CANDIDATE_REPORTED: 'Siz bildirdiniz',
  REPLY_CONFIRMED_BY_CANDIDATE: 'Cavab (siz təsdiqlədiniz)',
  SYSTEM: 'Sistem',
};

export const HOLD_REASONS: Record<string, string> = {
  DAILY_LIMIT: 'Gündəlik göndəriş limitinə görə gözləyir',
  USER_PAUSED: 'Göndərişi siz dayandırmısınız',
  EMERGENCY_PAUSE: 'Sistem müvəqqəti dayandırılıb',
  AUTOMATION_PAUSED: 'Avtomatik müraciət müvəqqəti dayandırılıb',
  FEATURE_DISABLED: 'Bu mühitdə göndəriş söndürülüb',
  RETRY_SCHEDULED: 'Təkrar cəhd planlanıb',
  WORKER_INTERRUPTED: 'Göndəriş yenidən planlaşdırılır',
};

export const FAILURES: Record<string, string> = {
  JOB_CLOSED: 'Elan bağlandı və ya müddəti bitdi',
  RECIPIENT_SUPPRESSED: 'Bu ünvan əvvəl çatdırılmadığı üçün bloklanıb',
  RECIPIENT_NOT_AUTHORIZED: 'Bu ünvana göndərmək hələ icazəli deyil',
  INTEGRITY_MISMATCH: 'Təsdiqlənmiş məzmunla uyğunsuzluq aşkarlandı; heç nə göndərilmədi',
  ATTACHMENT_MISSING: 'CV nüsxəsi tapılmadı',
  RETRIES_EXHAUSTED: 'Bir neçə cəhddən sonra göndərilə bilmədi',
  LISTING_STALE: 'Elan 30 gündən artıqdır yenilənməyib və köhnəlmiş hesab olunur',
  DUPLICATE_APPLICATION: 'Bu vakansiyaya artıq müraciət göndərilib və ya göndərilməkdədir',
  EMAIL_NOT_VERIFIED: 'E-poçt ünvanınız təsdiqlənməyib',
  LETTER_NOT_APPROVED: 'Seçilmiş motivasiya məktubu hələ təsdiqlənməyib',
  LETTER_WRONG_JOB: 'Motivasiya məktubu bu vakansiya üçün hazırlanmayıb',
  WRONG_DOCUMENT_KIND: 'Seçilmiş sənəd növü uyğun deyil',
  LETTER_CHANGED: 'Motivasiya məktubu önizləmədən sonra dəyişdirildi; zəhmət olmasa yenidən yoxlayın',
  CV_CHANGED: 'CV faylı önizləmədən sonra dəyişdirildi; zəhmət olmasa yenidən yoxlayın',
  PREVIEW_STALE: 'Önizləmə köhnəlib; səhifəni yeniləyin',
};

export const failureText = (code: string | null | undefined) => (code ? (FAILURES[code] ?? (code.startsWith('PROVIDER_') ? 'E-poçt xidməti mesajı qəbul etmədi' : 'Göndərilmədi')) : '');

export const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-50 text-neutral-800 border-neutral-200',
  progress: 'bg-blue-50 text-blue-800 border-blue-200',
  good: 'bg-green-50 text-green-800 border-green-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
};

export interface AttachmentView {
  role: 'cv' | 'letter';
  fileName: string;
  mimeType: string;
  sha256: string;
  bytes: number | null;
  resumeId: string | null;
}

export interface RecipientEvidence {
  excerpt: string;
  subjectLine?: string | null;
  reference?: string | null;
  sourceUrl: string;
  observedAt: string;
  listedAt?: string | null;
}

export interface RecruitmentEvidenceView {
  state: RecruitmentState;
  evidence: 'PROVIDER_ACCEPTED' | 'CANDIDATE_REPORTED' | 'REPLY_CONFIRMED_BY_CANDIDATE' | null;
  employerConfirmed: boolean;
}

export interface EmailApplicationSummary {
  id: string; jobId: string | null; jobTitle: string; jobCompany: string; jobUrl: string; mode: 'REVIEW_AND_SEND' | 'AUTOMATIC';
  deliveryState: DeliveryState; recruitmentState: RecruitmentState; holdReason: string | null; failureCode: string | null; subject: string;
  approvedAt: string | null; providerAcceptedAt: string | null; deliveredAt: string | null; interviewAt: string | null; interviewTimezone: string | null; createdAt: string;
  /** Set when AISE prepared it in the background for the candidate to review; nothing is sent until they approve it. */
  preparedByAgentAt?: string | null;
}

export interface EmailApplicationView extends EmailApplicationSummary {
  recipient: string; instructions: string | null; instructionsExtra?: boolean; asksMoreThanCv?: boolean; reference: string | null; subjectSource: string; subjectLocked: boolean; body: string; copyToSelf: boolean; replyTo: string; senderName: string; senderAddress?: string | null;
  cv: { resumeId: string | null; kind: 'base' | 'tailored'; fileName: string; mimeType: string; sha256: string; bytes: number | null };
  letter?: { resumeId: string | null; fileName: string; mimeType: string; sha256: string; bytes: number | null } | null;
  attachments?: AttachmentView[];
  recipientEvidence?: RecipientEvidence | null;
  recruitment?: RecruitmentEvidenceView | null;
  payloadSha256: string; consentVersion: string | null; sharing: string[]; evidence: { providerAcceptedAt: string | null; deliveredAt: string | null; bouncedAt: string | null; complainedAt: string | null; uncertainAt: string | null };
  reminderOptIn: boolean; interviewNotes: string | null; attemptCount: number; inboundAddress?: string;
  history?: { id: string; from: RecruitmentState | null; to: RecruitmentState; evidence: string; note: string | null; at: string }[];
  replies?: { id: string; subject: string; receivedAt: string; suggestedState: RecruitmentState | null; suggestionReason: string | null; status: string; attachmentCount: number }[];
}

/** Local date-time input value ("YYYY-MM-DDTHH:mm") for an instant, shown in a given IANA zone. */
export function toLocalInput(iso: string | null, timeZone: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return parts.replace(' ', 'T');
}

/** The instant a wall-clock time in an IANA zone means, as an ISO string (no offset guessing: the zone decides). */
export function fromLocalInput(local: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asUtc = new Date(`${local}:00Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const offset = (instant: Date) => {
    const zoned = new Date(new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(instant).replace(' ', 'T') + 'Z');
    return zoned.getTime() - instant.getTime();
  };
  try {
    const first = new Date(asUtc.getTime() - offset(asUtc));
    return new Date(asUtc.getTime() - offset(first)).toISOString();
  } catch {
    return null;
  }
}

export const COMMON_TIMEZONES = ['Asia/Baku', 'Europe/Istanbul', 'Europe/Moscow', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'UTC'];
