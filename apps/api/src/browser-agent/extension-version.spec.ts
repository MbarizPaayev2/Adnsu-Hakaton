import { cleanVersion, compareVersions } from './extension-version';
import { loadAgentConfig } from './agent.config';

describe('extension versions', () => {
  it('accepts only plain x.y.z', () => {
    expect(cleanVersion('0.3.3')).toBe('0.3.3');
    expect(cleanVersion(' 1.10.0 ')).toBe('1.10.0');
    for (const bad of ['', '0.3', '0.3.3-beta', '9.9.9<script>', 42, null, undefined, ['0.3.3']]) expect(cleanVersion(bad)).toBeNull();
  });
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.3.2', '0.3.3')).toBeLessThan(0);
    expect(compareVersions('0.3.10', '0.3.3')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3.3', '0.3.3')).toBe(0);
  });
  it('has no version floor unless the operator names a valid one', () => {
    expect(loadAgentConfig({}).minExtensionVersion).toBeNull();
    expect(loadAgentConfig({ BROWSER_AGENT_MIN_EXTENSION_VERSION: 'latest' }).minExtensionVersion).toBeNull();
    expect(loadAgentConfig({ BROWSER_AGENT_MIN_EXTENSION_VERSION: '0.3.3' }).minExtensionVersion).toBe('0.3.3');
  });
});
