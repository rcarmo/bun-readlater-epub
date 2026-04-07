import { Image } from "imagescript";
import { parseHTML } from "linkedom";
import { getConfig } from "../config";
import type { ArticleAsset } from "../types";
import { browserFetch } from "./http";

const config = getConfig();
const GRAY4_LEVELS = [0, 85, 170, 255] as const;

export type ImageRenderMode = "gray8" | "gray4-dither";

function allowedImageType(contentType: string) {
  return /image\/(jpeg|jpg|png|webp|gif|svg\+xml)/i.test(contentType);
}

function canTransformImage(contentType: string) {
  return /image\/(jpeg|jpg|png)/i.test(contentType);
}

function inferOriginalExtension(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("svg")) return "svg";
  return "bin";
}

function nearestGray4Level(value: number) {
  let best = GRAY4_LEVELS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of GRAY4_LEVELS) {
    const distance = Math.abs(level - value);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

function computeLuminance(r: number, g: number, b: number) {
  return Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
}

export function resizeIfNeeded(image: Image) {
  if (image.width <= config.imageMaxWidth && image.height <= config.imageMaxHeight) {
    return image;
  }

  const widthRatio = config.imageMaxWidth / image.width;
  const heightRatio = config.imageMaxHeight / image.height;
  const scale = Math.min(widthRatio, heightRatio);
  const nextWidth = Math.max(1, Math.round(image.width * scale));
  const nextHeight = Math.max(1, Math.round(image.height * scale));
  return image.resize(nextWidth, nextHeight);
}

export function classifyImage(bitmap: Uint8ClampedArray, width: number, height: number, contentType: string): ImageRenderMode {
  let tonalMin = 255;
  let tonalMax = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  const buckets = new Set<number>();
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));

  const sampleLuma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return computeLuminance(bitmap[i]!, bitmap[i + 1]!, bitmap[i + 2]!);
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const luma = sampleLuma(x, y);
      tonalMin = Math.min(tonalMin, luma);
      tonalMax = Math.max(tonalMax, luma);
      buckets.add(Math.floor(luma / 16));

      if (x + step < width) {
        edgeSum += Math.abs(luma - sampleLuma(x + step, y));
        edgeCount += 1;
      }
      if (y + step < height) {
        edgeSum += Math.abs(luma - sampleLuma(x, y + step));
        edgeCount += 1;
      }
    }
  }

  const dynamicRange = tonalMax - tonalMin;
  const averageEdge = edgeCount > 0 ? edgeSum / edgeCount : 0;
  const looksLikeDiagram =
    contentType.includes("png") &&
    buckets.size <= 10 &&
    averageEdge >= 18 &&
    dynamicRange >= 96;

  return looksLikeDiagram ? "gray4-dither" : "gray8";
}

export function applyGray8(bitmap: Uint8ClampedArray) {
  for (let i = 0; i < bitmap.length; i += 4) {
    const gray = computeLuminance(bitmap[i]!, bitmap[i + 1]!, bitmap[i + 2]!);
    bitmap[i] = gray;
    bitmap[i + 1] = gray;
    bitmap[i + 2] = gray;
  }
}

export function applyGray4Dither(bitmap: Uint8ClampedArray, width: number, height: number) {
  const alpha = new Uint8ClampedArray(width * height);
  const luma = new Float32Array(width * height);

  for (let i = 0, p = 0; i < bitmap.length; i += 4, p += 1) {
    luma[p] = computeLuminance(bitmap[i]!, bitmap[i + 1]!, bitmap[i + 2]!);
    alpha[p] = bitmap[i + 3]!;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const oldPixel = Math.max(0, Math.min(255, luma[index]!));
      const newPixel = nearestGray4Level(oldPixel);
      const error = oldPixel - newPixel;
      luma[index] = newPixel;

      if (x + 1 < width) luma[index + 1] += error * (7 / 16);
      if (y + 1 < height) {
        if (x > 0) luma[index + width - 1] += error * (3 / 16);
        luma[index + width] += error * (5 / 16);
        if (x + 1 < width) luma[index + width + 1] += error * (1 / 16);
      }
    }
  }

  for (let p = 0, i = 0; p < luma.length; p += 1, i += 4) {
    const gray = Math.max(0, Math.min(255, Math.round(luma[p]!)));
    bitmap[i] = gray;
    bitmap[i + 1] = gray;
    bitmap[i + 2] = gray;
    bitmap[i + 3] = alpha[p]!;
  }
}

export async function transformImageAsset(asset: ArticleAsset): Promise<ArticleAsset> {
  if (!canTransformImage(asset.mediaType)) {
    return asset;
  }

  try {
    const image = resizeIfNeeded(await Image.decode(asset.bytes));
    const mode = classifyImage(image.bitmap, image.width, image.height, asset.mediaType);

    if (mode === "gray4-dither") {
      applyGray4Dither(image.bitmap, image.width, image.height);
      const bytes = await image.encode();
      return {
        ...asset,
        href: asset.href.replace(/\.[^.]+$/, ".png"),
        mediaType: "image/png",
        bytes,
      };
    }

    applyGray8(image.bitmap);
    const bytes = await image.encodeJPEG(82);
    return {
      ...asset,
      href: asset.href.replace(/\.[^.]+$/, ".jpg"),
      mediaType: "image/jpeg",
      bytes,
    };
  } catch {
    return asset;
  }
}

export async function inlineArticleImages(contentHtml: string, baseUrl: string): Promise<{ contentHtml: string; assets: ArticleAsset[]; leadImageUrl: string | null }> {
  const { document } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`);
  const images = [...document.querySelectorAll("img")];
  const assets: ArticleAsset[] = [];
  let index = 0;
  let leadImageUrl: string | null = null;

  for (const img of images) {
    const src = img.getAttribute("src")?.trim();
    if (!src) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(src, baseUrl).toString();
    } catch {
      continue;
    }

    try {
      const response = await browserFetch(absoluteUrl, {
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: baseUrl,
          "sec-fetch-dest": "image",
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "cross-site",
        },
      });
      if (!response.ok) continue;

      const contentType = (response.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
      if (!allowedImageType(contentType)) continue;
      const originalBytes = new Uint8Array(await response.arrayBuffer());
      if (originalBytes.length === 0) continue;

      const ext = inferOriginalExtension(contentType);
      const id = `img-${index + 1}`;
      const originalAsset: ArticleAsset = {
        id,
        href: `images/${id}.${ext}`,
        mediaType: contentType,
        bytes: originalBytes,
        sourceUrl: absoluteUrl,
      };
      const asset = await transformImageAsset(originalAsset);
      assets.push(asset);
      img.setAttribute("src", asset.href);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.removeAttribute("fetchpriority");
      img.removeAttribute("loading");
      img.removeAttribute("decoding");
      for (const attribute of [...img.getAttributeNames()]) {
        if (attribute.startsWith("data-")) {
          img.removeAttribute(attribute);
        }
      }
      if (!leadImageUrl) leadImageUrl = absoluteUrl;
      index += 1;
    } catch {
      continue;
    }
  }

  return {
    contentHtml: document.body.innerHTML,
    assets,
    leadImageUrl,
  };
}
