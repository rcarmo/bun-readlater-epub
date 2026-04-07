import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { storeInArticleLibrary } from "../calibre/library";
import { buildEpub } from "../epub/build";
import { fetchAndExtractArticle } from "../fetch/article";
import type { AttemptKind, BuiltEpub, ExtractedArticle, ItemAttemptRecord, ItemDetailRecord, ItemRecord, SaveResponse } from "../types";

interface ItemRow {
  id: string;
  submitted_url: string;
  canonical_url: string | null;
  status: ItemRecord["status"];
  title: string | null;
  author: string | null;
  published_at: string | null;
  source_domain: string | null;
  source_url: string | null;
  fallback_url: string | null;
  content_hash: string | null;
  unread: number;
  queued: number;
  calibre_book_id: number | null;
  calibre_book_path: string | null;
  last_error: string | null;
  duplicate_of_item_id: string | null;
  created_at: string;
  updated_at: string;
  last_attempted_at: string | null;
  last_saved_at: string | null;
  last_refetched_at: string | null;
  refetch_count: number;
}

interface AttemptRow {
  id: string;
  item_id: string;
  attempt_kind: AttemptKind;
  status: string;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

interface PendingJob {
  id: string;
  kind: AttemptKind;
}

interface QueueDependencies {
  fetchAndExtractArticle: (url: string) => Promise<ExtractedArticle>;
  buildEpub: (article: ExtractedArticle, outPath: string) => Promise<BuiltEpub>;
  storeInArticleLibrary: (root: string, article: ExtractedArticle, epub: BuiltEpub, existingBookId?: number | null) => { bookId: number; bookPath: string };
  deleteTempFile: (path: string) => void;
}

function mapRow(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    submittedUrl: row.submitted_url,
    canonicalUrl: row.canonical_url,
    status: row.status,
    title: row.title,
    author: row.author,
    publishedAt: row.published_at,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
    fallbackUrl: row.fallback_url,
    contentHash: row.content_hash,
    unread: Boolean(row.unread),
    queued: Boolean(row.queued),
    calibreBookId: row.calibre_book_id,
    calibreBookPath: row.calibre_book_path,
    lastError: row.last_error,
    duplicateOfItemId: row.duplicate_of_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAttemptedAt: row.last_attempted_at,
    lastSavedAt: row.last_saved_at,
    lastRefetchedAt: row.last_refetched_at,
    refetchCount: row.refetch_count,
  };
}

