import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "./db/schema";
import { buildEpub } from "./epub/build";
import { SerialQueueService } from "./queue/service";
import type { ExtractedArticle } from "./types";

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

function makeArticle(url: string): ExtractedArticle {
  return {
    canonicalUrl: url,
    title: "End to End Article",
    author: "Integration Tester",
    publishedAt: "2026-04-07T07:30:00.000Z",
    sourceDomain: new URL(url).hostname,
    sourceUrl: url,
    fallbackUrl: null,
    leadImageUrl: null,
    contentHtml: "<p>Hello from the end-to-end test.</p>",
    assets: [],
  };
}

describe("end-to-end library pipeline", () => {
  test("queue processing builds EPUB, writes Calibre library, and updates service DB", async () => {
    const root = makeTempDir("bun-readlater-e2e-");
    const dbPath = join(root, "readlater.db");
    const libraryRoot = join(root, "library");
    const db = openDatabase(dbPath);

    const outRoot = join(root, "out");
    const deleted: string[] = [];
    const queue = new SerialQueueService(db, libraryRoot, {
      fetchAndExtractArticle: async () => makeArticle("https://example.com/articles/e2e"),
      buildEpub: async (article, outPath) => buildEpub(article, join(outRoot, outPath.split("/").pop()!)),
      deleteTempFile: (path) => {
        deleted.push(path);
        if (existsSync(path)) unlinkSync(path);
      },
    });

    const result = queue.enqueue("https://example.com/articles/e2e?utm_source=test");
    await queue.drain();

    const item = queue.getItem(result.id);
    expect(item).not.toBeNull();
    expect(item!.status).toBe("saved");
    expect(item!.canonicalUrl).toBe("https://example.com/articles/e2e");
    expect(item!.calibreBookId).not.toBeNull();
    expect(item!.calibreBookPath).not.toBeNull();
    expect(item!.contentHash).not.toBeNull();

    const calibreDbPath = join(libraryRoot, "metadata.db");
    const calibreDb = new Database(calibreDbPath, { readonly: true });
    const book = calibreDb.query("SELECT id, title, path FROM books WHERE id = ?").get(item!.calibreBookId) as { id: number; title: string; path: string } | null;
    expect(book).not.toBeNull();
    expect(book!.title).toBe("End to End Article");

    const dataRow = calibreDb.query("SELECT format, name FROM data WHERE book = ?").get(item!.calibreBookId) as { format: string; name: string } | null;
    expect(dataRow).not.toBeNull();
    expect(dataRow!.format).toBe("EPUB");
    expect(dataRow!.name).toBe("End to End Article");

    const comments = calibreDb.query("SELECT text FROM comments WHERE book = ?").get(item!.calibreBookId) as { text: string } | null;
    expect(comments).not.toBeNull();
    expect(comments!.text).toContain("https://example.com/articles/e2e");
    calibreDb.close();

    const epubBytes = readFileSync(item!.calibreBookPath!);
    const epubText = new TextDecoder().decode(epubBytes);
    expect(epubText).toContain("application/epub+zip");
    expect(epubText).toContain("OEBPS/content.opf");
    expect(epubText).toContain("End to End Article");
    expect(epubText).toContain("https://example.com/articles/e2e");

    expect(deleted.some((path) => path.endsWith(`${result.id}.epub`))).toBe(true);

    const detail = queue.getItemDetail(result.id)!;
    expect(detail.attempts.some((attempt) => attempt.status === "saved")).toBe(true);

    db.close();
  });
});
