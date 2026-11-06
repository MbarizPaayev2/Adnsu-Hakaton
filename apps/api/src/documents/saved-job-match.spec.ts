import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

const openJob = (over: Record<string, unknown> = {}) => ({ id: 'j1', title: 'Analyst', company: 'Acme', status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, deadline: null, closedAt: null, ...over });

function service(prisma: any) {
  return new DocumentsService(prisma, {} as any, {} as any, {} as any, undefined);
}

describe('documents for a saved posting, whatever its match score', () => {
  it('creates a hidden, unscored match for a saved posting that never reached the recommendation threshold', async () => {
    const created: any[] = [];
    const prisma = {
      savedJob: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      match: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null) // no match yet
          .mockResolvedValueOnce({ id: 'm1', userId: 'u1', job: openJob(), vacancy: null }), // read back by actionableMatch
        create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'm1' }; }),
      },
    };
    const r = await service(prisma).matchForSavedJob('u1', 'imported:j1');
    expect(r).toEqual({ matchId: 'm1', title: 'Analyst', company: 'Acme' });
    expect(created[0]).toMatchObject({ userId: 'u1', jobId: 'j1', score: 0, status: 'VIEWED', details: { origin: 'saved_job', scored: false } });
  });

  it('reuses the match that already exists for the pair', async () => {
    const prisma = {
      savedJob: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      match: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'm9' })
          .mockResolvedValueOnce({ id: 'm9', userId: 'u1', job: openJob(), vacancy: null }),
        create: jest.fn(),
      },
    };
    expect((await service(prisma).matchForSavedJob('u1', 'imported:j1')).matchId).toBe('m9');
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it('refuses a posting the candidate has not saved, a malformed reference and a closed posting', async () => {
    const notSaved = { savedJob: { findFirst: jest.fn().mockResolvedValue(null) }, match: { findFirst: jest.fn(), create: jest.fn() } };
    await expect(service(notSaved).matchForSavedJob('u1', 'imported:j1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service(notSaved).matchForSavedJob('u1', 'nonsense')).rejects.toBeInstanceOf(BadRequestException);
    const closed = {
      savedJob: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      match: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'm1' }).mockResolvedValueOnce({ id: 'm1', userId: 'u1', job: openJob({ status: 'CLOSED' }), vacancy: null }), create: jest.fn() },
    };
    await expect(service(closed).matchForSavedJob('u1', 'imported:j1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
