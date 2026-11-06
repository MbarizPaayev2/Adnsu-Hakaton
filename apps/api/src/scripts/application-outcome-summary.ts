/**
 * Prints counts of applications with interview evidence, by who supplied the evidence (candidate-confirmed vs employer-confirmed, never added
 * together). Read-only; no personal data; counts, not rates. Whatever the database it is run against is the data it reports on.
 */
import { PrismaClient } from '@prisma/client';
import { OutcomeStatsService } from '../application-timeline/outcome-stats.service';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await new OutcomeStatsService(prisma as never).summary(), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
