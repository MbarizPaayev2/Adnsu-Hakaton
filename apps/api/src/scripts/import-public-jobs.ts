import { COLLECTOR_KEYS, collectorFor } from '../scrapers/public-jobs/collector-registry';
import type { IngestJobDto } from '../jobs/dto/ingest-job.dto';

/** The header that carries the source lease token on every write (see JobsController): without the lease the API refuses the write. */
const LEASE_HEADER = 'x-source-lease';
const leaseHeaders = (lease?: string): Record<string, string> => (lease ? { [LEASE_HEADER]: lease } : {});

export function validateImportDestination(base: string, token: string | undefined): asserts token is string {
  const u = new URL(base);
  if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Import destination must be a loopback API origin');
  if (!token) throw new Error('SCRAPER_SERVICE_TOKEN is required for --apply');
}

export type IngestOutcome = 'created' | 'updated' | 'reopened' | 'unchanged';
const OUTCOMES: readonly string[] = ['created', 'updated', 'reopened', 'unchanged'];

export async function ingestPublicJob(job: IngestJobDto, base: string, token: string | undefined, lease?: string): Promise<IngestOutcome> {
  validateImportDestination(base, token);
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...leaseHeaders(lease) },
    body: JSON.stringify(job), signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Import API HTTP ${response.status}`); }
  const result = await response.json() as { success?: boolean; jobId?: string; outcome?: string };
  if (result.success !== true || typeof result.jobId !== 'string' || !result.jobId || !OUTCOMES.includes(result.outcome ?? '')) throw new Error('Import API returned an invalid acknowledgement');
  return result.outcome as IngestOutcome;
}

/** Confirms that stored postings were observed in the current listing, touching lastSeenAt without re-fetching detail HTML. */
export async function confirmListedJobs(externalIds: string[], base: string, token: string | undefined, listedAt?: Date, lease?: string): Promise<{ confirmed: number; reopened: number }> {
  validateImportDestination(base, token);
  if (!externalIds.length) return { confirmed: 0, reopened: 0 };
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/confirm-listed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...leaseHeaders(lease) },
    body: JSON.stringify({ externalIds, ...(listedAt ? { listedAt: listedAt.toISOString() } : {}) }),
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Confirm listed API HTTP ${response.status}`); }
  const result = await response.json() as { success?: boolean; confirmed?: number; reopened?: number };
  if (result.success !== true || typeof result.confirmed !== 'number') throw new Error('Confirm listed API returned an invalid acknowledgement');
  return { confirmed: result.confirmed, reopened: result.reopened ?? 0 };
}

export interface CollectorReport { source: string; complete: boolean; pages: number; discovered: number; fetched: number; accepted: number; expired: number; skipped?: number; failed: number; error?: string }


/** Sends the run summary (counts only, no job content) so the API can track source health and, for a verified-complete listing, close removed postings. */
export async function reportImportRun(report: CollectorReport, tally: Record<IngestOutcome, number>, startedAt: Date, base: string, token: string | undefined, lease?: string, segment = false): Promise<{ status: string; closed: number; closureSkipped: string | null }> {
  validateImportDestination(base, token);
  const body = {
    source: report.source, startedAt: startedAt.toISOString(), complete: report.complete, pages: report.pages, discovered: report.discovered, fetched: report.fetched,
    accepted: report.accepted, created: tally.created, updated: tally.updated, unchanged: tally.unchanged, reopened: tally.reopened,
    expired: report.expired, skipped: report.skipped ?? 0, failed: report.failed, ...(report.error ? { error: report.error.slice(0, 300) } : {}),
    ...(segment ? { segment: true } : {}),
  };
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/import-runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...leaseHeaders(lease) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Import run API HTTP ${response.status}`); }
  const result = await response.json() as { success?: boolean; status?: string; closed?: number; closureSkipped?: string | null };
  if (result.success !== true || typeof result.status !== 'string' || typeof result.closed !== 'number') throw new Error('Import run API returned an invalid acknowledgement');
  return { status: result.status, closed: result.closed, closureSkipped: result.closureSkipped ?? null };
}

/** Takes the source lease (the one the scheduler and run-now use). Throws with the server's explanation when another process holds it. Returns the owner token. */
export async function acquireSourceLease(source: string, base: string, token: string | undefined): Promise<string> {
  validateImportDestination(base, token);
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/source-lease`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, action: 'acquire' }), signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (response.status === 409) throw new Error(body.message || `Source ${source} is being collected by another process`);
  if (!response.ok || typeof body.token !== 'string') throw new Error(`Source lease API HTTP ${response.status}`);
  return body.token;
}

