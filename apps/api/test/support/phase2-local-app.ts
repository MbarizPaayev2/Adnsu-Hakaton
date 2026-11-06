/** Local-only rehearsal: real Nest/Postgres/Redis/auth/queues, fixture source HTTP,
 * and either fixture scoring responses (default) or the real Python scorer
 * (`scorerUrl`). Never imported by the product AppModule. */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/database.service';
import { AuthModule } from '../../src/auth/auth.module';
import { ProfilesService } from '../../src/profiles/profiles.service';
import { ProfilesModule } from '../../src/profiles/profiles.module';
import { ResumesModule } from '../../src/resumes/resumes.module';
import { MatchingModule } from '../../src/matching/matching.module';
import { JobsModule } from '../../src/jobs/jobs.module';
import { DashboardModule } from '../../src/dashboard/dashboard.module';
import { UploadsModule } from '../../src/uploads/uploads.module';
import { BusinessModule } from '../../src/business/business.module';
import { AdminModule } from '../../src/admin/admin.module';
import { VacanciesModule } from '../../src/vacancies/vacancies.module';
import { JobApplicationsModule } from '../../src/job-applications/job-applications.module';
import { CompaniesModule } from '../../src/companies/companies.module';
import { GlorriScraperService } from '../../src/scrapers/glorri/glorri-scraper.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { PostHogService } from '../../src/common/posthog.service';
import { EmailService } from '../../src/common/email.service';
import { BillingModule } from '../../src/billing/billing.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { SavedModule } from '../../src/saved/saved.module';
import { AlertsModule } from '../../src/alerts/alerts.module';
import { TelegramModule } from '../../src/telegram/telegram.module';
import { TimelineModule } from '../../src/application-timeline/timeline.module';
import { Queue } from 'bullmq';

export type ScorerFault = 'down' | 'malformed' | null;
export interface ScorerExchange { path: string; request: any; response?: any }

