/**
 * Idempotency keys for document generation (`requestId` on POST /documents/generate).
 *
 * The server replays a request it has already seen: the same key returns the same documents and charges nothing. That is exactly right for ONE
 * case — the answer to a request never arrived (network error, timeout), so the candidate retries and must not pay twice. It is wrong everywhere
 * else: once ANY HTTP answer was received (created, refused, failed) the attempt is over, and reusing its key would replay that outcome — a
 * FAILED document forever, or the previous language. So the key is tied to the exact request and is dropped as soon as the outcome is known.
 */
export function newRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `req_${c.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export interface RequestIdKeeper {
  /** The key for exactly this request. The same request (same parts) keeps its key; any change starts a new one. */
  forRequest(parts: unknown): string;
  /** The outcome is known (an HTTP answer arrived): the next attempt is a new request. */
  settle(): void;
}

export function createRequestIdKeeper(): RequestIdKeeper {
  let fingerprint: string | null = null;
  let id = '';
  return {
    forRequest(parts) {
      const next = JSON.stringify(parts);
      if (next !== fingerprint) {
        fingerprint = next;
        id = newRequestId();
      }
      return id;
    },
    settle() {
      fingerprint = null;
      id = '';
    },
  };
}
