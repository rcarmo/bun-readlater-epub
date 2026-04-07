import { getConfig } from "../config";
import { isRetryableStatus } from "./policy";

export const SAFARI_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

export function buildBrowserHeaders(url: string): HeadersInit {
  const target = new URL(url);
  const origin = `${target.protocol}//${target.host}`;

  return {
    "user-agent": SAFARI_USER_AGENT,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "referer": origin,
  };
}

export interface BrowserFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

function shouldRetry(method: string, status: number, attempt: number, retries: number) {
  return ["GET", "HEAD"].includes(method.toUpperCase()) && attempt < retries && isRetryableStatus(status);
}

export async function browserFetch(url: string, init?: BrowserFetchOptions) {
  const config = getConfig();
  const fetchImpl = init?.fetchImpl || fetch;
  const headers = {
    ...buildBrowserHeaders(url),
    ...(init?.headers || {}),
  };
  const method = (init?.method || "GET").toUpperCase();
  const retries = init?.retries ?? config.fetchRetries;
  const timeoutMs = init?.timeoutMs ?? config.fetchTimeoutMs;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Fetch timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        redirect: init?.redirect || "follow",
        headers,
        signal: init?.signal || controller.signal,
      });
      clearTimeout(timeout);
      if (!shouldRetry(method, response.status, attempt, retries)) {
        return response;
      }
      lastError = new Error(`Fetch failed with retryable status ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= retries || !["GET", "HEAD"].includes(method)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