export async function startPhase2App(options: { scorerUrl?: string; native?: boolean; retention?: boolean; requireNoForeignActiveJobs?: boolean } = {}) {
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const db = new URL(process.env.DATABASE_URL);
  const namedIsolatedDb = ['aise_phase2_test', 'aise_census'].includes(db.pathname.replace(/^\//, '')) && db.port === '5433';
  // Explicit opt-in for a disposable local container on a non-default port. This keeps the normal
  // rehearsal guard while allowing isolated CI-style databases without touching the shared 5433 DB.
  const disposableContainerDb = process.env.AISE_ALLOW_DISPOSABLE_TEST_DB === '1'
    && db.hostname === '127.0.0.1'
    && db.port !== '5433'
    && ['aise_phase2_test', 'aise_test'].includes(db.pathname.replace(/^\//, ''));
  if (db.hostname !== '127.0.0.1' || !(namedIsolatedDb || disposableContainerDb)) {
    throw new Error('Rehearsal requires a local isolated database (aise_phase2_test or aise_census; disposable containers require AISE_ALLOW_DISPOSABLE_TEST_DB=1)');
  }
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 're_mock_key';
  process.env.POSTHOG_API_KEY = '';
  process.env.FRONTEND_URL = 'http://127.0.0.1:3450';
  process.env.GLORRI_SCRAPER_ENABLED = 'false';
  process.env.GLORRI_DETAIL_DELAY_MS = '0';
  process.env.GLORRI_RETRY_BASE_MS = '0';
  process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
  const scoreRequests: any[] = [];
  const scorerExchanges: ScorerExchange[] = [];
  let scorerFault: ScorerFault = null;
  let scorer: ReturnType<typeof createServer> | undefined;
  if (options.scorerUrl) {
    // Real scorer: no fixture server exists in this mode, so nothing can fall back to fixture scores.
    if (!process.env.MATCHING_SERVICE_TOKEN) throw new Error('Real-scorer rehearsal needs MATCHING_SERVICE_TOKEN');
    process.env.MATCHING_SERVICE_URL = options.scorerUrl;
  } else {
  // Deterministic transport fixture, not a substitute for CPU-model validation.
  scorer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    // Health probes (the admin health card) are GETs with no body: answer them instead of crashing the fixture.
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    scoreRequests.push(body);
    const score = (persona: any) => ({ score: String(persona.summary).includes('PostgreSQL') ? 0.91 : 0.65, matchedKeywords: ['TypeScript'], breakdown: {}, gaps: [] });
    const results = req.url === '/score-profile'
      ? body.jobs.map((job: any) => ({ jobId: job.clientId, source: 'job', ...score(body.persona) }))
      : body.profiles.map((p: any) => ({ profileId: p.profileId, ...score(p.persona) }));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results }));
  });
  await new Promise<void>((resolve) => scorer!.listen(0, '127.0.0.1', resolve));
  process.env.MATCHING_SERVICE_URL = `http://127.0.0.1:${(scorer.address() as AddressInfo).port}`;
  }
  const scorerOrigin = new URL(process.env.MATCHING_SERVICE_URL!).origin;
  const prefix = `aise-phase2-${process.pid}-${Date.now()}`;
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10000 }]),
    BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
    DatabaseModule, AuthModule, ProfilesModule, ResumesModule, MatchingModule, JobsModule, DashboardModule, UploadsModule,
    ...(options.native ? [BusinessModule, AdminModule, VacanciesModule, JobApplicationsModule, CompaniesModule] : []),
    // Product, saved items, alerts, Telegram (disabled) and the application timeline: only when a suite asks for them.
    ...(options.retention ? [BillingModule, NotificationsModule, SavedModule, AlertsModule, TelegramModule, TimelineModule] : []),
  ] }).overrideProvider(PostHogService).useValue({ capture() {} }).compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'], rawBody: true });
  app.enableCors({ origin: 'http://127.0.0.1:3450', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  if (options.requireNoForeignActiveJobs) {
    // These suites assert exact per-plan match counts, and every active job in the shared database competes for a
    // free user's 3 monthly matches. Leftovers of another (aborted or failed) suite used to make them fail as
    // "2 failed, 2 passed" — a data-isolation problem, not timing. Fail early and say so; never delete other rows here.
    const foreign = await prisma.job.count({ where: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null } });
    if (foreign > 0) {
      await app.close();
      throw new Error(`Isolation precondition failed: ${foreign} active job(s) already exist in aise_phase2_test (leftovers of another run). This suite needs an empty active-job set. Inspect them first (select "externalId" from "Job" where status='ACTIVE'), then remove only synthetic fixtures.`);
    }
  }
  const jobs = app.get(JobsService);
  const emails = app.get(EmailService);
  const scrape = new GlorriScraperService(prisma, jobs, { capture() {} } as any, {} as Queue);
  const profileQueue: Queue = (app.get(ProfilesService) as any).profileOnboardedQueue;
  const originalAdd = profileQueue.add.bind(profileQueue);
  let failEnqueue = false;
  profileQueue.add = (async (...args: any[]) => {
    if (failEnqueue) { failEnqueue = false; throw new Error('Synthetic queue failure'); }
    return (originalAdd as any)(...args);
  }) as any;
  const nativeFetch = global.fetch;
  const importRunIds: string[] = [];
  let pages: any[][] = [];
  let details: Record<string, { html?: string; status?: number }> = {};
  global.fetch = async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    if (url.hostname === 'api.glorri.com') {
      const offset = Number(url.searchParams.get('offset') || 0);
      return new Response(JSON.stringify(pages[Math.floor(offset / 18)] || []));
    }
    if (url.hostname === 'jobs.glorri.com') {
      const slug = url.pathname.split('/').pop()!;
      const detail = details[slug];
      return new Response(detail?.html || 'unavailable', { status: detail?.status ?? (detail?.html ? 200 : 404) });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('External traffic disabled in phase2 rehearsal');
    if (url.origin !== scorerOrigin) return nativeFetch(input, init);
    // Transport-level view of the scoring adapter's traffic; faults are injected here, never scores.
    const exchange: ScorerExchange = { path: url.pathname, request: JSON.parse(String(init?.body ?? 'null')) };
    scorerExchanges.push(exchange);
    if (scorerFault === 'down') throw new TypeError('fetch failed (injected scorer outage)');
    if (scorerFault === 'malformed') return new Response(JSON.stringify({ results: [{}] }), { status: 200 });
    const response = await nativeFetch(input, init);
    exchange.response = await response.clone().json().catch(() => undefined);
    return response;
  };
  return {
    app, prisma, jobs, emails, scoreRequests, scorerExchanges, prefix,
    setScorerFault(fault: ScorerFault) { scorerFault = fault; },
    failNextProfileEnqueue() { failEnqueue = true; },
    async importFixtures(nextPages: any[][], nextDetails: typeof details) {
      pages = nextPages; details = nextDetails;
      const result = await scrape.runScrape();
      importRunIds.push(result.runId);
      return result;
    },
    async settle() {
      for (let i = 0; i < 200; i++) {
        const queues = ['job-ingested', 'profile-onboarded', 'resume-tailor', ...(options.retention ? ['new-job-alert'] : [])].map((name) => app.get<Queue>(getQueueToken(name)));
        const counts = await Promise.all(queues.map((q) => q.getJobCounts('active','waiting','delayed','failed')));
        if (counts.some((c) => c.failed)) throw new Error('Matching queue contains a failed rehearsal task');
        if (counts.every((c) => !c.active && !c.waiting && !c.delayed)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Matching queue did not settle within 20 seconds');
    },
    async close() {
      await prisma.jobImportRun.deleteMany({ where: { id: { in: importRunIds } } });
      await app.close();
      global.fetch = nativeFetch;
      if (scorer) await new Promise<void>((resolve) => scorer!.close(() => resolve()));
      // Only this process's unique, isolated rehearsal queues.
      for (const name of ['job-ingested','profile-onboarded','profile-rescore','match-created','resume-tailor','new-job-alert','alert-dispatch']) {
        const queue = new Queue(name, { prefix, connection: { host: '127.0.0.1', port: 6379 } });
        await queue.obliterate(); await queue.close();
      }
    },
  };
}

export const fixtureSummary = (slug: string, title = 'TypeScript Engineer', location = 'Bakı') => ({ slug, title, location, postedDate: '2026-09-01T00:00:00Z', company: { slug: 'aise-fixture', name: 'AISE Test Company' } });
export const fixtureDetail = (title: string, text = 'TypeScript PostgreSQL', location = 'Bakı', deadline?: string) => ({ html: `<h1 class="mb-1 text-3xl font-semibold">${title}</h1><ul class="mb-2 list-disc"><li>AISE Test Company</li><li>${location}</li></ul><div class="description-html">${text}</div>${deadline ? `<div class="mb-4 flex justify-between"><p>Son tarix</p><p>${deadline}</p></div>` : ''}` });
