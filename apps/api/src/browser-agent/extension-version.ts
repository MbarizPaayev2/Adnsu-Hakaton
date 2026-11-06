import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the API image keeps the packed extension (apps/extension/scripts/pack.mjs writes both files there at build time). */
export const EXTENSION_DIR = join(__dirname, '../../private/agent');

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** A version string the extension reported, or null when it is absent or not plain x.y.z (never stored as given). */
export function cleanVersion(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return VERSION.test(v) ? v : null;
}

/** Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

let shipped: { version: string } | null | undefined;
/** The version inside the ZIP this API hands out, or null when no archive was packed (development without `pack.mjs`). Read once. */
export function shippedExtension(): { version: string } | null {
  if (shipped !== undefined) return shipped;
  try {
    const meta = JSON.parse(readFileSync(join(EXTENSION_DIR, 'aise-agent-extension.json'), 'utf8')) as { version?: unknown };
    const version = cleanVersion(meta.version);
    shipped = version ? { version } : null;
  } catch { shipped = null; }
  return shipped;
}
