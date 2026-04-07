import { describe, expect, test } from "bun:test";
import { extractCanonicalUrl, extractPublishedAt, normalizeUrl } from "./normalize";

describe("URL normalization", () => {
  test("removes tracking params, fragments, and default ports", () => {
    expect(normalizeUrl("HTTPS://Example.com:443/path/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/path?a=1&b=2");
  });

  test("preserves meaningful params while trimming trailing slash", () => {
    expect(normalizeUrl("https://example.com/article/?page=2&ref=homepage")).toBe("https://example.com/article?page=2");
  });

  test("keeps root slash intact", () => {
    expect(normalizeUrl("https://Example.com/?utm_medium=email")).toBe("https://example.com/");
  });
});

describe("canonical extraction", () => {
  test("prefers canonical link over fetched URL", () => {
    const html = `
      <html><head>
        <link rel="canonical" href="/article?utm_source=newsletter" />
        <meta property="og:url" content="https://other.example/ignored" />
      </head><body></body></html>
    `;

    expect(extractCanonicalUrl(html, "https://example.com/path?fbclid=abc")).toBe("https://example.com/article");
  });

  test("falls back to og:url when canonical link missing", () => {
    const html = `
      <html><head>
        <meta property="og:url" content="https://example.com/post/?utm_campaign=test&id=123" />
      </head></html>
    `;

    expect(extractCanonicalUrl(html, "https://example.com/raw")).toBe("https://example.com/post?id=123");
  });

  test("falls back to normalized fetched URL when no canonical metadata exists", () => {
    expect(extractCanonicalUrl("<html></html>", "https://example.com/x?utm_source=y#z")).toBe("https://example.com/x");
  });
});

describe("published date extraction", () => {
  test("extracts ISO date from article metadata", () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="2026-04-06T10:30:00+01:00" />
      </head></html>
    `;
    expect(extractPublishedAt(html)).toBe("2026-04-06T09:30:00.000Z");
  });

  test("falls back to time datetime attribute", () => {
    const html = `<html><body><time datetime="2026-04-05">April 5</time></body></html>`;
    expect(extractPublishedAt(html)).toBe("2026-04-05T00:00:00.000Z");
  });

  test("returns null for invalid dates", () => {
    const html = `<html><head><meta name="pubdate" content="not-a-date" /></head></html>`;
    expect(extractPublishedAt(html)).toBeNull();
  });
});
