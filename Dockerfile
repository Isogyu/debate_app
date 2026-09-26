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
# Word に貼る統計グラフ（resvg で PNG 化）に日本語フォントが要る。ないと文字が□になる
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
# 起動時のマイグレーションに必要なものだけを持ち込む。
# tsconfig.json がないと "@/" の別名が解決できずマイグレーションが落ちる
COPY package.json next.config.ts tsconfig.json ./
COPY src ./src
# 資料取得の試験（npm run spike:sources）を本番のマシンで流せるようにする
COPY scripts ./scripts
# データは必ずボリュームに置く。未マウントだとコンテナ再作成で全部消える
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "run", "start:migrate"]
