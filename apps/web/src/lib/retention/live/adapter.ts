import { apiFetch } from '@/lib/api';
import type { RetentionApi } from '../api';
import { RetentionError } from '../contract';
import type {
  AlertFrequency, CommercialCatalogue, CompanyRef, EmployerPackage, EntitlementsView, HomeSummary, JobRef, NotificationPreferences, PlanView, SavedJob, SavedSearch, SearchCriteria,
} from '../contract';

/**
 * LIVE ADAPTER — the real backend contract (docs/frontend-contract-2026-10-03.md), through the signed-in session. Every mapping below is
 * one the API really supports; what it cannot do is reported through `capabilities` and refused here, never simulated.
 */

type Json = Record<string, any>;

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response | undefined;
  const readOnly = !init.method || init.method.toUpperCase() === 'GET';
  for (let attempt = 0; attempt < (readOnly ? 2 : 1); attempt++) {
    try {
      res = await apiFetch(path, { cache: 'no-store', signal: AbortSignal.timeout(12_000), ...init });
      if (readOnly && attempt === 0 && [502, 503, 504].includes(res.status)) { await res.body?.cancel(); await new Promise((resolve) => setTimeout(resolve, 350)); continue; }
      break;
    } catch {
      if (!readOnly || attempt > 0) throw new RetentionError('FAILED', 'Serverlə əlaqə qurulmadı. Bir az sonra yenidən cəhd edin.');
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  if (!res) throw new RetentionError('FAILED', 'Serverlə əlaqə qurulmadı.');
  if (!res.ok) {
    let message = '';
    try { const body = await res.json(); message = Array.isArray(body?.message) ? body.message.join(' ') : String(body?.message || ''); } catch { /* no body */ }
    if (res.status === 401) throw new RetentionError('SIGNED_OUT', 'Sessiyanız bitib. Zəhmət olmasa yenidən daxil olun.');
    if (res.status === 429) throw new RetentionError('RATE_LIMITED', message || 'Qısa müddətdə çox sorğu göndərildi. Bir az sonra yenidən cəhd edin.');
    if (res.status === 404) throw new RetentionError('NOT_FOUND', message || 'Tapılmadı.');
    if (res.status === 503) throw new RetentionError('UNAVAILABLE', message || 'Bu imkan hələ aktiv deyil.');
    throw new RetentionError('FAILED', message || 'Əməliyyat alınmadı.');
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => undefined)) as T;
}

const minutesToHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) throw new RetentionError('FAILED', 'Saat formatı yanlışdır.');
  return h * 60 + m;
}
const PAUSE_DAYS = 30;

/** Short Azerbaijani labels for entitlement features (copy lives in the UI layer; numbers come from the server). */
const FEATURE_LABELS: Record<string, string> = {
  'discovery.public_jobs': 'Bütün vakansiyalara baxış və axtarış',
  'saved.jobs': 'Elanları yadda saxlama',
  'saved.searches': 'Axtarış bildirişləri',
  'follows.companies': 'Şirkətlərə abunə',
  'alerts.email_digest': 'Gündəlik e-poçt xülasəsi',
  'alerts.instant': 'Məhdud ani bildirişlər',
  'cv.versions': 'CV versiyaları',
  'tailored.cv': 'Elana uyğunlaşdırılmış CV',
  'tailored.cover_letter': 'Faktlara əsaslanan müşayiət məktubu',
  'email.applications': 'E-poçtla müraciət',
  'preferences.rich': 'Genişləndirilmiş üstünlüklər',
  'applications.advanced_preparation': 'Müraciətə hazırlıq yoxlaması',
};
const PERIOD: Record<string, string> = { day: 'gündə', month: 'ayda', lifetime: 'ümumi', per_match: 'hər uyğunluq üçün' };

function planView(offer: Json, fallbackName: string): PlanView {
  const includes: string[] = [];
  const allowances: { label: string; value: string | null }[] = [];
  for (const [key, grant] of Object.entries<Json>(offer.features || {})) {
    const label = FEATURE_LABELS[key];
    if (!label || !grant?.enabled) continue;
    const planned = grant.availability === 'planned';
    includes.push(planned ? `${label} (hazırlanır)` : label);
    if (typeof grant.limit === 'number' && !planned) allowances.push({ label, value: `${grant.limit} ${PERIOD[grant.period] || ''}`.trim() });
    else if (grant.costly && !planned) allowances.push({ label, value: null });
  }
  const grants = Object.fromEntries(Object.entries<Json>(offer.features || {}).map(([k, g]) => [k, { enabled: !!g?.enabled, limit: typeof g?.limit === 'number' ? g.limit : g?.limit === null ? null : undefined, period: g?.period, availability: g?.availability }]));
  return { id: offer.id, name: offer.label || fallbackName, priceAzn: typeof offer.price === 'number' ? offer.price : null, period: 'ay', includes, allowances, grants, purchasable: !!offer.purchasable, checkoutId: offer.id };
}

