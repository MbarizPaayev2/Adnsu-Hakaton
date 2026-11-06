/**
 * Local staging server for the vacancy census: the real API (auth, jobs, matching with a fixture scorer, native and
 * e-mail applications) on loopback against the isolated `aise_census` database and an isolated queue prefix.
 * Nothing here is production. Run from apps/api: ts-node --transpile-only test/census-server.ts
 */
import { randomBytes } from 'node:crypto';

async function main() {
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census?schema=public';
  process.env.SCRAPER_SERVICE_TOKEN ||= randomBytes(24).toString('hex');
  const fs = require('node:fs');
  fs.writeFileSync('/tmp/census-token', process.env.SCRAPER_SERVICE_TOKEN, { mode: 0o600 });
  Object.assign(process.env, { EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', EMAIL_APPLY_SINK_URL: 'http://127.0.0.1:4599', EMAIL_APPLY_FROM: 'AISE Applications <applications@aise.example>', EMAIL_APPLY_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64')}`, EMAIL_APPLY_AUTOMATION_ENABLED: 'false' });
  const { startPhase2App } = require('./support/phase2-local-app') as typeof import('./support/phase2-local-app');
  // REAL scorer when AISE_REAL_SCORER_URL is set (and MATCHING_SERVICE_TOKEN): no fixture scores exist in that mode.
  const env = await startPhase2App({ native: true, ...(process.env.AISE_REAL_SCORER_URL ? { scorerUrl: process.env.AISE_REAL_SCORER_URL } : {}) });
  await env.app.listen(4010, '127.0.0.1');
  console.log('CENSUS_SERVER_READY');
  process.on('SIGTERM', async () => { await env.close(); process.exit(0); });
}
main().catch((e) => { console.error('CENSUS_SERVER_FAILED', e.message); process.exit(1); });
