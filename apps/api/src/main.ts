import { NestFactory } from '@nestjs/core';
import { frontendOrigins } from './common/cors-origins';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { validationException } from './common/validation-messages';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import helmet from 'helmet';

async function bootstrap() {
  // Body parser is disabled globally so the Dodo Payments webhook route can get
  // the raw byte buffer below — Standard Webhooks signature verification needs
  // the exact bytes Dodo signed, and re-serializing already-parsed JSON won't
  // byte-match the original.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Exactly one reverse proxy sits in front of this container in every real
  // deployment (see DEPLOY.md) — without this, ThrottlerGuard's per-IP
  // tracking reads req.ip as the proxy's own address for every client, so
  // one attacker's failed-login burst exhausts the shared bucket and locks
  // out everyone else, and per-attacker brute-force isolation is lost
  // entirely. `1` trusts exactly that one hop's X-Forwarded-For, not
  // whatever a client claims beyond it.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use('/webhooks/dodo', express.raw({ type: 'application/json' }));
  // Svix signatures cover the exact bytes the provider signed.
  app.use('/webhooks/resend', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '512kb' })); // 40k-character descriptions in UTF-8 exceed the 100kb default
  app.use(express.urlencoded({ extended: true }));

  // Uploaded files (resumes, ID-document photos, application attachments,
  // review screenshots) are served via UploadsModule's GET /uploads/:filename
  // instead of Express static middleware — that used to serve anything under
  // uploads/ to anyone with the URL, no session required. See
  // src/uploads/any-session.guard.ts for why.

  // Enable CORS
  app.enableCors({
    origin: frontendOrigins(process.env.FRONTEND_URL),
    credentials: true,
  });

  // Enable global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    // Plain Azerbaijani instead of class-validator's English defaults (see common/validation-messages.ts).
    exceptionFactory: validationException,
  }));

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Backend API started on port ${port}`);
}
bootstrap();
