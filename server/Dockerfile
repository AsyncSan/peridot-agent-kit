# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY tsconfig.json ./
COPY src ./src

# Bundle everything into a single self-contained JS file
RUN bun build src/index.ts \
      --outfile dist/server.js \
      --target bun \
      --minify

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM oven/bun:1-alpine
WORKDIR /app

# Non-root user for security
RUN addgroup -S peridot && adduser -S peridot -G peridot
USER peridot

COPY --from=builder /app/dist/server.js ./server.js

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["bun", "run", "server.js"]
