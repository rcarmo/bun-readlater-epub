import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractedArticle } from "../types";
import { getConfig } from "../config";
import { browserFetch, type BrowserFetchOptions } from "./http";
import { inlineArticleImages } from "./images";
import { extractCanonicalUrl, extractPublishedAt, normalizeUrl } from "./normalize";
import { assertAcceptableHtmlResponse, readTextWithinLimit } from "./policy";

interface ExtractOptions {
  fetchImpl?: typeof browserFetch;
  inlineImagesImpl?: typeof inlineArticleImages;
  config?: ReturnType<typeof getConfig>;
}

async function fetchHtml(url: string, config: ReturnType<typeof getConfig>, fetchImpl: typeof browserFetch) {
  const response = await fetchImpl(url, {
    retries: config.fetchRetries,
    timeoutMs: config.fetchTimeoutMs,
  } satisfies BrowserFetchOptions);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  assertAcceptableHtmlResponse(response, config.fetchMaxHtmlBytes);
  const finalUrl = normalizeUrl(response.url || url);
  const html = await readTextWithinLimit(response, config.fetchMaxHtmlBytes);
  return { finalUrl, html };
}

function buildFallbackUrl(baseUrl: string, sourceUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/${encodeURIComponent(sourceUrl)}`;
}

async function extractFromHtml(html: string, sourceUrl: string, fallbackUrl: string | null, inlineImagesImpl: typeof inlineArticleImages): Promise<ExtractedArticle> {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article?.content || !article.title) {
    throw new Error("Readability extraction returned no content");
  }

  const canonicalUrl = extractCanonicalUrl(html, sourceUrl);
  const source = new URL(canonicalUrl);
  const withImages = await inlineImagesImpl(article.content, canonicalUrl);

  return {
    canonicalUrl,
    title: article.title,
    author: article.byline || null,
    publishedAt: extractPublishedAt(html),
    sourceDomain: source.hostname,
    sourceUrl,
    fallbackUrl,
    leadImageUrl: withImages.leadImageUrl,
    contentHtml: withImages.contentHtml,
    assets: withImages.assets,
  };
}

export async function fetchAndExtractArticle(url: string, options?: ExtractOptions): Promise<ExtractedArticle> {
  const config = options?.config || getConfig();
  const fetchImpl = options?.fetchImpl || browserFetch;
  const inlineImagesImpl = options?.inlineImagesImpl || inlineArticleImages;

  try {
    const { finalUrl, html } = await fetchHtml(url, config, fetchImpl);
    return await extractFromHtml(html, finalUrl, null, inlineImagesImpl);
  } catch (primaryError) {
    if (!config.archiveFallbackBaseUrl) throw primaryError;

    const fallbackUrl = buildFallbackUrl(config.archiveFallbackBaseUrl, url);
    try {
      const { finalUrl, html } = await fetchHtml(fallbackUrl, config, fetchImpl);
      return await extractFromHtml(html, finalUrl, fallbackUrl, inlineImagesImpl);
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Primary fetch failed: ${primaryMessage}; fallback fetch failed: ${fallbackMessage}`);
    }
  }
}
