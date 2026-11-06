# Built from the monorepo root (docker build -f apps/api/Dockerfile .), not
# from apps/api/ itself — apps/api depends on the @aise/shared-types
# workspace package, which only resolves correctly through npm's root-level
# workspace linking.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /repo

# Prisma's engine needs to detect the installed OpenSSL version, both here
# (to select the right generated query engine binary) and at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Workspace manifests only, so `npm ci` is cached across source-only edits —
# every workspace's package.json is needed for npm to resolve the lockfile,
# even though this image only builds/ships apps/api.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/apply-worker/package.json apps/apply-worker/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
COPY apps/extension apps/extension
RUN node apps/extension/scripts/pack.mjs apps/api/private/agent

# @aise/shared-types is consumed via its compiled dist/ (see its package.json
# "main"/"types"), not ts-node/paths — it must be built before apps/api's own
# build can resolve its types.
RUN npm run build --workspace=packages/shared-types

# Prisma client types are generated from the schema; nest build fails without them.
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma

RUN npm run build --workspace=apps/api

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# fonts-liberation: the resume-tailor Typst templates set
# `font: "Liberation Sans"` / `"Liberation Serif"` and point NodeCompiler's
# fontPaths at /usr/share/fonts (resume-tailor.service.ts) — without this,
# that directory doesn't exist at all in this base image, and Typst falls
# back to its own bundled default font instead of erroring. That fallback's
# Azerbaijani glyph coverage (ə, ğ, ş, ı, ö) isn't guaranteed, unlike
# Liberation's, which was chosen specifically for it (see cv-extract.ts's
# comment on the same concern for CV parsing).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Same /repo/node_modules + /repo/apps/api layout as the build stage, so
# Node's module resolution (which walks up parent directories) finds hoisted
# workspace dependencies exactly as it did there. node_modules is copied
# whole (devDependencies included) because the `prisma` CLI — a devDependency
# — is what runs `prisma migrate deploy` below; there's no separate prod-only
# install step.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/private ./apps/api/private
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json

WORKDIR /repo/apps/api
EXPOSE 4000

# Apply any pending migrations before the API starts serving traffic.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
