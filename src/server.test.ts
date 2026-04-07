import { describe, expect, test } from "bun:test";
import { createApp } from "./server";
import type { AppConfig } from "./config";
import type { ItemDetailRecord, ItemRecord, SaveResponse } from "./types";

const config: AppConfig = {
  port: 8788,
  token: "secret-token",
  dbPath: ":memory:",
  articleLibraryRoot: "/tmp/articles",
  archiveFallbackBaseUrl: null,
  imageMaxWidth: 800,
  imageMaxHeight: 600,
  fetchTimeoutMs: 1000,
  fetchMaxHtmlBytes: 1024 * 1024,
  fetchRetries: 0,
};

function makeItem(id: string, overrides?: Partial<ItemRecord>): ItemRecord {
  return {
    id,
    submittedUrl: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    status: "saved",
    title: "Example Article",
    author: "Tester",
    publishedAt: null,
    sourceDomain: "example.com",
    sourceUrl: "https://example.com/article",
    fallbackUrl: null,
    contentHash: "hash-1",
    unread: true,
    queued: false,
    calibreBookId: 1,
    calibreBookPath: "/tmp/articles/Example.epub",
    lastError: null,
    duplicateOfItemId: null,
    createdAt: "2026-04-06T10:00:00.000Z",
    updatedAt: "2026-04-06T10:01:00.000Z",
    lastAttemptedAt: "2026-04-06T10:00:30.000Z",
    lastSavedAt: "2026-04-06T10:01:00.000Z",
    lastRefetchedAt: null,
    refetchCount: 0,
    ...overrides,
  };
}

function makeQueue(overrides?: {
  listItems?: () => ItemRecord[];
  getItemDetail?: (id: string) => ItemDetailRecord | null;
  enqueue?: (url: string, options?: { forceRefetch?: boolean }) => SaveResponse;
  enqueueExisting?: (id: string, kind: "retry" | "refetch") => SaveResponse;
}) {
  const item = makeItem("item-1");
  return {
    listItems: overrides?.listItems || (() => [item]),
    getItemDetail: overrides?.getItemDetail || ((id: string) => id === item.id ? { item, attempts: [] } : null),
    enqueue: overrides?.enqueue || ((url: string, options?: { forceRefetch?: boolean }) => ({
      id: "queued-1",
      status: "queued",
      message: options?.forceRefetch ? `Queued refetch for ${url}` : `Queued ${url}`,
    })),
    enqueueExisting: overrides?.enqueueExisting || ((id: string, kind: "retry" | "refetch") => ({
      id,
      status: "queued",
      message: kind === "retry" ? "Queued for retry" : "Queued for refetch",
    })),
  };
}

describe("server app", () => {
  test("GET /items renders HTML queue page", async () => {
    const app = createApp(config, makeQueue({
      listItems: () => [makeItem("item-1", { status: "failed" })],
    }));
    const response = await app.fetch(new Request("http://readlater.local/items"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Read-later queue");
    expect(html).toContain("Install bookmarklet");
    expect(html).toContain("Example Article");
    expect(html).toContain("Retry");
    expect(html).toContain("Refetch");
  });

  test("GET /bookmarklet renders install page", async () => {
    const app = createApp(config, makeQueue());
    const response = await app.fetch(new Request("http://readlater.local/bookmarklet"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Install bookmarklet");
    expect(html).toContain("Save to Read Later");
    expect(html).toContain("secret-token");
  });

  test("GET /items/:id renders HTML detail page with actions", async () => {
    const app = createApp(config, makeQueue({
      getItemDetail: (id: string) => id === "item-1" ? { item: makeItem("item-1", { status: "saved", fallbackUrl: "https://archive.example/item" }), attempts: [] } : null,
    }));
    const response = await app.fetch(new Request("http://readlater.local/items/item-1"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Item detail");
    expect(html).toContain("Refetch");
    expect(html).toContain("Fallback URL");
    expect(html).toContain("https://archive.example/item");
  });

  test("GET /items/:id?format=json returns item detail JSON", async () => {
    const app = createApp(config, makeQueue());
    const response = await app.fetch(new Request("http://readlater.local/items/item-1?format=json"));
    const json = await response.json() as ItemDetailRecord;

    expect(response.status).toBe(200);
    expect(json.item.id).toBe("item-1");
    expect(Array.isArray(json.attempts)).toBe(true);
  });

  test("POST /save returns JSON acknowledgement for API clients", async () => {
    let captured: { url: string; forceRefetch?: boolean } | null = null;
    const app = createApp(config, makeQueue({
      enqueue: (url, options) => {
        captured = { url, forceRefetch: options?.forceRefetch };
        return { id: "queued-2", status: "queued", message: "Queued for background processing" };
      },
    }));

    const response = await app.fetch(new Request("http://readlater.local/save", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ url: "https://example.com/article", token: "secret-token", forceRefetch: true }),
    }));
    const json = await response.json() as SaveResponse;

    expect(response.status).toBe(202);
    expect(json.id).toBe("queued-2");
    expect(captured).toEqual({ url: "https://example.com/article", forceRefetch: true });
  });

  test("POST /save returns HTML ack page for browser form clients", async () => {
    const app = createApp(config, makeQueue());
    const form = new URLSearchParams({
      url: "https://example.com/article",
      token: "secret-token",
    });
    const response = await app.fetch(new Request("http://readlater.local/save", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept": "text/html",
      },
      body: form,
    }));
    const html = await response.text();

    expect(response.status).toBe(202);
    expect(html).toContain("Saved to Read Later");
    expect(html).toContain("Open queue");
  });

  test("POST /save rejects invalid token", async () => {
    const app = createApp(config, makeQueue());
    const response = await app.fetch(new Request("http://readlater.local/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/article", token: "wrong" }),
    }));
    const json = await response.json() as { status: string; message: string };

    expect(response.status).toBe(401);
    expect(json.status).toBe("unauthorized");
  });

  test("POST /items/:id/retry queues retry", async () => {
    let captured: { id: string; kind: "retry" | "refetch" } | null = null;
    const app = createApp(config, makeQueue({
      enqueueExisting: (id, kind) => {
        captured = { id, kind };
        return { id, status: "queued", message: "Queued for retry" };
      },
    }));

    const response = await app.fetch(new Request("http://readlater.local/items/item-1/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "secret-token" }),
    }));
    const json = await response.json() as SaveResponse;

    expect(response.status).toBe(202);
    expect(json.message).toContain("retry");
    expect(captured).toEqual({ id: "item-1", kind: "retry" });
  });

  test("POST /items/:id/refetch returns HTML ack page for browser form clients", async () => {
    let captured: { id: string; kind: "retry" | "refetch" } | null = null;
    const app = createApp(config, makeQueue({
      enqueueExisting: (id, kind) => {
        captured = { id, kind };
        return { id, status: "queued", message: "Queued for refetch" };
      },
    }));

    const form = new URLSearchParams({ token: "secret-token" });
    const response = await app.fetch(new Request("http://readlater.local/items/item-1/refetch", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "accept": "text/html" },
      body: form,
    }));
    const html = await response.text();

    expect(response.status).toBe(202);
    expect(html).toContain("Saved to Read Later");
    expect(html).toContain("Queued for refetch");
    expect(captured).toEqual({ id: "item-1", kind: "refetch" });
  });
});
