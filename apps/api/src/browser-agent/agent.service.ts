import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import type { AgentApplication, AgentCampaign, AgentApplicationState, Job } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { ProductService } from '../billing/product.service';
import { isJobActionable } from '../jobs/jobs.service';
import { AGENT_CONFIG, type AgentConfig } from './agent.config';
import { CONSENT_VERSION, normalizeScope, type Scope } from './agent-scope';
import { hashOf, sha256 } from './canonical';
import { planOf, questionKey, resolveFields, type Answers, type FormField, type ResolvedField } from './field-resolver';
import { isConfirmationUrl, postingOf, PORTALS, SUPPORTED_PORTALS, type PortalKey } from './portals';
import { cleanVersion, compareVersions, EXTENSION_DIR, shippedExtension } from './extension-version';

const OPEN = ['QUEUED', 'PREPARING', 'AWAITING_INPUT', 'READY'] as const satisfies readonly AgentApplicationState[];
const LIVE = [...OPEN, 'SUBMITTING', 'SUBMITTED', 'UNCERTAIN'] as const satisfies readonly AgentApplicationState[];
const PERMIT_MS = 3 * 60_000;
const MAX_FIELDS = 150;
const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

/** A paired browser on one request. `version` is what the extension reported on this call (null: older than 0.3.3, or not sent). */
export interface DeviceCtx { id: string; userId: string; version?: string | null }
type Tx = Prisma.TransactionClient;

@Injectable()
export class AgentService {
  constructor(
    private prisma: PrismaService,
    private storage: LocalStorageService,
    private flags: FeatureFlagsService,
    @Inject(AGENT_CONFIG) private cfg: AgentConfig,
    // The plan entitlement. Absent only in unit tests that build the service by hand; the application module always provides it.
    @Optional() private products?: ProductService,
  ) {}

  /**
   * What the browser assistant is worth to this account right now: the plan's `browser.applications` grant and this month's use. Checked when
   * pairing, when consent is created, when work is handed out and when a submission is permitted, so a downgrade or an expiry stops new work at
   * once while everything already submitted stays in the history.
   */
  private async browserAccess(userId: string, now = new Date()): Promise<{ enabled: boolean; limit: number | null; used: number; remaining: number | null }> {
    if (!this.products) return { enabled: true, limit: null, used: 0, remaining: null };
    const g = (await this.products.entitlementsFor(userId, now)).features['browser.applications'];
    if (!g || !g.enabled) return { enabled: false, limit: null, used: 0, remaining: 0 };
    const used = g.used ?? 0;
    return { enabled: true, limit: g.limit ?? null, used, remaining: g.limit == null ? null : Math.max(0, g.limit - used) };
  }
  private async requireBrowserAccess(userId: string) {
    const a = await this.browserAccess(userId);
    if (!a.enabled) throw new ForbiddenException('Brauzer köməkçisi Premium planına daxildir. Planınızı yeniləyin. (PLAN_REQUIRED)');
    return a;
  }

  // ───────────────────────────────────────────────────────────────── plumbing
  private requireEnabled() {
    if (!this.cfg.enabled) throw new ServiceUnavailableException('Brauzer agenti bu mühitdə aktiv deyil. (AGENT_DISABLED)');
  }
  /**
   * Whether an extension version may still act, and whether a newer one is available. `required`: below the operator's floor
   * (BROWSER_AGENT_MIN_EXTENSION_VERSION), so protected actions are refused until the candidate updates; `available`: the API hands out a newer ZIP.
   * An unreported version (before 0.3.3) is below any floor and always has an update available.
   */
  private extensionUpdate(version: string | null | undefined): 'required' | 'available' | null {
    const v = cleanVersion(version);
    if (this.cfg.minExtensionVersion && (!v || compareVersions(v, this.cfg.minExtensionVersion) < 0)) return 'required';
    const latest = shippedExtension()?.version;
    if (latest && (!v || compareVersions(v, latest) < 0)) return 'available';
    return null;
  }
  private requireCurrentExtension(device: DeviceCtx) {
    if (this.extensionUpdate(device.version) === 'required') throw new ForbiddenException('Genişlənmənin bu versiyası artıq dəstəklənmir. AISE-dən yeni versiyanı yükləyib quraşdırın. (EXTENSION_OUTDATED)');
  }

  private autonomousAllowed(portal: string) {
    return this.cfg.autonomousEnabled && (this.cfg.autonomousPortals as string[]).includes(portal);
  }
  private async log(db: Tx | PrismaService, app: { id: string; userId: string }, actor: 'system' | 'candidate' | 'extension' | 'portal', kind: string, detail?: Prisma.InputJsonValue) {
    await db.agentApplicationEvent.create({ data: { applicationId: app.id, userId: app.userId, actor, kind, detail: detail ?? undefined } });
  }
  /** Moves an application from one of `from` states to `to`; false when somebody else moved it first. */
  private async move(db: Tx | PrismaService, app: { id: string; userId: string }, from: readonly AgentApplicationState[], to: AgentApplicationState, data: Prisma.AgentApplicationUpdateManyMutationInput & { stateReason?: string | null }, actor: 'system' | 'candidate' | 'extension' | 'portal', kind: string, detail?: Prisma.InputJsonValue) {
    const r = await db.agentApplication.updateMany({ where: { id: app.id, state: { in: [...from] } }, data: { ...data, state: to } });
    if (r.count === 1) await this.log(db, app, actor, kind, { to, ...(data.stateReason ? { reason: data.stateReason } : {}), ...(detail as object | undefined) } as Prisma.InputJsonValue);
    return r.count === 1;
  }

  async capabilities(userId: string) {
    const [devices, paused, access] = await Promise.all([this.prisma.agentDevice.count({ where: { userId, revokedAt: null } }), this.flags.isPaused('agent.submissions'), this.browserAccess(userId)]);
    return {
      enabled: this.cfg.enabled,
      // Plan entitlement: whether this account may use the assistant, and this month's use against the plan's cap.
      entitlement: { included: access.enabled, plan: 'PREMIUM', monthlyLimit: access.limit, usedThisMonth: access.used, remainingThisMonth: access.remaining },
      assisted: this.cfg.enabled,
      autonomous: this.cfg.enabled && this.cfg.autonomousEnabled && this.cfg.autonomousPortals.length > 0,
      pausedByOperator: paused,
      pairedDevices: devices,
      limits: { userDailyLimit: this.cfg.userDailyLimit, maxCampaignDays: this.cfg.maxCampaignDays },
      // The ZIP this API hands out and the oldest version still allowed to act; the page compares each paired browser against them.
      extension: { latestVersion: shippedExtension()?.version ?? null, minVersion: this.cfg.minExtensionVersion },
      portals: SUPPORTED_PORTALS.map((k) => ({ key: k, name: PORTALS[k].name, verification: PORTALS[k].verification, limitations: PORTALS[k].limitations, autonomousAvailable: this.autonomousAllowed(k) })),
    };
  }

  /** On-demand identity prefill in a tab the candidate explicitly chooses. Never submits a form. */
  async assistedProfile(device: DeviceCtx) {
    this.requireEnabled();
    await this.requireBrowserAccess(device.userId);
    this.requireCurrentExtension(device);
    if (await this.flags.isPaused('agent.submissions')) throw new ForbiddenException('Brauzer köməkçisi müvəqqəti dayandırılıb.');
    const user = await this.prisma.user.findUnique({ where: { id: device.userId }, select: { name: true, email: true, emailVerified: true, suspendedAt: true, profile: { select: { phone: true } } } });
    if (!user?.emailVerified || user.suspendedAt) throw new ForbiddenException('Təsdiqlənmiş, aktiv hesab lazımdır.');
    return { name: user.name ?? '', email: user.email, phone: user.profile?.phone ?? '' };
  }

