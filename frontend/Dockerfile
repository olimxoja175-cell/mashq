FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN adduser -D -u 10001 worldvoice
COPY --from=build --chown=worldvoice /app/.next/standalone ./
COPY --from=build --chown=worldvoice /app/.next/static ./.next/static
COPY --from=build --chown=worldvoice /app/public ./public
USER worldvoice
EXPOSE 3000
CMD ["node", "server.js"]
