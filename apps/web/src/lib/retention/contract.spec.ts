import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalQaHost, retentionMode } from './contract';

function setHost(hostname: string) {
  vi.stubGlobal('window', { location: { hostname } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isLocalQaHost', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'qa.localhost', 'aise.test', 'LOCALHOST'])('allows %s', (h) => expect(isLocalQaHost(h)).toBe(true));
  it.each(['aisehr.com', 'www.aisehr.com', 'staging.aisehr.com', 'localhost.evil.com', 'evil-localhost', 'notlocalhost.com', 'example.com', '10.0.0.5', '192.168.1.2', ''])('refuses %s', (h) => expect(isLocalQaHost(h)).toBe(false));
});

describe('retentionMode', () => {
  it('is live by default', () => {
    setHost('localhost');
    expect(retentionMode()).toBe('live');
  });

  it('serves fixtures only when asked for AND on a local QA host', () => {
    vi.stubEnv('NEXT_PUBLIC_RETENTION_MODE', 'fixture');
    setHost('localhost');
    expect(retentionMode()).toBe('fixture');
  });

  it('never serves fixtures on the public site, whatever the build says', () => {
    vi.stubEnv('NEXT_PUBLIC_RETENTION_MODE', 'fixture');
    vi.stubEnv('NEXT_PUBLIC_ALLOW_TEST_FIXTURES', 'true');
    for (const h of ['aisehr.com', 'www.aisehr.com', 'app.aisehr.com']) {
      setHost(h);
      expect(retentionMode()).toBe('live');
    }
  });

  it('is live on the server (fixtures are browser-only)', () => {
    vi.stubEnv('NEXT_PUBLIC_RETENTION_MODE', 'fixture');
    vi.stubGlobal('window', undefined);
    expect(retentionMode()).toBe('live');
  });

  it('a production build needs the explicit allow flag even on localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_RETENTION_MODE', 'fixture');
    vi.stubEnv('NODE_ENV', 'production');
    setHost('localhost');
    expect(retentionMode()).toBe('live');
    vi.stubEnv('NEXT_PUBLIC_ALLOW_TEST_FIXTURES', 'true');
    expect(retentionMode()).toBe('fixture');
  });
});
