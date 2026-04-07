import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getConfig, type AppConfig } from "./config";
import { openDatabase } from "./db/schema";
import { SerialQueueService } from "./queue/service";
import type { ItemDetailRecord, ItemRecord, SaveResponse } from "./types";
import { renderItemDetailPage, renderSaveAckPage } from "./web/detail";
import { renderBookmarkletPage, renderItemsPage } from "./web/html";

interface QueueLike {
  listItems(): ItemRecord[];
  getItemDetail(id: string): ItemDetailRecord | null;
  enqueue(url: string, options?: { forceRefetch?: boolean }): SaveResponse;
  enqueueExisting(id: string, kind: "retry" | "refetch"): SaveResponse;
}

function jsonError(status: number, message: string) {
  return Response.json({ status: "failed", message }, { status });
}

export function printHelp() {
  console.log(`bun-readlater-epub\n\nEnvironment:\n  READLATER_TOKEN\n  READLATER_DB_PATH\n  CALIBRE_ARTICLE_LIBRARY\n  ARCHIVE_FALLBACK_BASE_URL\n  READLATER_IMAGE_MAX_WIDTH\n  READLATER_IMAGE_MAX_HEIGHT\n  READLATER_FETCH_TIMEOUT_MS\n  READLATER_FETCH_MAX_HTML_BYTES\n  READLATER_FETCH_RETRIES\n  PORT`);
}

export function createApp(config: AppConfig, queue: QueueLike) {
  return {
    port: config.port,
    async fetch(request: Request) {
      const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/items") {
      return new Response(renderItemsPage(queue.listItems(), config.token), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/bookmarklet") {
      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(renderBookmarkletPage(baseUrl, config.token), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/items/")) {
      const id = url.pathname.split("/")[2];
      if (!id) return jsonError(400, "Missing item id");
      const detail = queue.getItemDetail(id);
      if (!detail) return jsonError(404, "Item not found");
      if (url.searchParams.get("format") === "json") {
        return Response.json(detail);
      }
      return new Response(renderItemDetailPage(detail, config.token), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/save") {
      const contentType = request.headers.get("content-type") || "";
      let body: { url?: string; token?: string; forceRefetch?: boolean } | null = null;
      if (contentType.includes("application/json")) {
        body = await request.json().catch(() => null) as { url?: string; token?: string; forceRefetch?: boolean } | null;
      } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
        const form = await request.formData().catch(() => null);
        body = form ? {
          url: typeof form.get("url") === "string" ? String(form.get("url")) : undefined,
          token: typeof form.get("token") === "string" ? String(form.get("token")) : undefined,
          forceRefetch: String(form.get("forceRefetch") || "").toLowerCase() === "true",
        } : null;
      } else {
        body = await request.json().catch(() => null) as { url?: string; token?: string; forceRefetch?: boolean } | null;
      }

      if (!body?.token || body.token !== config.token) {
        if (request.headers.get("accept")?.includes("text/html")) {
          return new Response(renderSaveAckPage({ id: "", status: "unauthorized", message: "Invalid token" }, "/items", "/items"), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return Response.json({ status: "unauthorized", message: "Invalid token" }, { status: 401 });
      }
      if (!body.url) {
        if (request.headers.get("accept")?.includes("text/html")) {
          return new Response(renderSaveAckPage({ id: "", status: "failed", message: "Missing URL" }, "/items", "/items"), {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return jsonError(400, "Missing URL");
      }
      const result = queue.enqueue(body.url, { forceRefetch: body.forceRefetch });
      if (request.headers.get("accept")?.includes("text/html")) {
        return new Response(renderSaveAckPage(result, "/items", `/items/${encodeURIComponent(result.id)}`), {
          status: 202,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return Response.json(result, { status: 202 });
    }

    if (request.method === "POST" && url.pathname.match(/^\/items\/[^/]+\/retry$/)) {
      const contentType = request.headers.get("content-type") || "";
      let token: string | undefined;
      if (contentType.includes("application/json")) {
        const body = await request.json().catch(() => null) as { token?: string } | null;
        token = body?.token;
      } else {
        const form = await request.formData().catch(() => null);
        token = form && typeof form.get("token") === "string" ? String(form.get("token")) : undefined;
      }
      if (!token || token !== config.token) {
        if (request.headers.get("accept")?.includes("text/html")) {
          return new Response(renderSaveAckPage({ id: "", status: "unauthorized", message: "Invalid token" }, "/items", "/items"), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
        }
        return Response.json({ status: "unauthorized", message: "Invalid token" }, { status: 401 });
      }
      const id = url.pathname.split("/")[2];
      if (!id) return jsonError(400, "Missing item id");
      const result = queue.enqueueExisting(id, "retry");
      if (request.headers.get("accept")?.includes("text/html")) {
        return new Response(renderSaveAckPage(result, "/items", `/items/${encodeURIComponent(result.id)}`), { status: result.status === "failed" ? 404 : 202, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return Response.json(result, { status: result.status === "failed" ? 404 : 202 });
    }

    if (request.method === "POST" && url.pathname.match(/^\/items\/[^/]+\/refetch$/)) {
      const contentType = request.headers.get("content-type") || "";
      let token: string | undefined;
      if (contentType.includes("application/json")) {
        const body = await request.json().catch(() => null) as { token?: string } | null;
        token = body?.token;
      } else {
        const form = await request.formData().catch(() => null);
        token = form && typeof form.get("token") === "string" ? String(form.get("token")) : undefined;
      }
      if (!token || token !== config.token) {
        if (request.headers.get("accept")?.includes("text/html")) {
          return new Response(renderSaveAckPage({ id: "", status: "unauthorized", message: "Invalid token" }, "/items", "/items"), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
        }
        return Response.json({ status: "unauthorized", message: "Invalid token" }, { status: 401 });
      }
      const id = url.pathname.split("/")[2];
      if (!id) return jsonError(400, "Missing item id");
      const result = queue.enqueueExisting(id, "refetch");
      if (request.headers.get("accept")?.includes("text/html")) {
        return new Response(renderSaveAckPage(result, "/items", `/items/${encodeURIComponent(result.id)}`), { status: result.status === "failed" ? 404 : 202, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return Response.json(result, { status: result.status === "failed" ? 404 : 202 });
    }

      return new Response("Not found", { status: 404 });
    },
  };
}

if (import.meta.main) {
  const config = getConfig();
  mkdirSync(dirname(config.dbPath), { recursive: true });
  mkdirSync(config.articleLibraryRoot, { recursive: true });
  mkdirSync(config.tempRoot, { recursive: true });

  const db = openDatabase(config.dbPath);
  const queue = new SerialQueueService(db, config.articleLibraryRoot);

  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  Bun.serve(createApp(config, queue));
  console.log(`bun-readlater-epub listening on http://0.0.0.0:${config.port}`);
}
