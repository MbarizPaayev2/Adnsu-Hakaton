import { NotificationsService, matchEmailBatchSize, MATCH_EMAIL_INTERVAL_MS } from './notifications.service';

const now = new Date('2026-10-13T05:00:00Z');
const match = (i: number, extra = {}) => ({ id: `m${i}`, jobId: `j${i}`, score: 0.9 - i / 100, job: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, deadline: null, title: `Job ${i}`, company: 'Acme' }, ...extra });
function fixture(plan = 'FREE') {
  const user = { id: 'u', email: 'test@example.com', subscription: { plan, status: 'active', currentPeriodEnd: null } };
  const db: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user), findMany: jest.fn().mockResolvedValue([user]) },
    match: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockImplementation((q) => Promise.resolve(q.select ? [] : Array.from({ length: 12 }, (_, i) => match(i)))), updateMany: jest.fn().mockResolvedValue({count:3}) },
    notification: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue([]),
  };
  db.$transaction = jest.fn((callback) => callback(db));
  const email = { send: jest.fn().mockResolvedValue({ id: 'test' }) };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new NotificationsService(db, email as any, { capture: jest.fn() } as any, queue as any, queue as any);
  return { service, db, email, queue };
}

describe('48-hour match recommendations', () => {
  it.each([['FREE', 3], ['PLUS', 1], ['PREMIUM', 5]])('lists and marks only %s plan batch (%i)', async (plan, size) => {
    const { service, db, email } = fixture(plan as string);
    expect(matchEmailBatchSize(plan as string)).toBe(size);
    expect(await service.sendMatchEmailDigest('u', now)).toBe(true);
    expect(email.send.mock.calls[0][2].match(/<li>/g)).toHaveLength(size as number);
    expect(db.match.updateMany.mock.calls[0][0].where.id.in).toHaveLength(size as number);
    expect(email.send.mock.calls[0][3].idempotencyKey).toMatch(/^match-digest-/);
    expect(db.$executeRaw).toHaveBeenCalled();
  });
  it.each(['flush', 'digest'])('respects %s send history for exactly 48 hours', async (origin) => {
    const { service, db, email } = fixture('BASIC');
    const last = new Date(now.getTime() - 48 * 3_600_000 + 1);
    if (origin === 'flush') db.match.findFirst.mockResolvedValue({ notifiedAt: last });
    else db.notification.findFirst.mockResolvedValue({ createdAt: last });
    expect(await service.sendMatchEmailDigest('u', now)).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
    last.setTime(last.getTime() - 1);
    expect(await service.sendMatchEmailDigest('u', now)).toBe(true);
  });
  it('Free gets one batch per Baku week; an upgrade offer never sends without consent', async () => {
    const { service, db, email } = fixture();
    db.match.findFirst.mockResolvedValue({ notifiedAt: new Date('2026-10-12T05:00:00Z') });
    expect(await service.sendMatchEmailDigest('u', new Date('2026-10-18T19:59:59Z'))).toBe(false);
    expect(await service.sendMatchEmailDigest('u', new Date('2026-10-18T20:00:00Z'))).toBe(true);
    expect(await service.sendPlanOffer('u', now)).toBe(false);
    expect(email.send).toHaveBeenCalledTimes(1);
  });
  it('sends one consented Free plan reminder and suppresses repeats or paid accounts', async () => {
    const { service, db, email } = fixture();
    (service as any).preferences = { get: async () => ({planOffersEmail:true,emailEnabled:true,pausedUntil:null,quietStartMinute:null,quietEndMinute:null}), unsubscribeToken: () => 'fixture-token' };
    db.notification.findFirst.mockImplementation((q) => Promise.resolve(q.where.type === 'DIGEST' ? {createdAt:new Date(now.getTime()-4*86400000)} : null));
    expect(await service.sendPlanOffer('u', now)).toBe(true);
    db.notification.findFirst.mockResolvedValue({ createdAt: now });
    expect(await service.sendPlanOffer('u', now)).toBe(false);
    db.user.findUnique.mockResolvedValue({ id:'u', subscription:{plan:'PLUS',status:'active',currentPeriodEnd:null} });
    expect(await service.sendPlanOffer('u', now)).toBe(false);
    expect(email.send).toHaveBeenCalledTimes(1);
  });
  it.each(['PLUS', 'PREMIUM'])('allows %s on the next Baku day, never twice on the same day', async (plan) => {
    const { service, db, email } = fixture(plan);
    db.match.findFirst.mockResolvedValue({ notifiedAt: new Date('2026-10-12T19:59:59Z') });
    expect(await service.sendMatchEmailDigest('u', new Date('2026-10-12T20:00:00Z'))).toBe(true);
    db.match.findFirst.mockResolvedValue({ notifiedAt: new Date('2026-10-12T20:00:00Z') });
    expect(await service.sendMatchEmailDigest('u', new Date('2026-10-13T19:59:59Z'))).toBe(false);
    expect(email.send).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a posting under a newly computed match or repeat it inside one batch', async () => {
    const { service, db } = fixture();
    db.match.findMany.mockImplementation((q) => Promise.resolve(q.select ? [{ id: 'old', jobId: 'j0' }] : [match(0), match(1), match(1, {id:'duplicate'}), match(2)]));
    await service.sendMatchEmailDigest('u', now);
    expect(db.match.updateMany.mock.calls[0][0].where.id.in).toEqual(['m1', 'm2']);
  });
  it('includes legacy paid digest matches in the do-not-repeat history', async () => {
    const { service, db } = fixture();
    db.notification.findMany.mockResolvedValue([{payload:{matchIds:['legacy-match']}}]);
    await service.sendMatchEmailDigest('u', now);
    expect(db.match.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {userId:'u', OR:[{notifiedAt:{not:null}},{id:{in:['legacy-match']}}]}}));
  });
  it('skips expired, hidden, closed and duplicate postings', async () => {
    const { service, db, email } = fixture();
    db.match.findMany.mockImplementation((q) => Promise.resolve(q.select ? [] : [match(0, { job: {status:'CLOSED'} }), match(1, { job: {status:'ACTIVE', hiddenAt:now} }), match(2, {job:{status:'ACTIVE',deadline:new Date(0)}})]));
    expect(await service.sendMatchEmailDigest('u',now)).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
  });
  it('does not mark anything after failed sending; the retry uses the same idempotency key', async () => {
    const { service, db, email } = fixture();
    email.send.mockRejectedValueOnce(new Error('provider down'));
    await expect(service.sendMatchEmailDigest('u',now)).rejects.toThrow('provider down');
    expect(db.match.updateMany).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    await service.sendMatchEmailDigest('u',now);
    expect(email.send.mock.calls[0][3]).toEqual(email.send.mock.calls[1][3]);
  });
  it('both scheduler entry points use the same gate for all plans', async () => {
    const { service, db, email } = fixture('PREMIUM');
    db.match.findFirst.mockResolvedValue({notifiedAt:new Date(now.getTime()-3600000)});
    expect(await service.runDailyDigest(now)).toEqual({sent:0,failed:0});
    expect(email.send).not.toHaveBeenCalled();
  });
  it('respects unsubscribe and suspension, even if an earlier queue job exists', async () => {
    const {service, db, email} = fixture();
    db.user.findUnique.mockResolvedValue({suspendedAt:now});
    await service.sendMatchEmailDigest('u',now);
    expect(email.send).not.toHaveBeenCalled();
    db.user.findUnique.mockResolvedValue({id:'u',email:'test@example.com'});
    (service as any).preferences = {get:async()=>({matchEmail:false,emailEnabled:true,pausedUntil:null})};
    await service.sendMatchEmailDigest('u',now);
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('occupation relevance before notifications', () => {
  const irrelevant = { breakdown: { roleFit: .4, filters: { role_relevant: false } } };
  it('does not create an in-app alert or email job for an unrelated occupation', async () => {
    const {service, db, queue} = fixture();
    db.match.findUnique.mockResolvedValue(match(0, { details: irrelevant }));
    await service.handleMatchCreated('m0', 'u');
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('does not create an alert for dismissed or applied matches', async () => {
    const {service, db, queue} = fixture();
    db.match.findUnique.mockResolvedValue(match(0, { status: 'DISMISSED' }));
    await service.handleMatchCreated('m0', 'u');
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();

    db.match.findUnique.mockResolvedValue(match(0, { status: 'APPLIED' }));
    await service.handleMatchCreated('m0', 'u');
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it('does not create duplicate in-app alerts for the same match or posting', async () => {
    const {service, db} = fixture();
    db.match.findUnique.mockResolvedValue(match(0, { id: 'm0', jobId: 'j0' }));
    db.notification.findMany.mockResolvedValue([{ payload: { matchId: 'm0', jobId: 'j0' } }]);
    await service.handleMatchCreated('m0', 'u');
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it('does not alert for expired jobs', async () => {
    const {service, db} = fixture();
    const expiredJob = { id: 'j0', title: 'Job 0', company: 'Corp', expiresAt: new Date(Date.now() - 3600000) };
    db.match.findUnique.mockResolvedValue(match(0, { job: expiredJob }));
    await service.handleMatchCreated('m0', 'u');
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it('rechecks delayed digests and does not let an unrelated high score use the batch', async () => {
    const {service, db, email} = fixture('PLUS');
    db.match.findMany.mockImplementation((q) => Promise.resolve(q.select ? [] : [match(0, { details: irrelevant }), match(1)]));
    await service.sendMatchEmailDigest('u', now);
    expect(email.send.mock.calls[0][2]).not.toContain('Job 0');
    expect(db.match.updateMany.mock.calls[0][0].where.id.in).toEqual(['m1']);
  });
  it('omits rejected old alerts without deleting history or hiding unrelated notification types', async () => {
    const {service, db} = fixture();
    db.notification.findMany.mockResolvedValue([{id:'n0', type:'NEW_MATCH', payload:{matchId:'m0'}}, {id:'n1', type:'NEW_MATCH', payload:{matchId:'m1'}}, {id:'n2', type:'DIGEST'}]);
    db.match.findMany.mockResolvedValue([{id:'m0', details:irrelevant}, {id:'m1', details:null}]);
    expect((await service.getNotifications('u')).map((n) => n.id)).toEqual(['n1','n2']);
    expect(db.match.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {userId:'u', id:{in:['m0','m1']}} }));
  });
});
