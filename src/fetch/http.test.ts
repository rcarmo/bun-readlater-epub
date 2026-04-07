import { describe, expect, test } from "bun:test";
import { browserFetch } from "./http";

describe("browserFetch", () => {
  test("retries GET on retryable status codes", async () => {
    let attempts = 0;
    const response = await browserFetch("https://example.com/article", {
      retries: 2,
      timeoutMs: 1000,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("busy", { status: 503, headers: { "content-type": "text/html" } });
        }
        return new Response("ok", { status: 200, headers: { "content-type": "text/html" } });
      },
    });

    expect(attempts).toBe(3);
    expect(response.status).toBe(200);
  });

  test("does not retry POST on retryable status codes", async () => {
    let attempts = 0;
    const response = await browserFetch("https://example.com/save", {
      method: "POST",
      retries: 2,
      timeoutMs: 1000,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("busy", { status: 503, headers: { "content-type": "text/html" } });
      },
    });

    expect(attempts).toBe(1);
    expect(response.status).toBe(503);
  });

  test("retries thrown network errors for GET", async () => {
    let attempts = 0;
    const response = await browserFetch("https://example.com/article", {
      retries: 1,
      timeoutMs: 1000,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
        return new Response("ok", { status: 200, headers: { "content-type": "text/html" } });
      },
    });

    expect(attempts).toBe(2);
    expect(await response.text()).toBe("ok");
  });
});
