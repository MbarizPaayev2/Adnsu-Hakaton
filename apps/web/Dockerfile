# Built from the monorepo root (docker build -f apps/web/Dockerfile .), not
# from apps/web/ itself — apps/web depends on the @aise/shared-types
# workspace package, which only resolves correctly through npm's root-level
# workspace linking.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /repo

# Workspace manifests only, so `npm ci` is cached across source-only edits —
# every workspace's package.json is needed for npm to resolve the lockfile,
# even though this image only builds/ships apps/web.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/apply-worker/package.json apps/apply-worker/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
# Web tests are typechecked by next build and exercise this shared form helper.
# Copy source into the build stage only; the extension archive stays private in the API.
COPY apps/extension/lib/assisted-form.js apps/extension/lib/assisted-form.js
COPY apps/extension/lib/prefill-summary.js apps/extension/lib/prefill-summary.js

# @aise/shared-types is consumed via its compiled dist/ (see its package.json
# "main"/"types"), not ts-node/paths — it must be built before apps/web's own
# build can resolve its types.
RUN npm run build --workspace=packages/shared-types

# next.config.ts sets output: 'standalone', so this traces the real
# dependency graph (workspace packages included) into .next/standalone
# instead of requiring the whole monorepo node_modules at runtime.
RUN npm run build --workspace=apps/web

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# In an npm-workspaces monorepo, Next nests the standalone output under the
# app's path relative to the workspace root (apps/web/server.js), not at the
# top level — the COPY destinations below mirror that nesting.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Without HOSTNAME set, the standalone server prints "Ready" but binds to the
# container's own hostname instead of all interfaces — unreachable from
# outside the container despite looking healthy in the logs.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
