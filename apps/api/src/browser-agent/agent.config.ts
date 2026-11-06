import { SUPPORTED_PORTALS, type PortalKey } from './portals';

/**
 * Switches for the browser agent. Everything is OFF unless named. Assisted mode (the candidate approves every submission) and autonomous mode (the
 * candidate authorised a campaign) are separate switches, and autonomous mode additionally needs each portal to be named as verified by the operator.
 */
export interface AgentConfig {
  enabled: boolean;
  autonomousEnabled: boolean;
  autonomousPortals: PortalKey[];
  leaseMs: number;
  userDailyLimit: number; // hard ceiling across all of one candidate's campaigns
  globalDailyLimit: number;
  minGapMs: number; // minimum time between two submit permits for one candidate
  maxCampaignDays: number;
  /** Oldest extension version still allowed to act (x.y.z). Null: no floor, older browsers are only told an update exists. */
  minExtensionVersion: string | null;
}

export const AGENT_CONFIG = 'AGENT_CONFIG';

const flag = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'true';
const int = (v: string | undefined, d: number, max: number) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(Math.floor(x), max) : d; };

export function loadAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const portals = (env.BROWSER_AGENT_AUTONOMOUS_PORTALS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s): s is PortalKey => (SUPPORTED_PORTALS as string[]).includes(s));
  return {
    enabled: flag(env.BROWSER_AGENT_ENABLED),
    autonomousEnabled: flag(env.BROWSER_AGENT_AUTONOMOUS_ENABLED),
    autonomousPortals: portals,
    leaseMs: int(env.BROWSER_AGENT_LEASE_MS, 10 * 60_000, 60 * 60_000),
    userDailyLimit: int(env.BROWSER_AGENT_USER_DAILY_LIMIT, 10, 50),
    globalDailyLimit: int(env.BROWSER_AGENT_GLOBAL_DAILY_LIMIT, 200, 5000),
    minGapMs: int(env.BROWSER_AGENT_MIN_GAP_MS, 60_000, 3_600_000),
    maxCampaignDays: int(env.BROWSER_AGENT_MAX_CAMPAIGN_DAYS, 30, 90),
    minExtensionVersion: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test((env.BROWSER_AGENT_MIN_EXTENSION_VERSION ?? '').trim()) ? env.BROWSER_AGENT_MIN_EXTENSION_VERSION!.trim() : null,
  };
}
