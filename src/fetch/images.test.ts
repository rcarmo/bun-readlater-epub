import { describe, expect, test } from "bun:test";
import { Image } from "imagescript";
import { applyGray4Dither, applyGray8, classifyImage, resizeIfNeeded, transformImageAsset } from "./images";
import type { ArticleAsset } from "../types";

function collectGrayValues(bitmap: Uint8ClampedArray) {
  const values = new Set<number>();
  for (let i = 0; i < bitmap.length; i += 4) {
    values.add(bitmap[i]!);
  }
  return values;
}

describe("image processing", () => {
  test("applyGray8 converts pixels to grayscale", () => {
    const bitmap = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      10, 20, 30, 255,
    ]);

    applyGray8(bitmap);

    for (let i = 0; i < bitmap.length; i += 4) {
      expect(bitmap[i]).toBe(bitmap[i + 1]);
      expect(bitmap[i + 1]).toBe(bitmap[i + 2]);
      expect(bitmap[i + 3]).toBe(255);
    }
  });

  test("applyGray4Dither quantizes output to four gray levels", () => {
    const width = 4;
    const height = 4;
    const bitmap = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const value = Math.round(((x + y * width) / (width * height - 1)) * 255);
        bitmap[i] = value;
        bitmap[i + 1] = value;
        bitmap[i + 2] = value;
        bitmap[i + 3] = 255;
      }
    }

    applyGray4Dither(bitmap, width, height);

    expect([...collectGrayValues(bitmap)].sort((a, b) => a - b)).toEqual([0, 85, 170, 255]);
  });

  test("classifyImage prefers gray4-dither for high-contrast PNG diagrams", () => {
    const width = 8;
    const height = 8;
    const bitmap = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const value = (x + y) % 2 === 0 ? 0 : 255;
        bitmap[i] = value;
        bitmap[i + 1] = value;
        bitmap[i + 2] = value;
        bitmap[i + 3] = 255;
      }
    }

    expect(classifyImage(bitmap, width, height, "image/png")).toBe("gray4-dither");
  });

  test("classifyImage prefers gray8 for photo-like JPEG images", () => {
    const width = 16;
    const height = 16;
    const bitmap = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        bitmap[i] = Math.min(255, x * 12);
        bitmap[i + 1] = Math.min(255, y * 12);
        bitmap[i + 2] = Math.min(255, (x + y) * 8);
        bitmap[i + 3] = 255;
      }
    }

    expect(classifyImage(bitmap, width, height, "image/jpeg")).toBe("gray8");
  });

  test("resizeIfNeeded caps images to the configured default box", () => {
    const image = new Image(1600, 1200);
    const resized = resizeIfNeeded(image);
    expect(resized.width).toBe(800);
    expect(resized.height).toBe(600);
  });

  test("transformImageAsset converts diagram-like PNGs to dithered grayscale PNG", async () => {
    const image = new Image(16, 16);
    for (let y = 1; y <= image.height; y += 1) {
      for (let x = 1; x <= image.width; x += 1) {
        const value = (x + y) % 2 === 0 ? 0 : 255;
        image.setPixelAt(x, y, Image.rgbaToColor(value, value, value, 255));
      }
    }

    const asset: ArticleAsset = {
      id: "img-1",
      href: "images/img-1.png",
      mediaType: "image/png",
      bytes: await image.encode(),
      sourceUrl: "https://example.com/test.png",
    };

    const result = await transformImageAsset(asset);
    expect(result.mediaType).toBe("image/png");
    expect(result.href).toBe("images/img-1.png");

    const decoded = await Image.decode(result.bytes);
    const grayValues = [...collectGrayValues(decoded.bitmap)].sort((a, b) => a - b);
    expect(grayValues.every((value) => [0, 85, 170, 255].includes(value))).toBe(true);
  });

  test("transformImageAsset converts photo-like JPEGs to grayscale JPEG", async () => {
    const image = new Image(32, 24);
    for (let y = 1; y <= image.height; y += 1) {
      for (let x = 1; x <= image.width; x += 1) {
        image.setPixelAt(x, y, Image.rgbaToColor((x * 7) % 256, (y * 11) % 256, ((x + y) * 9) % 256, 255));
      }
    }

    const asset: ArticleAsset = {
      id: "img-2",
      href: "images/img-2.png",
      mediaType: "image/jpeg",
      bytes: await image.encodeJPEG(90),
      sourceUrl: "https://example.com/test.jpg",
    };

    const result = await transformImageAsset(asset);
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.href).toBe("images/img-2.jpg");

    const decoded = await Image.decode(result.bytes);
    for (let i = 0; i < decoded.bitmap.length; i += 4) {
      expect(Math.abs(decoded.bitmap[i]! - decoded.bitmap[i + 1]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(decoded.bitmap[i + 1]! - decoded.bitmap[i + 2]!)).toBeLessThanOrEqual(2);
    }
  });
});
