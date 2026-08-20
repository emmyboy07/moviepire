# --- Build stage ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/.output ./.output
# .env is committed in the repo and holds SESSION_SECRET etc. Loaded at
# runtime via --env-file-if-exists below.
COPY --from=builder /app/.env ./.env

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Your Bun values: 32 MB cache ceiling, 4 MB max per in-flight segment.
ENV SEGMENT_CACHE_MAX_BYTES=33554432
ENV SEGMENT_MAX_BUFFER_BYTES=4194304

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--env-file-if-exists=.env", "--max-old-space-size=384", ".output/server/index.mjs"]
