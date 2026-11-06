/**
 * Local probe (isolated aise_census database, rules-mode scorer at AISE_REAL_SCORER_URL): fires several simultaneous
 * scoring passes for ONE profile through the real MatchingService and counts how many full passes reached the scorer, using the
 * scorer's own /cache-stats (every posting scored is one cache lookup). Single flight means N simultaneous requests share one pass.
 * Run from apps/api: PROBE_EMAIL=... AISE_REAL_SCORER_URL=http://127.0.0.1:8101 MATCHING_SERVICE_TOKEN=... ts-node --transpile-only test/rules-concurrency-probe.ts
 */
import { readFileSync } from 'node:fs';

async function stats(url: string, token: string) {
  const r: any = await (await fetch(`${url}/cache-stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return r.rulesCache.hits + r.rulesCache.misses;
}

async function main() {
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census?schema=public';
  const url = process.env.AISE_REAL_SCORER_URL!;
  const token = process.env.MATCHING_SERVICE_TOKEN || readFileSync('/tmp/scorer-token', 'utf8').trim();
  const { startPhase2App } = require('./support/phase2-local-app') as typeof import('./support/phase2-local-app');
  const { MatchingService } = require('../src/matching/matching.service') as typeof import('../src/matching/matching.service');
  const { PrismaService } = require('../src/database/database.service') as typeof import('../src/database/database.service');
  const env = await startPhase2App({ native: true, scorerUrl: url });
  try {
    const prisma = env.app.get(PrismaService);
    const user = await prisma.user.findFirstOrThrow({ where: process.env.PROBE_EMAIL ? { email: process.env.PROBE_EMAIL } : { email: { startsWith: 'census-' } }, orderBy: { createdAt: 'desc' } });
    const matching = env.app.get(MatchingService);
    const eligible = await prisma.job.count({ where: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, OR: [{ deadline: null }, { deadline: { gte: new Date() } }] } });
    const before = await stats(url, token);
    const t0 = Date.now();
    const results = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(() => matching.runMatchingForProfile(user.id)));
    const ms = Date.now() - t0;
    const lookups = (await stats(url, token)) - before;
    const matches = await prisma.match.count({ where: { userId: user.id } });
    console.log(`SIMULTANEOUS_REQUESTS 6, settled ${results.filter((r) => r.status === 'fulfilled').length} fulfilled / ${results.filter((r) => r.status === 'rejected').length} rejected, ${ms} ms`);
    console.log(`SCORER_LOOKUPS ${lookups} for ${eligible} eligible postings = ${(lookups / eligible).toFixed(2)} full pass(es)`);
    console.log(`MATCHES_AFTER ${matches} (free plan allowance 3)`);
    // A later request starts its own pass.
    const before2 = await stats(url, token);
    await matching.runMatchingForProfile(user.id);
    console.log(`NEXT_REQUEST_LOOKUPS ${(await stats(url, token)) - before2} = ${(((await stats(url, token)) - before2) / eligible).toFixed(2)} pass(es)`);
  } finally {
    await env.close();
  }
}
main().catch((e) => { console.error('PROBE_FAILED', e.message); process.exit(1); });
