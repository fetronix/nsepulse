# syntax=docker/dockerfile:1

# ---- build stage: full dependencies, type check and compile ----
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts ./
COPY index.html ./
COPY src ./src
RUN npm run build:api && npm run build

# ---- production dependencies only ----
FROM node:22-alpine AS production-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime: non-root, production dependencies and compiled output ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    MARKET_DATA_PROVIDER=none
# wget is used by the container health check; it ships with the alpine base image.
COPY package.json package-lock.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY docs/openapi.yaml ./docs/openapi.yaml
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/logs \
    && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/api/v1/health/live" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
