import { JobsService, isJobActionable } from './jobs.service';
import { Prisma } from '@prisma/client';

const payload = { externalId: 'glorri:fixture', title: 'Engineer', company: 'Fixture', description: 'TypeScript', location: 'Baku', url: 'https://jobs.glorri.com/vacancies/fixture/fixture', postedAt: '2026-01-01T00:00:00Z' };
describe('job lifecycle', () => {
  let row: any;
  let prisma: any;
  let queue: any;
  let service: JobsService;
  beforeEach(() => {
    row = null;
    prisma = { job: {
      findUnique: jest.fn(async () => row),
      create: jest.fn(async ({ data }) => row = { id: 'job1', status: 'ACTIVE', ...data }),
      updateMany: jest.fn(async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; }),
      findUniqueOrThrow: jest.fn(async () => row),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }) => row = { ...row, ...data }),
    } };
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new JobsService(prisma, queue);
  });
  it('refreshes changed content, preserves identity and deduplicates unchanged matching work', async () => {
    const first = await service.upsertJob(payload);
    expect(first.outcome).toBe('created');
    const firstQueueId = queue.add.mock.calls[0][2].jobId;
    expect((await service.upsertJob(payload)).outcome).toBe('unchanged');
    expect(queue.add.mock.calls[1][2].jobId).toBe(firstQueueId);
    const updated = await service.upsertJob({ ...payload, description: 'PostgreSQL' });
    expect(updated.outcome).toBe('updated');
    expect(updated.job.id).toBe(first.job.id);
    expect(updated.job.description).toBe('PostgreSQL');
    expect(queue.add.mock.calls[2][2].jobId).not.toBe(firstQueueId);
    expect(prisma.job.create).toHaveBeenCalledTimes(1);
  });
  it('does not treat listing view counts or promotion as a content change', async () => {
    const listed = { ...payload, rawPayload: { slug: 'fixture', title: 'Engineer', viewCount: 10, isProAd: false } };
    const first = await service.upsertJob(listed);
    const firstQueueId = queue.add.mock.calls[0][2].jobId;
    const again = await service.upsertJob({ ...listed, rawPayload: { ...listed.rawPayload, viewCount: 57, isProAd: true } });
    expect(again.outcome).toBe('unchanged');
    expect(again.job.contentHash).toBe(first.job.contentHash);
    expect(queue.add.mock.calls[1][2].jobId).toBe(firstQueueId);
    // A real content change in the source payload still counts.
    const changed = await service.upsertJob({ ...listed, rawPayload: { ...listed.rawPayload, title: 'Senior Engineer' } });
    expect(changed.outcome).toBe('updated');
  });
  it('retries enqueue after persistence succeeded but Redis failed', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(service.upsertJob(payload)).rejects.toThrow('queue unavailable');
    expect(row).not.toBeNull();
    await service.upsertJob(payload);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(prisma.job.create).toHaveBeenCalledTimes(1);
  });
  it('keeps the first observation date when an employer does not publish a date', async () => {
    const first = await service.upsertJob({ ...payload, rawPayload: { postedAtBasis: 'first-observed' } }, new Date('2026-10-13'));
    const later = await service.upsertJob({ ...payload, postedAt: '2026-10-14T00:00:00Z', rawPayload: { postedAtBasis: 'first-observed' } }, new Date('2026-10-14'));
    expect(later.outcome).toBe('unchanged');
    expect(later.job.postedAt).toEqual(first.job.postedAt);
    const changed = await service.upsertJob({ ...payload, description: 'Updated responsibilities', postedAt: '2026-10-15T00:00:00Z', rawPayload: { postedAtBasis: 'first-observed' } }, new Date('2026-10-15'));
    expect(changed.outcome).toBe('updated');
    expect(changed.job.postedAt).toEqual(first.job.postedAt);
  });
  it('reopens a confirmed posting and does not queue an expired one', async () => {
    await service.upsertJob(payload);
    row.status = 'CLOSED';
    expect((await service.upsertJob(payload)).outcome).toBe('reopened');
    expect(row.status).toBe('ACTIVE');
    queue.add.mockClear();
    await service.upsertJob({ ...payload, deadline: '2000-01-01T00:00:00Z' });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('does not overwrite facts from a newer import', async () => {
    await service.upsertJob(payload, new Date('2030-01-02'));
    await service.upsertJob({ ...payload, title: 'Old' }, new Date('2030-01-01'));
    expect(row.title).toBe('Engineer');
  });
  it('does not overwrite a newer observation that wins between read and write', async () => {
    await service.upsertJob(payload, new Date('2030-01-01'));
    prisma.job.updateMany.mockImplementationOnce(async ({ where }: any) => {
      expect(where.lastSeenAt.lte).toEqual(new Date('2030-01-02'));
      row = { ...row, title: 'Newer winner', lastSeenAt: new Date('2030-01-03') };
      return { count: 0 };
    });
    await service.upsertJob({ ...payload, title: 'Older contender' }, new Date('2030-01-02'));
    expect(row.title).toBe('Newer winner');
  });
  it('recovers a concurrent unique-key insertion by refreshing the winner', async () => {
    await service.upsertJob(payload);
    prisma.job.findUnique.mockResolvedValueOnce(null);
    prisma.job.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    await expect(service.upsertJob(payload)).resolves.toMatchObject({ outcome: 'unchanged' });
  });
  it('rejects invalid in-process payloads before writing', async () => {
    await expect(service.upsertJob({ ...payload, postedAt: 'invalid' })).rejects.toThrow();
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('checks both lifecycle and deadline', () => {
    expect(isJobActionable({ status: 'CLOSED', deadline: null })).toBe(false);
    expect(isJobActionable({ status: 'ACTIVE', deadline: new Date(0) })).toBe(false);
    expect(isJobActionable({ status: 'ACTIVE', deadline: null })).toBe(true);
  });
  it('refuses a posting dated in the future, whatever the source', async () => {
    await expect(service.upsertJob({ ...payload, postedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })).rejects.toThrow('postedAt is in the future');
    await expect(service.upsertJob({ ...payload, postedAt: new Date(Date.now() + 3_600_000).toISOString() })).resolves.toMatchObject({ outcome: 'created' }); // clock skew is tolerated
    expect(prisma.job.create).toHaveBeenCalledTimes(1);
  });
  it('confirms listed postings, touches lastSeenAt and reopens closed ones without double-counting', async () => {
    prisma.job.updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 2 }) // active confirmed
      .mockResolvedValueOnce({ count: 1 }); // reopened
    const seenAt = new Date('2026-10-04T12:00:00Z');
    const result = await service.confirmListed(['work:1', 'work:2', 'work:3'], seenAt);
    expect(result).toEqual({ confirmed: 3, reopened: 1 });
    expect(prisma.job.updateMany).toHaveBeenNthCalledWith(1, {
      where: { externalId: { in: ['work:1', 'work:2', 'work:3'] }, status: 'ACTIVE', lastSeenAt: { lte: seenAt } },
      data: { lastSeenAt: seenAt, missedImports: 0 },
    });
    expect(prisma.job.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        externalId: { in: ['work:1', 'work:2', 'work:3'] },
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        hiddenAt: null,
        duplicateOfId: null,
        lastSeenAt: { lte: seenAt },
        OR: [{ deadline: null }, { deadline: { gte: seenAt } }],
      },
      data: { status: 'ACTIVE', closedAt: null, closedReason: null, lastSeenAt: seenAt, missedImports: 0 },
    });
  });
  it('refuses future observation timestamps in confirmListed', async () => {
    const futureDate = new Date(Date.now() + 120_000);
    await expect(service.confirmListed(['work:1'], futureDate)).rejects.toThrow('Observation timestamp cannot be in the future');
  });
});

