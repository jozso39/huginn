# Multi-arch (the Pi is arm64). Build the SPA, then run the server from source:
# Bun executes TypeScript directly, so there is no server build step.
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS web
COPY vite.config.ts ./
COPY web ./web
RUN bunx vite build

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY --from=web /app/web/dist ./web/dist
# The image's `bun` user is uid 1000, which is also the host user on the Pi, so the
# bind-mounted data directory stays owned by the person who backs it up.
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
