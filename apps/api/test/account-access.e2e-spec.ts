import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../src/auth/auth.module';
import { BusinessModule } from '../src/business/business.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailDeliveryError, EmailService } from '../src/common/email.service';
import { extractAuthLink } from '../src/common/email-link.util';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../src/auth/session-auth.guard';
import { GetUser } from '../src/auth/get-user.decorator';

@Controller('account-access-probe')
@UseGuards(SessionAuthGuard)
class AccountAccessProbeController {
  @Get('me')
  me(@GetUser('id') id: string) {
    return { id };
  }
}

const FRONTEND = 'http://127.0.0.1:3450';

function lastCaptured(mail: EmailService, to: string) {
  const matches = mail.getCapturedEmails().filter((item) => item.to === to);
  if (matches.length === 0) {
    throw new Error('No captured email for the synthetic address');
  }
  return matches[matches.length - 1];
}

// Registration, verification and password-reset journeys hash passwords repeatedly; allow for a loaded machine.
jest.setTimeout(30_000);

describe('Candidate and business account access (local mail capture)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: EmailService;
  const stamp = `${Date.now()}`;
  const candidateEmail = `aise-access-c-${stamp}@example.com`;
  const businessEmail = `aise-access-b-${stamp}@example.com`;
  const unknownEmail = `aise-access-unknown-${stamp}@example.com`;
  const password = 'Access-Test-1';
  const nextPassword = 'Access-Test-2';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = FRONTEND;
    // Synthetic accounts are written here: only the isolated, fully migrated test database is acceptable.
    process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
    const db = new URL(process.env.DATABASE_URL);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') {
      throw new Error('Requires the isolated local aise_phase2_test database');
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
        DatabaseModule,
        AuthModule,
        BusinessModule,
      ],
      controllers: [AccountAccessProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.$connect();
    mail = app.get(EmailService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: candidateEmail } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { email: businessEmail } }).catch(() => undefined);
    }
    if (app) {
      await app.close();
    }
  });

  it('runs the candidate verify, session and password-reset journeys from captured mail', async () => {
    const server = app.getHttpServer();

    const register = await request(server)
      .post('/auth/register')
      .send({ email: candidateEmail, password });
    expect(register.status).toBeGreaterThanOrEqual(200);
    expect(register.status).toBeLessThan(300);

    const denied = await request(server)
      .post('/auth/login')
      .send({ email: candidateEmail, password });
    expect(denied.status).toBe(403);

    const unauth = await request(server).get('/account-access-probe/me');
    expect(unauth.status).toBe(401);

    const verifyMail = lastCaptured(mail, candidateEmail);
    const verifyLink = extractAuthLink(verifyMail.html);
    expect(verifyLink.origin).toBe(FRONTEND);
    expect(verifyLink.pathname).toBe('/verify-email');

    const verify = await request(server).post('/auth/verify-email').send({ token: verifyLink.token });
    expect(verify.status).toBeGreaterThanOrEqual(200);
    expect(verify.status).toBeLessThan(300);

    const reused = await request(server).post('/auth/verify-email').send({ token: verifyLink.token });
    expect(reused.status).toBe(400);

    const login = await request(server)
      .post('/auth/login')
      .send({ email: candidateEmail, password });
    expect(login.status).toBeGreaterThanOrEqual(200);
    expect(login.status).toBeLessThan(300);
    const sessionToken = login.body.sessionToken as string;
    expect(typeof sessionToken).toBe('string');

    const me1 = await request(server)
      .get('/account-access-probe/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(me1.status).toBe(200);
    const me2 = await request(server)
      .get('/account-access-probe/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(me2.body.id).toBe(me1.body.id);

    await request(server).post('/auth/logout').set('Authorization', `Bearer ${sessionToken}`);
    const afterLogout = await request(server)
      .get('/account-access-probe/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(afterLogout.status).toBe(401);

    const loginAgain = await request(server)
      .post('/auth/login')
      .send({ email: candidateEmail, password });
    expect(loginAgain.status).toBeGreaterThanOrEqual(200);
    expect(loginAgain.status).toBeLessThan(300);

    const knownForgot = await request(server).post('/auth/forgot-password').send({ email: candidateEmail });
    const unknownForgot = await request(server).post('/auth/forgot-password').send({ email: unknownEmail });
    expect(knownForgot.status).toBe(unknownForgot.status);
    expect(knownForgot.body).toEqual(unknownForgot.body);

    const resetMail = lastCaptured(mail, candidateEmail);
    const resetLink = extractAuthLink(resetMail.html);
    expect(resetLink.pathname).toBe('/reset-password');
    expect(resetLink.origin).toBe(FRONTEND);

    const reset = await request(server)
      .post('/auth/reset-password')
      .send({ token: resetLink.token, password: nextPassword });
    expect(reset.status).toBeGreaterThanOrEqual(200);
    expect(reset.status).toBeLessThan(300);

    const reusedReset = await request(server)
      .post('/auth/reset-password')
      .send({ token: resetLink.token, password: 'Access-Test-3' });
    expect(reusedReset.status).toBe(400);

    const oldDenied = await request(server)
      .post('/auth/login')
      .send({ email: candidateEmail, password });
    expect(oldDenied.status).toBe(401);

    const newOk = await request(server)
      .post('/auth/login')
      .send({ email: candidateEmail, password: nextPassword });
    expect(newOk.status).toBeGreaterThanOrEqual(200);
    expect(newOk.status).toBeLessThan(300);
  });

  it('keeps resend generic when delivery fails and allows another attempt', async () => {
    const server = app.getHttpServer();
    const email = `aise-access-resend-${stamp}@example.com`;
    await request(server).post('/auth/register').send({ email, password });
    mail.clearCapturedEmails();

    const send = jest.spyOn(mail, 'send').mockRejectedValueOnce(new EmailDeliveryError('provider_error'));
    const failed = await request(server).post('/auth/resend-verification').send({ email });
    const unknown = await request(server).post('/auth/resend-verification').send({ email: unknownEmail });
    send.mockRestore();
    expect(failed.status).toBe(unknown.status);
    expect(failed.body).toEqual(unknown.body);

    const retry = await request(server).post('/auth/resend-verification').send({ email });
    expect(retry.status).toBeGreaterThanOrEqual(200);
    expect(retry.status).toBeLessThan(300);
    expect(retry.body).toEqual(unknown.body);
    const retryLink = extractAuthLink(lastCaptured(mail, email).html);
    expect(retryLink.pathname).toBe('/verify-email');
    await prisma.user.deleteMany({ where: { email } });
  });

  it('expires a captured verification link safely', async () => {
    const server = app.getHttpServer();
    const email = `aise-access-exp-${stamp}@example.com`;
    await request(server).post('/auth/register').send({ email, password });
    const link = extractAuthLink(lastCaptured(mail, email).html);
    await prisma.verificationToken.update({
      where: { token: link.token },
      data: { expires: new Date(Date.now() - 1000) },
    });
    const expired = await request(server).post('/auth/verify-email').send({ token: link.token });
    expect(expired.status).toBe(400);
    await prisma.user.deleteMany({ where: { email } });
  });

  it('runs the business verify, session and password-reset journeys from captured mail', async () => {
    const server = app.getHttpServer();

    const register = await request(server)
      .post('/business/auth/register')
      .send({ email: businessEmail, password, companyName: 'Access Co' });
    expect(register.status).toBeGreaterThanOrEqual(200);
    expect(register.status).toBeLessThan(300);

    const denied = await request(server)
      .post('/business/auth/login')
      .send({ email: businessEmail, password });
    expect(denied.status).toBe(403);

    const verifyLink = extractAuthLink(lastCaptured(mail, businessEmail).html);
    expect(verifyLink.origin).toBe(FRONTEND);
    expect(verifyLink.pathname).toBe('/business/verify-email');

    const verify = await request(server)
      .post('/business/auth/verify-email')
      .send({ token: verifyLink.token });
    expect(verify.status).toBeGreaterThanOrEqual(200);
    expect(verify.status).toBeLessThan(300);

    const reused = await request(server)
      .post('/business/auth/verify-email')
      .send({ token: verifyLink.token });
    expect(reused.status).toBe(400);

    const login = await request(server)
      .post('/business/auth/login')
      .send({ email: businessEmail, password });
    expect(login.status).toBe(200);
    const sessionToken = login.body.sessionToken as string;

    const me1 = await request(server)
      .get('/business/auth/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(me1.status).toBe(200);
    const me2 = await request(server)
      .get('/business/auth/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(me2.status).toBe(200);

    await request(server).post('/business/auth/logout').set('Authorization', `Bearer ${sessionToken}`);
    const afterLogout = await request(server)
      .get('/business/auth/me')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(afterLogout.status).toBe(401);

    const loginAgain = await request(server)
      .post('/business/auth/login')
      .send({ email: businessEmail, password });
    expect(loginAgain.status).toBe(200);

    const knownForgot = await request(server)
      .post('/business/auth/forgot-password')
      .send({ email: businessEmail });
    const unknownForgot = await request(server)
      .post('/business/auth/forgot-password')
      .send({ email: unknownEmail });
    expect(knownForgot.body).toEqual(unknownForgot.body);

    const resetLink = extractAuthLink(lastCaptured(mail, businessEmail).html);
    expect(resetLink.pathname).toBe('/business/reset-password');
    expect(resetLink.origin).toBe(FRONTEND);

    const reset = await request(server)
      .post('/business/auth/reset-password')
      .send({ token: resetLink.token, password: nextPassword });
    expect(reset.status).toBeGreaterThanOrEqual(200);
    expect(reset.status).toBeLessThan(300);

    const oldDenied = await request(server)
      .post('/business/auth/login')
      .send({ email: businessEmail, password });
    expect(oldDenied.status).toBe(401);

    const newOk = await request(server)
      .post('/business/auth/login')
      .send({ email: businessEmail, password: nextPassword });
    expect(newOk.status).toBe(200);
  });
});
