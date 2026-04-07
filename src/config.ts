export interface AppConfig {
  port: number;
  token: string;
  dbPath: string;
  articleLibraryRoot: string;
  tempRoot: string;
  archiveFallbackBaseUrl: string | null;
  imageMaxWidth: number;
  imageMaxHeight: number;
  fetchTimeoutMs: number;
  fetchMaxHtmlBytes: number;
  fetchRetries: number;
}

export function getConfig(): AppConfig {
  return {
    port: Number.parseInt(process.env.PORT || "8788", 10),
    token: process.env.READLATER_TOKEN || "change-me",
    dbPath: process.env.READLATER_DB_PATH || "./data/readlater.db",
    articleLibraryRoot: process.env.CALIBRE_ARTICLE_LIBRARY || "./data/calibre-articles",
    tempRoot: process.env.READLATER_TEMP_ROOT || process.env.TMPDIR || "./data/tmp",
    archiveFallbackBaseUrl: process.env.ARCHIVE_FALLBACK_BASE_URL || null,
    imageMaxWidth: Number.parseInt(process.env.READLATER_IMAGE_MAX_WIDTH || "800", 10),
    imageMaxHeight: Number.parseInt(process.env.READLATER_IMAGE_MAX_HEIGHT || "600", 10),
    fetchTimeoutMs: Number.parseInt(process.env.READLATER_FETCH_TIMEOUT_MS || "15000", 10),
    fetchMaxHtmlBytes: Number.parseInt(process.env.READLATER_FETCH_MAX_HTML_BYTES || "3145728", 10),
    fetchRetries: Number.parseInt(process.env.READLATER_FETCH_RETRIES || "2", 10),
  };
}
