# Class Compass container image (D-018, ENG-5).
# - Node 26 on Debian bookworm-slim; the server runs its TypeScript sources directly (type stripping).
# - Production dependencies only in the final image; non-root user; no secrets (they come from the
#   environment / env_file at run time); OCR language data copied in at build time (D-011).
# - Data (SQLite, uploads, local backups) lives in the /data volume.
# Build:  docker build -t class-compass:$(git rev-parse --short HEAD) --build-arg APP_COMMIT=$(git rev-parse --short HEAD) .

ARG NODE_IMAGE=node:26-bookworm-slim

# ---------------------------------------------------------------- production dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Native modules (better-sqlite3, @node-rs/argon2, sharp) normally use prebuilt binaries; the
# toolchain is only a fallback and stays in this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------- client build + OCR data
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && OCR_CACHE_DIR=/out/ocr node scripts/prepare-ocr.ts

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ARG APP_COMMIT=""
# restic for off-site backups (D-017); tini as PID 1 so signals reach node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends restic tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data \
 && chown app:app /data
WORKDIR /app
COPY --chown=root:root package.json package-lock.json ./
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root src ./src
COPY --chown=root:root drizzle ./drizzle
# AI tools resources (S14h1, D-160): the user guides' Markdown, the theming guide and the package schema.
COPY --chown=root:root docs/guides/en ./docs/guides/en
COPY --chown=root:root docs/guides/tr ./docs/guides/tr
COPY --chown=root:root docs/THEMING.md docs/theme-package.schema.json ./docs/
COPY --chown=root:root scripts/prepare-ocr.ts ./scripts/prepare-ocr.ts
COPY --from=build --chown=root:root /app/dist/client ./dist/client
COPY --from=build --chown=root:root /out/ocr /opt/class-compass/ocr

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    DATA_DIR=/data \
    OCR_CACHE_DIR=/opt/class-compass/ocr \
    TRUST_PROXY=false \
    APP_COMMIT=${APP_COMMIT}

USER app
VOLUME ["/data"]
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server/main.ts"]
