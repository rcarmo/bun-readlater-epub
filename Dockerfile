FROM oven/bun:1.3.11 AS runtime

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY docs ./docs
COPY README.md ./README.md

ENV HOST=0.0.0.0 \
    PORT=8788 \
    READLATER_DB_PATH=/data/readlater.db \
    CALIBRE_ARTICLE_LIBRARY=/books \
    READLATER_FETCH_TIMEOUT_MS=15000 \
    READLATER_FETCH_MAX_HTML_BYTES=3145728 \
    READLATER_FETCH_RETRIES=2 \
    READLATER_IMAGE_MAX_WIDTH=800 \
    READLATER_IMAGE_MAX_HEIGHT=600

EXPOSE 8788

CMD ["bun", "run", "src/server.ts"]