/** Proves the importer is alive. False means the lease is lost (expired and taken over): the importer must stop. */
export async function renewSourceLease(source: string, leaseToken: string, base: string, token: string | undefined): Promise<boolean> {
  validateImportDestination(base, token);
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/source-lease`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, action: 'renew', token: leaseToken }), signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  await response.body?.cancel();
  return response.ok;
}

export async function releaseSourceLease(source: string, leaseToken: string, base: string, token: string | undefined): Promise<void> {
  validateImportDestination(base, token);
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/source-lease`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, action: 'release', token: leaseToken }), signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  await response.body?.cancel();
}

/** What is already stored for the source, from the database: the importer's durable record of what it need not fetch again. */
export async function fetchKnownIds(source: string, base: string, token: string | undefined): Promise<Set<string>> {
  validateImportDestination(base, token);
  const response = await fetch(`${base.replace(/\/$/, '')}/internal/jobs/known-ids?source=${encodeURIComponent(source)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Known ids API HTTP ${response.status}`); }
  const body = await response.json() as { ids?: string[] };
  return new Set(body.ids ?? []);
}

export function parseImportArgs(args: string[]) {
  const options = { apply: false, source: 'hellojob', maxPages: 3, maxJobs: 50, delayMs: 1500, startPage: undefined as number | undefined, skipKnown: false, checkDirectAccess: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Repeated option ${arg}`);
    seen.add(arg);
    if (arg === '--apply') { options.apply = true; continue; }
    if (arg === '--skip-known') { options.skipKnown = true; continue; }
    if (arg === '--check-direct-access') { options.checkDirectAccess = true; continue; }
    if (!['--source', '--max-pages', '--max-jobs', '--delay-ms', '--start-page'].includes(arg)) throw new Error(`Unknown option ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--source') options.source = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error(`Invalid value for ${arg}`);
      const key = ({ '--max-pages': 'maxPages', '--max-jobs': 'maxJobs', '--delay-ms': 'delayMs', '--start-page': 'startPage' } as const)[arg as '--max-pages' | '--max-jobs' | '--delay-ms' | '--start-page'];
      options[key] = Number(value);
    }
  }
  if (!COLLECTOR_KEYS.includes(options.source)) throw new Error('Unvalidated source: a reviewed adapter is required.');
  if (options.checkDirectAccess && (options.source !== 'linkedin' || options.apply || options.skipKnown || options.startPage !== undefined || [...seen].some((arg) => !['--source', '--check-direct-access'].includes(arg)))) throw new Error('--check-direct-access is a read-only LinkedIn diagnostic; do not combine it with import options');
  if (options.skipKnown && !options.apply) throw new Error('--skip-known reads the stored postings from the API and needs --apply');
  if (options.maxPages < 1 || options.maxPages > 1000 || options.maxJobs < 1 || options.maxJobs > 10_000 || options.delayMs < 1000 || options.delayMs > 60_000 || (options.startPage !== undefined && options.startPage < 1)) throw new Error('Collection limits out of range');
  return options;
}

export interface ImportDeps {
  collectorFor: typeof collectorFor;
  /** How often the lease is renewed while importing. */
  heartbeatMs: number;
  log: (line: string) => void;
  directAccessProbe: (fetcher?: typeof fetch) => Promise<{ status: number | null; robotsDisallowJobsGuest: boolean; automatedFetchAllowed: false; note: string }>;
}

