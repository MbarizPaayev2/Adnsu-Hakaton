import { afterEach, expect, it } from 'vitest';
import { loadRetentionApi, resetRetentionApiForTests } from './api';

afterEach(() => resetRetentionApiForTests());

it('callers that load the adapter together share one instance', async () => {
  const [a, b, c] = await Promise.all([loadRetentionApi(), loadRetentionApi(), loadRetentionApi()]);
  expect(b).toBe(a);
  expect(c).toBe(a);
});
