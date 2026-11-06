import { createHash } from 'crypto';

/** Stable JSON (sorted keys, no undefined) so a hash means the same thing on every machine. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hashOf = (value: unknown) => sha256(canonicalJson(value));
