FROM oven/bun:1.3.11 AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 readlater \
    && useradd -m -d /home/readlater -s /bin/sh -u 1000 -g 1000 readlater

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY docs ./docs
COPY docker ./docker
COPY README.md ./README.md

RUN chmod +x /app/docker/entrypoint.sh

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

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["bun", "run", "src/server.ts"]
