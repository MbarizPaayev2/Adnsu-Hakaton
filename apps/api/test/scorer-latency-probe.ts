/**
 * Local probe: times representative /score-profile chunks against a scorer using a stored census profile and
 * eligible census jobs. Read-only against aise_census; prints timings only (no tokens, no personal data).
 * Run from apps/api: SCORER_URL=http://127.0.0.1:8100 npx ts-node --transpile-only -r tsconfig-paths/register test/scorer-latency-probe.ts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildJobPayload, buildPersonaFromProfile } from '../src/matching/job-matching.service';
import { actionableJobWhere } from '../src/jobs/jobs.service';

const URL_ = process.env.SCORER_URL || 'http://127.0.0.1:8100';
const TOKEN = process.env.MATCHING_SERVICE_TOKEN || readFileSync('/tmp/scorer-token', 'utf8').trim();
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census?schema=public' } } });

async function post(persona: unknown, jobs: unknown[], abortMs?: number) {
  const ctrl = new AbortController();
  const timer = abortMs ? setTimeout(() => ctrl.abort(), abortMs) : undefined;
  const t0 = performance.now();
  try {
    const res = await fetch(`${URL_}/score-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ persona, jobs }), signal: ctrl.signal });
    const body: any = await res.json();
    return { ms: Math.round(performance.now() - t0), status: res.status, n: body.results?.length };
  } catch (e: any) {
    return { ms: Math.round(performance.now() - t0), status: e.name, n: 0 };
  } finally { if (timer) clearTimeout(timer); }
}

async function main() {
  const profile: any = await prisma.profile.findFirstOrThrow({ where: { onboardingCompletedAt: { not: null }, ...(process.env.PROBE_EMAIL ? { user: { email: process.env.PROBE_EMAIL } } : {}) }, orderBy: { updatedAt: 'desc' }, include: { user: { include: { resumes: { where: { isBase: true }, select: { parsedContent: true } } } }, experiences: true, education: true } });
  const persona = buildPersonaFromProfile({ ...profile, resumes: profile.user.resumes } as any);
  const jobs = await prisma.job.findMany({ where: actionableJobWhere(), orderBy: { id: 'asc' } });
  const payloads = jobs.map((j) => ({ ...buildJobPayload(j as any), clientId: `job:${j.id}` }));
  console.log(`eligible jobs ${jobs.length}`);
  const mode = process.argv[2] || 'timings';
  if (mode === 'timings') {
    const sizes = [10, 100, 100, 100, 200];
    let off = 0;
    for (const [i, size] of sizes.entries()) {
      const r = await post(persona, payloads.slice(off, off + size));
      console.log(`${i === 0 ? 'cold ' : 'warm '}chunk of ${size}: ${r.ms} ms (status ${r.status}, ${r.n} results)`);
      off += size;
    }
  } else if (mode === 'fullpass') {
    // The whole eligible inventory in the API's chunks of 25, twice: the second pass shows what a scorer-side cache buys.
    for (const label of ['first pass', 'second pass']) {
      const t0 = performance.now();
      const per: number[] = [];
      let scored = 0;
      for (let i = 0; i < payloads.length; i += 25) {
        const r = await post(persona, payloads.slice(i, i + 25));
        per.push(r.ms);
        scored += r.n;
      }
      per.sort((a, b) => a - b);
      console.log(`${label}: ${scored}/${payloads.length} postings in ${Math.round(performance.now() - t0)} ms; per 25-posting request median ${per[Math.floor(per.length / 2)]} ms, p95 ${per[Math.floor(per.length * 0.95)]} ms, max ${per[per.length - 1]} ms`);
    }
  } else if (mode === 'verify') {
    // Free-plan selection check: score every eligible job (embeddings are cached after the journey, so this is fast)
    // and compare the best three against the persisted matches.
    const scored: { id: string; score: number }[] = [];
    for (let i = 0; i < payloads.length; i += 25) {
      const t0 = performance.now();
      const res = await fetch(`${URL_}/score-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ persona, jobs: payloads.slice(i, i + 25) }) });
      const body: any = await res.json();
      for (const r of body.results) scored.push({ id: String(r.jobId).slice(4), score: r.score });
      if (i === 0) console.log(`first verify chunk ${Math.round(performance.now() - t0)} ms`);
    }
    const best = scored.sort((a, b) => b.score - a.score).slice(0, 3);
    const stored = await prisma.match.findMany({ where: { userId: profile.userId }, orderBy: { score: 'desc' } });
    console.log(`scored ${scored.length}/${jobs.length}; best three ${best.map((b) => b.score).join(', ')}; persisted ${stored.map((m) => Number(m.score)).join(', ')}`);
    // Scores can tie (the rules mode produces many equal scores), so "the best three" is judged by score, not by which of several equal
    // postings was kept: the persisted scores must equal the top-3 score multiset, and each persisted match must carry the score the whole
    // inventory re-scoring gives that posting.
    const byId = new Map(scored.map((r) => [r.id, r.score]));
    const same = best.length === stored.length
      && best.every((b, i) => Math.abs(Number(stored[i].score) - b.score) < 1e-9)
      && stored.every((m) => byId.has(m.jobId ?? '') && Math.abs(byId.get(m.jobId ?? '')! - Number(m.score)) < 1e-9);
    const tied = scored.filter((r) => r.score >= best[best.length - 1].score).length;
    console.log(same ? `FREE_PLAN_SELECTION_OK: persisted scores are exactly the best three eligible scores (${tied} postings at or above the third-best score)` : 'FREE_PLAN_SELECTION_MISMATCH');
    if (!same) process.exitCode = 2;
  } else if (mode === 'dumpall') {
    // Whole eligible inventory + the candidate's persona, for offline scorer benchmarks (no secrets, no contact data).
    require('node:fs').writeFileSync(process.argv[3], JSON.stringify({ persona, jobs: payloads }));
  } else if (mode === 'dump') {
    require('node:fs').writeFileSync(process.argv[3], JSON.stringify({ persona, jobs: payloads.slice(10, 110) }));
  } else if (mode === 'abandon') {
    // Does a client-aborted request keep consuming worker capacity? Abort a 100-job chunk after 200 ms, then time a tiny request.
    const base = await post(persona, payloads.slice(0, 10));
    const aborted = await post(persona, payloads.slice(300, 400), 200);
    const after = await post(persona, payloads.slice(0, 10));
    console.log(`baseline 10-job request ${base.ms} ms; abandoned request ${aborted.status} after ${aborted.ms} ms; 10-job request issued right after the abort ${after.ms} ms`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
