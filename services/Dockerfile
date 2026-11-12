# One Dockerfile for all four Node.js services.
# Build from the repository root:
#   docker build -f services/Dockerfile --build-arg SERVICE=catalog -t libracloud-catalog .
FROM node:22-alpine

ARG SERVICE
ARG VERSION=dev
ENV NODE_ENV=production \
    SERVICE_VERSION=$VERSION \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=192

WORKDIR /srv/services

# Install dependencies first (cached unless package files change).
COPY services/shared/package*.json shared/
RUN cd shared && npm ci --omit=dev --no-audit --no-fund
COPY services/${SERVICE}/package*.json ${SERVICE}/
RUN cd ${SERVICE} && npm ci --omit=dev --no-audit --no-fund

COPY services/shared/ shared/
COPY services/${SERVICE}/ ${SERVICE}/

# Run as the unprivileged "node" user, never as root.
RUN mkdir -p /srv/services/${SERVICE}/uploads && chown -R node:node /srv/services/${SERVICE}/uploads
USER node
WORKDIR /srv/services/${SERVICE}

LABEL org.opencontainers.image.title="libracloud-${SERVICE}" org.opencontainers.image.version=$VERSION
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/index.js"]
