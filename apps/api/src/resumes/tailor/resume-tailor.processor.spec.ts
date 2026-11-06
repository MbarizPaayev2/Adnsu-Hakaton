import { ResumeTailorProcessor } from './resume-tailor.processor';
import { TailorError } from './resume-tailor.service';

describe('ResumeTailorProcessor', () => {
  const activeJob = { status: 'ACTIVE', deadline: null, title: 'Backend', company: 'Co', externalId: 'glorri:x' };
  let prisma: any;
  let tailor: any;
  let processor: ResumeTailorProcessor;
  let allowance: any;
  const row = (status: string, job: any = activeJob) => ({ id: 'r1', userId: 'u1', status, docKind: 'CV', language: null, letterInputs: null, provenance: null, user: { name: 'Leyla', email: 'l@example.com' }, match: { job, vacancy: null } });

  beforeEach(() => {
    prisma = {
      resume: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      profile: { findUnique: jest.fn().mockResolvedValue({ headline: 'Backend', experiences: [], education: [], skills: ['NestJS'] }) },
    };
    tailor = {
      buildPersonaFromProfile: jest.fn().mockReturnValue({ basics: { headline: 'Backend' }, experience: [], skills: [{ keywords: ['NestJS'] }] }),
      buildJobInput: jest.fn().mockReturnValue({ position: 'Backend', company: 'Co', location: '', description: 'd', requirements: '', responsibilities: '' }),
      generate: jest.fn(),
      compileDocumentPdf: jest.fn(),
    };
    allowance = { commit: jest.fn().mockResolvedValue(undefined), refund: jest.fn().mockResolvedValue(true) };
    processor = new ResumeTailorProcessor(prisma, tailor, undefined, allowance);
    jest.spyOn((processor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((processor as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it.each(['NEEDS_REVIEW', 'READY', 'FAILED'])('does nothing for a %s row (re-delivered job)', async (status) => {
    prisma.resume.findUnique.mockResolvedValue(row(status));
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(tailor.generate).not.toHaveBeenCalled();
    expect(prisma.resume.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', { ...activeJob, status: 'CLOSED' }],
    ['past its deadline', { ...activeJob, deadline: new Date(0) }],
  ])('fails without calling the provider when the job became %s after the request', async (_label, job) => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING', job));
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(tailor.generate).not.toHaveBeenCalled();
    expect(prisma.resume.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'FAILED', statusError: expect.stringContaining('(JOB_NOT_ACTIONABLE)') }),
    });
    // The reserved unit goes back with the failure.
    expect(allowance.refund).toHaveBeenCalledWith(prisma, 'r1', 'system:job_not_actionable');
    expect(allowance.commit).not.toHaveBeenCalled();
  });

  it('stores a draft for review, never READY, and only while still PENDING', async () => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING'));
    tailor.generate.mockResolvedValue({ content: { c: 1 }, issues: [], meta: { calls: 1, latencyMs: 5 } });
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(prisma.resume.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'NEEDS_REVIEW', reviewNotes: { issues: [], revision: 0 } }),
    });
    // Counted exactly when the draft exists, with its GENERATED snapshot, in the same transaction.
    expect(allowance.commit).toHaveBeenCalledWith(prisma, 'r1');
    expect(prisma.documentSnapshot.createMany.mock.calls[0][0].data[0]).toMatchObject({ resumeId: 'r1', revision: 0, kind: 'GENERATED' });
    expect(allowance.refund).not.toHaveBeenCalled();
  });

  it('uses a candidate-pasted vacancy snapshot without requiring or creating a public Match', async () => {
    const pasted = {
      title: 'Junior Analyst', company: null, location: null,
      originalText: 'Junior Analyst\n' + 'Analyze business data and prepare accurate reports. '.repeat(2),
      description: 'Junior Analyst\n' + 'Analyze business data and prepare accurate reports. '.repeat(2),
      requirements: '', responsibilities: '', deadline: null, sourceUrl: null,
    };
    prisma.resume.findUnique.mockResolvedValue({ ...row('PENDING'), match: null, privateVacancy: pasted });
    tailor.generate.mockResolvedValue({ content: { c: 1 }, issues: [], meta: { calls: 0, latencyMs: 0 } });
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(tailor.generate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      position: 'Junior Analyst', company: '', location: '', description: pasted.description, requirements: '', responsibilities: '',
    }), expect.anything());
    expect(prisma.resume.updateMany.mock.calls[0][0].data.provenance.job.source).toBe('candidate-paste');
    expect(allowance.commit).toHaveBeenCalledWith(prisma, 'r1');
  });

  it('does not count a draft that lost its PENDING row to a concurrent change', async () => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING'));
    tailor.generate.mockResolvedValue({ content: { c: 1 }, issues: [], meta: { calls: 1, latencyMs: 5 } });
    prisma.resume.updateMany.mockResolvedValue({ count: 0 });
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(allowance.commit).not.toHaveBeenCalled();
    expect(prisma.documentSnapshot.createMany).not.toHaveBeenCalled();
  });

  it('fails a draft that cannot be rendered instead of storing it', async () => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING'));
    tailor.generate.mockResolvedValue({ content: {}, issues: [], meta: { calls: 1 } });
    tailor.compileDocumentPdf.mockImplementation(() => { throw new TailorError('PDF_FAILED'); });
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(prisma.resume.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.resume.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', statusError: expect.stringContaining('(PDF_FAILED)') });
    expect(allowance.refund).toHaveBeenCalledWith(prisma, 'r1', 'system:pdf_failed');
  });

  it.each([['LANGUAGE_QUALITY', 'system:language_quality'], ['NOT_RELEVANT', 'system:not_relevant']])('a generation rejected for %s stores no document, commits nothing and refunds the reserved unit', async (code, reason) => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING'));
    tailor.generate.mockRejectedValue(new TailorError(code as any, { calls: 3, outcomes: ['rejected-language', 'rejected-language', 'rejected-language'] }));
    await processor.process({ data: { resumeId: 'r1' } } as any);
    expect(prisma.resume.updateMany).toHaveBeenCalledTimes(1);
    const data = prisma.resume.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'FAILED', statusError: expect.stringContaining(`(${code})`) });
    expect(data.parsedContent).toBeUndefined();
    expect(allowance.commit).not.toHaveBeenCalled();
    expect(prisma.documentSnapshot.createMany).not.toHaveBeenCalled();
    expect(allowance.refund).toHaveBeenCalledWith(prisma, 'r1', reason);
  });

  it('records an unexpected error by class only', async () => {
    prisma.resume.findUnique.mockResolvedValue(row('PENDING'));
    tailor.generate.mockRejectedValue(new RangeError('contains Leyla CV text'));
    await processor.process({ data: { resumeId: 'r1' } } as any);
    const data = prisma.resume.updateMany.mock.calls[0][0].data;
    expect(data.statusError).toContain('(INTERNAL)');
    expect(JSON.stringify(data)).not.toContain('Leyla');
    expect((processor as any).logger.warn).toHaveBeenCalledWith('resume-tailor r1: FAILED RangeError');
  });
});

