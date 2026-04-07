import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../db/schema";
import { SerialQueueService } from "./service";
import type { BuiltEpub, ExtractedArticle } from "../types";

function tempDbPath() {
  return join(tmpdir(), `bun-readlater-queue-${crypto.randomUUID()}.sqlite`);
}

function makeArticle(url: string, overrides?: Partial<ExtractedArticle>): ExtractedArticle {
  return {
    canonicalUrl: url,
    title: "Test Article",
    author: "Tester",
    publishedAt: null,
    sourceDomain: new URL(url).hostname,
    sourceUrl: url,
    fallbackUrl: null,
    leadImageUrl: null,
    contentHtml: "<p>Hello</p>",
    assets: [],
    ...overrides,
  };
}

function makeEpub(title = "Test Article"): BuiltEpub {
  return {
    tmpPath: "/tmp/fake.epub",
    contentHash: `hash-${title}`,
    title,
  };
}

const dbPaths: string[] = [];

afterEach(() => {
  for (const path of dbPaths.splice(0)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
});

describe("SerialQueueService", () => {
  test("marks later save as duplicate when canonical URL already exists", async () => {
    const dbPath = tempDbPath();
    dbPaths.push(dbPath);
    const db = openDatabase(dbPath);

    const articles = new Map<string, ExtractedArticle>([
      ["https://example.com/a", makeArticle("https://canonical.example/article")],
      ["https://example.com/b", makeArticle("https://canonical.example/article", { title: "Same Article Again" })],
    ]);

    const saved: Array<{ existingBookId?: number | null }> = [];
    const queue = new SerialQueueService(db, "/tmp/library", {
      fetchAndExtractArticle: async (url) => articles.get(url)!,
      buildEpub: async (article) => makeEpub(article.title),
      storeInArticleLibrary: (_root, _article, _epub, existingBookId) => {
        saved.push({ existingBookId });
        return { bookId: 101, bookPath: "/tmp/library/article.epub" };
      },
      deleteTempFile: () => {},
    });

    const first = queue.enqueue("https://example.com/a");
    await queue.drain();
    const second = queue.enqueue("https://example.com/b");
    await queue.drain();

    const firstItem = queue.getItem(first.id)!;
    const secondItem = queue.getItem(second.id)!;

    expect(firstItem.status).toBe("saved");
    expect(secondItem.status).toBe("duplicate");
    expect(secondItem.duplicateOfItemId).toBe(firstItem.id);
    expect(saved.length).toBe(1);

    const attempts = db.query("SELECT attempt_kind, status FROM item_attempts ORDER BY started_at ASC").all() as Array<{ attempt_kind: string; status: string }>;
    expect(attempts.map((row) => `${row.attempt_kind}:${row.status}`)).toEqual(["save:saved", "save:duplicate"]);

    db.close();
  });

  test("forceRefetch reuses existing item and increments refetch metadata", async () => {
    const dbPath = tempDbPath();
    dbPaths.push(dbPath);
    const db = openDatabase(dbPath);

    let fetchCount = 0;
    const queue = new SerialQueueService(db, "/tmp/library", {
      fetchAndExtractArticle: async () => {
        fetchCount += 1;
        return makeArticle("https://canonical.example/refetch", { title: fetchCount === 1 ? "Original Article" : "Updated Article" });
      },
      buildEpub: async (article) => makeEpub(article.title),
      storeInArticleLibrary: (_root, article, _epub, existingBookId) => ({
        bookId: existingBookId ?? 201,
        bookPath: `/tmp/library/${article.title}.epub`,
      }),
      deleteTempFile: () => {},
    });

    const original = queue.enqueue("https://example.com/original");
    await queue.drain();
    const originalItem = queue.getItem(original.id)!;

    const refetch = queue.enqueue("https://canonical.example/refetch", { forceRefetch: true });
    expect(refetch.id).toBe(original.id);
    await queue.drain();

    const updatedItem = queue.getItem(original.id)!;
    expect(updatedItem.status).toBe("saved");
    expect(updatedItem.refetchCount).toBe(1);
    expect(updatedItem.lastRefetchedAt).not.toBeNull();
    expect(updatedItem.calibreBookId).toBe(201);

    const attempts = db.query("SELECT attempt_kind, status FROM item_attempts ORDER BY started_at ASC").all() as Array<{ attempt_kind: string; status: string }>;
    expect(attempts.map((row) => `${row.attempt_kind}:${row.status}`)).toEqual(["save:saved", "refetch:saved"]);

    db.close();
  });

  test("refetch skips library rewrite when content is unchanged", async () => {
    const dbPath = tempDbPath();
    dbPaths.push(dbPath);
    const db = openDatabase(dbPath);

    let storeCalls = 0;
    const queue = new SerialQueueService(db, "/tmp/library", {
      fetchAndExtractArticle: async () => makeArticle("https://canonical.example/unchanged", { title: "Stable Article" }),
      buildEpub: async () => ({ tmpPath: "/tmp/fake.epub", contentHash: "stable-hash", title: "Stable Article" }),
      storeInArticleLibrary: (_root, _article, _epub, existingBookId) => {
        storeCalls += 1;
        return { bookId: existingBookId ?? 777, bookPath: "/tmp/library/stable.epub" };
      },
      deleteTempFile: () => {},
    });

    const first = queue.enqueue("https://example.com/unchanged");
    await queue.drain();
    const initial = queue.getItem(first.id)!;
    expect(initial.status).toBe("saved");
    expect(initial.contentHash).toBe("stable-hash");
    expect(storeCalls).toBe(1);

    const refetch = queue.enqueueExisting(first.id, "refetch");
    expect(refetch.id).toBe(first.id);
    await queue.drain();

    const updated = queue.getItem(first.id)!;
    expect(updated.status).toBe("saved");
    expect(updated.refetchCount).toBe(1);
    expect(updated.lastRefetchedAt).not.toBeNull();
    expect(updated.lastSavedAt).toBe(initial.lastSavedAt);
    expect(storeCalls).toBe(1);

    const attempts = db.query("SELECT attempt_kind, status FROM item_attempts ORDER BY started_at ASC").all() as Array<{ attempt_kind: string; status: string }>;
    expect(attempts.map((row) => `${row.attempt_kind}:${row.status}`)).toEqual(["save:saved", "refetch:unchanged"]);

    db.close();
  });

  test("stores fallback URL when fallback extraction is used", async () => {
    const dbPath = tempDbPath();
    dbPaths.push(dbPath);
    const db = openDatabase(dbPath);

    const queue = new SerialQueueService(db, "/tmp/library", {
      fetchAndExtractArticle: async () => makeArticle("https://canonical.example/fallback", {
        title: "Fallback Article",
        sourceUrl: "https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw",
        fallbackUrl: "https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw",
      }),
      buildEpub: async (article) => makeEpub(article.title),
      storeInArticleLibrary: () => ({ bookId: 401, bookPath: "/tmp/library/fallback.epub" }),
      deleteTempFile: () => {},
    });

    const queued = queue.enqueue("https://example.com/raw");
    await queue.drain();

    const item = queue.getItem(queued.id)!;
    expect(item.status).toBe("saved");
    expect(item.fallbackUrl).toBe("https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw");
    expect(item.sourceUrl).toBe("https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw");

    const detail = queue.getItemDetail(queued.id)!;
    expect(detail.attempts.some((attempt) => attempt.status === "fallback")).toBe(true);

    db.close();
  });

  test("retry clears error and saves item on subsequent success", async () => {
    const dbPath = tempDbPath();
    dbPaths.push(dbPath);
    const db = openDatabase(dbPath);

    let fail = true;
    const deleted: string[] = [];
    const queue = new SerialQueueService(db, "/tmp/library", {
      fetchAndExtractArticle: async () => {
        if (fail) throw new Error("temporary failure");
        return makeArticle("https://canonical.example/retry", { title: "Recovered" });
      },
      buildEpub: async (article, outPath) => ({ ...makeEpub(article.title), tmpPath: outPath }),
      storeInArticleLibrary: () => ({ bookId: 301, bookPath: "/tmp/library/recovered.epub" }),
      deleteTempFile: (path) => { deleted.push(path); },
    });

    const first = queue.enqueue("https://example.com/retry");
    await queue.drain();
    const failed = queue.getItem(first.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("temporary failure");

    fail = false;
    const retried = queue.enqueueExisting(first.id, "retry");
    expect(retried.id).toBe(first.id);
    await queue.drain();

    const recovered = queue.getItem(first.id)!;
    expect(recovered.status).toBe("saved");
    expect(recovered.lastError).toBeNull();
    expect(recovered.calibreBookId).toBe(301);
    expect(deleted.some((path) => path.endsWith(`${first.id}.epub`))).toBe(true);

    const attempts = db.query("SELECT attempt_kind, status FROM item_attempts ORDER BY started_at ASC").all() as Array<{ attempt_kind: string; status: string }>;
    expect(attempts.map((row) => `${row.attempt_kind}:${row.status}`)).toEqual(["save:failed", "retry:saved"]);

    db.close();
  });
});
