# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .

# Safe, build-only values. Runtime configuration is supplied by the platform.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV APP_URL=http://localhost:3000
ENV SESSION_SECRET=build-only-session-secret-with-at-least-32-characters
ENV TOKEN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENV INSTAGRAM_PROVIDER=fake
ENV ALLOW_FAKE_PROVIDER_IN_PRODUCTION=true
ENV STORAGE_PROVIDER=local

RUN pnpm build

FROM base AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Corepack caches the pinned pnpm release under root during the base stage.
# Copy it for the unprivileged runtime user so startup never downloads tooling.
RUN mkdir -p /home/node/.cache/node \
  && cp -R /root/.cache/node/corepack /home/node/.cache/node/corepack \
  && chown -R node:node /home/node/.cache

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts tsconfig.json ./
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/db ./db
COPY --chown=node:node --from=build /app/scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "pnpm db:migrate && exec pnpm start"]
