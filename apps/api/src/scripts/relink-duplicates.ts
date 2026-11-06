/**
 * Links cross-source repeats among postings already stored, with the same conservative rules the importer applies to new
 * ones (compareJobs auto-link only). Dry run by default; --apply writes ONLY duplicateOfId/duplicateReason on the later
 * posting, never content, lifecycle, matches or moderation, and never deletes. Safe to repeat.
 */
import { PrismaClient } from '@prisma/client';
import { compareJobs, sourceOf } from '../jobs/job-dedup.util';

export async function relinkDuplicates(prisma: Pick<PrismaClient, 'job'>, opts: { apply: boolean }) {
  const rows = await prisma.job.findMany({
    where: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, companyKey: { not: null } },
    orderBy: { ingestedAt: 'asc' },
    select: { id: true, externalId: true, title: true, company: true, location: true, description: true, url: true, postedAt: true, companyKey: true },
  });
  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) (byCompany.get(row.companyKey!) ?? byCompany.set(row.companyKey!, []).get(row.companyKey!)!).push(row);
  const linked: { later: string; primary: string; kind: string; similarity: number }[] = [];
  const taken = new Set<string>();
  for (const group of byCompany.values()) {
    for (let i = 1; i < group.length; i++) {
      const later = group[i];
      for (let j = 0; j < i; j++) {
        const primary = group[j];
        if (taken.has(primary.id) || sourceOf(primary.externalId) === sourceOf(later.externalId)) continue;
        const verdict = compareJobs(later, primary);
        if (!verdict?.autoLink) continue;
        linked.push({ later: later.id, primary: primary.id, kind: verdict.kind, similarity: verdict.similarity });
        taken.add(later.id); // a posting that is itself a repeat is never a primary
        if (opts.apply) await prisma.job.update({ where: { id: later.id }, data: { duplicateOfId: primary.id, duplicateReason: `${verdict.kind}: ${verdict.reason} (text similarity ${verdict.similarity.toFixed(2)})` } });
        break;
      }
    }
  }
  const byKind: Record<string, number> = {};
  for (const l of linked) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  return { scanned: rows.length, linked: linked.length, byKind };
}

async function main() {
  const prisma = new PrismaClient();
  try { console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', ...(await relinkDuplicates(prisma, { apply: process.argv.includes('--apply') })) })); } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Relink failed.'); process.exitCode = 1; });
