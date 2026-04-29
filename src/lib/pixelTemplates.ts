/** Row-major 5×7 bitmaps, '1' = ink. Classic chunky letters. */

const LETTERS: Record<string, string[]> = {
  G: [
    "01110",
    "10001",
    "10000",
    "10011",
    "10001",
    "10001",
    "01110",
  ],
  M: [
    "10001",
    "11011",
    "10101",
    "10101",
    "10001",
    "10001",
    "10001",
  ],
};

const TEMPLATE_W = 40;
const TEMPLATE_H = 40;

function blitPattern(
  cells: boolean[],
  w: number,
  h: number,
  pat: string[],
  scale: number,
  ox: number,
  oy: number,
) {
  for (let py = 0; py < pat.length; py++) {
    const row = pat[py];
    for (let px = 0; px < row.length; px++) {
      const on = row[px] === "1";
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const gx = ox + px * scale + dx;
          const gy = oy + py * scale + dy;
          if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
            cells[gy * w + gx] = on;
          }
        }
      }
    }
  }
}

/** Centered “GM”, 3× scale (15×21 per letter), 4px gap, in 40×40. */
export function buildGm40x40(): boolean[] {
  const w = TEMPLATE_W;
  const h = TEMPLATE_H;
  const cells = new Array<boolean>(w * h).fill(false);
  const scale = 3;
  const letterW = 5 * scale;
  const letterH = 7 * scale;
  const gap = 4;
  const totalW = letterW + gap + letterW;
  const ox0 = Math.floor((w - totalW) / 2);
  const oy0 = Math.floor((h - letterH) / 2);
  blitPattern(cells, w, h, LETTERS.G, scale, ox0, oy0);
  blitPattern(cells, w, h, LETTERS.M, scale, ox0 + letterW + gap, oy0);
  return cells;
}

export const TEMPLATE_GRID_SIZE = { w: TEMPLATE_W, h: TEMPLATE_H } as const;
