import type { AlertFrequency, CommercialCatalogue, CompanyRef, EntitlementsView, HomeSummary, JobRef, NotificationPreferences, RetentionCapabilities, SavedJob, SavedSearch, SearchCriteria } from './contract';
import { RetentionError, retentionMode } from './contract';

/**
 * The seam between UI and backend. Implementations:
 *  - live (default): the real API with the signed-in session (./live/adapter.ts);
 *  - fixture (explicit local QA host only): browser-only storage with synthetic data;
 *  - unavailable: kept for tests and for a build that must not call the backend.
 */
export interface RetentionApi {
  readonly mode: 'live' | 'fixture' | 'unavailable';
  readonly capabilities: RetentionCapabilities;
  listSavedJobs(): Promise<SavedJob[]>;
  saveJob(job: JobRef): Promise<void>;
  unsaveJob(key: string): Promise<void>;
  isJobSaved(key: string): Promise<boolean>;
  listSearches(): Promise<SavedSearch[]>;
  createSearch(input: { name: string; criteria: SearchCriteria; frequency: AlertFrequency }): Promise<SavedSearch>;
  updateSearch(id: string, patch: Partial<Pick<SavedSearch, 'name' | 'frequency' | 'paused'>>): Promise<SavedSearch>;
  deleteSearch(id: string): Promise<void>;
  listCompanies(): Promise<CompanyRef[]>;
  listFollowed(): Promise<string[]>;
  setFollowed(key: string, follow: boolean, companyName?: string): Promise<void>;
  getPreferences(): Promise<NotificationPreferences>;
  updatePreferences(next: NotificationPreferences): Promise<NotificationPreferences>;
  /** Secure linking is server-driven; the UI never handles tokens. Rejects UNAVAILABLE while the server has Telegram disabled. */
  startTelegramLink(): Promise<{ url: string }>;
  disconnectTelegram(): Promise<void>;
  getCatalogue(): Promise<CommercialCatalogue>;
  getEntitlements(): Promise<EntitlementsView>;
  getHome(): Promise<HomeSummary>;
}

const unavailable = (what: string) => Promise.reject(new RetentionError('UNAVAILABLE', `${what} hələ aktiv deyil.`));

export const unavailableApi: RetentionApi = {
  mode: 'unavailable',
  capabilities: { weeklyDigest: false, perSearchFrequency: false },
  listSavedJobs: () => unavailable('Yadda saxlanan elanlar'),
  saveJob: () => unavailable('Elanı yadda saxlama'),
  unsaveJob: () => unavailable('Elanı yadda saxlama'),
  isJobSaved: () => unavailable('Elanı yadda saxlama'),
  listSearches: () => unavailable('Saxlanan axtarışlar'),
  createSearch: () => unavailable('Axtarışı saxlama'),
  updateSearch: () => unavailable('Axtarışı saxlama'),
  deleteSearch: () => unavailable('Axtarışı saxlama'),
  listCompanies: () => unavailable('Şirkətlərə abunə'),
  listFollowed: () => unavailable('Şirkətlərə abunə'),
  setFollowed: () => unavailable('Şirkətlərə abunə'),
  getPreferences: () => unavailable('Bildiriş seçimləri'),
  updatePreferences: () => unavailable('Bildiriş seçimləri'),
  startTelegramLink: () => unavailable('Telegram bağlantısı'),
  disconnectTelegram: () => unavailable('Telegram bağlantısı'),
  getCatalogue: () => unavailable('Plan kataloqu'),
  getEntitlements: () => unavailable('Plan imkanları'),
  getHome: () => unavailable('Fərdi xülasə'),
};

// The promise is cached, not the adapter: buttons that mount together all wait for the one adapter instead of each building their own.
let cached: Promise<RetentionApi> | null = null;

export function loadRetentionApi(): Promise<RetentionApi> {
  if (!cached) {
    cached = (retentionMode() === 'fixture'
      // Dynamic import keeps fixture code out of the live bundle path.
      ? import('./fixtures/adapter').then(({ createFixtureApi }) => createFixtureApi())
      : import('./live/adapter').then(({ createLiveApi }) => createLiveApi()));
    cached.catch(() => { cached = null; });
  }
  return cached;
}

/** Tests only: forget the cached adapter. */
export function resetRetentionApiForTests() { cached = null; }

export function isUnavailable(error: unknown): boolean {
  return error instanceof RetentionError && error.code === 'UNAVAILABLE';
}