/** One bounded robots.txt request only. It never requests a job URL or attempts to bypass access controls. */
export async function checkLinkedInDirectAccess(fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher('https://www.linkedin.com/robots.txt', {
      method: 'GET', headers: { Accept: 'text/plain' }, signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: response.status,
        robotsDisallowJobsGuest: false,
        automatedFetchAllowed: false as const,
        note: 'Robots endpoint did not return a readable policy; no job page was requested and automated access remains disabled.',
      };
    }
    const reader = response.body?.getReader();
    let text = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 256 * 1024) {
            controller.abort();
            await reader.cancel().catch(() => undefined);
            throw new Error('robots.txt exceeded 256 KiB limit');
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    const robotsDisallowJobsGuest = /Disallow:\s*\/jobs-guest\//i.test(text);
    return {
      status: response.status,
      robotsDisallowJobsGuest,
      automatedFetchAllowed: false as const,
      note: 'Robots status is diagnostic only; LinkedIn User Agreement access terms still prohibit unapproved automated collection. No job page was requested.',
    };
  } catch (error) {
    return {
      status: null,
      robotsDisallowJobsGuest: false,
      automatedFetchAllowed: false as const,
      note: `Could not read robots.txt (${error instanceof Error ? error.name : 'network error'}); no job page was requested and automated access remains disabled.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The manual import. With --apply it works only while holding the source's lease, the same lease the scheduler and an operator's run-now take: if another
 * process is collecting the source it stops before fetching anything, and if the lease is lost mid-run it stops. There is no lock file, no temp file and no
 * path that writes without the lease. A run that starts after page 1 is reported as a segment and can never close postings.
 */
export async function runImport(argv: string[], env: NodeJS.ProcessEnv = process.env, deps: Partial<ImportDeps> = {}): Promise<{ exitCode: number }> {
  const d: ImportDeps = { collectorFor, heartbeatMs: 60_000, log: (line) => console.log(line), directAccessProbe: checkLinkedInDirectAccess, ...deps };
  const options = parseImportArgs(argv);
  if (options.checkDirectAccess) {
    const result = await d.directAccessProbe();
    d.log(JSON.stringify({ diagnostic: 'linkedin-direct-access', ...result }));
    return { exitCode: 0 };
  }
  const base = env.AISE_INGEST_API_URL || 'http://127.0.0.1:4000';
  const token = env.SCRAPER_SERVICE_TOKEN;
  if (options.apply) validateImportDestination(base, token);

  let lease: string | undefined;
  let lost = false;
  let timer: NodeJS.Timeout | undefined;
  if (options.apply) {
    lease = await acquireSourceLease(options.source, base, token);
    timer = setInterval(() => { void renewSourceLease(options.source, lease!, base, token).then((ok) => { if (!ok) lost = true; }).catch(() => { /* a network blip: the next beat decides */ }); }, d.heartbeatMs);
    timer.unref?.();
  }
  const alive = () => { if (lost) throw new Error(`The lease on ${options.source} was lost; stopping without recording a result`); };
  let exitCode = 0;
  try {
    const startedAt = new Date();
    const tally: Record<IngestOutcome, number> = { created: 0, updated: 0, reopened: 0, unchanged: 0 };
    const collector = d.collectorFor(options.source)!;
    const known = options.skipKnown ? await fetchKnownIds(options.source, base, token) : undefined;
    const listedBuffer: string[] = [];
    const flushListed = async () => {
      if (!options.apply || !listedBuffer.length) return;
      alive();
      const batch = listedBuffer.splice(0, listedBuffer.length);
      const res = await confirmListedJobs(batch, base, token, startedAt, lease);
      tally.unchanged += (res.confirmed - res.reopened);
      tally.reopened += res.reopened;
    };

    const report = await collector.collect(
      {
        ...options,
        ...(known ? { isKnown: (id: string) => known.has(id) } : {}),
        onListed: async (id: string) => {
          if (!options.apply) return;
          listedBuffer.push(id);
          if (listedBuffer.length >= 100) await flushListed();
        },
        onFailedDetail: async (id: string, error: string) => { d.log(JSON.stringify({ failedDetail: true, externalId: id, error: error.slice(0, 200) })); },
      },
      async (job) => {
        if (!options.apply) {
          d.log(JSON.stringify({ preview: true, externalId: job.externalId, title: job.title, company: job.company, location: job.location, url: job.url, deadline: job.deadline }));
          return;
        }
        alive();
        // The detail page was fetched for this posting just now: that is the revalidation time the scheduler uses to decide what to re-check later.
        const outcome = await ingestPublicJob({ ...job, detailFetchedAt: job.detailFetchedAt ?? startedAt.toISOString() }, base, token, lease);
        tally[outcome]++;
        const total = tally.created + tally.updated + tally.unchanged + tally.reopened;
        if (total % 50 === 0) d.log(JSON.stringify({ progress: true, total, created: tally.created, updated: tally.updated, unchanged: tally.unchanged, reopened: tally.reopened }));
      },
    );
    await flushListed();
    alive();
    const segment = options.startPage !== undefined && options.startPage > 1;
    const run = options.apply ? await reportImportRun(report, tally, startedAt, base, token, lease, segment) : undefined;
    d.log(JSON.stringify({ mode: options.apply ? 'import' : 'preview', ...report, ...(run ? { run: { ...tally, ...run } } : {}) }));
    if (report.error && !report.error.startsWith('Collection limit reached')) exitCode = 1;
  } finally {
    if (timer) clearInterval(timer);
    if (lease) await releaseSourceLease(options.source, lease, base, token).catch(() => undefined);
  }
  return { exitCode };
}

if (require.main === module) runImport(process.argv.slice(2)).then(({ exitCode }) => { process.exitCode = exitCode; }).catch((error) => { console.error(`Public job import failed: ${error instanceof Error ? error.message.slice(0, 300) : 'error'}. No secrets or response bodies are logged.`); process.exitCode = 1; });
