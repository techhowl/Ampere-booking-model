# Ampere /buy — production image.
#
# Three stages so the thing we ship carries no package manager, no source and
# no build cache: deps -> build -> runtime.
#
# Node 24 to match local development. Alpine keeps the final image small;
# libc6-compat is there because Prisma's engines are glibc-linked.

# ---------------------------------------------------------------- deps ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

# Only the manifests, so this layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build ----
FROM node:24-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The client is generated from the schema, so it must exist before the build.
RUN pnpm prisma generate

# Next inlines NEXT_PUBLIC_* at build time. Nothing secret belongs here — the
# values that matter (database, Juspay, crypto keys) are all read at runtime.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ------------------------------------------------------------- runtime ----
FROM node:24-alpine AS runtime
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run the server as root. A payment page is exactly the wrong place to
# be casual about this.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# `standalone` already contains the trimmed node_modules and server.js.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations run as a separate one-shot container on deploy (see
# docker-compose.prod.yml), so the schema and the Prisma CLI need to be present.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin

USER nextjs
EXPOSE 3000

# /api/health checks the database, so an unhealthy container is one that cannot
# serve a booking — not merely one whose process died.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
