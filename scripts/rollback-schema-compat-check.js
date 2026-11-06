// Rollback boundary at the data layer: can the PREVIOUS release's Prisma client (its own generated client, passed as OLD_CLIENT) still read and write a
// database that the NEW release has migrated? Run against a DISPOSABLE migrated copy only (scripts/rehearse-migration-upgrade.sh does that).
//   OLD_CLIENT=<previous checkout>/node_modules/@prisma/client DATABASE_URL=<disposable upgraded db> node scripts/rollback-schema-compat-check.js
// It performs what the previous release does to the tables the new release changed: reads every table it knows, creates and updates a source and a run
// without mentioning the new columns, ingests a posting, and checks that the new columns took their defaults.
const assert = require('node:assert/strict');
const { PrismaClient } = require(process.env.OLD_CLIENT);
(async () => {
  if (!/aise_rehearse_/.test(process.env.DATABASE_URL || '')) throw new Error('refusing: only a disposable aise_rehearse_* database');
  const db = new PrismaClient();
  const counts = {};
  // Models a previous release does not have (it predates their tables) are skipped; everything it does have is read.
  for (const m of ['user', 'resume', 'documentSnapshot', 'documentCharge', 'emailApplication', 'job', 'match', 'jobSource', 'jobImportRun', 'subscription', 'application', 'company', 'vacancy']) if (db[m]) counts[m] = await db[m].count();
  const hasSources = !!db.jobSource;
  if (hasSources) assert((await db.jobSource.findMany()).length >= 1, 'the old client reads every source row, including ones it did not create');
  for (const m of ['resume', 'emailApplication', 'documentSnapshot', 'match', 'subscription', 'application']) if (db[m]) await db[m].findMany({ take: 20 });
  const key = `rollback-${Date.now()}`;
  if (hasSources) {
    await db.jobSource.create({ data: { key, name: key, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'rollback check', applicationMethods: ['EXTERNAL_SITE'] } });
    await db.jobSource.update({ where: { key }, data: { consecutiveFailures: 1, nextRunAt: new Date(), leaseUntil: new Date() } });
  }
  await db.jobImportRun.create({ data: { source: key, status: 'SUCCEEDED', finishedAt: new Date(), listed: 1 } });
  const job = await db.job.create({ data: { externalId: `${key}:1`, title: 'Rollback check', company: 'Synthetic', description: 'x', location: 'Bakı', url: 'https://example.org/1', postedAt: new Date() } });
  await db.job.update({ where: { id: job.id }, data: { lastSeenAt: new Date() } });
  if (hasSources) {
    const [row] = await db.$queryRawUnsafe(`SELECT "cooldownCount", "cooldownUntil", "leaseOwner" FROM "JobSource" WHERE key = '${key}'`);
    assert.equal(Number(row.cooldownCount), 0, 'a row written by the old release takes the new column default');
    assert.equal(row.cooldownUntil, null); assert.equal(row.leaseOwner, null);
  }
  await db.job.delete({ where: { id: job.id } }); await db.jobImportRun.deleteMany({ where: { source: key } }); if (hasSources) await db.jobSource.delete({ where: { key } });
  console.log(JSON.stringify({ readTables: counts, oldReleaseWrites: 'ok' }));
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
