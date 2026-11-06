# Built from the monorepo root (docker build -f apps/apply-worker/Dockerfile .),
# not from apps/apply-worker/ itself — npm workspaces keep a single lockfile at
# the repo root, so `npm ci` needs every workspace's package.json present to
# resolve it, even though this image only builds/ships apps/apply-worker.

# Small internal sidecar, same posture as apps/matching-service: not publicly
# exposed, reached only by apps/api over a loopback-bound port with a bearer
# token. This is the one workspace that needs Playwright's browser binaries.
FROM node:20-slim
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/apply-worker/package.json apps/apply-worker/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

COPY apps/apply-worker apps/apply-worker

WORKDIR /repo/apps/apply-worker
RUN npm run build

# Installs the actual Chromium browser binary plus the OS-level libraries it
# needs. --with-deps is critical here since node:20-slim is a minimal base
# image that doesn't ship the fonts/libs Chromium requires headless.
RUN npx playwright install --with-deps chromium

ENV PORT=8100
EXPOSE 8100

CMD ["node", "dist/main"]
