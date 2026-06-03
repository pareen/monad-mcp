# syntax=docker/dockerfile:1
# Production image for the Streamable-HTTP MCP transport (dist/server-http.js).
# Build stage compiles TypeScript; runtime stage ships only prod deps + dist.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# Defaults; override at deploy time (PUBLIC_BASE_URL, PRIVY_*, etc.).
ENV PORT=8787
ENV MONAD_DEFAULT_NETWORK=testnet
EXPOSE 8787

# No Privy creds by default => /mcp is an open, read-only gateway (write tools
# return AuthRequiredError). Add PRIVY_APP_ID/SECRET via `fly secrets` to enable
# the bearer-authed write flow.
CMD ["node", "dist/server-http.js"]
