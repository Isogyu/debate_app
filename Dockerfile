# 管理者のPC1台で動かす前提の構成（REQUIREMENTS.md §6.1）
FROM node:22-bookworm-slim AS base
WORKDIR /app
# better-sqlite3 のネイティブビルドに必要
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV DEBATE_DATA_DIR=/app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY package.json next.config.ts ./
COPY src/db ./src/db
# データは必ずボリュームに置く。未マウントだとコンテナ再作成で全部消える
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "run", "start:migrate"]
