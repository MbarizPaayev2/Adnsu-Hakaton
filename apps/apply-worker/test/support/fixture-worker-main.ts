/**
 * Test-only entry point: the real apply-worker (AppModule, token guard,
 * SessionsService, Glorri adapter, headless Chromium) with its browser
 * context routed to a local fixture ATS. Production uses src/main.ts, which
 * never sets these seams. Refuses to start unless the fixture is on loopback.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { chromium } from 'playwright';
import { AppModule } from '../../src/app.module';
import { SessionsService } from '../../src/sessions/sessions.service';
import { routeDestinationToFixture } from './fixture-ats';

async function main() {
  const origin = new URL(process.env.FIXTURE_ATS_ORIGIN || 'invalid:');
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('FIXTURE_ATS_ORIGIN must be a loopback http origin');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const sessions = app.get(SessionsService);
  sessions.launchBrowser = () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  sessions.prepareContext = routeDestinationToFixture(origin.origin);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT), '127.0.0.1');
  console.log('FIXTURE_WORKER_READY');
}

main().catch((error) => {
  console.error('FIXTURE_WORKER_FAILED', error instanceof Error ? error.message : error);
  process.exit(1);
});