  /**
   * The letter the candidate approved in AISE for the Glorri vacancy open in their tab, for the letter step of Glorri's form ("Motivasiya məktubu").
   * Only an APPROVED snapshot of their own letter for a vacancy AISE knows; never a draft and never generated here. 404 when there is none.
   */
  async assistedLetter(device: DeviceCtx, urlRaw: unknown) {
    await this.assistedProfile(device);
    const path = glorriVacancyPath(urlRaw);
    if (!path) throw new NotFoundException('Bu səhifə üçün məktub yoxdur. (NO_APPROVED_LETTER)');
    const jobs = await this.prisma.job.findMany({
      where: { OR: GLORRI_HOSTS.map((h) => ({ url: { startsWith: `https://${h}${path}` } })) },
      select: { id: true, url: true },
      take: 5,
    });
    for (const job of jobs.filter((j) => glorriVacancyPath(j.url) === path)) {
      const letter = await this.approvedLetter(device.userId, job.id);
      if (letter) return { text: letter.text, documentId: letter.documentId };
    }
    throw new NotFoundException('Bu vakansiya üçün AISE-də təsdiqlənmiş məktub yoxdur. (NO_APPROVED_LETTER)');
  }

  async extensionArchive(userId: string): Promise<Buffer> {
    this.requireEnabled();
    await this.requireBrowserAccess(userId);
    return readFile(join(EXTENSION_DIR, 'aise-agent-extension.zip'));
  }

  // ───────────────────────────────────────────────────────────────── devices
  async createPairingCode(userId: string) {
    this.requireEnabled();
    await this.requireBrowserAccess(userId);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    await this.prisma.$transaction([
      this.prisma.agentPairingCode.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.agentPairingCode.create({ data: { userId, codeHash: sha256(code), expiresAt: new Date(Date.now() + 10 * 60_000) } }),
    ]);
    return { code, expiresInSeconds: 600 };
  }

  async pair(codeRaw: unknown, nameRaw: unknown, versionRaw?: unknown) {
    this.requireEnabled();
    const code = typeof codeRaw === 'string' ? codeRaw.replace(/[\s-]/g, '').toUpperCase() : '';
    if (!/^[A-Z0-9]{8}$/.test(code)) throw new BadRequestException('Kod yanlışdır. (PAIRING_CODE_INVALID)');
    const name = clip(nameRaw, 60).trim() || 'Brauzer';
    const version = cleanVersion(versionRaw);
    const row = await this.prisma.agentPairingCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new BadRequestException('Kodun vaxtı bitib və ya istifadə olunub. Yeni kod yaradın. (PAIRING_CODE_EXPIRED)');
    // Checked before the code is used up, so the candidate can update or upgrade and still use the same code: the plan may have ended since the code
    // was made, and a browser too old to act is not paired at all.
    if (!(await this.browserAccess(row.userId)).enabled) throw new ForbiddenException('Brauzer köməkçisi Premium planına daxildir. Planınızı yeniləyin. (PLAN_REQUIRED)');
    if (this.extensionUpdate(version) === 'required') throw new BadRequestException('Genişlənmənin bu versiyası artıq dəstəklənmir. AISE-dən yeni versiyanı yükləyib quraşdırın. (EXTENSION_OUTDATED)');
    const claimed = await this.prisma.agentPairingCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException('Kodun vaxtı bitib və ya istifadə olunub. Yeni kod yaradın. (PAIRING_CODE_EXPIRED)');
    const token = `aat_${randomBytes(32).toString('base64url')}`;
    const device = await this.prisma.agentDevice.create({ data: { userId: row.userId, name, tokenHash: sha256(token), extensionVersion: version, lastSeenAt: new Date() } });
    return { token, deviceId: device.id };
  }

