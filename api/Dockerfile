FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/dist ./dist
COPY db/migrations ./migrations
COPY Logo ./Logo

RUN mkdir -p /app/storage && chown node:node /app/storage

EXPOSE 3000
USER node
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]