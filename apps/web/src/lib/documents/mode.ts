import { isLocalQaHost } from '@/lib/retention/contract';

export type DocumentsMode = 'live' | 'preview' | 'unavailable';

/**
 * Returns the operational mode for newly proposed document flows (e.g. motivation letter
 * or full CV generator where backend contract is pending).
 *
 * Production hosts (such as aisehr.com) will never enter 'preview' mode.
 * Only non-production local hosts with NEXT_PUBLIC_DOCUMENTS_MODE='preview' enter 'preview'.
 */
export function getDocumentsMode(): DocumentsMode {
  if (typeof window === 'undefined') return 'unavailable';
  
  const host = window.location.hostname;
  const isLocal = isLocalQaHost(host);
  const isPreviewRequested =
    process.env.NEXT_PUBLIC_DOCUMENTS_MODE === 'preview' ||
    process.env.NEXT_PUBLIC_RETENTION_MODE === 'fixture';

  if (isLocal && isPreviewRequested && process.env.NODE_ENV !== 'production') {
    return 'preview';
  }

  return 'unavailable';
}
