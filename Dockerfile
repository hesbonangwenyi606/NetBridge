FROM node:24-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/api ./apps/api
# Client generation needs a datasource URL but does not connect during a build.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY apps/web ./apps/web
RUN node apps/web/scripts/build.mjs

FROM build AS migrate
USER node
CMD ["npm", "run", "db:deploy"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/src/main.js"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production WEB_HOST=0.0.0.0 WEB_PORT=5173 API_URL=http://api:3000
COPY --from=web-build --chown=node:node /app/apps/web/server.mjs ./apps/web/server.mjs
COPY --from=web-build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.mjs", "--production"]
