import { ResumesService } from './resumes.service';
import { recordSnapshot } from '../documents/snapshots';

jest.mock('../documents/snapshots', () => ({
  recordSnapshot: jest.fn(),
  sha256Hex: jest.fn().mockReturnValue('dummy-sha256'),
}));

describe('approveTailoredResume non-blocking language acknowledgement', () => {
  const contentWithUntranslated = {
    language: 'az',
    basics: { name: 'Aysel', headline: 'Financial Analyst' },
    summary: 'Summary in English.',
    experience: [{ position: 'Analyst', highlights: ['Led the financial audit.'] }],
  };

  const cleanContent = {
    language: 'az',
    basics: { name: 'Aysel', headline: 'Maliyyə analitiki' },
    summary: 'Maliyyə sahəsində peşəkar təcrübəyə malikdir.',
    experience: [{ position: 'Analitik', highlights: ['Maliyyə auditinə rəhbərlik etdim.'] }],
  };

  function setup(opts: {
    status?: string;
    content?: any;
    revision?: number;
    updateCount?: number;
  } = {}) {
    const status = opts.status ?? 'NEEDS_REVIEW';
    const content = opts.content ?? contentWithUntranslated;
    const revision = opts.revision ?? 2;
    const updateCount = opts.updateCount ?? 1;

    const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
    const tx = { resume: { updateMany } };
    const prisma: any = {
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const storageService: any = {
      uploadBuffer: jest.fn().mockResolvedValue('https://storage.example.com/cv.pdf'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const tailorService: any = {
      compileDocumentPdf: jest.fn().mockReturnValue(Buffer.from('%PDF-1.4')),
      layoutFor: jest.fn().mockReturnValue({ pages: 1, expectedMaxPages: 1, status: 'OK' }),
    };

    const svc = new ResumesService(prisma, storageService, tailorService, {} as any);
    const mockResume = {
      id: 'res-1',
      userId: 'user-1',
      status,
      language: 'az',
      docKind: 'CV',
      parsedContent: content,
      reviewNotes: { revision, issues: [] },
      provenance: {},
      fileUrl: null,
      createdAt: new Date(),
    };

    jest.spyOn(svc as any, 'ownedTailored').mockResolvedValue(mockResume);
    jest.spyOn(svc, 'getTailoredResume').mockImplementation(async (uid, id) => {
      return {
        id,
        status: 'READY',
        untranslated: (svc as any).untranslatedOf(mockResume),
        reviewNotes: mockResume.reviewNotes,
      } as any;
    });

    return { svc, prisma, storageService, tailorService, updateMany, mockResume };
  }

  it('rejects approval when untranslated items exist and acknowledgeUntranslated is not set', async () => {
    const { svc } = setup({ content: contentWithUntranslated });
    await expect(svc.approveTailoredResume('user-1', 'res-1')).rejects.toThrow(/NOT_TRANSLATED/);
  });

  it('rejects approval if reviewedRevision does not match current draft revision', async () => {
    const { svc } = setup({ content: contentWithUntranslated, revision: 3 });
    await expect(
      svc.approveTailoredResume('user-1', 'res-1', {
        acknowledgeUntranslated: true,
        reviewedRevision: 2,
      }),
    ).rejects.toThrow(/Sənəd dəyişdirildi/);
  });

  it('rejects approval if reviewedRevision is undefined when acknowledging untranslated items', async () => {
    const { svc } = setup({ content: contentWithUntranslated, revision: 3 });
    await expect(
      svc.approveTailoredResume('user-1', 'res-1', {
        acknowledgeUntranslated: true,
      }),
    ).rejects.toThrow(/Sənəd dəyişdirildi/);
  });

  it('approves document with acknowledged untranslated items and records flag in reviewNotes', async () => {
    const { svc, updateMany, storageService } = setup({
      content: contentWithUntranslated,
      revision: 2,
    });

    const result = await svc.approveTailoredResume('user-1', 'res-1', {
      acknowledgeUntranslated: true,
      reviewedRevision: 2,
    });

    expect(storageService.uploadBuffer).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-1', userId: 'user-1', status: 'NEEDS_REVIEW', reviewNotes: { path: ['revision'], equals: 2 } },
        data: expect.objectContaining({
          status: 'READY',
          fileUrl: 'https://storage.example.com/cv.pdf',
          reviewNotes: expect.objectContaining({
            revision: 2,
            untranslatedAcknowledged: true,
            acknowledgedUntranslatedCount: expect.any(Number),
          }),
        }),
      }),
    );
    expect(recordSnapshot).toHaveBeenCalledWith(expect.anything(), 'res-1', 2, 'APPROVED', contentWithUntranslated, {}, 'dummy-sha256');
    expect(result.status).toBe('READY');
  });

  it('approves normally without acknowledgement when document is fully translated', async () => {
    const { svc, updateMany } = setup({ content: cleanContent, revision: 1 });

    const result = await svc.approveTailoredResume('user-1', 'res-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'READY',
          reviewNotes: expect.objectContaining({ revision: 1 }),
        }),
      }),
    );
    expect(result.status).toBe('READY');
  });

  it('returns untranslated fields even when document status is READY', async () => {
    const { svc, mockResume } = setup({ content: contentWithUntranslated });
    mockResume.status = 'READY';
    const result = await svc.getTailoredResume('user-1', 'res-1');
    expect(result.untranslated.length).toBeGreaterThan(0);
  });

  it('rejects when a concurrent approval already consumed the NEEDS_REVIEW row (updateMany count = 0)', async () => {
    const { svc } = setup({ content: cleanContent, revision: 1, updateCount: 0 });
    await expect(svc.approveTailoredResume('user-1', 'res-1')).rejects.toThrow(/CONFLICT|dəyişdirildi|tapılmadı/i);
  });

  it('rejects approval with stale reviewedRevision when document was edited since candidate read it', async () => {
    const { svc } = setup({ content: contentWithUntranslated, revision: 4 });
    await expect(
      svc.approveTailoredResume('user-1', 'res-1', {
        acknowledgeUntranslated: true,
        reviewedRevision: 3,
      }),
    ).rejects.toThrow(/Sənəd dəyişdirildi/);
  });

  it('snapshot records untranslatedAcknowledged when approving with outstanding untranslated items', async () => {
    const { svc, updateMany } = setup({ content: contentWithUntranslated, revision: 2 });
    await svc.approveTailoredResume('user-1', 'res-1', {
      acknowledgeUntranslated: true,
      reviewedRevision: 2,
    });
    const data = updateMany.mock.calls[0][0].data;
    expect(data.reviewNotes).toMatchObject({
      untranslatedAcknowledged: true,
      acknowledgedUntranslatedCount: expect.any(Number),
    });
  });
});
