FROM node:20-alpine AS deps

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry "${NPM_REGISTRY}"

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_DIST_DIR=.next-build
ENV API_BASE_INTERNAL=http://backend:8000

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser

ENV NODE_ENV=production \
    NEXT_DIST_DIR=.next-build \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=appuser:appgroup /app/.next-build/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next-build/static ./.next-build/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
