import type { NormieTransformVersion } from "./normies-api";
import {
  imageOriginalPngUrl,
  normieVersionImagePngUrl,
} from "./normies-api";

/** Spacing between image GETs (~60 requests/minute on the API). */
export const MIN_IMAGE_FETCH_MS = 1100;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
  });
}

export function loadImageUrl(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load image: ${url}`));
    };
    signal?.addEventListener("abort", onAbort);
    img.src = url;
  });
}

/** Cover-fit `img` into a square; returns RGBA length `size * size * 4`. */
export function drawImageCoverToRgba(
  img: HTMLImageElement,
  size: number,
): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (sw === 0 || sh === 0) {
    throw new Error("Image has zero dimensions");
  }
  const scale = Math.max(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, size, size).data;
}

/** Pick `count` indices spread across `0..length-1` (inclusive endpoints when count > 1). */
export function evenlySpacedIndices(length: number, count: number): number[] {
  if (count <= 0 || length <= 0) return [];
  if (count === 1) return [length - 1];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.floor((i * (length - 1)) / (count - 1)));
  }
  return out;
}

export type EvolutionFramePlan = {
  urls: string[];
  /** Short labels for UI (e.g. "original", "v3"). */
  labels: string[];
};

export function buildEvolutionFramePlan(
  tokenId: number,
  versions: NormieTransformVersion[],
  maxFrames: number,
  prependOriginal: boolean,
): EvolutionFramePlan {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const cap = Math.max(1, Math.min(15, maxFrames));

  let versionSlots = prependOriginal ? cap - 1 : cap;
  versionSlots = Math.max(0, versionSlots);
  const take = Math.min(versionSlots, sorted.length);
  const idxs = evenlySpacedIndices(sorted.length, take);
  const picked = idxs.map((i) => sorted[i]!);

  const urls: string[] = [];
  const labels: string[] = [];

  if (prependOriginal) {
    urls.push(imageOriginalPngUrl(tokenId));
    labels.push("original");
  }
  for (const v of picked) {
    urls.push(normieVersionImagePngUrl(tokenId, v.version));
    labels.push(`v${v.version}`);
  }

  return { urls, labels };
}

export async function fetchAndRasterizeFrames(
  urls: string[],
  size: number,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Uint8ClampedArray[]> {
  const { signal, onProgress } = opts;
  const out: Uint8ClampedArray[] = [];
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await sleep(MIN_IMAGE_FETCH_MS, signal);
    const img = await loadImageUrl(urls[i]!, signal);
    out.push(drawImageCoverToRgba(img, size));
    onProgress?.(i + 1, urls.length);
  }
  return out;
}

/** Encodes frames as an animated GIF (lazy-loads `gifenc`). */
export async function encodeGif(
  framesRgba: Uint8ClampedArray[],
  size: number,
  frameDelayMs: number,
): Promise<Uint8Array> {
  if (framesRgba.length === 0) {
    throw new Error("No frames to encode");
  }
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();
  const palette = quantize(framesRgba[0]!, 256);

  for (let i = 0; i < framesRgba.length; i++) {
    const rgba = framesRgba[i]!;
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, size, size, {
      palette,
      delay: frameDelayMs,
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
}