function mapAttemptRow(row: AttemptRow): ItemAttemptRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    attemptKind: row.attempt_kind,
    status: row.status,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class SerialQueueService {
  private readonly pending: PendingJob[] = [];
  private running = false;
  private readonly deps: QueueDependencies;

  constructor(
    private readonly db: Database,
    private readonly articleLibraryRoot: string,
    deps?: Partial<QueueDependencies>,
  ) {
    this.deps = {
      fetchAndExtractArticle,
      buildEpub,
      storeInArticleLibrary,
      deleteTempFile: (path: string) => {
        if (existsSync(path)) unlinkSync(path);
      },
      ...deps,
    };
  }

  enqueue(url: string, options?: { forceRefetch?: boolean }): SaveResponse {
    const existing = this.findExistingByUrl(url);
    if (existing && options?.forceRefetch) {
      return this.enqueueExisting(existing.id, "refetch");
    }

    const now = new Date().toISOString();
    const itemId = randomUUID();

    this.db.query(`
      INSERT INTO items (id, submitted_url, status, unread, queued, created_at, updated_at)
      VALUES (?, ?, 'queued', 1, 1, ?, ?)
    `).run(itemId, url, now, now);

    this.pending.push({ id: itemId, kind: "save" });
    void this.pump();

    return {
      id: itemId,
      status: "queued",
      message: options?.forceRefetch ? "Queued for background processing" : "Queued for background processing",
    };
  }

  enqueueExisting(id: string, kind: Extract<AttemptKind, "retry" | "refetch">): SaveResponse {
    const item = this.getItem(id);
    if (!item) {
      return { id, status: "failed", message: "Item not found" };
    }

    const now = new Date().toISOString();
    this.db.query(`
      UPDATE items
      SET queued = 1,
          status = 'queued',
          updated_at = ?,
          last_error = CASE WHEN ? = 'retry' THEN NULL ELSE last_error END
      WHERE id = ?
    `).run(now, kind, id);

    this.pending.push({ id, kind });
    void this.pump();

    return {
      id,
      status: "queued",
      message: kind === "refetch" ? "Queued for refetch" : "Queued for retry",
    };
  }

  async drain() {
    while (this.running || this.pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  getItem(id: string): ItemRecord | null {
    const row = this.db.query(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | null;
    return row ? mapRow(row) : null;
  }

  getItemDetail(id: string): ItemDetailRecord | null {
    const item = this.getItem(id);
    if (!item) return null;
    const attempts = this.db.query(`
      SELECT * FROM item_attempts
      WHERE item_id = ?
      ORDER BY started_at DESC
    `).all(id).map((row) => mapAttemptRow(row as AttemptRow));
    return { item, attempts };
  }

  listItems(): ItemRecord[] {
    return this.db.query(`
      SELECT * FROM items
      ORDER BY created_at DESC
    `).all().map((row) => mapRow(row as ItemRow));
  }

  private findExistingByUrl(url: string): ItemRecord | null {
    const row = this.db.query(`
      SELECT * FROM items
      WHERE submitted_url = ? OR canonical_url = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(url, url) as ItemRow | null;
    return row ? mapRow(row) : null;
  }

  private findExistingByCanonicalUrl(canonicalUrl: string, excludeId: string): ItemRecord | null {
    const row = this.db.query(`
      SELECT * FROM items
      WHERE canonical_url = ? AND id <> ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(canonicalUrl, excludeId) as ItemRow | null;
    return row ? mapRow(row) : null;
  }

  private insertAttempt(itemId: string, kind: AttemptKind, status: string, message?: string | null) {
    const now = new Date().toISOString();
    const attemptId = randomUUID();
    this.db.query(`
      INSERT INTO item_attempts (id, item_id, attempt_kind, status, message, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(attemptId, itemId, kind, status, message ?? null, now, now);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (!job) continue;
        await this.processItem(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async processItem(job: PendingJob) {
    const row = this.db.query(`SELECT * FROM items WHERE id = ?`).get(job.id) as ItemRow | null;
    const item = row ? mapRow(row) : null;
    if (!item) return;

    const attemptAt = new Date().toISOString();
    try {
      this.db.query(`
        UPDATE items
        SET status = 'fetching', last_attempted_at = ?, updated_at = ?, queued = 1
        WHERE id = ?
      `).run(attemptAt, attemptAt, job.id);

      const article = await this.deps.fetchAndExtractArticle(item.submittedUrl);
      const duplicate = this.findExistingByCanonicalUrl(article.canonicalUrl, item.id);

      if (duplicate && job.kind !== "refetch") {
        this.db.query(`
          UPDATE items
          SET status = 'duplicate',
              queued = 0,
              fallback_url = ?,
              title = ?,
              author = ?,
              source_domain = ?,
              source_url = ?,
              duplicate_of_item_id = ?,
              updated_at = ?,
              last_error = NULL
          WHERE id = ?
        `).run(
          article.fallbackUrl,
          article.title,
          article.author,
          article.sourceDomain,
          article.canonicalUrl,
          duplicate.id,
          new Date().toISOString(),
          item.id,
        );
        this.insertAttempt(item.id, job.kind, "duplicate", `Duplicate of ${duplicate.id}`);
        return;
      }

      const target = job.kind === "refetch" && duplicate ? duplicate : item;
      const updateAt = new Date().toISOString();
      this.db.query(`
        UPDATE items
        SET canonical_url = ?, fallback_url = ?, title = ?, author = ?, source_domain = ?, source_url = ?, duplicate_of_item_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(article.canonicalUrl, article.fallbackUrl, article.title, article.author, article.sourceDomain, article.sourceUrl, updateAt, target.id);

      if (article.fallbackUrl) {
        const fallbackAt = new Date().toISOString();
        this.db.query(`UPDATE items SET status = 'fallback', updated_at = ? WHERE id = ?`).run(fallbackAt, target.id);
        this.insertAttempt(target.id, job.kind, 'fallback', article.fallbackUrl);
      }

      if (target.id !== item.id) {
        this.db.query(`
          UPDATE items
          SET status = 'duplicate', queued = 0, duplicate_of_item_id = ?, updated_at = ?
          WHERE id = ?
        `).run(target.id, updateAt, item.id);
      }

      const tmpPath = join("./out", `${target.id}.epub`);
      this.db.query(`UPDATE items SET status = 'building', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), target.id);
      const epub = await this.deps.buildEpub(article, tmpPath);
      try {
        const completedAt = new Date().toISOString();

        if (job.kind === "refetch" && target.contentHash && target.contentHash === epub.contentHash) {
          this.db.query(`
            UPDATE items
            SET status = 'saved',
                queued = 0,
                last_refetched_at = ?,
                refetch_count = refetch_count + 1,
                updated_at = ?,
                last_error = NULL
            WHERE id = ?
          `).run(completedAt, completedAt, target.id);
          this.insertAttempt(target.id, job.kind, "unchanged", epub.contentHash);
          return;
        }

        const stored = this.deps.storeInArticleLibrary(this.articleLibraryRoot, article, epub, target.calibreBookId);

        this.db.query(`
          UPDATE items
          SET status = 'saved',
              queued = 0,
              calibre_book_id = ?,
              calibre_book_path = ?,
              content_hash = ?,
              last_saved_at = ?,
              last_refetched_at = CASE WHEN ? = 'refetch' THEN ? ELSE last_refetched_at END,
              refetch_count = CASE WHEN ? = 'refetch' THEN refetch_count + 1 ELSE refetch_count END,
              updated_at = ?,
              last_error = NULL
          WHERE id = ?
        `).run(stored.bookId, stored.bookPath, epub.contentHash, completedAt, job.kind, completedAt, job.kind, completedAt, target.id);

        this.insertAttempt(target.id, job.kind, "saved", null);
      } finally {
        this.deps.deleteTempFile(tmpPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      this.db.query(`UPDATE items SET status = 'failed', queued = 0, last_error = ?, updated_at = ? WHERE id = ?`)
        .run(message, failedAt, job.id);
      this.insertAttempt(job.id, job.kind, "failed", message);
    }
  }
}
