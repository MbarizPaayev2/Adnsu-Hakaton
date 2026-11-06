import { PrismaClient } from '@prisma/client';
import {
  compareJobs,
  normalizeCompany,
  normalizeTitle,
  descriptionSimilarity,
  type DedupJob,
} from '../jobs/job-dedup.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const allJobs = await prisma.job.findMany({
      where: { status: 'ACTIVE', hiddenAt: null },
      select: {
        id: true,
        externalId: true,
        title: true,
        company: true,
        location: true,
        description: true,
        url: true,
        postedAt: true,
        companyKey: true,
        duplicateOfId: true,
      },
      orderBy: { postedAt: 'desc' },
    });

    const targetJobs: DedupJob[] = [];
    const referenceJobs: DedupJob[] = [];

    for (const job of allJobs) {
      const source = job.externalId.split(':')[0];
      const dedupJob: DedupJob = {
        externalId: job.externalId,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        url: job.url,
        postedAt: job.postedAt,
      };
      if (source === 'work' || source === 'xsolla') {
        targetJobs.push(dedupJob);
      } else {
        referenceJobs.push(dedupJob);
      }
    }

    console.log(`Analyzing ${targetJobs.length} Work/Xsolla jobs against ${referenceJobs.length} reference jobs (Hellojob, Boss, Smartjob, etc.)...`);

    const autoLinked: Array<{
      targetId: string;
      referenceId: string;
      kind: string;
      reason: string;
      similarity: number;
    }> = [];

    const ambiguous: Array<{
      targetId: string;
      targetTitle: string;
      targetCompany: string;
      referenceId: string;
      referenceTitle: string;
      referenceCompany: string;
      similarity: number;
      reason: string;
    }> = [];

    for (const target of targetJobs) {
      for (const ref of referenceJobs) {
        const verdict = compareJobs(target, ref);
        if (verdict?.autoLink) {
          autoLinked.push({
            targetId: target.externalId,
            referenceId: ref.externalId,
            kind: verdict.kind,
            reason: verdict.reason,
            similarity: verdict.similarity,
          });
          continue;
        }

        // Check for ambiguous pairs: same company and same title, but not auto-linked
        const targetComp = normalizeCompany(target.company);
        const refComp = normalizeCompany(ref.company);
        const targetTitle = normalizeTitle(target.title);
        const refTitle = normalizeTitle(ref.title);

        if (targetComp && targetComp === refComp && targetTitle && targetTitle === refTitle) {
          const sim = descriptionSimilarity(target.description, ref.description);
          ambiguous.push({
            targetId: target.externalId,
            targetTitle: target.title,
            targetCompany: target.company,
            referenceId: ref.externalId,
            referenceTitle: ref.title,
            referenceCompany: ref.company,
            similarity: sim,
            reason: `Same company and title across sources; description similarity ${sim.toFixed(2)} (below auto-link threshold or date window exceeded)`,
          });
        }
      }
    }

    console.log(JSON.stringify({
      targetCount: targetJobs.length,
      referenceCount: referenceJobs.length,
      autoLinkedCount: autoLinked.length,
      autoLinked,
      ambiguousCount: ambiguous.length,
      ambiguous: ambiguous.slice(0, 20),
    }, null, 2));

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
