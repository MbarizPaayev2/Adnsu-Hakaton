import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Boots the whole product module. Booting it used to start the live Glorri importer (real requests to glorri.az,
// writing into whatever database DATABASE_URL named), so the importer is switched off and only the isolated DB is allowed.
process.env.GLORRI_SCRAPER_ENABLED = 'false';
process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
if (new URL(process.env.DATABASE_URL).pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');

// Starting and closing the entire product (a dozen queues and their workers) takes longer than jest's 5 s default.
jest.setTimeout(60_000);

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
