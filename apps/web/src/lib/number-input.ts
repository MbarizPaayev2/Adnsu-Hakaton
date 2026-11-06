import type { KeyboardEvent } from 'react';

/**
 * A plain <input type="number"> still lets someone type "1e5" (scientific
 * notation — evaluates to 100000) or a leading "-", neither of which makes
 * sense for a field like a salary or year that should only ever be a
 * non-negative whole number. The browser's own number-input keyboard
 * filtering allows both of those characters through.
 *
 * Attach as onKeyDown alongside `min={0}` on any such input.
 */
export function blockNegativeAndExponentKeys(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
    e.preventDefault();
  }
}

/**
 * Defense-in-depth for onChange: a pasted value (or a spinner click at the
 * boundary) bypasses onKeyDown entirely. Clamps to a non-negative number,
 * or '' if the field should read as empty/unset — never NaN or negative.
 */
export function parseNonNegativeNumber(rawValue: string): number | '' {
  if (rawValue === '') return '';
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < 0) return '';
  return n;
}
