import { describe, it, expect } from 'vitest';
import { deviceConnection } from './agent';

describe('deviceConnection', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it('says online only when the extension checked in within ten minutes (it polls every minute)', () => {
    expect(deviceConnection('2026-10-16T11:55:00Z', now).state).toBe('online');
    expect(deviceConnection('2026-10-16T09:00:00Z', now).state).toBe('idle');
    expect(deviceConnection('2026-10-14T09:00:00Z', now).state).toBe('stale');
    expect(deviceConnection(null, now).state).toBe('never');
  });
});
