/**
 * Re-derives job facts (work arrangement, experience level, explicit application e-mail with its evidence) from the
 * posting text already stored, after the extractor improved. Dry run by default; --apply writes ONLY those five
 * columns, never content, lifecycle, matches or moderation. Safe to repeat.
 * --subjects-only adds missing explicit subjects to existing email evidence only. Existing application snapshots
 * are never rewritten. Concurrent imports win: every update checks the row's original source text and evidence.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { deriveJobFacts } from '../jobs/job-facts';

export async function backfillJobFacts(prisma: Pick<PrismaClient, 'job'>, opts: { apply: boolean; batch?: number; subjectsOnly?: boolean }) {
  const result = { scanned: 0, changed: 0, nowEmail: 0, noLongerEmail: 0, skippedConcurrent: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.job.findMany({
      ...(opts.subjectsOnly ? { where: { applicationMethod: 'EMAIL', applicationEmail: { not: null } } } : {}),
      take: opts.batch ?? 500, orderBy: { id: 'asc' }, ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, title: true, description: true, rawPayload: true, workArrangement: true, experienceLevel: true, applicationMethod: true, applicationEmail: true, applicationEmailEvidence: true },
    });
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      result.scanned++;
      const f = deriveJobFacts({ title: row.title, description: row.description, rawPayload: row.rawPayload as Record<string, unknown> | null });
      const unchanged = {
        id: row.id, title: row.title, description: row.description,
        rawPayload: { equals: row.rawPayload ?? Prisma.DbNull },
        applicationEmail: row.applicationEmail,
        applicationEmailEvidence: { equals: row.applicationEmailEvidence ?? Prisma.DbNull },
      };
      if (opts.subjectsOnly) {
        const existing = row.applicationEmailEvidence as Prisma.JsonObject | null;
        const subject = f.applicationEmailEvidence?.subjectLine;
        if (!existing || existing.subjectLine || !subject || f.applicationEmail !== row.applicationEmail) continue;
        result.changed++;
        if (opts.apply) {
          const written = await prisma.job.updateMany({
            where: unchanged,
            data: { applicationEmailEvidence: { ...existing, subjectLine: subject, extractorVersion: f.applicationEmailEvidence!.extractorVersion } as Prisma.InputJsonObject },
          });
          result.skippedConcurrent += 1 - written.count;
        }
        continue;
      }
      if (f.workArrangement === row.workArrangement && f.experienceLevel === row.experienceLevel && f.applicationMethod === row.applicationMethod && f.applicationEmail === row.applicationEmail && JSON.stringify(f.applicationEmailEvidence) === JSON.stringify(row.applicationEmailEvidence)) continue;
      result.changed++;
      if (f.applicationMethod === 'EMAIL' && row.applicationMethod !== 'EMAIL') result.nowEmail++;
      if (f.applicationMethod !== 'EMAIL' && row.applicationMethod === 'EMAIL') result.noLongerEmail++;
      if (opts.apply) {
        const written = await prisma.job.updateMany({ where: unchanged, data: { workArrangement: f.workArrangement, experienceLevel: f.experienceLevel, applicationMethod: f.applicationMethod, applicationEmail: f.applicationEmail, applicationEmailEvidence: f.applicationEmailEvidence ? (f.applicationEmailEvidence as unknown as Prisma.InputJsonObject) : Prisma.DbNull } });
        result.skippedConcurrent += 1 - written.count;
      }
    }
  }
  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try { console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', subjectsOnly: process.argv.includes('--subjects-only'), ...(await backfillJobFacts(prisma, { apply: process.argv.includes('--apply'), subjectsOnly: process.argv.includes('--subjects-only') })) })); } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Fact backfill failed.'); process.exitCode = 1; });
