/**
 * Reads a migrated database through the INTEGRATED code (the same Prisma client and allowance ledger the API uses) and asserts invariants about what
 * must survive a schema upgrade: approved documents keep their approved-file hash, allowance usage equals reserved+committed charges, application snapshots
 * keep their evidence. Read-only. DATABASE_URL must point at a disposable copy. Run by scripts/rehearse-migration-upgrade.sh (READ_CHECK=...).
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { allowanceUsage } from '../../src/documents/allowance-ledger';
import { payloadHash, payloadPartsOf } from '../../src/email-applications/email-application-state';

async function main() {
  const db = new PrismaClient();
  const out: Record<string, unknown> = {};
  const resumes = await db.resume.groupBy({ by: ['docKind', 'status'], _count: true });
  out.documents = resumes.map((r) => `${r.docKind}/${r.status}=${r._count}`);
  const approved = await db.documentSnapshot.findMany({ where: { kind: 'APPROVED' } });
  assert(approved.every((s) => !!s.fileSha256 && !!s.contentHash), 'every APPROVED snapshot keeps its content hash and approved-file hash');
  out.approvedSnapshots = approved.length;
  out.snapshots = await db.documentSnapshot.count();
  const users = await db.documentCharge.findMany({ distinct: ['userId'], select: { userId: true } });
  let checked = 0;
  for (const { userId } of users) {
    const usage = await allowanceUsage(db as never, userId);
    const now = new Date();
    const charges = await db.documentCharge.findMany({ where: { userId, OR: [{ status: 'COMMITTED' }, { status: 'RESERVED', expiresAt: { gt: now } }] } });
    const period = usage.period.key;
    const expected = charges.filter((c) => c.periodKey === period).reduce((n, c) => n + c.units, 0);
    assert.equal(usage.committed + usage.reserved, expected, `allowance used for ${userId} equals reserved+committed units in ${period}`);
    (out.allowances ??= [] as string[]) ; (out.allowances as string[]).push(`${usage.period.key}: committed ${usage.committed}, reserved ${usage.reserved}`);
    checked++;
  }
  out.usersWithCharges = checked;
  const apps = await db.emailApplication.findMany();
  let hashes = 0;
  for (const a of apps) {
    assert(a.recipient && a.subject && a.body && a.bodySha256, 'application keeps recipient, subject, body and body hash');
    if (a.payloadSha256 && a.cvSha256) { assert.equal(payloadHash(payloadPartsOf(a as never, 'approved')), a.payloadSha256, `application ${a.id} payload hash still verifies`); hashes++; }
  }
  out.applications = apps.length; out.applicationPayloadHashesVerified = hashes;
  out.jobs = await db.job.count();
  console.log(JSON.stringify(out));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
