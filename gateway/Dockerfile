# Stage 1: build the React website
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: nginx serves the website and routes /api to the services
FROM nginx:1.28-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="libracloud-gateway" org.opencontainers.image.version=$VERSION
ENV ORIGIN_VERIFY=""
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY gateway/default.conf.template /etc/nginx/templates/default.conf.template
COPY gateway/security-headers.conf gateway/proxy.conf /etc/nginx/snippets/
COPY --from=build /app/dist /usr/share/nginx/html
RUN echo "{\"service\":\"gateway\",\"version\":\"$VERSION\"}" > /usr/share/nginx/html/version.json
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