import { generationPath, wasWriterTried } from './resume-tailor.processor';
describe('generation telemetry', () => {
  it('records a verified writer letter as writer and a refused draft as composed (never as writer output)', () => {
    expect(generationPath(['ok', 'writer:judge:faithful', 'writer:m:accepted', 'written'])).toBe('writer');
    expect(generationPath(['writer:m:gates:unknown_word', 'writer:fallback', 'composed'])).toBe('composed');
    expect(wasWriterTried(['writer:m:gates:unknown_word', 'writer:fallback', 'composed'])).toBe(true);
    expect(generationPath(['ok', 'composed'])).toBe('composed');
    expect(wasWriterTried(['ok', 'composed'])).toBe(false);
  });
  it('a CV counts as writer output only when at least one rewording was verified and used', () => {
    expect(generationPath(['ok', 'composed', 'polish:2/5'])).toBe('writer');
    expect(generationPath(['ok', 'composed', 'polish:0/5', 'polish-rejected:1'])).toBe('composed');
    expect(wasWriterTried(['ok', 'composed', 'polish:0/5'])).toBe(true);
  });
});


it('worker uses the persisted career selection when building the generation persona', async () => {
  const selected = { id: 'award', userId: 'u', kind: 'AWARD', status: 'CONFIRMED', title: 'Community prize', datePrecision: 'YEAR' };
  const other = { ...selected, id: 'other', kind: 'PROJECT', title: 'Other project' };
  const resume: any = { id: 'r', userId: 'u', status: 'PENDING', docKind: 'CV', provenance: { selectedCareerEntryIds: ['award'] }, user: {}, match: { job: { status: 'ACTIVE' } } };
  const prisma: any = { resume: { findUnique: jest.fn().mockResolvedValue(resume), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, profile: { findUnique: jest.fn().mockResolvedValue({ experiences: [] }) }, documentSnapshot: { createMany: jest.fn() } };
  prisma.$transaction = jest.fn(async (f) => typeof f === 'function' ? f(prisma) : []);
  const tailor: any = { buildJobInput: jest.fn().mockReturnValue({ position: 'SQL analyst', description: '', requirements: '', responsibilities: '' }), buildPersonaFromProfile: jest.fn().mockReturnValue({ basics: { headline: 'Analyst' }, experience: [], skills: [] }), generate: jest.fn().mockResolvedValue({ content: {}, issues: [], meta: {} }), compileDocumentPdf: jest.fn() };
  const processor = new ResumeTailorProcessor(prisma, tailor, { confirmedFor: jest.fn().mockResolvedValue([selected, other]) } as any);
  await processor.process({ data: { resumeId: 'r' } } as any);
  const sections = tailor.buildPersonaFromProfile.mock.calls[0][2];
  expect(sections.awards.map((e) => e.entryId)).toEqual(['award']);
  expect(sections.projects).toEqual([]);
});
