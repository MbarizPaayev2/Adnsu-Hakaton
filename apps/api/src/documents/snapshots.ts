import { createHash } from 'node:crypto';
import type { DocumentSnapshotKind, Prisma } from '@prisma/client';

/** JSON with sorted keys, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().filter((k) => (value as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const contentHash = (content: unknown): string => createHash('sha256').update(canonicalJson(content)).digest('hex');
export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Appends one version of a document. Snapshots are never updated or deleted by the application: the GENERATED one is what the provider produced
 * after fact-checking, EDITED ones are the candidate's saves, APPROVED is what the candidate approved together with the SHA-256 of the exact PDF.
 * (resumeId, revision, kind) is unique, so a repeated write of the same version is a no-op.
 */
export async function recordSnapshot(
  tx: Prisma.TransactionClient,
  resumeId: string,
  revision: number,
  kind: DocumentSnapshotKind,
  content: unknown,
  provenance: unknown,
  fileSha256?: string,
): Promise<void> {
  await tx.documentSnapshot.createMany({
    data: [{ resumeId, revision, kind, content: content as Prisma.InputJsonValue, provenance: (provenance ?? undefined) as Prisma.InputJsonValue | undefined, contentHash: contentHash(content), fileSha256 }],
    skipDuplicates: true,
  });
}
