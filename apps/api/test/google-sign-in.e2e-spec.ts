import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerModule } from '@nestjs/throttler';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import * as bcrypt from 'bcrypt';
import { AuthModule } from '../src/auth/auth.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { GoogleIdentityService } from '../src/auth/google-identity.service';
import { SessionAuthGuard } from '../src/auth/session-auth.guard';
import { GetUser } from '../src/auth/get-user.decorator';

@Controller('google-probe')
@UseGuards(SessionAuthGuard)
class ProbeController { @Get('me') me(@GetUser('id') id: string) { return { id }; } }

jest.setTimeout(40_000);

// The REAL verification path (signature, issuer, audience, expiry, verified e-mail) runs against a key set this test controls; nothing contacts Google.
describe('Google sign-in for candidates (locally signed ID tokens, isolated Postgres)', () => {
  let app: INestApplication, prisma: PrismaService, server: any;
  let privateKey: CryptoKey, wrongKey: CryptoKey;
  const stamp = `${Date.now()}`;
  const AUD = 'aise-test-client.apps.googleusercontent.com';
  const mail = (n: string) => `g-${stamp}-${n}@example.com`;
  const made: string[] = [];

  const token = async (claims: Record<string, unknown>, opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: string | number } = {}) =>
    new SignJWT({ email_verified: true, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(opts.iss ?? 'https://accounts.google.com').setAudience(opts.aud ?? AUD)
      .setIssuedAt().setExpirationTime(opts.exp ?? '10m').sign(opts.key ?? privateKey);
  const signIn = (idToken: string) => request(server).post('/auth/google').send({ idToken });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.RESEND_API_KEY = 're_mock_key'; process.env.GOOGLE_CLIENT_ID = AUD;
    process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
    const db = new URL(process.env.DATABASE_URL);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey as CryptoKey;
    wrongKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const module: TestingModule = await Test.createTestingModule({ imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]), DatabaseModule, AuthModule], controllers: [ProbeController] }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.init();
    app.get(GoogleIdentityService).useKeys(createLocalJWKSet({ keys: [jwk] }));
    prisma = app.get(PrismaService); server = app.getHttpServer();
  });
  afterAll(async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: `g-${stamp}-` } } }).catch(() => undefined);
    await app?.close();
  });

  it('reports whether Google sign-in is offered; refuses with 503 when no client id is configured', async () => {
    expect((await request(server).get('/auth/providers').expect(200)).body).toEqual({ google: true });
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(server).get('/auth/providers').expect(200)).body).toEqual({ google: false });
    await signIn(await token({ sub: 's0', email: mail('off') })).expect(503);
    process.env.GOOGLE_CLIENT_ID = AUD;
  });

  it('a new Google candidate gets a normal verified FREE account and a working session; repeat sign-in is the same account', async () => {
    const t = await token({ sub: `sub-${stamp}-new`, email: mail('new').toUpperCase(), name: 'Leyla Hüseynova' });
    const first = await signIn(t).expect(201);
    expect(first.body.user).toMatchObject({ email: mail('new'), name: 'Leyla Hüseynova' });
    expect(first.body.user.hashedPassword).toBeUndefined();
    const row = await prisma.user.findUniqueOrThrow({ where: { email: mail('new') }, include: { subscription: true, accounts: true } });
    expect(row.emailVerified).not.toBeNull();
    expect(row.subscription).toMatchObject({ plan: 'FREE', status: 'active' });
    expect(row.accounts).toHaveLength(1);
    await request(server).get('/google-probe/me').set('Authorization', `Bearer ${first.body.sessionToken}`).expect(200).expect({ id: row.id });
    // logout, then sign in again: same account, no duplicate, a fresh session
    await request(server).post('/auth/logout').set('Authorization', `Bearer ${first.body.sessionToken}`).expect(201);
    await request(server).get('/google-probe/me').set('Authorization', `Bearer ${first.body.sessionToken}`).expect(401);
    const again = await signIn(t).expect(201);
    expect(again.body.user.id).toBe(row.id);
    expect(again.body.sessionToken).not.toBe(first.body.sessionToken);
    expect(await prisma.user.count({ where: { email: { equals: mail('new'), mode: 'insensitive' } } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: row.id } })).toBe(1);
  });

  it('records the Terms/Privacy acceptance at sign-up and, when it is required, refuses a sign-up that lacks it (password and Google)', async () => {
    process.env.TERMS_ACCEPTANCE_REQUIRED = 'true';
    try {
      const pw = { email: mail('legal-pw'), password: 'Legal-Synthetic-1' };
      await request(server).post('/auth/register').send(pw).expect(400);
      await request(server).post('/auth/register').send({ ...pw, acceptTerms: false }).expect(400);
      expect(await prisma.user.count({ where: { email: pw.email } })).toBe(0);
      await request(server).post('/auth/register').send({ ...pw, acceptTerms: true }).expect(201);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: pw.email } });
      expect(row.legalAcceptedAt).not.toBeNull();
      expect(row.legalVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.legalAcceptedVia).toBe('register-checkbox');

      const t = await token({ sub: `sub-${stamp}-legal`, email: mail('legal-g'), name: 'Legal G' });
      await signIn(t).expect(400);
      expect(await prisma.user.count({ where: { email: mail('legal-g') } })).toBe(0);
      await request(server).post('/auth/google').send({ idToken: t, acceptTerms: true }).expect(201);
      const g = await prisma.user.findUniqueOrThrow({ where: { email: mail('legal-g') } });
      expect(g.legalAcceptedVia).toBe('google-notice');
      expect(g.legalAcceptedAt).not.toBeNull();
      // an existing account signing in again needs no new acceptance
      await signIn(t).expect(201);
    } finally { delete process.env.TERMS_ACCEPTANCE_REQUIRED; }
    // not required (development/tests): sign-up still works, acceptance simply stays unrecorded
    await request(server).post('/auth/register').send({ email: mail('legal-none'), password: 'Legal-Synthetic-1' }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: mail('legal-none') } })).legalAcceptedAt).toBeNull();
  });

  it('links an existing VERIFIED password account (any e-mail case) and keeps its data; ordinary password login still works', async () => {
    const email = `G-${stamp}-Verified@Example.com`; // stored with mixed case, as an older registration could be
    const user = await prisma.user.create({ data: { email, hashedPassword: await bcrypt.hash('Old-Pass-1', 4), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    await prisma.profile.create({ data: { userId: user.id, headline: 'Backend', skills: ['SQL'], location: 'Bakı', jobPreferences: {} } });
    await prisma.resume.create({ data: { userId: user.id, fileUrl: 'u/cv.pdf', fileName: 'cv.pdf' } as never }).catch(() => undefined);
    const res = await signIn(await token({ sub: `sub-${stamp}-ver`, email: email.toLowerCase() })).expect(201);
    expect(res.body.user.id).toBe(user.id);
    expect(await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })).toBe(1);
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(1); // profile, CVs, matches, saved jobs hang off the same user id
    await request(server).post('/auth/login').send({ email, password: 'Old-Pass-1' }).expect(201); // e-mail/password sign-in preserved
  });

  it('linking to an UNVERIFIED pre-registration signs it out everywhere and makes its password unusable (no pre-hijacking)', async () => {
    const email = mail('unverified');
    const user = await prisma.user.create({ data: { email, hashedPassword: await bcrypt.hash('Attacker-1', 4), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    await prisma.session.create({ data: { sessionToken: `attacker-${stamp}`, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
    const res = await signIn(await token({ sub: `sub-${stamp}-unv`, email })).expect(201);
    expect(res.body.user.id).toBe(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).not.toBeNull();
    await request(server).get('/google-probe/me').set('Authorization', `Bearer attacker-${stamp}`).expect(401);
    await request(server).post('/auth/login').send({ email, password: 'Attacker-1' }).expect(401);
  });

  it('refuses ambiguity instead of merging or duplicating: a second Google identity for a linked account, and several accounts for one e-mail', async () => {
    const linkedMail = mail('linked');
    await signIn(await token({ sub: `sub-${stamp}-a`, email: linkedMail })).expect(201);
    const other = await signIn(await token({ sub: `sub-${stamp}-b`, email: linkedMail })).expect(409);
    expect(JSON.stringify(other.body)).toMatch(/başqa Google hesabına/);
    const dup = mail('dup');
    await prisma.user.create({ data: { email: dup, hashedPassword: 'x', emailVerified: new Date() } });
    await prisma.user.create({ data: { email: dup.replace('g-', 'G-'), hashedPassword: 'x', emailVerified: new Date() } });
    await signIn(await token({ sub: `sub-${stamp}-c`, email: dup })).expect(409);
    expect(await prisma.account.count({ where: { providerAccountId: `sub-${stamp}-c` } })).toBe(0);
  });

  it('rejects an unverified Google e-mail, a wrong audience, wrong issuer, expired and forged tokens, garbage, and a suspended account', async () => {
    const email = mail('reject');
    await signIn(await token({ sub: 'x1', email, email_verified: false })).expect(401);
    await signIn(await token({ sub: 'x2', email }, { aud: 'someone-elses-client' })).expect(401);
    await signIn(await token({ sub: 'x3', email }, { iss: 'https://evil.example' })).expect(401);
    await signIn(await token({ sub: 'x4', email }, { exp: Math.floor(Date.now() / 1000) - 3600 })).expect(401);
    await signIn(await token({ sub: 'x5', email }, { key: wrongKey })).expect(401);
    await signIn('not-a-token-but-long-enough-to-pass-validation').expect(401);
    await request(server).post('/auth/google').send({}).expect(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0); // nothing was created by any refused attempt
    const sus = mail('suspended');
    await signIn(await token({ sub: `sub-${stamp}-s`, email: sus })).expect(201);
    await prisma.user.update({ where: { email: sus }, data: { suspendedAt: new Date() } });
    await signIn(await token({ sub: `sub-${stamp}-s`, email: sus })).expect(403);
  });
});
