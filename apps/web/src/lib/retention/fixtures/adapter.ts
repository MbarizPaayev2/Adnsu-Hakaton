import type { RetentionApi } from '../api';
import { RetentionError } from '../contract';
import type { SavedJob, SavedSearch, NotificationPreferences } from '../contract';
import { dedupeCompanies } from '../companies';
import { FIXTURE_COMPANIES, fixtureCatalogue, fixtureHome, fixturePreferences, fixtureSavedJobs, fixtureSearches } from './data';

/**
 * FIXTURE ADAPTER — browser-only storage, synthetic data. Not a backend.
 * Failure injection for QA: localStorage 'aise.fixture.fail' = '*' or a
 * comma-separated list of operation names (e.g. 'saveJob,updateSearch').
 */
const KEY = 'aise.fixture.retention.v1';
const FAIL_KEY = 'aise.fixture.fail';

interface Store {
  saved: SavedJob[];
  searches: SavedSearch[];
  followed: string[];
  prefs: NotificationPreferences;
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch { /* fall through to seed */ }
  return { saved: fixtureSavedJobs(), searches: fixtureSearches(), followed: [], prefs: structuredClone(fixturePreferences) };
}

const write = (store: Store) => localStorage.setItem(KEY, JSON.stringify(store));

async function gate(op: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const fail = localStorage.getItem(FAIL_KEY);
  if (fail && (fail === '*' || fail.split(',').includes(op))) throw new RetentionError('FAILED', 'Əməliyyat alınmadı.');
}

export function createFixtureApi(): RetentionApi {
  return {
    mode: 'fixture',
    capabilities: { weeklyDigest: true, perSearchFrequency: true },
    async listSavedJobs() { await gate('listSavedJobs'); return read().saved; },
    async saveJob(job) {
      await gate('saveJob');
      const s = read();
      if (!s.saved.some((j) => j.key === job.key)) s.saved.unshift({ ...job, savedAt: new Date().toISOString(), open: true, applyMethod: 'UNKNOWN' });
      write(s);
    },
    async unsaveJob(key) { await gate('unsaveJob'); const s = read(); s.saved = s.saved.filter((j) => j.key !== key); write(s); },
    async isJobSaved(key) { await gate('isJobSaved'); return read().saved.some((j) => j.key === key); },
    async listSearches() { await gate('listSearches'); return read().searches; },
    async createSearch(input) {
      await gate('createSearch');
      const s = read();
      const created: SavedSearch = { id: `fx-${Date.now()}`, name: input.name, criteria: input.criteria, frequency: input.frequency, paused: false, updatedAt: new Date().toISOString(), newSinceLastVisit: null };
      s.searches.unshift(created); write(s); return created;
    },
    async updateSearch(id, patch) {
      await gate('updateSearch');
      const s = read();
      const i = s.searches.findIndex((x) => x.id === id);
      if (i < 0) throw new RetentionError('NOT_FOUND', 'Axtarış tapılmadı.');
      s.searches[i] = { ...s.searches[i], ...patch, updatedAt: new Date().toISOString() };
      write(s); return s.searches[i];
    },
    async deleteSearch(id) { await gate('deleteSearch'); const s = read(); s.searches = s.searches.filter((x) => x.id !== id); write(s); },
    async listCompanies() { await gate('listCompanies'); return dedupeCompanies(FIXTURE_COMPANIES); },
    async listFollowed() { await gate('listFollowed'); return read().followed; },
    async setFollowed(key, follow) {
      await gate('setFollowed');
      const s = read();
      s.followed = follow ? [...new Set([...s.followed, key])] : s.followed.filter((k) => k !== key);
      write(s);
    },
    async getPreferences() { await gate('getPreferences'); return read().prefs; },
    async updatePreferences(next) { await gate('updatePreferences'); const s = read(); s.prefs = next; write(s); return next; },
    // Linking needs the server's one-time flow; a fixture must never fake a link.
    async startTelegramLink() { await gate('startTelegramLink'); throw new RetentionError('UNAVAILABLE', 'Telegram bağlantısı hələ aktiv deyil.'); },
    async disconnectTelegram() { await gate('disconnectTelegram'); throw new RetentionError('UNAVAILABLE', 'Telegram bağlantısı hələ aktiv deyil.'); },
    async getCatalogue() { await gate('getCatalogue'); return fixtureCatalogue; },
    async getEntitlements() { await gate('getEntitlements'); return { plan: 'FREE', offer: 'free', legacy: false, features: {} }; },
    async getHome() { await gate('getHome'); return fixtureHome; },
  };
}
