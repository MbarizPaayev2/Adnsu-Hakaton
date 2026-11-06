import { parseRescoreArgs, rescoreJobId, validateRollout } from './rescore';

describe('parseRescoreArgs', () => {
  const apply = ['--apply', '--rollout', 'scorer-2026-10', '--silent'];

  it('is a dry run by default and needs nothing else', () => {
    expect(parseRescoreArgs([])).toMatchObject({ apply: false, all: false, spacingSeconds: 120, retryFailed: false });
    expect(parseRescoreArgs(['--rollout', 'scorer-2026-10']).rollout).toBe('scorer-2026-10');
  });

  it('parses a valid silent rollout for one user or everyone', () => {
    expect(parseRescoreArgs([...apply, '--user', 'u1'])).toMatchObject({ apply: true, user: 'u1', silent: true, rollout: 'scorer-2026-10' });
    expect(parseRescoreArgs([...apply, '--all', '--spacing-seconds', '90', '--retry-failed'])).toMatchObject({ all: true, spacingSeconds: 90, retryFailed: true });
  });

  it('forces an explicit notification choice and a named rollout when applying', () => {
    expect(() => parseRescoreArgs(['--apply', '--rollout', 'scorer-2026-10', '--all'])).toThrow(/--silent.*--notify/);
    expect(() => parseRescoreArgs(['--apply', '--silent', '--all'])).toThrow(/--rollout/);
    expect(() => parseRescoreArgs([...apply])).toThrow(/--user.*--all/);
    expect(parseRescoreArgs(['--apply', '--rollout', 'scorer-2026-10', '--notify', '--all']).silent).toBe(false);
    expect(() => parseRescoreArgs([...apply, '--notify', '--all'])).toThrow(/not both/);
  });

  it.each([['--spacing-seconds', '5'], ['--spacing-seconds', '99999'], ['--spacing-seconds', '12.5'], ['--spacing-seconds', 'abc'], ['--spacing-seconds', '-30']])('rejects %s %s', (flag, value) => {
    expect(() => parseRescoreArgs([...apply, '--all', flag, value])).toThrow();
  });

  it('rejects unknown, duplicated and value-less options and conflicting targets', () => {
    expect(() => parseRescoreArgs([...apply, '--all', '--force'])).toThrow(/Unknown option/);
    expect(() => parseRescoreArgs([...apply, '--all', '--all'])).toThrow(/twice/);
    expect(() => parseRescoreArgs(['--apply', '--rollout'])).toThrow(/needs a value/);
    expect(() => parseRescoreArgs([...apply, '--user', 'u1', '--all'])).toThrow(/not both/);
    expect(() => parseRescoreArgs(['--retry-failed'])).toThrow(/only makes sense/);
  });

  it('validates rollout names', () => {
    for (const bad of ['', 'ab', 'Has-Caps', 'has space', '-lead', 'x'.repeat(41), 'semi;colon']) expect(() => validateRollout(bad)).toThrow();
    expect(validateRollout('scorer-2026-10-silent')).toBe('scorer-2026-10-silent');
    expect(rescoreJobId('r-1', 'cuid1')).toBe('rescore-r-1-cuid1');
  });
});
