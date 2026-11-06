import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { rateLimitMessage, throttleOptions } from './throttle-options';

@Controller()
class PingController { @Get('ping') ping() { return { ok: true }; } }

describe('rate-limit response', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const limited = { ...throttleOptions, throttlers: [{ name: 'default', ttl: 60_000, limit: 1 }] };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(limited)],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('tells the person in Azerbaijani how long to wait, with a matching Retry-After', async () => {
    await request(app.getHttpServer()).get('/ping').expect(200);
    const res = await request(app.getHttpServer()).get('/ping').expect(429);
    const wait = Number(res.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(res.body.message).toBe(rateLimitMessage(wait));
    expect(res.body.message).not.toMatch(/Too Many Requests|ThrottlerException/);
  });

  it('never asks to wait zero seconds', () => {
    expect(rateLimitMessage(0)).toContain('1 saniyə');
  });
});
