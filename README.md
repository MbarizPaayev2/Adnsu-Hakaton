# AISE

Job matching and applications for candidates and employers in Azerbaijan.

| Path | What it is |
|---|---|
| `apps/api` | NestJS API (Prisma + PostgreSQL, BullMQ + Redis) |
| `apps/web` | Next.js web app (candidates, employers, admin) |
| `apps/apply-worker` | Browser worker for external applications (off by default) |
| `apps/matching-service` | Python matching/scoring service |
| `packages/shared-types` | Types shared by the apps |

## Local development

You need Node.js 20, npm and Docker. No production secret is needed or used
locally: email and payments run in mock mode, and the Glorri importer and
external applications are off.

1. **Environment files** — copy each template and keep the copy out of Git:

   ```bash
   cp .env.example .env
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   cp apps/apply-worker/.env.example apps/apply-worker/.env   # only if you work on the worker
   ```

   Replace `NEXTAUTH_SECRET` (the same value in `.env` and
   `apps/web/.env.local`) with your own random string (`openssl rand -hex 32`).
   Each file explains its variables.

2. **Dependencies and database**

   ```bash
   npm ci
   npm run build --workspace=packages/shared-types
   docker compose up -d postgres redis
   cd apps/api && npx prisma migrate deploy && npx prisma generate && cd ../..
   npm run db:seed        # optional sample data
   ```

3. **Run**

   ```bash
   npm run dev:api        # http://localhost:4000
   npm run dev:web        # http://localhost:3000
   ```

   Emails are printed in the API log (`[EMAIL MOCK] …`) instead of being sent.

4. **Tests**

   ```bash
   npm test --workspace=apps/api
   npm test --workspace=apps/web
   ```

## Secrets

- Never commit `.env`, `.env.local` or any real key. The `*.env.example`
  files contain development placeholders only.
- Production secrets exist only on the production server. Do not copy them to
  your machine, chat or email.
- If you need a real third-party key for your own testing (Resend, Dodo test
  mode, NVIDIA), ask for a separate key issued to you, so it can be revoked on
  its own.

## More

- Deployment: `DEPLOY.md`
- Release record and runbook: `docs/release-2026-10-05.md`
