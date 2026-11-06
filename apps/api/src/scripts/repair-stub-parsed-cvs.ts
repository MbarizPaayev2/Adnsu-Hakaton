import { NestFactory } from '@nestjs/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/database.service';
import { extractCvText } from '../resumes/cv-extract';
import { parseCv } from '../resumes/cv-parser';
import { classify, STUB_SKILLS } from './stub-cv-detector';

/**
 * Repairs Resume rows whose parsedContent came from the old stub parser.
 *
 * Until commit 3387312 the "parser" ignored the uploaded file entirely and
 * wrote the same object for every user, so any profile built from it — and
 * every match scored against it — derives from data the candidate never
 * supplied.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 *   npm run script:repair-stub-cvs                # report only
 *   npm run script:repair-stub-cvs -- --apply     # perform the repair
 *   npm run script:repair-stub-cvs -- --apply --limit 50
 *
 * Deliberately out of scope: this never sends an application, never enqueues
 * a notification or job-alert email, and never re-runs matching. It repairs
 * stored CV data and reports what derived data is now stale, leaving
 * regeneration to a separate, explicitly-triggered step. A repair job that
 * silently emailed several hundred users would be worse than the bug.
 */

async function bootstrap() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeLikely = args.includes('--include-likely');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : undefined;
  const batchSize = 100;

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const uploadDir = path.join(process.cwd(), 'uploads');

  console.log('--- STUB-PARSED CV REPAIR ---');
  console.log(apply ? 'MODE: APPLY (writes)' : 'MODE: DRY RUN (no writes)');
  if (limit) console.log(`limit: ${limit}`);
  console.log('');

  const stats = {
    scanned: 0,
    certain: 0,
    likely: 0,
    reparsedOk: 0,
    fileMissing: 0,
    extractFailed: 0,
    profileEdited: 0,
    matchesStale: 0,
    failures: [] as { resumeId: string; reason: string }[],
  };

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.resume.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, fileUrl: true, parsedContent: true, isBase: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const resume of batch) {
      if (limit && stats.scanned >= limit) break;
      stats.scanned++;

      const { confidence, reasons } = classify(resume.parsedContent);
      if (confidence === 'no') continue;
      if (confidence === 'certain') stats.certain++;
      else stats.likely++;

      const repairable = confidence === 'certain' || includeLikely;
      const label = `${resume.id} (${confidence})`;

      // Reprocessing needs the original upload. Uploaded files were not on a
      // persistent volume before this was fixed, so on any host that has been
      // restarted since the upload the original is simply gone — that is the
      // expected case here, not an anomaly, and it cannot be repaired
      // automatically. Those rows are reported for a re-upload prompt.
      if (!resume.fileUrl) {
        stats.fileMissing++;
        console.log(`  ${label}: no fileUrl — needs re-upload`);
        continue;
      }

      const filePath = path.join(uploadDir, path.basename(resume.fileUrl));
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(filePath);
      } catch {
        stats.fileMissing++;
        console.log(`  ${label}: original file absent (${path.basename(resume.fileUrl)}) — needs re-upload`);
        continue;
      }

      // Mime is not stored, so infer it from the extension the uploader kept.
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : '';

      let reparsed: ReturnType<typeof parseCv>;
      try {
        const user = await prisma.user.findUnique({
          where: { id: resume.userId },
          select: { name: true, email: true },
        });
        const text = await extractCvText(buffer, mime);
        reparsed = parseCv(text, { name: user?.name ?? undefined, email: user?.email ?? undefined });
      } catch (error) {
        stats.extractFailed++;
        const reason = error instanceof Error ? error.message : String(error);
        stats.failures.push({ resumeId: resume.id, reason });
        console.log(`  ${label}: extraction failed (${reason}) — left unchanged`);
        continue;
      }

      if (reparsed.extracted.length === 0) {
        stats.extractFailed++;
        console.log(`  ${label}: nothing extractable (likely a scanned PDF) — left unchanged`);
        continue;
      }

      console.log(
        `  ${label}: reparsed → ${reparsed.skills.length} skill(s), ` +
          `${reparsed.workExperience.length} role(s)  [${reasons.join('; ')}]`,
      );
      stats.reparsedOk++;

      // Any Match scored against the stub content is now stale. Counted and
      // reported; NOT rescored here, because rescoring creates notifications
      // and consumes quota.
      const matchCount = await prisma.match.count({ where: { userId: resume.userId } });
      stats.matchesStale += matchCount;

      if (!apply || !repairable) continue;

      // Only the Resume row is rewritten. The Profile is left alone on
      // purpose: the user may have corrected it by hand during onboarding,
      // and overwriting that would replace real answers with machine output.
      // Reported instead so a human can decide.
      const profile = await prisma.profile.findUnique({
        where: { userId: resume.userId },
        select: { skills: true },
      });
      const profileLooksEdited =
        profile != null &&
        !(
          Array.isArray(profile.skills) &&
          profile.skills.length === STUB_SKILLS.length &&
          STUB_SKILLS.every((s, i) => (profile.skills as string[])[i] === s)
        );
      if (profileLooksEdited) stats.profileEdited++;

      await prisma.resume.update({
        where: { id: resume.id },
        // Idempotent: a repaired row gains an `extracted` field and stops
        // matching the detector, so re-running skips it.
        data: { parsedContent: reparsed as any },
      });
    }
    if (limit && stats.scanned >= limit) break;
  }

  console.log('');
  console.log('--- SUMMARY ---');
  console.log(`resumes scanned              : ${stats.scanned}`);
  console.log(`stub-parsed (certain)        : ${stats.certain}`);
  console.log(`stub-shaped (likely)         : ${stats.likely}  ${includeLikely ? '(included)' : '(reported only; pass --include-likely to repair)'}`);
  console.log(`reparsed successfully        : ${stats.reparsedOk}`);
  console.log(`original file missing        : ${stats.fileMissing}  → user must re-upload`);
  console.log(`extraction failed/empty      : ${stats.extractFailed}  → left unchanged, never invented`);
  console.log(`profiles that look user-edited: ${stats.profileEdited}  → not overwritten`);
  console.log(`matches derived from stub data: ${stats.matchesStale}  → stale, NOT rescored by this script`);
  if (stats.failures.length) {
    console.log('');
    console.log('failures:');
    for (const f of stats.failures.slice(0, 20)) console.log(`  ${f.resumeId}: ${f.reason}`);
  }
  console.log('');
  console.log(
    apply
      ? 'Repair applied to Resume rows only. Profiles and Matches were not modified.'
      : 'Dry run: nothing was written. Re-run with --apply to perform the repair.',
  );

  await app.close();
}

bootstrap();
