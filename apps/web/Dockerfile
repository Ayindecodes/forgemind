# The interface as a container: Next's standalone server and the files it
# traced, run as a non-root user. Built from the repository root, where the
# workspace's lockfile and the contract package are:
#   docker build -f apps/web/Dockerfile .
FROM node:24-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1 CI=1
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
RUN pnpm install --frozen-lockfile --filter @forgemind/web...
COPY tsconfig.base.json ./
COPY packages/contract packages/contract
COPY apps/web apps/web
# Where the browser finds the API, fixed into the scripts when they are built.
# A path, so one image serves any site that routes that path to the API.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_OUTPUT=standalone
RUN pnpm --filter @forgemind/web build

FROM node:24-bookworm-slim
ARG COMMIT=unknown
LABEL org.opencontainers.image.revision=$COMMIT
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
# The standalone server serves its scripts and styles from beside itself.
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/sign-in').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/web/server.js"]
