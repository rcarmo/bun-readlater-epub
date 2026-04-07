export function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export function isLikelyHtmlContentType(contentType: string | null) {
  if (!contentType) return true;
  const value = contentType.split(";")[0]!.trim().toLowerCase();
  return value === "text/html" || value === "application/xhtml+xml";
}

export function assertAcceptableHtmlResponse(response: Response, maxHtmlBytes: number) {
  const contentType = response.headers.get("content-type");
  if (!isLikelyHtmlContentType(contentType)) {
    throw new Error(`Fetch returned non-HTML content-type: ${contentType}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > maxHtmlBytes) {
      throw new Error(`Fetch returned oversized HTML payload: ${size} bytes > ${maxHtmlBytes}`);
    }
  }
}

export async function readTextWithinLimit(response: Response, maxBytes: number) {
  const text = await response.text();
  const size = new TextEncoder().encode(text).length;
  if (size > maxBytes) {
    throw new Error(`Fetched HTML exceeds limit after download: ${size} bytes > ${maxBytes}`);
  }
  return text;
}
