# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS frontend-dependencies

WORKDIR /build/frontend

COPY hypothetically-app-frontend/package.json hypothetically-app-frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000


FROM frontend-dependencies AS frontend-build

WORKDIR /build/frontend

COPY hypothetically-app-frontend/ ./
RUN npm run build


FROM frontend-dependencies AS backend-build

WORKDIR /build/backend

COPY hypothetically-app-backend/package.json hypothetically-app-backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

COPY hypothetically-app-backend/ ./
RUN npm run build


FROM backend-build AS production-dependencies

WORKDIR /build/backend
RUN npm prune --omit=dev --no-audit --no-fund


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node hypothetically-app-backend/package.json hypothetically-app-backend/package-lock.json ./
COPY --chown=node:node --from=production-dependencies /build/backend/node_modules ./node_modules
COPY --chown=node:node --from=backend-build /build/backend/dist ./dist
COPY --chown=node:node --from=frontend-build /build/frontend/dist ./public
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
