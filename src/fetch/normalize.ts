import { parseHTML } from "linkedom";

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^source$/i,
  /^si$/i,
  /^spm$/i,
];

function isTrackingParam(name: string) {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  const nextParams = new URLSearchParams();
  const entries = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [name, value] of entries) {
    nextParams.append(name, value);
  }

  url.search = nextParams.toString();

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }

  return url.toString();
}

function firstMetaContent(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const content = node?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return null;
}

export function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const { document } = parseHTML(html);
  const linkHref = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim();
  const metaHref = firstMetaContent(document, [
    'meta[property="og:url"]',
    'meta[name="twitter:url"]',
  ]);

  const candidate = linkHref || metaHref || fallbackUrl;
  try {
    return normalizeUrl(new URL(candidate, fallbackUrl).toString());
  } catch {
    return normalizeUrl(fallbackUrl);
  }
}

export function extractPublishedAt(html: string): string | null {
  const { document } = parseHTML(html);
  const candidate = firstMetaContent(document, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="parsely-pub-date"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[itemprop="datePublished"]',
  ]) || document.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() || null;

  if (!candidate) return null;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
