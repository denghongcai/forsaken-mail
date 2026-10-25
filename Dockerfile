# ---------- Build stage: compile the frontend and backend ----------
FROM node:24-alpine AS build
WORKDIR /build
RUN corepack enable

# Copy the manifests first to leverage Docker layer caching
# (dependencies aren't reinstalled unless they change)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

# Copy the sources and build: web → dist (static assets), server → dist (tsc output)
COPY server/ server/
COPY web/ web/
# pnpm deploy: extract the minimal set the server needs to run (dist + prod deps) into /build/out
RUN pnpm --filter @forsaken/web build \
  && pnpm --filter @forsaken/server build \
  && pnpm --filter @forsaken/server --prod deploy /build/out

# ---------- Runtime stage: only production deps and build output ----------
FROM node:24-alpine
WORKDIR /app
# The database lives in /app/data; mount a volume there to persist it
ENV NODE_ENV=production WEB_DIST=/app/web/dist

COPY --from=build /build/out ./
COPY --from=build /build/web/dist ./web/dist

EXPOSE 25
EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
