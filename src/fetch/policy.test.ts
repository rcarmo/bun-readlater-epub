import { describe, expect, test } from "bun:test";
import { assertAcceptableHtmlResponse, isLikelyHtmlContentType, isRetryableStatus, readTextWithinLimit } from "./policy";

describe("fetch policy", () => {
  test("identifies retryable statuses", () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
  });

  test("accepts html-like content types", () => {
    expect(isLikelyHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isLikelyHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isLikelyHtmlContentType(null)).toBe(true);
    expect(isLikelyHtmlContentType("application/json")).toBe(false);
  });

  test("rejects non-html responses", () => {
    const response = new Response("{}", {
      headers: { "content-type": "application/json" },
    });
    expect(() => assertAcceptableHtmlResponse(response, 1024)).toThrow("non-HTML");
  });

  test("rejects oversized html by content-length", () => {
    const response = new Response("<html></html>", {
      headers: {
        "content-type": "text/html",
        "content-length": "4096",
      },
    });
    expect(() => assertAcceptableHtmlResponse(response, 1024)).toThrow("oversized HTML payload");
  });

  test("rejects oversized html after reading", async () => {
    const response = new Response("x".repeat(2048), {
      headers: { "content-type": "text/html" },
    });
    await expect(readTextWithinLimit(response, 1024)).rejects.toThrow("exceeds limit");
  });

  test("returns html text within limit", async () => {
    const response = new Response("<html><body>ok</body></html>", {
      headers: { "content-type": "text/html" },
    });
    await expect(readTextWithinLimit(response, 1024)).resolves.toContain("<body>ok</body>");
  });
});
