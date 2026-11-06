import { DocumentsService } from './documents.service';

describe('document evidence selection at generation boundary', () => {
  function setup(ownedCount = 1) {
    const prisma: any = {
      match: { findFirst: jest.fn().mockResolvedValue({ job: { status: 'ACTIVE', deadline: null, hiddenAt: null, duplicateOfId: null, title: 'Analyst', description: 'SQL', location: 'Baku' } }) },
      profile: { findUnique: jest.fn().mockResolvedValue({ headline: 'Analyst', experiences: [], skills: ['SQL'] }) },
      careerEntry: { count: jest.fn().mockResolvedValue(ownedCount) },
      resume: { updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, id: 'draft' })) },
      $queryRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (f) => f(prisma));
    const queue = { add: jest.fn() };
    const allowance: any = { sweep: jest.fn(), lock: jest.fn(), reserve: jest.fn() };
    const service = new DocumentsService(prisma, queue as any, allowance, { buildJobInput: (job: any) => ({ position: job.title, description: job.description }) } as any);
    return { prisma, queue, service };
  }
  const request: any = { matchId: 'match', items: [{ kind: 'CV', language: 'az' }], expectedUnits: 1, selectedCareerEntryIds: ['award'] };

  it('stores candidate choices on the queued document rather than silently applying default selection', async () => {
    const { service, prisma, queue } = setup();
    await service.generate('user', request);
    expect(prisma.careerEntry.count).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: 'user', status: 'CONFIRMED', id: { in: ['award'] } }) });
    expect(prisma.resume.create).toHaveBeenCalledWith({ data: expect.objectContaining({ provenance: expect.objectContaining({ selectedCareerEntryIds: ['award'] }) }) });
    expect(queue.add).toHaveBeenCalled();
  });

  it('refuses foreign, hidden or unconfirmed ids before reserving allowance or queuing', async () => {
    const { service, prisma, queue } = setup(0);
    await expect(service.generate('user', request)).rejects.toThrow('təsdiqlənmiş');
    expect(prisma.resume.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('distinguishes an intentionally empty choice from automatic selection', async () => {
    const { service, prisma } = setup(0);
    await service.generate('user', { ...request, selectedCareerEntryIds: [] });
    expect(prisma.resume.create.mock.calls[0][0].data.provenance.selectedCareerEntryIds).toEqual([]);
  });

  it('queues a candidate-pasted vacancy privately without creating a catalogue match', async () => {
    const { service, prisma, queue } = setup();
    const privateVacancy = {
      title: 'Junior BI Analyst', company: null, location: null,
      originalText: 'Junior BI Analyst\nWe are looking for an analyst with Power BI and SQL experience. '.repeat(2),
      description: 'Junior BI Analyst\nWe are looking for an analyst with Power BI and SQL experience.',
      sourceUrl: null, deadline: null,
    };
    await service.generate('user', { privateVacancy, items: [{ kind: 'CV', language: 'az' }], expectedUnits: 1 });
    const row = prisma.resume.create.mock.calls[0][0].data;
    expect(row.matchId).toBeNull();
    expect(row.privateVacancy).toMatchObject({ title: 'Junior BI Analyst', company: null, location: null, originalText: privateVacancy.originalText });
    expect(prisma.match.findFirst).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('tailor-resume', { resumeId: 'draft' }, expect.any(Object));
  });

  it('rejects incomplete pasted-vacancy input and mixed public/private targets', async () => {
    const { service, prisma, queue } = setup();
    await expect(service.generate('user', { privateVacancy: { title: '', originalText: 'too short' }, items: [{ kind: 'CV' }], expectedUnits: 1 } as any)).rejects.toThrow('Vakansiyanın adı');
    await expect(service.generate('user', { ...request, privateVacancy: { title: 'Analyst', originalText: 'x'.repeat(60) } } as any)).rejects.toThrow('Bir vakansiya uyğunluğu');
    expect(prisma.resume.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
