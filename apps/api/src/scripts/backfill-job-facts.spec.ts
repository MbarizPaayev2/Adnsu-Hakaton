import { Prisma } from '@prisma/client';
import { backfillJobFacts } from './backfill-job-facts';

const row = {
  id: 'job-1',
  title: 'Kassir', description: 'Mövzu yerində “Satıcı - Kassir” yazmaqla öz CV-lərini hr@acme.az ünvanına göndərə bilər.',
  rawPayload: null, workArrangement: null, experienceLevel: null,
  applicationMethod: 'EMAIL', applicationEmail: 'hr@acme.az',
  applicationEmailEvidence: { excerpt: 'CV-lərini hr@acme.az ünvanına göndərə bilər.', extractedFrom: 'description', extractorVersion: 3, reference: 'REF-12' },
};

function database(rows: any[], count = 1) {
  return { job: {
    findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count }),
  } };
}

describe('subject-only fact repair', () => {
  it('previews without writing; apply preserves reference and only changes email evidence', async () => {
    const preview = database([row]);
    expect(await backfillJobFacts(preview as any, { apply: false, subjectsOnly: true })).toMatchObject({ changed: 1 });
    expect(preview.job.updateMany).not.toHaveBeenCalled();
    const db = database([row]);
    await backfillJobFacts(db as any, { apply: true, subjectsOnly: true });
    expect(db.job.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, title: row.title, description: row.description, rawPayload: { equals: Prisma.DbNull }, applicationEmail: row.applicationEmail, applicationEmailEvidence: { equals: row.applicationEmailEvidence } },
      data: { applicationEmailEvidence: { ...row.applicationEmailEvidence, subjectLine: 'Satıcı - Kassir', extractorVersion: 4 } },
    });
  });

  it('leaves existing subjects and changed recipients alone, so repeating the repair is harmless', async () => {
    const db = database([
      { ...row, applicationEmailEvidence: { ...row.applicationEmailEvidence, subjectLine: 'Satıcı - Kassir' } },
      { ...row, id: 'job-2', applicationEmail: 'old@acme.az' },
    ]);
    expect(await backfillJobFacts(db as any, { apply: true, subjectsOnly: true })).toMatchObject({ changed: 0 });
    expect(db.job.updateMany).not.toHaveBeenCalled();
  });

  it('reports a concurrent change instead of overwriting it', async () => {
    const db = database([row], 0);
    expect(await backfillJobFacts(db as any, { apply: true, subjectsOnly: true })).toMatchObject({ changed: 1, skippedConcurrent: 1 });
  });
});
