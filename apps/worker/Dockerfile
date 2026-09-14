FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @ticket-agent/worker...

COPY apps/worker apps/worker
COPY packages/contracts packages/contracts

RUN pnpm --filter @ticket-agent/contracts build \
    && pnpm --filter @ticket-agent/worker typecheck

ENV TICKET_AGENT_WORKER_HEADLESS=true
ENV TICKET_AGENT_WORKER_DRY_RUN=true
ENV CRAWLEE_STORAGE_DIR=/app/.crawlee-storage

CMD ["pnpm", "--filter", "@ticket-agent/worker", "start"]
