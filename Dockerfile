# A creator's own hive server (docs/host-your-hive.md): the coordinator in public mode, run from its
# /create page with the owner code set at deployment (KICKSWARM_OWNER_CODE). The registry, the owner's
# key and the snapshots live on the persistent volume mounted at /data: keep it, and back it up.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json README.md LICENSE LICENSE-DOCS ./
COPY src ./src
COPY web ./web
# The package the join command installs from this server (GET /kickswarm.tgz), then production modules only.
RUN npm run build && npm pack && mv kickswarm-*.tgz kickswarm.tgz && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    KICKSWARM_DATA=/data \
    KICKSWARM_HOME=/data/home
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web
COPY --from=build /app/kickswarm.tgz ./kickswarm.tgz
EXPOSE 7777
# Hosting providers mount the volume as they choose, often owned by root: the process stays root inside
# the container. Deliverables never run as code here: only in the WebAssembly sandbox, with no network
# and no disk.
CMD ["sh", "-c", "[ -n \"$KICKSWARM_OWNER_CODE\" ] || { echo 'Set KICKSWARM_OWNER_CODE (16 characters or more): it unlocks the /create page.' >&2; exit 1; }; exec node dist/cli.js coordinator --public --host 0.0.0.0 --port \"${PORT:-7777}\" --data \"$KICKSWARM_DATA\" --trust-proxy"]
