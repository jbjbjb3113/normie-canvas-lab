export type MotionLoopKind = "bob" | "pulse" | "wiggle" | "bounce";

/**
 * Builds a looping animation from a single PNG (no version history).
 * Cover-fits into `size`×`size`, transforms per frame, pixelated scaling.
 */
export function synthesizeMotionLoopFrames(
  img: HTMLImageElement,
  size: number,
  frameCount: number,
  kind: MotionLoopKind,
): Uint8ClampedArray[] {
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

  ctx.imageSmoothingEnabled = false;

  const scale0 = Math.max(size / sw, size / sh);
  const dw = sw * scale0;
  const dh = sh * scale0;
  const baseDx = (size - dw) / 2;
  const baseDy = (size - dh) / 2;

  const frames: Uint8ClampedArray[] = [];
  const n = Math.max(2, frameCount);

  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#12141a";
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(size / 2, size / 2);

    if (kind === "bob") {
      ctx.translate(0, 5 * Math.sin(t));
    } else if (kind === "pulse") {
      const s = 1 + 0.055 * Math.sin(t);
      ctx.scale(s, s);
    } else if (kind === "wiggle") {
      ctx.rotate(0.045 * Math.sin(t));
    } else {
      /* bounce */
      ctx.translate(0, 4 * Math.sin(t * 1.3));
      const s = 1 + 0.04 * Math.sin(t * 0.9);
      ctx.scale(s, s);
    }

    ctx.translate(-size / 2, -size / 2);
    ctx.drawImage(img, baseDx, baseDy, dw, dh);
    ctx.restore();

    frames.push(ctx.getImageData(0, 0, size, size).data);
  }

  return frames;
}
