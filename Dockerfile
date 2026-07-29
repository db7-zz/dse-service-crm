# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY database/package.json database/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN pnpm db:generate

FROM builder AS api
RUN pnpm --filter @dse/shared build \
    && pnpm --filter @dse/database build \
    && pnpm --filter @dse/api build
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

FROM builder AS web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dse/shared build \
    && pnpm --filter @dse/config build \
    && pnpm --filter @dse/api-client build \
    && pnpm --filter @dse/ui build \
    && pnpm --filter @dse/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@dse/web", "start"]

