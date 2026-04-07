import { describe, expect, test } from "bun:test";
import { fetchAndExtractArticle } from "./article";

const ARTICLE_HTML = `
<!doctype html>
<html>
  <head>
    <title>Example Article</title>
    <link rel="canonical" href="https://example.com/articles/test?utm_source=newsletter" />
    <meta property="article:published_time" content="2026-04-06T10:30:00+01:00" />
  </head>
  <body>
    <article>
      <h1>Example Article</h1>
      <p>Hello world.</p>
    </article>
  </body>
</html>`;

describe("fetchAndExtractArticle", () => {
  test("extracts article from primary fetch", async () => {
    const article = await fetchAndExtractArticle("https://example.com/raw?utm_source=x", {
      config: {
        port: 8788,
        token: "x",
        dbPath: ":memory:",
        articleLibraryRoot: "/tmp/articles",
        archiveFallbackBaseUrl: null,
        imageMaxWidth: 800,
        imageMaxHeight: 600,
        fetchTimeoutMs: 1000,
        fetchMaxHtmlBytes: 1024 * 1024,
        fetchRetries: 0,
      },
      fetchImpl: async () => new Response(ARTICLE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      inlineImagesImpl: async (contentHtml) => ({
        contentHtml,
        assets: [],
        leadImageUrl: null,
      }),
    });

    expect(article.canonicalUrl).toBe("https://example.com/articles/test");
    expect(article.sourceUrl).toBe("https://example.com/raw");
    expect(article.fallbackUrl).toBeNull();
    expect(article.publishedAt).toBe("2026-04-06T09:30:00.000Z");
  });

  test("uses archive fallback when primary fetch fails", async () => {
    const calls: string[] = [];
    const article = await fetchAndExtractArticle("https://example.com/raw", {
      config: {
        port: 8788,
        token: "x",
        dbPath: ":memory:",
        articleLibraryRoot: "/tmp/articles",
        archiveFallbackBaseUrl: "https://archive.example/fetch",
        imageMaxWidth: 800,
        imageMaxHeight: 600,
        fetchTimeoutMs: 1000,
        fetchMaxHtmlBytes: 1024 * 1024,
        fetchRetries: 0,
      },
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (calls.length === 1) {
          throw new Error("origin blocked");
        }
        return new Response(ARTICLE_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
      inlineImagesImpl: async (contentHtml) => ({
        contentHtml,
        assets: [],
        leadImageUrl: null,
      }),
    });

    expect(calls).toEqual([
      "https://example.com/raw",
      "https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw",
    ]);
    expect(article.fallbackUrl).toBe("https://archive.example/fetch/https%3A%2F%2Fexample.com%2Fraw");
    expect(article.canonicalUrl).toBe("https://example.com/articles/test");
  });

  test("surfaces combined primary and fallback failures", async () => {
    await expect(fetchAndExtractArticle("https://example.com/raw", {
      config: {
        port: 8788,
        token: "x",
        dbPath: ":memory:",
        articleLibraryRoot: "/tmp/articles",
        archiveFallbackBaseUrl: "https://archive.example/fetch",
        imageMaxWidth: 800,
        imageMaxHeight: 600,
        fetchTimeoutMs: 1000,
        fetchMaxHtmlBytes: 1024 * 1024,
        fetchRetries: 0,
      },
      fetchImpl: async (url) => {
        if (String(url).startsWith("https://archive.example/")) {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("origin blocked");
      },
      inlineImagesImpl: async (contentHtml) => ({
        contentHtml,
        assets: [],
        leadImageUrl: null,
      }),
    })).rejects.toThrow("Primary fetch failed: origin blocked; fallback fetch failed:");
  });
});
