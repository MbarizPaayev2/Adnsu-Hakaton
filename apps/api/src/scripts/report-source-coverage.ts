/**
 * Read-only: prints measured vacancy coverage per registered source from the database named by DATABASE_URL. Writes nothing.
 * The report names its environment and never adds numbers across environments: an isolated test/trial database and a production-like one are
 * different inventories and must be reported separately.
 */
import { PrismaClient } from '@prisma/client';
import { EMPLOYER_TARGETS } from '../scrapers/public-jobs/employer-registry';
import { coverageSummary } from '../jobs/job-source.service';

const ISOLATED = /(phase2_test|census|scratch|trial|local_preview|_test$)/i;

/** Names the database without its credentials, and says whether it is a disposable/isolated one. */
export function describeEnvironment(databaseUrl: string | undefined): { label: string; isolated: boolean } {
  try {
    const url = new URL(databaseUrl ?? '');
    const name = url.pathname.replace(/^\//, '');
    const isolated = ISOLATED.test(name) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return { label: `${url.hostname}:${url.port || '5432'}/${name}`, isolated };
  } catch {
    return { label: 'unknown database', isolated: false };
  }
}

async function main() {
  const env = describeEnvironment(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const summary = await coverageSummary(prisma as never, EMPLOYER_TARGETS);
    const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16) + 'Z' : 'never');
    console.log(`Environment: ${env.label} — ${env.isolated ? 'ISOLATED (disposable) inventory; not production' : 'NOT classified as isolated: treat as a production-like inventory'}`);
    console.log(`Registered employer targets: ${summary.registeredEmployerTargets} (with a collector: ${summary.employerTargetsWithAdapter})`);
    console.log(`Sources with open postings: ${summary.sourcesWithOpenPostings}; open postings: ${summary.openPostings} (proven listed by a verified-complete run: ${summary.openVerifiedInCompleteListing}; freshness unknown: ${summary.openFreshnessUnknown}); duplicate-linked, excluded: ${summary.duplicateLinked}; with explicit e-mail application: ${summary.openPostingsWithEmailApplication}\n`);
    console.log('source        open verified unknown  dup total closed expired  email | last run: discovered accepted rejected expired failed | completeness      last success       access review');
    for (const s of summary.sources) {
      const r = s.lastRun;
      console.log(`${s.key.padEnd(13)} ${String(s.counts.open).padStart(4)} ${String(s.counts.openVerifiedInCompleteListing).padStart(8)} ${String(s.counts.openFreshnessUnknown).padStart(7)} ${String(s.counts.duplicates).padStart(4)} ${String(s.counts.total).padStart(5)} ${String(s.counts.closed).padStart(6)} ${String(s.counts.expiredByDeadline).padStart(7)} ${String(s.counts.emailApplicable).padStart(6)} |           ${r ? `${String(r.discovered).padStart(10)} ${String(r.accepted).padStart(8)} ${String(r.rejected).padStart(8)} ${String(r.expired).padStart(7)} ${String(r.failed).padStart(6)}` : '       no run recorded       '} | ${s.completeness.padEnd(18)} ${when(s.lastSuccessAt).padEnd(18)} ${s.accessReview}${s.scheduled ? '' : ' (not scheduled)'}`);
    }
    console.log('\n' + summary.caveats.map((c) => `* ${c}`).join('\n'));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Coverage report failed.'); process.exitCode = 1; });
