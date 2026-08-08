# Next.js, built to `output: "standalone"` (already set in next.config.ts), so the runtime
# stage carries a traced node_modules instead of the whole install.
#
# READ THIS BEFORE BUILDING: `NEXT_PUBLIC_*` values are inlined into the client bundle at
# BUILD time, not read at boot. That makes the image environment-specific — an image built
# with staging's API URL will talk to staging wherever you run it. The build args below are
# how those values get in; CI passes production's. Do not "fix" this by moving them to
# compose `environment:` — the browser never sees that, and the bundle would keep whatever it
# was built with while the container claims otherwise.

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_MAIN_SITE_URL=""
ARG NEXT_PUBLIC_TEACHER_PORTAL_URL=""
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG NEXT_PUBLIC_DESMOS_API_KEY=""
ARG NEXT_PUBLIC_MASTERSAT_AUTH_CORREL_HEADERS=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MAIN_SITE_URL=$NEXT_PUBLIC_MAIN_SITE_URL \
    NEXT_PUBLIC_TEACHER_PORTAL_URL=$NEXT_PUBLIC_TEACHER_PORTAL_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_DESMOS_API_KEY=$NEXT_PUBLIC_DESMOS_API_KEY \
    NEXT_PUBLIC_MASTERSAT_AUTH_CORREL_HEADERS=$NEXT_PUBLIC_MASTERSAT_AUTH_CORREL_HEADERS \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 nextjs

WORKDIR /app
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