  async authenticate(tokenRaw: string | undefined, versionRaw?: unknown): Promise<DeviceCtx> {
    const token = (tokenRaw ?? '').trim();
    if (!/^aat_[A-Za-z0-9_-]{40,60}$/.test(token)) throw new UnauthorizedException('Cihaz tanınmır. (DEVICE_UNKNOWN)');
    const d = await this.prisma.agentDevice.findUnique({ where: { tokenHash: sha256(token) } });
    if (!d || d.revokedAt) throw new UnauthorizedException('Cihaz tanınmır. (DEVICE_UNKNOWN)');
    const version = cleanVersion(versionRaw);
    // A reported version is stored as soon as it changes (an update shows on the page at once); an extension that reports none keeps what it had.
    const newVersion = version && version !== d.extensionVersion;
    if (newVersion || !d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 30_000) await this.prisma.agentDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), ...(newVersion ? { extensionVersion: version } : {}) } }).catch(() => undefined);
    return { id: d.id, userId: d.userId, version };
  }

  async listDevices(userId: string) {
    const rows = await this.prisma.agentDevice.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, createdAt: true, lastSeenAt: true, extensionVersion: true } });
    return rows.map((d) => ({ ...d, update: this.extensionUpdate(d.extensionVersion) }));
  }

  async revokeDevice(userId: string, id: string) {
    const r = await this.prisma.agentDevice.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new NotFoundException('Cihaz tapılmadı');
    return { revoked: true };
  }

  // ───────────────────────────────────────────────────────────────── campaigns (the candidate's own authority)
  private async checkedScope(userId: string, raw: unknown) {
    const parsed = normalizeScope(raw, new Date(), this.cfg);
    if (!parsed.ok) throw new BadRequestException(`Kampaniya məlumatları yanlışdır. (INVALID_SCOPE:${parsed.errors.join(',')})`);
    const scope = parsed.scope;
    if (scope.mode === 'AUTONOMOUS') {
      if (!this.cfg.autonomousEnabled) throw new ForbiddenException('Avtonom rejim hələ aktiv deyil. (AUTONOMOUS_DISABLED)');
      const bad = scope.portals.filter((p) => !this.autonomousAllowed(p));
      if (bad.length) throw new ForbiddenException(`Avtonom rejim bu portal üçün hələ təsdiqlənməyib: ${bad.join(',')}. (AUTONOMOUS_PORTAL_UNVERIFIED)`);
    }
    const resume = await this.prisma.resume.findFirst({ where: { id: scope.resumeId, userId }, select: { id: true, isBase: true, docKind: true, status: true, fileUrl: true } });
    if (!resume || !resume.isBase || resume.docKind === 'LETTER' || resume.status !== 'READY' || !resume.fileUrl) throw new BadRequestException('Seçilmiş CV hazır deyil və ya sizə aid deyil. (RESUME_NOT_USABLE)');
    let bytes: Buffer;
    try { bytes = await this.storage.readUpload(resume.fileUrl); } catch { throw new BadRequestException('CV faylı tapılmadı. (RESUME_FILE_MISSING)'); }
    const hashed = { ...scope, resumeSha256: sha256(bytes), coverNoteSha256: scope.coverNote ? sha256(scope.coverNote) : null, consentVersion: CONSENT_VERSION };
    return { scope, resumeSha256: hashed.resumeSha256, consentHash: hashOf(hashed), resumeBytes: bytes.length };
  }

  async previewCampaign(userId: string, raw: unknown) {
    this.requireEnabled();
    await this.requireBrowserAccess(userId);
    const { scope, consentHash, resumeSha256, resumeBytes } = await this.checkedScope(userId, raw);
    return { scope, consentHash, consentVersion: CONSENT_VERSION, resume: { id: scope.resumeId, sha256: resumeSha256, bytes: resumeBytes }, portals: scope.portals.map((p) => ({ key: p, name: PORTALS[p].name, limitations: PORTALS[p].limitations })) };
  }

  async createCampaign(userId: string, raw: unknown, consent: { consentHash?: unknown; acknowledged?: unknown }) {
    this.requireEnabled();
    await this.requireBrowserAccess(userId);
    const { scope, consentHash, resumeSha256 } = await this.checkedScope(userId, raw);
    if (consent?.acknowledged !== true) throw new BadRequestException('Razılıq təsdiqlənməlidir. (CONSENT_REQUIRED)');
    if (consent?.consentHash !== consentHash) throw new ConflictException('Kampaniya göstərilən məzmundan fərqlənir; yenidən nəzərdən keçirin. (CONSENT_SCOPE_CHANGED)');
    const active = await this.prisma.agentCampaign.count({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    if (active >= 5) throw new ConflictException('Eyni vaxtda ən çox 5 kampaniya ola bilər. (TOO_MANY_CAMPAIGNS)');
    const c = await this.prisma.agentCampaign.create({
      data: {
        userId, name: scope.name, mode: scope.mode, portals: scope.portals, employerAllow: scope.employerAllow, employerDeny: scope.employerDeny, targetRoles: scope.targetRoles, locations: scope.locations,
        criteria: scope.criteria as unknown as Prisma.InputJsonValue, resumeId: scope.resumeId, resumeSha256, coverNote: scope.coverNote, answers: scope.answers as unknown as Prisma.InputJsonValue, alwaysAsk: scope.alwaysAsk,
        useApprovedLetters: scope.useApprovedLetters, dailyLimit: scope.dailyLimit, expiresAt: new Date(scope.expiresAt), consentVersion: CONSENT_VERSION, consentHash, consentedAt: new Date(),
      },
    });
    return this.campaignView(c);
  }

  private async todaysPermits(where: Prisma.AgentApplicationWhereInput, now = new Date()) {
    return this.prisma.agentApplication.count({ where: { ...where, permitIssuedAt: { gte: startOfDay(now) }, state: { in: ['SUBMITTING', 'SUBMITTED', 'UNCERTAIN'] } } });
  }

  private async campaignView(c: AgentCampaign) {
    const [counts, today] = await Promise.all([
      this.prisma.agentApplication.groupBy({ by: ['state'], where: { campaignId: c.id }, _count: true }),
      this.todaysPermits({ campaignId: c.id }),
    ]);
    return {
      id: c.id, name: c.name, mode: c.mode, status: c.status, portals: c.portals, employerAllow: c.employerAllow, employerDeny: c.employerDeny, targetRoles: c.targetRoles, locations: c.locations,
      criteria: c.criteria, alwaysAsk: c.alwaysAsk, dailyLimit: c.dailyLimit, submissionsToday: today, expiresAt: c.expiresAt, consentedAt: c.consentedAt, consentVersion: c.consentVersion, consentHash: c.consentHash,
      pausedAt: c.pausedAt, revokedAt: c.revokedAt, stoppedAt: c.stoppedAt, resumeId: c.resumeId, hasCoverNote: !!c.coverNote, useApprovedLetters: c.useApprovedLetters,
      counts: Object.fromEntries(counts.map((x) => [x.state, x._count])),
    };
  }

  async listCampaigns(userId: string) {
    await this.expireDue();
    const rows = await this.prisma.agentCampaign.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Promise.all(rows.map((c) => this.campaignView(c)));
  }

  async getCampaign(userId: string, id: string) {
    await this.expireDue();
    const c = await this.prisma.agentCampaign.findFirst({ where: { id, userId } });
    if (!c) throw new NotFoundException('Kampaniya tapılmadı');
    return { ...(await this.campaignView(c)), answers: c.answers, coverNote: c.coverNote };
  }

  /** Revoking or stopping cancels everything that has not been submitted yet, including queued and prepared work. */
  private async cancelOpenWork(db: Tx | PrismaService, campaign: { id: string; userId: string }, reason: string) {
    const open = await db.agentApplication.findMany({ where: { campaignId: campaign.id, state: { in: [...OPEN] } }, select: { id: true, userId: true } });
    for (const a of open) await this.move(db, a, OPEN, 'CANCELLED', { cancelledAt: new Date(), stateReason: reason, leaseOwner: null, leaseUntil: null, permitId: null }, 'system', 'cancelled', { reason });
    return open.length;
  }

  async campaignAction(userId: string, id: string, action: 'pause' | 'resume' | 'revoke' | 'stop') {
    const c = await this.prisma.agentCampaign.findFirst({ where: { id, userId } });
    if (!c) throw new NotFoundException('Kampaniya tapılmadı');
    const now = new Date();
    if (action === 'pause') {
      if (c.status !== 'ACTIVE') throw new ConflictException('Yalnız aktiv kampaniya dayandırıla bilər. (NOT_ACTIVE)');
      await this.prisma.agentCampaign.update({ where: { id }, data: { status: 'PAUSED', pausedAt: now } });
    } else if (action === 'resume') {
      if (c.status !== 'PAUSED') throw new ConflictException('Yalnız dayandırılmış kampaniya davam etdirilə bilər. (NOT_PAUSED)');
      if (c.expiresAt.getTime() <= now.getTime()) throw new ConflictException('Kampaniyanın müddəti bitib. (CAMPAIGN_EXPIRED)');
      await this.prisma.agentCampaign.update({ where: { id }, data: { status: 'ACTIVE', pausedAt: null } });
    } else {
      if (['REVOKED', 'STOPPED', 'EXPIRED'].includes(c.status) && action === 'revoke') return this.getCampaign(userId, id);
      await this.prisma.$transaction(async (tx) => {
        await tx.agentCampaign.update({ where: { id }, data: action === 'revoke' ? { status: 'REVOKED', revokedAt: now } : { status: 'STOPPED', stoppedAt: now } });
        await this.cancelOpenWork(tx, c, action === 'revoke' ? 'CONSENT_REVOKED' : 'EMERGENCY_STOP');
      });
    }
    return this.getCampaign(userId, id);
  }

  /** Emergency stop of everything this candidate has authorised. */
  async stopAll(userId: string) {
    const campaigns = await this.prisma.agentCampaign.findMany({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    for (const c of campaigns) await this.campaignAction(userId, c.id, 'stop');
    return { stopped: campaigns.length };
  }

  private async expireDue(now = new Date()) {
    const due = await this.prisma.agentCampaign.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, expiresAt: { lte: now } }, select: { id: true, userId: true } });
    for (const c of due) {
      await this.prisma.$transaction(async (tx) => {
        await tx.agentCampaign.update({ where: { id: c.id }, data: { status: 'EXPIRED' } });
        await this.cancelOpenWork(tx, c, 'CAMPAIGN_EXPIRED');
      });
    }
  }

  // ───────────────────────────────────────────────────────────────── discovery
  private async duplicateElsewhere(userId: string, job: Pick<Job, 'id' | 'duplicateOfId'>): Promise<string | null> {
    const primary = job.duplicateOfId ?? job.id;
    const linked = await this.prisma.job.findMany({ where: { OR: [{ id: primary }, { duplicateOfId: primary }] }, select: { id: true } });
    const ids = [...new Set([job.id, primary, ...linked.map((j) => j.id)])];
    const email = await this.prisma.emailApplication.findFirst({ where: { userId, jobId: { in: ids }, deliveryState: { in: ['QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN'] } }, select: { id: true } });
    if (email) return 'EMAIL_APPLICATION';
    const external = await this.prisma.externalApplication.findFirst({ where: { userId, match: { jobId: { in: ids } }, status: { in: ['SUBMITTING', 'SUBMITTED', 'DELIVERY_UNCONFIRMED'] } }, select: { id: true } });
    if (external) return 'EXTERNAL_APPLICATION';
    const other = await this.prisma.agentApplication.findFirst({ where: { userId, jobId: { in: ids.filter((i) => i !== job.id) }, state: { in: [...LIVE] } }, select: { id: true } });
    if (other) return 'AGENT_APPLICATION';
    return null;
  }

  /** Finds vacancies inside the campaign's own scope and queues them, never more than the day's remaining allowance. A match score is only ONE of the conditions. */
  async discover(userId: string, campaignId?: string, now = new Date()) {
    if (!this.cfg.enabled) return { queued: 0 };
    await this.expireDue(now);
    const campaigns = await this.prisma.agentCampaign.findMany({ where: { userId, status: 'ACTIVE', expiresAt: { gt: now }, ...(campaignId ? { id: campaignId } : {}) } });
    let queued = 0;
    for (const c of campaigns) {
      const [open, today] = await Promise.all([this.prisma.agentApplication.count({ where: { campaignId: c.id, state: { in: [...OPEN] } } }), this.todaysPermits({ campaignId: c.id }, now)]);
      let capacity = c.dailyLimit - open - today;
      if (capacity <= 0) continue;
      const crit = c.criteria as unknown as Scope['criteria'];
      const jobs = await this.prisma.job.findMany({
        where: {
          status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, url: { startsWith: 'https://jobs.lever.co/' }, OR: [{ deadline: null }, { deadline: { gt: now } }],
          matches: { some: { userId, score: { gte: crit.minScore } } },
          agentApplications: { none: { userId } },
        },
        include: { matches: { where: { userId }, select: { score: true, details: true } } },
        orderBy: { postedAt: 'desc' },
        take: 400,
      });
      const candidates = jobs
        .map((job) => ({ job, ref: postingOf(job.url), match: job.matches[0] }))
        .filter((x) => x.ref && (c.portals as string[]).includes(x.ref.portal) && c.employerAllow.includes(x.ref.employer) && !c.employerDeny.includes(x.ref.employer) && isJobActionable(x.job, now))
        .filter(({ job }) => {
          const title = job.title.toLowerCase(), text = `${title} ${job.description}`.toLowerCase();
          if (!c.targetRoles.some((r) => title.includes(r.toLowerCase()))) return false;
          if (c.locations.length && !c.locations.some((l) => job.location.toLowerCase().includes(l.toLowerCase()))) return false;
          if (crit.workArrangement && job.workArrangement !== crit.workArrangement) return false;
          if (crit.experienceLevel && job.experienceLevel !== crit.experienceLevel) return false;
          if (crit.mustInclude?.some((k) => !text.includes(k.toLowerCase()))) return false;
          if (crit.mustExclude?.some((k) => text.includes(k.toLowerCase()))) return false;
          return true;
        })
        .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
      for (const { job, ref, match } of candidates) {
        if (capacity <= 0) break;
        if (await this.duplicateElsewhere(userId, job)) continue;
        try {
          const app = await this.prisma.agentApplication.create({
            data: { userId, campaignId: c.id, jobId: job.id, portal: ref!.portal, applyUrl: ref!.applyUrl, mode: c.mode, matchScore: match?.score ?? null, matchedKeywords: ((match?.details as { matchedKeywords?: unknown } | null)?.matchedKeywords ?? undefined) as Prisma.InputJsonValue | undefined, idempotencyKey: hashOf({ userId, jobId: job.id }) },
          });
          await this.log(this.prisma, app, 'system', 'queued', { campaignId: c.id, score: match?.score ?? null });
          capacity--; queued++;
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002') throw e; // already queued by a concurrent discovery: fine
        }
      }
    }
    return { queued };
  }

  // ───────────────────────────────────────────────────────────────── candidate-facing application operations
  private async view(a: AgentApplication & { job: Pick<Job, 'title' | 'company' | 'url'>; campaign: Pick<AgentCampaign, 'name' | 'resumeId' | 'resumeSha256' | 'coverNote' | 'useApprovedLetters' | 'status'> }, events = true) {
    const plan = (a.plan ?? null) as { fill?: unknown[]; resolved?: ResolvedField[] } | null;
    const evs = events ? await this.prisma.agentApplicationEvent.findMany({ where: { applicationId: a.id }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, actor: true, kind: true, detail: true, createdAt: true } }) : [];
    const letter = events && a.campaign.useApprovedLetters ? await this.approvedLetter(a.userId, a.jobId) : null;
    const needsApproval = a.mode === 'ASSISTED';
    const next: string[] = [];
    if (a.state === 'AWAITING_INPUT') next.push('answer_questions');
    if (a.state === 'READY' && needsApproval && a.approvedPlanHash !== a.planHash) next.push('review_and_approve');
    if (a.state === 'UNCERTAIN') next.push('reconcile');
    return {
      id: a.id, jobId: a.jobId, title: a.job.title, company: a.job.company, jobUrl: a.job.url, portal: a.portal, applyUrl: a.applyUrl, mode: a.mode, state: a.state, stateReason: a.stateReason,
      matchScore: a.matchScore, matchedKeywords: a.matchedKeywords, campaign: { id: a.campaignId, name: a.campaign.name, status: a.campaign.status },
      plan: plan?.fill ?? null, planHash: a.planHash, questions: a.questions ?? [], approval: { required: needsApproval, approved: !!a.planHash && a.approvedPlanHash === a.planHash, approvedAt: a.approvedAt },
      documents: {
        resume: { id: a.campaign.resumeId, sha256: a.campaign.resumeSha256 }, coverNote: a.campaign.coverNote ? { sha256: sha256(a.campaign.coverNote) } : null,
        // Which letter would be sent: the one the candidate approved for this vacancy (only looked up for the detail view).
        letter: a.campaign.useApprovedLetters ? { enabled: true, approved: !!letter, ...(letter ? { documentId: letter.documentId, sha256: letter.sha256 } : {}) } : null,
      },
      confirmation: a.confirmation, evidence: a.evidence, submittedAt: a.submittedAt, uncertainAt: a.uncertainAt, cancelledAt: a.cancelledAt, createdAt: a.createdAt, updatedAt: a.updatedAt, nextActions: next, events: evs,
    };
  }

  async listApplications(userId: string) {
    const rows = await this.prisma.agentApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { job: { select: { title: true, company: true, url: true } }, campaign: { select: { name: true, resumeId: true, resumeSha256: true, coverNote: true, useApprovedLetters: true, status: true } } } });
    return Promise.all(rows.map((r) => this.view(r, false)));
  }

  private async own(userId: string, id: string) {
    const a = await this.prisma.agentApplication.findFirst({ where: { id, userId }, include: { job: { select: { title: true, company: true, url: true } }, campaign: { select: { name: true, resumeId: true, resumeSha256: true, coverNote: true, useApprovedLetters: true, status: true, answers: true, alwaysAsk: true } } } });
    if (!a) throw new NotFoundException('Müraciət tapılmadı');
    return a;
  }

  async getApplication(userId: string, id: string) { return this.view(await this.own(userId, id)); }

  /** The candidate answers the questions the form put to them; answers stay with this application and may be remembered for the same employer question (never sensitive or legal). */
  async answer(userId: string, id: string, body: { answers?: unknown; remember?: unknown }) {
    const a = await this.own(userId, id);
    if (a.state !== 'AWAITING_INPUT') throw new ConflictException('Bu müraciət cavab gözləmir. (NOT_AWAITING_INPUT)');
    const pending = ((a.questions ?? []) as unknown as ResolvedField[]).filter((q) => q.action === 'ask');
    const given: Record<string, string | boolean | string[]> = {};
    for (const x of Array.isArray(body?.answers) ? (body.answers as { key?: unknown; value?: unknown }[]) : []) {
      const q = pending.find((p) => p.key === x?.key);
      if (!q) throw new BadRequestException('Naməlum sual. (UNKNOWN_QUESTION)');
      const v = x.value;
      if (typeof v === 'string') given[q.key] = v.trim().slice(0, 3000);
      else if (typeof v === 'boolean') given[q.key] = v;
      else if (Array.isArray(v) && v.every((s) => typeof s === 'string')) given[q.key] = (v as string[]).slice(0, 20).map((s) => s.slice(0, 200));
      else throw new BadRequestException('Cavab yanlışdır. (INVALID_ANSWER)');
      if (q.options?.length && typeof given[q.key] === 'string' && !q.options.some((o) => o.value === given[q.key])) throw new BadRequestException('Cavab seçimlər arasında deyil. (ANSWER_NOT_AN_OPTION)');
      if (q.required && given[q.key] === '') throw new BadRequestException('Tələb olunan cavab boş ola bilməz. (ANSWER_REQUIRED)');
    }
    if (!Object.keys(given).length) throw new BadRequestException('Cavab göndərilməyib. (NO_ANSWERS)');
    const ref = postingOf(a.applyUrl)!;
    await this.prisma.$transaction(async (tx) => {
      const stored = (a.questions ?? []) as unknown as (ResolvedField & { answer?: unknown })[];
      const merged = stored.map((q) => (given[q.key] !== undefined ? { ...q, answer: given[q.key] } : q));
      await tx.agentApplication.update({ where: { id }, data: { questions: merged as unknown as Prisma.InputJsonValue } });
      if (body?.remember === true) {
        for (const q of pending) {
          if (given[q.key] === undefined || q.category !== 'unknown' || typeof given[q.key] === 'object') continue; // only plain employer questions are remembered
          await tx.agentKnownAnswer.upsert({ where: { userId_portal_employer_questionKey: { userId, portal: a.portal, employer: ref.employer, questionKey: questionKey(q as FormField) } }, create: { userId, portal: a.portal, employer: ref.employer, questionKey: questionKey(q as FormField), value: given[q.key] as Prisma.InputJsonValue }, update: { value: given[q.key] as Prisma.InputJsonValue } });
        }
      }
      await this.log(tx, a, 'candidate', 'answers_given', { keys: Object.keys(given), remembered: body?.remember === true });
    });
    return this.reresolve(userId, id);
  }

  /** Recomputes the plan from the stored form description after new answers, without touching the portal. */
  private async reresolve(userId: string, id: string) {
    const a = await this.own(userId, id);
    const stored = (a.plan ?? null) as { described?: FormField[]; declaration?: { hash: string | null } } | null;
    if (!stored?.described) return this.view(a);
    const out = await this.buildPlan(a, stored.described, stored.declaration?.hash ?? null);
    if ('failed' in out) { await this.move(this.prisma, a, ['AWAITING_INPUT'], 'FAILED', { stateReason: out.failed }, 'system', 'failed', { reason: out.failed }); return this.getApplication(userId, id); }
    const to: AgentApplicationState = out.ready ? 'READY' : 'AWAITING_INPUT';
    await this.move(this.prisma, a, ['AWAITING_INPUT', 'READY'], to, { plan: out.plan as unknown as Prisma.InputJsonValue, planHash: out.planHash, questions: out.questions as unknown as Prisma.InputJsonValue, stateReason: out.ready ? null : 'QUESTIONS', approvedPlanHash: a.planHash === out.planHash ? a.approvedPlanHash : null, leaseOwner: null, leaseUntil: null }, 'system', out.ready ? 'plan_ready' : 'awaiting_input', { planHash: out.planHash });
    return this.getApplication(userId, id);
  }

  async approve(userId: string, id: string, body: { planHash?: unknown }) {
    const a = await this.own(userId, id);
    if (a.mode !== 'ASSISTED') throw new ConflictException('Avtonom kampaniya üçün ayrıca təsdiq tələb olunmur. (NOT_ASSISTED)');
    if (a.campaign.status !== 'ACTIVE') throw new ConflictException('Kampaniya aktiv deyil. (CAMPAIGN_NOT_ACTIVE)');
    if (a.state !== 'READY' || !a.planHash) throw new ConflictException('Müraciət təsdiq üçün hazır deyil. (NOT_READY)');
    if (body?.planHash !== a.planHash) throw new ConflictException('Plan dəyişib; yenidən nəzərdən keçirin. (PLAN_CHANGED)');
    await this.prisma.$transaction(async (tx) => {
      await tx.agentApplication.update({ where: { id }, data: { approvedPlanHash: a.planHash, approvedAt: new Date() } });
      await this.log(tx, a, 'candidate', 'approved', { planHash: a.planHash });
    });
    return this.getApplication(userId, id);
  }

  async cancel(userId: string, id: string) {
    const a = await this.own(userId, id);
    if (a.state === 'SUBMITTING') throw new ConflictException('Göndərmə davam edir və geri çağırıla bilməz. (SUBMIT_IN_PROGRESS)');
    if (!(['QUEUED', 'PREPARING', 'AWAITING_INPUT', 'READY', 'UNCERTAIN'] as AgentApplicationState[]).includes(a.state)) throw new ConflictException('Bu müraciət ləğv oluna bilməz. (NOT_CANCELLABLE)');
    await this.move(this.prisma, a, [...OPEN, 'UNCERTAIN'], 'CANCELLED', { cancelledAt: new Date(), stateReason: 'CANCELLED_BY_CANDIDATE', leaseOwner: null, leaseUntil: null, permitId: null }, 'candidate', 'cancelled');
    return this.getApplication(userId, id);
  }

  /** The candidate reconciles an unclear outcome (or reports having submitted it themselves): kept apart from portal-confirmed evidence. */
  async reconcile(userId: string, id: string, body: { outcome?: unknown }) {
    const a = await this.own(userId, id);
    if (!(['UNCERTAIN', 'AWAITING_INPUT', 'READY'] as AgentApplicationState[]).includes(a.state)) throw new ConflictException('Bu müraciət üçün nəticə qeyd etmək olmaz. (NOT_RECONCILABLE)');
    if (body?.outcome === 'submitted') {
      await this.move(this.prisma, a, ['UNCERTAIN', 'AWAITING_INPUT', 'READY'], 'SUBMITTED', { confirmation: 'CANDIDATE', submittedAt: new Date(), stateReason: 'REPORTED_BY_CANDIDATE', leaseOwner: null, leaseUntil: null, permitId: null }, 'candidate', 'reported_submitted');
    } else if (body?.outcome === 'not_submitted' && a.state === 'UNCERTAIN') {
      await this.move(this.prisma, a, ['UNCERTAIN'], 'QUEUED', { stateReason: 'RETRY_AFTER_RECONCILIATION', uncertainAt: null, permitId: null, leaseOwner: null, leaseUntil: null, plan: Prisma.DbNull, planHash: null, approvedPlanHash: null, approvedAt: null }, 'candidate', 'reported_not_submitted');
    } else throw new BadRequestException('Nəticə yanlışdır. (INVALID_OUTCOME)');
    return this.getApplication(userId, id);
  }

  // ───────────────────────────────────────────────────────────────── the browser extension's protocol
  private async guardApplication(device: DeviceCtx, id: string) {
    const a = await this.prisma.agentApplication.findFirst({ where: { id, userId: device.userId }, include: { campaign: true, job: true } });
    if (!a) throw new NotFoundException('Müraciət tapılmadı');
    return a;
  }
  private leaseHeld(a: Pick<AgentApplication, 'leaseOwner' | 'leaseUntil'>, device: DeviceCtx, now = new Date()) {
    return a.leaseOwner === device.id && !!a.leaseUntil && a.leaseUntil.getTime() > now.getTime();
  }

  private async sweepStale(now = new Date()) {
    const stale = await this.prisma.agentApplication.findMany({ where: { leaseUntil: { lt: now }, state: { in: ['PREPARING', 'SUBMITTING', 'READY'] } }, select: { id: true, userId: true, state: true, attempt: true } });
    for (const s of stale) {
      if (s.state === 'SUBMITTING') await this.move(this.prisma, s, ['SUBMITTING'], 'UNCERTAIN', { uncertainAt: now, stateReason: 'LEASE_EXPIRED_DURING_SUBMIT', leaseOwner: null, leaseUntil: null }, 'system', 'uncertain', { reason: 'LEASE_EXPIRED_DURING_SUBMIT' });
      else if (s.state === 'PREPARING') {
        if (s.attempt >= MAX_ATTEMPTS) await this.move(this.prisma, s, ['PREPARING'], 'FAILED', { stateReason: 'PREPARE_ATTEMPTS_EXHAUSTED', leaseOwner: null, leaseUntil: null }, 'system', 'failed', { reason: 'PREPARE_ATTEMPTS_EXHAUSTED' });
        else await this.move(this.prisma, s, ['PREPARING'], 'QUEUED', { leaseOwner: null, leaseUntil: null, stateReason: 'LEASE_EXPIRED' }, 'system', 'lease_expired');
      } else await this.prisma.agentApplication.updateMany({ where: { id: s.id, state: 'READY' }, data: { leaseOwner: null, leaseUntil: null } });
    }
  }

  /** Hands the extension its next piece of work, or none. The work is claimed with a lease, so two browsers can never act on one application. */
  async next(device: DeviceCtx, now = new Date()) {
    if (!this.cfg.enabled) return { work: null, reason: 'AGENT_DISABLED' };
    if (await this.flags.isPaused('agent.submissions')) return { work: null, reason: 'PAUSED_BY_OPERATOR' };
    if (this.extensionUpdate(device.version) === 'required') return { work: null, reason: 'EXTENSION_OUTDATED' };
    const access = await this.browserAccess(device.userId, now);
    if (!access.enabled) {
      // The plan no longer includes the assistant (downgrade or expiry): open work is ended with a clear reason; submitted applications and their
      // history are untouched.
      const open = await this.prisma.agentApplication.findMany({ where: { userId: device.userId, state: { in: [...OPEN] } }, select: { id: true, userId: true, state: true } });
      for (const o of open) await this.move(this.prisma, o, [...OPEN], 'CANCELLED', { cancelledAt: now, stateReason: 'PLAN_REQUIRED', leaseOwner: null, leaseUntil: null }, 'system', 'cancelled', { reason: 'PLAN_REQUIRED' });
      return { work: null, reason: 'PLAN_REQUIRED' };
    }
    if (access.remaining === 0) return { work: null, reason: 'MONTHLY_LIMIT' };
    await this.sweepStale(now);
    await this.discover(device.userId, undefined, now);
    const live = await this.prisma.agentApplication.findMany({
      where: { userId: device.userId, campaign: { status: 'ACTIVE', expiresAt: { gt: now } }, OR: [{ state: 'QUEUED' }, { state: 'READY', mode: 'AUTONOMOUS' }, { state: 'READY', mode: 'ASSISTED', approvedPlanHash: { not: null } }], AND: [{ OR: [{ leaseOwner: null }, { leaseUntil: { lt: now } }] }] },
      include: { campaign: true, job: true }, orderBy: [{ state: 'desc' }, { createdAt: 'asc' }], take: 10,
    });
    for (const a of live) {
      if (a.state === 'READY') {
        if (a.mode === 'ASSISTED' && a.approvedPlanHash !== a.planHash) continue;
        if (a.mode === 'AUTONOMOUS' && !this.autonomousAllowed(a.portal)) continue;
        if ((await this.limitReason(a, now)) !== null) continue;
      }
      if (!isJobActionable(a.job, now)) { await this.move(this.prisma, a, [...OPEN], 'CANCELLED', { cancelledAt: now, stateReason: 'JOB_CLOSED', leaseOwner: null, leaseUntil: null }, 'system', 'cancelled', { reason: 'JOB_CLOSED' }); continue; }
      const step = a.state === 'QUEUED' ? 'describe' : 'submit';
      const leaseUntil = new Date(now.getTime() + this.cfg.leaseMs);
      const claimed = await this.prisma.agentApplication.updateMany({
        where: { id: a.id, state: a.state, OR: [{ leaseOwner: null }, { leaseUntil: { lt: now } }] },
        data: { leaseOwner: device.id, leaseUntil, ...(step === 'describe' ? { state: 'PREPARING', attempt: { increment: 1 } } : {}) },
      });
      if (claimed.count !== 1) continue;
      await this.log(this.prisma, a, 'extension', 'claimed', { step, deviceId: device.id });
      return { work: await this.workPackage(a, step, leaseUntil) };
    }
    return { work: null, reason: 'NO_WORK' };
  }

  private async workPackage(a: AgentApplication & { campaign: AgentCampaign }, step: 'describe' | 'submit', leaseUntil: Date) {
    const plan = (a.plan ?? null) as { fill?: unknown[]; declaration?: { hash: string | null } } | null;
    const ref = postingOf(a.applyUrl)!;
    return {
      applicationId: a.id, step, portal: a.portal, applyUrl: a.applyUrl, postingUrl: ref.postingUrl, thanksUrl: ref.thanksUrl, mode: a.mode, leaseUntil, leaseMs: this.cfg.leaseMs,
      ...(step === 'submit' ? { plan: plan?.fill ?? [], planHash: a.planHash, declarationHash: plan?.declaration?.hash ?? null, attachment: { kind: 'resume', sha256: a.campaign.resumeSha256, path: `/agent/ext/applications/${a.id}/attachment`, filename: this.attachmentName((a.campaign.answers as Answers).fullName) } } : {}),
    };
  }
  private attachmentName(name: string | null | undefined) {
    const base = (name ?? 'CV').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'CV';
    return `CV-${base}.pdf`;
  }

  /** What must still hold before a submission: day limits and spacing. null = fine. */
  private async limitReason(a: AgentApplication & { campaign: AgentCampaign }, now: Date): Promise<string | null> {
    const [campaignToday, userToday, globalToday, last] = await Promise.all([
      this.todaysPermits({ campaignId: a.campaignId }, now), this.todaysPermits({ userId: a.userId }, now), this.todaysPermits({}, now),
      this.prisma.agentApplication.findFirst({ where: { userId: a.userId, permitIssuedAt: { not: null } }, orderBy: { permitIssuedAt: 'desc' }, select: { permitIssuedAt: true } }),
    ]);
    if (campaignToday >= a.campaign.dailyLimit) return 'CAMPAIGN_DAILY_LIMIT';
    if (userToday >= this.cfg.userDailyLimit) return 'USER_DAILY_LIMIT';
    if (globalToday >= this.cfg.globalDailyLimit) return 'GLOBAL_DAILY_LIMIT';
    if (last?.permitIssuedAt && now.getTime() - last.permitIssuedAt.getTime() < this.cfg.minGapMs) return 'TOO_SOON_AFTER_PREVIOUS';
    return null;
  }

  /** The candidate's approved letter for a vacancy: the latest APPROVED snapshot of a READY letter generated for their match with it. */
  private async approvedLetter(userId: string, jobId: string) {
    const doc = await this.prisma.resume.findFirst({
      where: { userId, docKind: 'LETTER', status: 'READY', reviewedAt: { not: null }, match: { is: { jobId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, snapshots: { where: { kind: 'APPROVED' }, orderBy: { revision: 'desc' }, take: 1, select: { id: true, content: true } } },
    });
    const snap = doc?.snapshots[0];
    const paragraphs = (snap?.content as { paragraphs?: { text?: unknown }[] } | null)?.paragraphs;
    if (!doc || !snap || !Array.isArray(paragraphs)) return null;
    const text = paragraphs.map((p) => (typeof p?.text === 'string' ? p.text.trim() : '')).filter(Boolean).join('\n\n').slice(0, 3000);
    return text ? { documentId: doc.id, snapshotId: snap.id, text, sha256: sha256(text) } : null;
  }

  private async buildPlan(a: AgentApplication & { campaign: Pick<AgentCampaign, 'resumeId' | 'resumeSha256' | 'coverNote' | 'useApprovedLetters' | 'answers' | 'alwaysAsk'> }, fields: FormField[], declarationHash: string | null) {
    const resume = await this.prisma.resume.findFirst({ where: { id: a.campaign.resumeId, userId: a.userId }, select: { fileUrl: true, status: true } });
    let hasResume = false;
    if (resume?.fileUrl && resume.status === 'READY') {
      try { hasResume = sha256(await this.storage.readUpload(resume.fileUrl)) === a.campaign.resumeSha256; } catch { hasResume = false; }
    }
    if (!hasResume) return { failed: 'RESUME_CHANGED' as const };
    const ref = postingOf(a.applyUrl)!;
    const known = await this.prisma.agentKnownAnswer.findMany({ where: { userId: a.userId, portal: a.portal, employer: ref.employer } });
    const remembered = Object.fromEntries(known.map((k) => [k.questionKey, k.value as string | boolean]));
    const given: Record<string, string | boolean | string[]> = {};
    for (const q of (a.questions ?? []) as unknown as { key: string; answer?: string | boolean | string[] }[]) if (q.answer !== undefined) given[q.key] = q.answer;
    // The letter the candidate approved for THIS vacancy (approved snapshot, not a draft, not generated here) wins over the campaign's single note.
    const letter = a.campaign.useApprovedLetters ? await this.approvedLetter(a.userId, a.jobId) : null;
    const res = resolveFields({ fields, answers: a.campaign.answers as unknown as Answers, coverNote: letter?.text ?? a.campaign.coverNote, coverSource: letter ? 'approved_letter' : 'approved_cover_note', alwaysAsk: a.campaign.alwaysAsk, remembered, given, hasResume });
    const fill = planOf(res.fields);
    const planHash = hashOf({ fill, resume: a.campaign.resumeSha256, declarationHash });
    // Questions keep any answer already given, so a later re-resolution (after new answers) does not lose it.
    const questions = res.questions.map((q) => ({ ...q, ...(given[q.key] !== undefined ? { answer: given[q.key] } : {}) }));
    return { plan: { described: fields, declaration: { hash: declarationHash }, resolved: res.fields, fill, ...(letter ? { letter: { documentId: letter.documentId, snapshotId: letter.snapshotId, sha256: letter.sha256 } } : {}) }, planHash, questions, ready: res.ready };
  }

  /** Step 1: the extension reports what the real form looks like; AISE decides what it may fill and what it must ask. */
  async describe(device: DeviceCtx, id: string, body: { pageState?: unknown; fields?: unknown; declarationText?: unknown }) {
    const a = await this.guardApplication(device, id);
    if (a.state !== 'PREPARING' || !this.leaseHeld(a, device)) throw new ConflictException('Bu iş üçün icazəniz yoxdur. (LEASE_NOT_HELD)');
    if (a.campaign.status !== 'ACTIVE') { await this.move(this.prisma, a, ['PREPARING'], 'CANCELLED', { cancelledAt: new Date(), stateReason: 'CONSENT_REVOKED', leaseOwner: null, leaseUntil: null }, 'system', 'cancelled'); return { proceed: false, reason: 'CAMPAIGN_NOT_ACTIVE' }; }
    const page = body?.pageState;
    const release = { leaseOwner: null, leaseUntil: null };
    if (page === 'closed') { await this.move(this.prisma, a, ['PREPARING'], 'CANCELLED', { cancelledAt: new Date(), stateReason: 'JOB_CLOSED', ...release }, 'extension', 'cancelled', { reason: 'JOB_CLOSED_ON_PORTAL' }); return { proceed: false, reason: 'JOB_CLOSED' }; }
    if (page === 'login' || page === 'captcha') { await this.move(this.prisma, a, ['PREPARING'], 'AWAITING_INPUT', { stateReason: page === 'login' ? 'LOGIN_REQUIRED' : 'CAPTCHA', questions: [{ key: '__handoff', label: page === 'login' ? 'portal_login' : 'portal_captcha', type: 'other', required: true, category: 'unknown', action: 'ask', askReason: 'unsupported_control' }] as unknown as Prisma.InputJsonValue, ...release }, 'extension', 'handoff', { reason: page }); return { proceed: false, reason: page === 'login' ? 'LOGIN_REQUIRED' : 'CAPTCHA' }; }
    if (page === 'error') { await this.move(this.prisma, a, ['PREPARING'], 'QUEUED', { stateReason: 'PORTAL_ERROR', ...release }, 'extension', 'portal_error'); return { proceed: false, reason: 'PORTAL_ERROR' }; }
    if (page === 'unsupported') { await this.move(this.prisma, a, ['PREPARING'], 'FAILED', { stateReason: 'UNSUPPORTED_FORM', ...release }, 'extension', 'failed', { reason: 'UNSUPPORTED_FORM' }); return { proceed: false, reason: 'UNSUPPORTED_FORM' }; }
    if (page !== 'form' || !Array.isArray(body.fields) || body.fields.length === 0 || body.fields.length > MAX_FIELDS) throw new BadRequestException('Forma təsviri yanlışdır. (INVALID_FORM_DESCRIPTION)');
    const types = ['text', 'email', 'tel', 'url', 'textarea', 'select', 'radio', 'checkbox', 'file', 'number', 'date', 'other'];
    const fields: FormField[] = (body.fields as Record<string, unknown>[]).map((f) => ({
      key: clip(f.key, 200), label: clip(f.label, 300).replace(/\s+/g, ' ').trim(), type: (types.includes(f.type as string) ? f.type : 'other') as FormField['type'], required: f.required === true,
      options: Array.isArray(f.options) ? (f.options as { value?: unknown; label?: unknown }[]).slice(0, 100).map((o) => ({ value: clip(o.value, 200), label: clip(o.label, 200) })) : undefined, multiple: f.multiple === true,
    })).filter((f) => f.key);
    const declarationHash = typeof body.declarationText === 'string' && body.declarationText.trim() ? sha256(body.declarationText.replace(/\s+/g, ' ').trim()) : null;
    const out = await this.buildPlan(a, fields, declarationHash);
    if ('failed' in out) { await this.move(this.prisma, a, ['PREPARING'], 'FAILED', { stateReason: out.failed, ...release }, 'system', 'failed', { reason: out.failed }); return { proceed: false, reason: out.failed }; }
    const ok = out.ready;
    await this.move(this.prisma, a, ['PREPARING'], ok ? 'READY' : 'AWAITING_INPUT', { plan: out.plan as unknown as Prisma.InputJsonValue, planHash: out.planHash, questions: out.questions as unknown as Prisma.InputJsonValue, declarationHash, stateReason: ok ? null : 'QUESTIONS', approvedPlanHash: a.planHash === out.planHash ? a.approvedPlanHash : null, ...release }, 'extension', ok ? 'plan_ready' : 'awaiting_input', { planHash: out.planHash, fields: fields.length, questions: out.questions.length });
    return { proceed: false, state: ok ? 'READY' : 'AWAITING_INPUT', planHash: out.planHash, questions: out.questions.length };
  }

  async attachment(device: DeviceCtx, id: string) {
    const a = await this.guardApplication(device, id);
    if (!this.leaseHeld(a, device) || !(['PREPARING', 'READY', 'SUBMITTING'] as AgentApplicationState[]).includes(a.state)) throw new ConflictException('Bu iş üçün icazəniz yoxdur. (LEASE_NOT_HELD)');
    if (a.campaign.status !== 'ACTIVE') throw new ConflictException('Kampaniya aktiv deyil. (CAMPAIGN_NOT_ACTIVE)');
    const resume = await this.prisma.resume.findFirst({ where: { id: a.campaign.resumeId, userId: a.userId }, select: { fileUrl: true, status: true } });
    let bytes: Buffer | null = null;
    if (resume?.fileUrl && resume.status === 'READY') { try { bytes = await this.storage.readUpload(resume.fileUrl); } catch { bytes = null; } }
    // The file that may be sent is the one the candidate consented to, byte for byte.
    if (!bytes || sha256(bytes) !== a.campaign.resumeSha256) {
      await this.move(this.prisma, a, [...OPEN], 'FAILED', { stateReason: 'RESUME_CHANGED', leaseOwner: null, leaseUntil: null }, 'system', 'failed', { reason: 'RESUME_CHANGED' });
      throw new ConflictException('CV faylı razılaşdırılmış versiyadan fərqlənir. (RESUME_CHANGED)');
    }
    return { bytes, sha256: a.campaign.resumeSha256, filename: this.attachmentName((a.campaign.answers as Answers).fullName), mimeType: 'application/pdf' };
  }

  /** The extension asks to continue. Revocation, a pause, an operator stop or an expired campaign end the work here. */
  async heartbeat(device: DeviceCtx, id: string) {
    const a = await this.guardApplication(device, id);
    const now = new Date();
    const reason = !this.cfg.enabled ? 'AGENT_DISABLED' : (await this.flags.isPaused('agent.submissions')) ? 'PAUSED_BY_OPERATOR' : this.extensionUpdate(device.version) === 'required' ? 'EXTENSION_OUTDATED' : !(await this.browserAccess(a.userId, now)).enabled ? 'PLAN_REQUIRED' : a.campaign.status !== 'ACTIVE' ? 'CAMPAIGN_NOT_ACTIVE' : a.campaign.expiresAt.getTime() <= now.getTime() ? 'CAMPAIGN_EXPIRED' : a.state === 'CANCELLED' ? 'CANCELLED' : !this.leaseHeld(a, device, now) && a.state !== 'AWAITING_INPUT' ? 'LEASE_NOT_HELD' : null;
    if (reason) return { continue: false, reason };
    await this.prisma.agentApplication.updateMany({ where: { id, leaseOwner: device.id }, data: { leaseUntil: new Date(now.getTime() + this.cfg.leaseMs) } });
    return { continue: true };
  }

  /**
   * The only door to a submission. Issued for ONE application, to the browser holding its lease, after every condition is checked again: consent is in force,
   * the form still matches the approved plan, the vacancy is still open, the day's limits hold, the approved file is unchanged. Single use, short lived.
   */
  async permit(device: DeviceCtx, id: string, body: { planHash?: unknown; declarationHash?: unknown; missingRequired?: unknown; mismatched?: unknown }) {
    const now = new Date();
    const a = await this.guardApplication(device, id);
    const refuse = async (reason: string, to?: { state: AgentApplicationState; stateReason: string }) => {
      if (to) await this.move(this.prisma, a, [a.state], to.state, { stateReason: to.stateReason, leaseOwner: null, leaseUntil: null }, 'system', 'permit_refused', { reason });
      else await this.log(this.prisma, a, 'system', 'permit_refused', { reason });
      return { allowed: false as const, reason };
    };
    if (!this.cfg.enabled) return refuse('AGENT_DISABLED');
    if (await this.flags.isPaused('agent.submissions')) return refuse('PAUSED_BY_OPERATOR');
    if (this.extensionUpdate(device.version) === 'required') return refuse('EXTENSION_OUTDATED');
    if (a.state !== 'READY' || !this.leaseHeld(a, device, now)) return refuse('LEASE_NOT_HELD');
    if (a.campaign.status !== 'ACTIVE') return refuse('CAMPAIGN_NOT_ACTIVE', { state: 'CANCELLED', stateReason: 'CONSENT_REVOKED' });
    if (a.campaign.expiresAt.getTime() <= now.getTime()) return refuse('CAMPAIGN_EXPIRED', { state: 'CANCELLED', stateReason: 'CAMPAIGN_EXPIRED' });
    if (a.mode === 'AUTONOMOUS' && !this.autonomousAllowed(a.portal)) return refuse('AUTONOMOUS_NOT_AVAILABLE');
    // The plan is checked again at the moment of submission: a downgrade after approval ends the work, and the monthly cap holds even for work
    // approved earlier. An application that already has a permit (a retry) is not counted twice.
    const access = await this.browserAccess(a.userId, now);
    if (!access.enabled) return refuse('PLAN_REQUIRED', { state: 'CANCELLED', stateReason: 'PLAN_REQUIRED' });
    if (!a.permitIssuedAt && access.remaining === 0) return refuse('MONTHLY_LIMIT');
    if (body?.planHash !== a.planHash || !a.planHash) return refuse('PLAN_MISMATCH', { state: 'QUEUED', stateReason: 'PLAN_MISMATCH' });
    if (a.mode === 'ASSISTED' && a.approvedPlanHash !== a.planHash) return refuse('NOT_APPROVED');
    const plan = (a.plan ?? null) as { declaration?: { hash: string | null } } | null;
    if ((plan?.declaration?.hash ?? null) !== ((body?.declarationHash as string | null | undefined) ?? null)) return refuse('DECLARATION_CHANGED', { state: 'AWAITING_INPUT', stateReason: 'DECLARATION_CHANGED' });
    const missing = Array.isArray(body?.missingRequired) ? (body.missingRequired as unknown[]).length : 0, mism = Array.isArray(body?.mismatched) ? (body.mismatched as unknown[]).length : 0;
    if (missing || mism) return refuse('FORM_VALIDATION_FAILED', { state: 'AWAITING_INPUT', stateReason: 'VALIDATION_FAILED' });
    if (!isJobActionable(a.job, now)) return refuse('JOB_CLOSED', { state: 'CANCELLED', stateReason: 'JOB_CLOSED' });
    if (await this.duplicateElsewhere(a.userId, a.job)) return refuse('DUPLICATE_ELSEWHERE', { state: 'CANCELLED', stateReason: 'DUPLICATE_ELSEWHERE' });
    const limit = await this.limitReason(a, now);
    if (limit) return refuse(limit);
    const permitId = randomBytes(18).toString('base64url');
    // One permit at a time per candidate: the day's counts are read and the permit written under one lock.
    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.userId}))`;
      const again = await this.limitReason(a, new Date());
      if (again) return again;
      const ok = await this.move(tx, a, ['READY'], 'SUBMITTING', { permitId, permitIssuedAt: now, leaseUntil: new Date(now.getTime() + PERMIT_MS), attempt: { increment: 1 } }, 'system', 'permit_issued', { planHash: a.planHash });
      return ok ? null : 'RACE';
    });
    if (issued) return refuse(issued);
    return { allowed: true as const, permitId, expiresAt: new Date(now.getTime() + PERMIT_MS) };
  }

  /** Something stopped the extension: a challenge, a login, a form error, or no confirmation after the click. */
  async blocked(device: DeviceCtx, id: string, body: { reason?: unknown; phase?: unknown; permitId?: unknown }) {
    const a = await this.guardApplication(device, id);
    const reason = clip(body?.reason, 40).replace(/[^a-z_]/gi, '').toLowerCase() || 'unknown';
    const afterClick = body?.phase === 'after_click';
    if (a.state === 'SUBMITTING' && a.permitId && body?.permitId === a.permitId) {
      if (reason === 'captcha' || reason === 'login') {
        // The portal is showing a challenge before accepting anything: no submission happened. The candidate completes it in their own tab.
        await this.move(this.prisma, a, ['SUBMITTING'], 'AWAITING_INPUT', { stateReason: reason === 'captcha' ? 'CAPTCHA_PENDING' : 'LOGIN_REQUIRED', leaseUntil: new Date(Date.now() + this.cfg.leaseMs) }, 'extension', 'handoff', { reason });
        return { state: 'AWAITING_INPUT' };
      }
      if (!afterClick) {
        await this.move(this.prisma, a, ['SUBMITTING'], 'AWAITING_INPUT', { stateReason: reason.toUpperCase(), permitId: null, leaseOwner: null, leaseUntil: null }, 'extension', 'blocked_before_submit', { reason });
        return { state: 'AWAITING_INPUT' };
      }
      await this.move(this.prisma, a, ['SUBMITTING'], 'UNCERTAIN', { uncertainAt: new Date(), stateReason: 'NO_CONFIRMATION', leaseOwner: null, leaseUntil: null }, 'extension', 'uncertain', { reason });
      return { state: 'UNCERTAIN' };
    }
    if (a.state === 'PREPARING' || a.state === 'READY') {
      await this.move(this.prisma, a, ['PREPARING', 'READY'], 'AWAITING_INPUT', { stateReason: reason.toUpperCase(), leaseOwner: null, leaseUntil: null }, 'extension', 'blocked', { reason });
      return { state: 'AWAITING_INPUT' };
    }
    return { state: a.state };
  }

  /** Portal-confirmed evidence: only the posting's own confirmation page counts; a click, or a URL that merely resembles it, does not. */
  async evidence(device: DeviceCtx, id: string, body: { permitId?: unknown; confirmationUrl?: unknown; textSha256?: unknown; portalReference?: unknown }) {
    const a = await this.guardApplication(device, id);
    const ref = postingOf(a.applyUrl)!;
    if (a.state === 'SUBMITTED') return { state: 'SUBMITTED', duplicate: true };
    const allowed: AgentApplicationState[] = ['SUBMITTING', 'UNCERTAIN', 'AWAITING_INPUT'];
    if (!allowed.includes(a.state) || !a.permitId || body?.permitId !== a.permitId) throw new ConflictException('Bu müraciət üçün göndərmə icazəsi yoxdur. (NO_PERMIT)');
    if (!isConfirmationUrl(ref, body?.confirmationUrl)) {
      await this.log(this.prisma, a, 'extension', 'evidence_rejected', { reason: 'CONFIRMATION_URL_NOT_ACCEPTED' });
      if (a.state === 'SUBMITTING') await this.move(this.prisma, a, ['SUBMITTING'], 'UNCERTAIN', { uncertainAt: new Date(), stateReason: 'EVIDENCE_NOT_ACCEPTED', leaseOwner: null, leaseUntil: null }, 'system', 'uncertain');
      throw new BadRequestException('Təsdiq səhifəsi qəbul edilmədi. (EVIDENCE_REJECTED)');
    }
    const evidence = { confirmationUrl: new URL(body.confirmationUrl as string).origin + new URL(body.confirmationUrl as string).pathname, textSha256: typeof body.textSha256 === 'string' && /^[a-f0-9]{64}$/.test(body.textSha256) ? body.textSha256 : null, portalReference: clip(body.portalReference, 80) || null, capturedAt: new Date().toISOString() };
    await this.move(this.prisma, a, allowed, 'SUBMITTED', { confirmation: 'PORTAL', evidence: evidence as unknown as Prisma.InputJsonValue, submittedAt: new Date(), stateReason: null, uncertainAt: null, leaseOwner: null, leaseUntil: null }, 'portal', 'submitted_with_evidence', { confirmationUrl: evidence.confirmationUrl });
    return { state: 'SUBMITTED' };
  }

  // ───────────────────────────────────────────────────────────────── maintenance
  async sweep(now = new Date()) {
    await this.expireDue(now);
    await this.sweepStale(now);
  }
}

const GLORRI_HOSTS = ['jobs.glorri.az', 'jobs.glorri.com'];
/** "/vacancies/<company>/<slug>" of a Glorri vacancy or its apply page (any further path, query or hash is dropped), else null. */
export function glorriVacancyPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || !GLORRI_HOSTS.includes(u.hostname)) return null;
  const m = /^\/vacancies\/([a-z0-9-]{1,100})\/([a-z0-9-]{1,200})(?:\/|$)/i.exec(u.pathname);
  return m ? `/vacancies/${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null;
}
