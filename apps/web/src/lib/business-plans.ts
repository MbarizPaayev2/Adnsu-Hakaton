/**
 * Employer plans as the server reports them (GET /business/plans). Nothing here decides what an employer may do: the server enforces entitlements,
 * moderation and expiry; this module only turns its answers into plain Azerbaijani and into the next sensible action.
 */
export interface PlansOverview {
  /** Plans are switched on in this deployment. When false the vacancy flow is exactly what it was before. */
  gated: boolean;
  /** Checkout can be opened (billing switched on and provider products exist). */
  checkoutAvailable: boolean;
  prices: { singleAzn: number; singleDays: number; businessAznPerMonth: number; trialDays: number };
  trial: { available: boolean; used: boolean; startedAt: string | null; endsAt: string | null };
  credits: { available: number };
  business: { active: boolean; status: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
  nextPublication: 'BUSINESS' | 'CREDIT' | 'TRIAL' | 'NONE';
}

export type VacancyStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'DELETED';

export interface PlanVacancy {
  id: string;
  title: string;
  status: VacancyStatus;
  deadline?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  publicationPlan?: 'TRIAL' | 'SINGLE' | 'BUSINESS' | null;
  expiryReason?: 'TRIAL_ENDED' | 'DURATION' | 'SUBSCRIPTION_LAPSED' | 'DEADLINE' | string | null;
  moderationNote?: string | null;
}

export const STATUS_LABEL: Record<VacancyStatus, string> = {
  DRAFT: 'Qaralama',
  PENDING_REVIEW: 'Yoxlanılır',
  APPROVED: 'Təsdiqlənib, yayımlanmayıb',
  REJECTED: 'Rədd edilib',
  ACTIVE: 'Aktiv',
  PAUSED: 'Dayandırılmış',
  EXPIRED: 'Müddəti bitib',
  DELETED: 'Silinmiş',
};

export const PLAN_LABEL = { TRIAL: 'Sınaq', SINGLE: 'Tək vakansiya', BUSINESS: 'Biznes' } as const;

export const EXPIRY_REASON_LABEL: Record<string, string> = {
  TRIAL_ENDED: 'Ödənişsiz sınaq müddəti bitdi.',
  DURATION: '30 günlük yayım müddəti bitdi.',
  SUBSCRIPTION_LAPSED: 'Biznes abunəliyi aktiv olmadığı üçün elan dayandırıldı.',
  DEADLINE: 'Elanın son tarixi keçdi.',
};

/** What publishing the next vacancy will use, in one plain sentence. */
export function nextPublicationText(o: PlansOverview): string {
  switch (o.nextPublication) {
    case 'BUSINESS': return 'Biznes planınız çərçivəsində yayımlanacaq.';
    case 'CREDIT': return `Bir Tək vakansiya krediti işlənəcək və elan ${o.prices.singleDays} gün yayımda qalacaq.`;
    case 'TRIAL': return `Ödənişsiz ${o.prices.trialDays} günlük sınaq yayımlandığı an başlayacaq. Kart tələb olunmur.`;
    default: return 'Yayımlamaq üçün Tək vakansiya (' + o.prices.singleAzn + ' AZN) və ya Biznes planı lazımdır.';
  }
}

export function daysLeft(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export interface PlanAction {
  kind: 'submit' | 'publish' | 'extend' | 'reconfirm' | 'edit' | 'buy' | 'none';
  label: string;
  /** Short explanation shown next to the action. */
  hint: string;
  /** What the server will spend, shown BEFORE the click. */
  cost?: string;
}

/** The one next step for a vacancy under plans. Mirrors the server's rules; the server still decides. */
export function nextAction(v: PlanVacancy, o: PlansOverview, now = Date.now()): PlanAction {
  switch (v.status) {
    case 'DRAFT':
      return { kind: 'submit', label: 'Yoxlamaya göndər', hint: 'AISE vakansiyanı qaydalara uyğunluq üçün yoxlayır. Bu mərhələdə ödəniş və ya sınaq işlənmir.' };
    case 'PENDING_REVIEW':
      return { kind: 'none', label: 'Yoxlanılır', hint: 'AISE vakansiyanı yoxlayır. Nəticə burada görünəcək; bu mərhələdə heç nə işlənmir.' };
    case 'REJECTED':
      return { kind: 'submit', label: 'Düzəlişdən sonra yenidən göndər', hint: v.moderationNote ? `Rədd səbəbi: ${v.moderationNote}` : 'Vakansiya qəbul edilmədi. Mətni düzəldib yenidən göndərə bilərsiniz.' };
    case 'APPROVED':
      return o.nextPublication === 'NONE'
        ? { kind: 'buy', label: 'Plan seç', hint: 'Vakansiya təsdiqlənib. Yayımlamaq üçün ödənişli plan lazımdır.', cost: undefined }
        : { kind: 'publish', label: 'Yayımla', hint: 'Vakansiya təsdiqlənib.', cost: nextPublicationText(o) };
    case 'ACTIVE': {
      const left = daysLeft(v.expiresAt, now);
      if (v.publicationPlan === 'BUSINESS') {
        return left !== null && left <= 14
          ? { kind: 'reconfirm', label: 'Hələ də aktualdır', hint: `Yayım ${left} gün sonra bitir. Təsdiqləsəniz müddət uzanır, əlavə ödəniş yoxdur.` }
          : { kind: 'none', label: '', hint: v.expiresAt ? 'Biznes planı ilə yayımdadır.' : '' };
      }
      if (left === null || left > 7) return { kind: 'none', label: '', hint: '' };
      // A trial listing can be carried on after its free days; either way it is an explicit, separate purchase that never renews by itself.
      const after = v.publicationPlan === 'TRIAL' ? 'Sınaq bitəndən sonra davam etmək üçün: ' : '';
      return o.credits.available > 0
        ? { kind: 'extend', label: `${after}daha ${o.prices.singleDays} gün uzat`.replace(/^./, (c) => c.toUpperCase()), hint: `Yayım ${left} gün sonra bitir.`, cost: 'Bir Tək vakansiya krediti işlənəcək.' }
        : { kind: 'buy', label: `${after}daha ${o.prices.singleDays} gün — ${o.prices.singleAzn} AZN`.replace(/^./, (c) => c.toUpperCase()), hint: `Yayım ${left} gün sonra bitir. Avtomatik yenilənmə yoxdur.` };
    }
    case 'EXPIRED': {
      const why = (v.expiryReason && EXPIRY_REASON_LABEL[v.expiryReason]) || 'Yayım müddəti bitdi.';
      if (v.expiryReason === 'DEADLINE') return { kind: 'edit', label: 'Son tarixi dəyiş', hint: why };
      if (o.nextPublication === 'NONE') return { kind: 'buy', label: 'Plan seç', hint: `${why} Müraciətlər və məlumatlar saxlanılıb.` };
      return { kind: 'publish', label: 'Yenidən yayımla', hint: `${why} Müraciətlər və məlumatlar saxlanılıb.`, cost: nextPublicationText(o) };
    }
    default:
      return { kind: 'none', label: '', hint: '' };
  }
}

export interface PlanCallResult<T = unknown> { ok: boolean; status: number; data: T | null; message: string | null }

/** Calls the employer plans routes through the cookie-backed bridge. Never throws; the message is the server's own plain-language text when it has one. */
export async function callPlans<T = unknown>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<PlanCallResult<T>> {
  try {
    const res = await fetch(`/api/business/plans${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const text = await res.text();
    let data: { message?: unknown } | null = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const raw = data?.message as unknown;
    const message = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(' ') : typeof (raw as { message?: unknown } | null)?.message === 'string' ? (raw as { message: string }).message : null;
    return { ok: res.ok, status: res.status, data: res.ok ? (data as T) : null, message: res.ok ? null : message ?? 'Əməliyyat alınmadı. Bir az sonra yenidən cəhd edin.' };
  } catch {
    return { ok: false, status: 0, data: null, message: 'Şəbəkə xətası. Bağlantını yoxlayıb yenidən cəhd edin.' };
  }
}

export async function loadPlansOverview(): Promise<PlansOverview | null> {
  const r = await callPlans<PlansOverview>('');
  return r.ok ? r.data : null;
}

/** A fresh client key for one purchase intent: repeating the SAME request (network retry) never creates a second purchase. */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return `k-${c.randomUUID()}`;
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
