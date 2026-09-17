# Housewarden — guarded household-operations MCP server.
#
# Multi-stage so the runtime image carries only Next's standalone output and the
# node_modules it actually traced. PGlite ships a WASM Postgres, so the container
# needs no external database.
#
#   docker build -t housewarden .
#   docker run --rm -p 3000:3000 -e HOUSEWARDEN_TOKEN="$(openssl rand -hex 24)" housewarden
#
# MCP endpoint: http://localhost:3000/api/mcp   (Streamable HTTP, bearer auth)
# Console:      http://localhost:3000           (needs HOUSEWARDEN_ADMIN_SECRET)

# ---- deps: install with the lockfile, cached separately from the source ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build: emit .next/standalone ----
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A build-time placeholder only. It is never baked into the image: the runtime
# stage below starts from a clean env, so a real token must be supplied to run.
ENV HOUSEWARDEN_TOKEN=build-time-placeholder-not-a-secret
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run unprivileged. PGlite writes to .data, so that must be owned by the user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs housewarden

# standalone already contains server.js, the traced node_modules, db/migrations
# and ui/pending.html (see outputFileTracingIncludes in next.config.ts).
# Static assets are the one thing the tracer does not place there.
# There is deliberately no `public/` copy: this repo has no public directory,
# and COPY fails the build on a missing source.
COPY --from=builder --chown=housewarden:nodejs /app/.next/standalone ./
COPY --from=builder --chown=housewarden:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/.data && chown -R housewarden:nodejs /app/.data
VOLUME ["/app/.data"]

USER housewarden
EXPOSE 3000

# No HOUSEWARDEN_TOKEN default, by design. The guard in lib/mcp/auth.ts returns
# 503 rather than falling open when the token is missing or under 16 characters,
# and a token baked into a public image would be a known credential on every
# deployment of it. Supply one at run time.
CMD ["node", "server.js"]
