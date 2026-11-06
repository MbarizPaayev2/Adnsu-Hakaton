import { describe, expect, it } from 'vitest';
import { ageTone, evaluateHealth, type HealthPayload } from './health';

const up = { ok: true, ms: 3 };
const full = (over: Partial<NonNullable<HealthPayload['backup']>> = {}, services: HealthPayload['services'] = { database: up, redis: up, matching: up, applyWorker: up }): HealthPayload => ({
  services,
  backup: { known: true, lastBackupAgeHours: 5, lastOffhostResult: 'VERIFIED', lastOffhostCopyAgeHours: 5, lastRestoreTestResult: 'PASSED', lastRestoreTestAgeHours: 48, ...over },
});
const verdict = (health: HealthPayload | null, extra: { loading?: boolean; error?: string } = {}) => evaluateHealth({ loading: false, health, ...extra });

describe('admin health verdict', () => {
  it('healthy only with positive evidence for services, backup, off-host copy and restore test', () => {
    expect(verdict(full()).tone).toBe('ok');
  });
  it('loading, request failure and no payload are unknown, never healthy', () => {
    expect(verdict(null, { loading: true }).tone).toBe('unknown');
    expect(verdict(null, { error: 'x' }).tone).toBe('unknown');
    expect(verdict(null).tone).toBe('unknown');
  });
  it('a failed service is bad; a missing service result is unknown', () => {
    expect(verdict(full({}, { database: up, redis: { ok: false, ms: 1 }, matching: up, applyWorker: up })).tone).toBe('bad');
    expect(verdict(full({}, { database: up, redis: up, matching: up })).tone).toBe('unknown');
  });
  it('unknown backup status is unknown even when every service is up', () => {
    expect(verdict({ services: full().services, backup: { known: false, reason: 'yoxdur' } }).tone).toBe('unknown');
    expect(verdict({ services: full().services }).tone).toBe('unknown');
  });
  it('a backup with no readable age is unknown, not fresh', () => {
    expect(verdict(full({ lastBackupAgeHours: null })).tone).toBe('unknown');
    expect(verdict(full({ lastBackupAgeHours: Number.NaN as unknown as number })).tone).toBe('unknown');
  });
  it('stale evidence is warn; very old backup, failed off-host copy, failed restore test and recorded backup failure are bad', () => {
    expect(verdict(full({ lastBackupAgeHours: 40 })).tone).toBe('warn');
    expect(verdict(full({ lastRestoreTestAgeHours: 9 * 24 })).tone).toBe('warn');
    expect(verdict(full({ lastBackupAgeHours: 100 })).tone).toBe('bad');
    expect(verdict(full({ lastOffhostResult: 'FAILED' })).tone).toBe('bad');
    expect(verdict(full({ lastRestoreTestResult: 'FAILED' })).tone).toBe('bad');
    expect(verdict(full({ lastBackupFailureAt: '2026-10-03T00:00:00Z', lastBackupError: 'x' })).tone).toBe('bad');
  });
  it('missing off-host or restore-test evidence is unknown, not healthy', () => {
    expect(verdict(full({ lastOffhostResult: null })).tone).toBe('unknown');
    expect(verdict(full({ lastRestoreTestResult: null })).tone).toBe('unknown');
  });
  it('age thresholds', () => {
    expect([ageTone(0), ageTone(26), ageTone(27), ageTone(72), ageTone(73), ageTone(undefined), ageTone(-1)]).toEqual(['ok', 'ok', 'warn', 'warn', 'bad', 'unknown', 'unknown']);
  });
});