export function createLiveApi(): RetentionApi {
  let cachedPrefs: { mapped: NotificationPreferences; raw: Json } | null = null;
  let globalFrequency: AlertFrequency | null = null;

  const fetchPrefs = async () => {
    const [raw, tg] = await Promise.all([call<Json>('/notification-preferences'), call<Json>('/telegram').catch(() => null)]);
    const paused = !!raw.pausedUntil && new Date(raw.pausedUntil).getTime() > Date.now();
    const mapped: NotificationPreferences = {
      channels: {
        inApp: !!(raw.newJobInApp && raw.matchInApp),
        email: !!(raw.emailEnabled && (raw.matchEmail || raw.newJobEmail !== 'OFF')),
        telegram: tg?.status === 'ACTIVE' || tg?.status === 'PAUSED',
      },
      frequency: raw.newJobEmail === 'INSTANT' ? 'instant' : 'daily',
      quietHours: { enabled: raw.quietStartMinute != null && raw.quietEndMinute != null, from: minutesToHm(raw.quietStartMinute ?? 1320), to: minutesToHm(raw.quietEndMinute ?? 480) },
      paused,
      pausedUntil: paused ? raw.pausedUntil : null,
      unsubscribedAll: !raw.emailEnabled,
      telegram: !tg || !tg.enabled ? 'unavailable' : tg.status === 'ACTIVE' || tg.status === 'PAUSED' ? 'linked' : 'unlinked',
      planOffersEmail: raw.planOffersEmail === true,
      instant: raw.instant ? { available: !!raw.instant.available, dailyLimit: raw.instant.dailyLimit ?? null } : undefined,
    };
    globalFrequency = mapped.frequency;
    cachedPrefs = { mapped, raw };
    return mapped;
  };

  const searchView = (s: Json, freq: AlertFrequency): SavedSearch => ({ id: s.id, name: s.name, criteria: (s.criteria || {}) as SearchCriteria, frequency: freq, paused: !s.alertsEnabled, updatedAt: s.updatedAt, newSinceLastVisit: null });
  const currentFrequency = async (): Promise<AlertFrequency> => globalFrequency ?? (await fetchPrefs()).frequency;

  // Every save button on a page shares one lookup. The jobs list renders a button per card, and a request per card spent most of
  // the API's per-IP limit (60 a minute) in one visit, so the saved-jobs page opened next was refused with 429.
  const SAVED_LOOKUP_MS = 30_000;
  let savedLookup: { at: number; keys: Promise<Set<string>> } | null = null;
  const rememberSaved = (keys: Promise<Set<string>>) => {
    const entry = { at: Date.now(), keys };
    savedLookup = entry;
    keys.catch(() => { if (savedLookup === entry) savedLookup = null; });
  };
  const adjustSaved = (key: string, saved: boolean) => {
    if (!savedLookup) return;
    rememberSaved(savedLookup.keys.then((keys) => { const next = new Set(keys); if (saved) next.add(key); else next.delete(key); return next; }));
  };

  return {
    mode: 'live',
    // The backend has one e-mail cadence per account (daily or instant) and no weekly digest.
    capabilities: { weeklyDigest: false, perSearchFrequency: false },

    async listSavedJobs() {
      const rows = await call<Json[]>('/saved-jobs');
      const jobs = rows.map((r): SavedJob => ({ key: r.ref, title: r.title, company: r.company, location: r.location ?? null, deadline: r.deadline ?? null, savedAt: r.savedAt, open: r.state === 'open', applyMethod: 'UNKNOWN' }));
      rememberSaved(Promise.resolve(new Set(jobs.map((j) => j.key))));
      return jobs;
    },
    async saveJob(job: JobRef) { await call(`/saved-jobs/${encodeURIComponent(job.key)}`, { method: 'PUT' }); adjustSaved(job.key, true); },
    async unsaveJob(key) { await call(`/saved-jobs/${encodeURIComponent(key)}`, { method: 'DELETE' }); adjustSaved(key, false); },
    async isJobSaved(key) {
      if (!savedLookup || Date.now() - savedLookup.at > SAVED_LOOKUP_MS) rememberSaved(this.listSavedJobs().then((jobs) => new Set(jobs.map((j) => j.key))));
      return (await savedLookup!.keys).has(key);
    },

    async listSearches() {
      const rows = await call<Json[]>('/saved-searches');
      const freq = globalFrequency ?? 'daily';
      return rows.map((s) => searchView(s, freq));
    },
    async createSearch(input) {
      const created = await call<Json>('/saved-searches', { method: 'POST', body: JSON.stringify({ name: input.name, criteria: input.criteria, alertsEnabled: true }) });
      const freq = await currentFrequency();
      const row = (await call<Json[]>('/saved-searches')).find((s) => s.id === created.id);
      if (!row) throw new RetentionError('FAILED', 'Axtarış yadda saxlanmadı.');
      return searchView(row, freq);
    },
    async updateSearch(id, patch) {
      const body: Json = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.paused !== undefined) body.alertsEnabled = !patch.paused;
      if (patch.frequency !== undefined) throw new RetentionError('FAILED', 'Hər axtarış üçün ayrıca tezlik seçmək mümkün deyil; tezliyi bildiriş parametrlərində seçin.');
      await call(`/saved-searches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      const freq = await currentFrequency();
      const row = (await call<Json[]>('/saved-searches')).find((s) => s.id === id);
      if (!row) throw new RetentionError('NOT_FOUND', 'Axtarış tapılmadı.');
      return searchView(row, freq);
    },
    async deleteSearch(id) { await call(`/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' }); },

    async listCompanies() {
      const rows = await call<Json[]>('/companies');
      // Stable backend ids only: two employers with the same name stay two entries, and vacancy counts are never summed across records.
      return rows.map((c): CompanyRef => ({
        id: c.id, key: `company:${c.id}`, name: c.name, sourceLabel: 'AISE-də qeydiyyatdan keçmiş işəgötürən',
        openVacancies: typeof c._count?.vacancies === 'number' ? c._count.vacancies : null, location: c.location ?? null, status: c.status,
        isRegistered: c.status === 'APPROVED', isPartner: false, logo: c.logo ?? undefined,
      } as CompanyRef)).sort((a, b) => a.name.localeCompare(b.name, 'az'));
    },
    async listFollowed() { return (await call<Json[]>('/company-follows')).map((f) => f.companyKey as string); },
    async setFollowed(key, shouldFollow, name) {
      if (shouldFollow) {
        if (key.startsWith('company:')) {
          await call('/company-follows', { method: 'PUT', body: JSON.stringify({ companyId: key.slice('company:'.length) }) });
          return;
        }
        if (!name?.trim()) throw new RetentionError('FAILED', 'Şirkətin adı tapılmadı.');
        const created = await call<Json>('/company-follows', { method: 'PUT', body: JSON.stringify({ company: name }) });
        if (created.companyKey !== key) {
          if (created.id) await call(`/company-follows/${encodeURIComponent(created.id)}`, { method: 'DELETE' }).catch(() => undefined);
          throw new RetentionError('FAILED', 'Şirkətin izləmə açarı uyğun gəlmədi. Yenidən cəhd edin.');
        }
        return;
      }
      const existing = (await call<Json[]>('/company-follows')).find((f) => f.companyKey === key);
      if (existing) await call(`/company-follows/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
    },

    async getPreferences() { return fetchPrefs(); },
    async updatePreferences(next) {
      const prev = cachedPrefs ?? { mapped: await fetchPrefs(), raw: {} };
      const before = prev.mapped;
      const body: Json = {};
      if (next.planOffersEmail !== before.planOffersEmail) body.planOffersEmail = next.planOffersEmail === true;
      if (next.channels.inApp !== before.channels.inApp) { body.matchInApp = next.channels.inApp; body.newJobInApp = next.channels.inApp; }
      if (next.channels.email !== before.channels.email) {
        body.matchEmail = next.channels.email;
        body.newJobEmail = next.channels.email ? (before.frequency === 'instant' ? 'INSTANT' : 'DAILY') : 'OFF';
        if (next.channels.email) body.emailEnabled = true;
      }
      if (next.frequency !== before.frequency) {
        if (next.frequency === 'weekly') throw new RetentionError('FAILED', 'Həftəlik xülasə dəstəklənmir. Gündəlik və ya ani seçin.');
        if (next.channels.email) body.newJobEmail = next.frequency === 'instant' ? 'INSTANT' : 'DAILY';
      }
      if (next.quietHours.enabled !== before.quietHours.enabled || (next.quietHours.enabled && (next.quietHours.from !== before.quietHours.from || next.quietHours.to !== before.quietHours.to))) {
        if (next.quietHours.enabled) { body.quietStartMinute = hmToMinutes(next.quietHours.from); body.quietEndMinute = hmToMinutes(next.quietHours.to); }
        else { body.quietStartMinute = null; body.quietEndMinute = null; }
      }
      if (next.paused !== before.paused) body.pausedUntil = next.paused ? new Date(Date.now() + PAUSE_DAYS * 86_400_000).toISOString() : null;
      if (next.unsubscribedAll !== before.unsubscribedAll) body.emailEnabled = !next.unsubscribedAll;
      if (next.channels.telegram !== before.channels.telegram && before.telegram === 'linked') body.newJobTelegram = next.channels.telegram ? 'DAILY' : 'OFF';
      if (Object.keys(body).length) await call('/notification-preferences', { method: 'PUT', body: JSON.stringify(body) });
      return fetchPrefs();
    },
    async startTelegramLink() {
      const res = await call<Json>('/telegram/link-token', { method: 'POST' });
      return { url: res.deepLink as string };
    },
    async disconnectTelegram() { await call('/telegram', { method: 'DELETE' }); cachedPrefs = null; },

    async getCatalogue(): Promise<CommercialCatalogue> {
      const [cat, status] = await Promise.all([call<Json>('/billing/catalogue'), call<Json>('/billing/status').catch(() => ({ paymentsEnabled: false }))]);
      const paymentsEnabled = status?.paymentsEnabled === true;
      const offer = (id: string) => (cat.candidate.offers as Json[]).find((o) => o.id === id);
      const free = planView(offer('free') || { id: 'free', label: 'Ödənişsiz', price: 0, features: {} }, 'Ödənişsiz');
      const plusOffer = offer('plus');
      const plus = plusOffer ? planView(plusOffer, 'Plus') : undefined;
      if (plus) plus.purchasable = plus.purchasable && paymentsEnabled && plus.priceAzn !== null;
      const premium = planView(offer('premium') || { id: 'premium', label: 'Premium', price: null, features: {} }, 'Premium');
      premium.purchasable = premium.purchasable && paymentsEnabled && premium.priceAzn !== null;
      const names: Record<string, EmployerPackage['id']> = { starter_trial: 'trial', single_job: 'single', business: 'recurring', enterprise: 'enterprise' };
      const employer: EmployerPackage[] = (cat.employer.offers as Json[]).map((o) => {
        // Purchasable only when the server says so AND payments are on; the free trial is started by publishing, never bought.
        const available = o.purchasable === true && paymentsEnabled;
        return {
          id: names[o.id] ?? 'trial', name: o.label, summary: available ? '' : 'Hazırda satışda deyil.', priceAzn: typeof o.price === 'number' ? o.price : null, available,
          cta: available ? { label: 'Kabinetdə seçin', href: '/business/billing' } : { label: 'Əlaqə saxlayın', href: '/contact' },
        };
      });
      const promo = (cat.employer.addons as Json[])?.[0];
      if (promo) employer.push({ id: 'promoted', name: 'Önə çıxarılmış elan', summary: 'İstəyə bağlı; həmişə "Promosyon" işarəsi ilə göstərilir.', priceAzn: typeof promo.price === 'number' ? promo.price : null, optional: true, available: false, cta: { label: 'Əlaqə saxlayın', href: '/contact' } });
      return {
        source: 'live', paymentsEnabled, candidate: { free, plus, premium }, employer,
        positioning: { cvPreview: cat.positioning?.cvPreview?.az, applicationReview: cat.positioning?.applicationReview?.az, premiumComparison: cat.positioning?.premiumComparison?.az, finePrint: cat.positioning?.finePrintAz },
      };
    },
    async getEntitlements(): Promise<EntitlementsView> {
      const e = await call<Json>('/billing/entitlements');
      return { plan: e.plan, offer: e.offer, legacy: !!e.legacy, features: e.features || {} };
    },
    async getHome(): Promise<HomeSummary> {
      // The dashboard computes its own answers from the authoritative timeline and matches; nothing here is guessed.
      return { reviewJobs: null, actionApplication: null, reply: null, searchUpdates: null };
    },
  };
}
