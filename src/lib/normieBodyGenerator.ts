/**
 * Pixl bodies — procedural pixel extension below the canonical 40×40 Normie face.
 * Multiple outfit templates (simple silhouettes) share the same two-tone grid.
 *
 * Input: API `/normie/:id/pixels` string (1600 × '0'|'1', row-major, 1 = ink).
 * Output: composite grid 40×80 — face 40×40 + body 40×40 (hard-sized panel).
 *
 * Unofficial fan concept — not affiliated with Normies.
 */

export const NORMIE_GRID = 40;
/** Body outfit panel: always same resolution as the face (40×40). */
export const BODY_GRID = 40;

export const BODY_TEMPLATES = [
  "standard",
  "overalls",
  "pants",
  "tee",
  "tank",
  "hoodie",
  "suit",
  "coat",
  "dress",
  "robe",
  "armor",
  "sport",
  "tunic",
] as const;

export type BodyTemplate = (typeof BODY_TEMPLATES)[number];

export type BodyGenOptions = {
  /** Extra half-width at shoulders vs neck (0–12). */
  shoulderBoost: number;
  /** 0–1 tweaks deterministic detail from face hash. */
  styleT: number;
  /** Outfit silhouette (default standard). */
  template?: BodyTemplate;
};

const DEFAULT_OPTS: BodyGenOptions = {
  shoulderBoost: 6,
  styleT: 0.5,
  template: "standard",
};

export function parsePixels1600(bits: string): boolean[] {
  const out = new Array<boolean>(1600);
  for (let i = 0; i < 1600; i++) {
    const c = bits[i];
    out[i] = c === "1";
  }
  return out;
}

function faceAt(face: boolean[], x: number, y: number): boolean {
  if (x < 0 || x >= NORMIE_GRID || y < 0 || y >= NORMIE_GRID) return false;
  return face[y * NORMIE_GRID + x];
}

/** Lower-face column reads as skin (mostly non-ink) — for neckline gaps. */
function faceColumnMostlySkin(face: boolean[], x: number): boolean {
  const y0 = 24;
  let clear = 0;
  let n = 0;
  for (let fy = y0; fy < NORMIE_GRID; fy++) {
    n++;
    if (!faceAt(face, x, fy)) clear++;
  }
  return n >= 10 && clear / n >= 0.48;
}

/** Lowest row ink span — anchors neck / center. */
export function chinSpanFromFace(face: boolean[]): {
  left: number;
  right: number;
  center: number;
  width: number;
} {
  const y = NORMIE_GRID - 1;
  let left = NORMIE_GRID;
  let right = -1;
  for (let x = 0; x < NORMIE_GRID; x++) {
    if (face[y * NORMIE_GRID + x]) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < left) {
    return { left: 18, right: 21, center: 19, width: 4 };
  }
  return {
    left,
    right,
    center: Math.round((left + right) / 2),
    width: right - left + 1,
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic 0–1 from pixel string + knobs. */
export function deriveTweak(bits: string, styleT: number): number {
  let h = 2166136261;
  for (let i = 0; i < bits.length; i++) {
    h ^= bits.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = ((h >>> 0) % 10000) / 10000;
  return (u * 0.7 + styleT * 0.3) % 1;
}

type TorsoCtx = {
  face: boolean[];
  faceBits: string;
  cells: boolean[];
  totalH: number;
  bodyH: number;
  cx: number;
  neckHalf: number;
  shoulderHalf: number;
  tweak: number;
};

function wSet(c: TorsoCtx, x: number, y: number, on: boolean) {
  if (x < 0 || x >= NORMIE_GRID || y < NORMIE_GRID || y >= c.totalH) return;
  c.cells[y * NORMIE_GRID + x] = on;
}

function paintSpan(
  c: TorsoCtx,
  y: number,
  cx: number,
  halfW: number,
  jitter: boolean,
  rowIndex: number,
) {
  const lo = cx - halfW;
  const hi = cx + halfW;
  for (let x = Math.max(0, Math.floor(lo)); x <= Math.min(NORMIE_GRID - 1, Math.ceil(hi)); x++) {
    const dist = Math.abs(x - cx);
    const edgeDist = halfW - dist;
    if (edgeDist < 0) continue;
    const edgeFactor = edgeDist / Math.max(1, halfW);
    if (jitter) {
      const n = (rowIndex * 31 + x * 17 + (c.tweak * 1000) | 0) & 255;
      const skip = edgeFactor < 0.25 ? n % 3 === 0 : false;
      if (skip && edgeFactor < 0.2) continue;
    }
    wSet(c, x, y, true);
  }
}

/**
 * Clear outfit ink at the upper chest so the same light “skin” bits as the
 * face can read (uses chin span + lower-face skin columns; solid, no checker).
 */
function neckCarve(
  c: TorsoCtx,
  chin: ReturnType<typeof chinSpanFromFace>,
  neckY0: number,
  neckY1: number,
) {
  const x0 = Math.max(0, chin.left - 1);
  const x1 = Math.min(NORMIE_GRID - 1, chin.right + 1);
  for (let y = neckY0; y <= neckY1; y++) {
    for (let x = x0; x <= x1; x++) {
      const jawGap = !faceAt(c.face, x, NORMIE_GRID - 1);
      if (jawGap || faceColumnMostlySkin(c.face, x)) {
        wSet(c, x, y, false);
      }
    }
  }
}

/**
 * Where the body panel is already open at the neck, copy face rows upward so
 * skin tone / dither matches the face instead of a flat empty panel.
 */
function carryFaceSkinIntoNeckGaps(
  c: TorsoCtx,
  chin: ReturnType<typeof chinSpanFromFace>,
) {
  const yEnd = Math.min(NORMIE_GRID + 5, c.totalH - 1);
  const x0 = Math.max(0, chin.left - 2);
  const x1 = Math.min(NORMIE_GRID - 1, chin.right + 2);
  const halfBand = Math.ceil(chin.width / 2) + 2;
  for (let y = NORMIE_GRID; y <= yEnd; y++) {
    const dip = y - NORMIE_GRID;
    const srcY = Math.max(26, NORMIE_GRID - 1 - Math.min(dip, 9));
    for (let x = x0; x <= x1; x++) {
      if (Math.abs(x - chin.center) > halfBand) continue;
      const idx = y * NORMIE_GRID + x;
      if (c.cells[idx]) continue;
      c.cells[idx] = faceAt(c.face, x, srcY);
    }
  }
}

/** Half-width for each standard torso row (shared by seams / hem). */
function standardRowHalfW(
  i: number,
  bodyH: number,
  neckHalf: number,
  shoulderHalf: number,
  tweak: number,
): number {
  const p = i / Math.max(1, bodyH - 1);
  let halfW: number;
  if (p < 0.1) {
    halfW = neckHalf;
  } else if (p < 0.38) {
    const u = (p - 0.1) / 0.28;
    halfW = Math.round(mix(neckHalf, shoulderHalf, u * u));
  } else if (p < 0.82) {
    const sway = 0.04 * Math.sin((p - 0.38) * Math.PI * 3 + tweak * 6.28);
    halfW = Math.round(shoulderHalf * (1 + sway));
  } else {
    const u = (p - 0.82) / 0.18;
    halfW = Math.max(2, Math.round(shoulderHalf * (1 - u * 0.38)));
  }
  if (p > 0.08 && p < 0.16) halfW = Math.min(19, halfW + 1);
  return halfW;
}

/** Trapezoid torso + faux placket, side seams, double hem band. */
function paintStandard(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const halfW = standardRowHalfW(i, bodyH, neckHalf, shoulderHalf, tweak);
    paintSpan(c, y, cx, halfW, true, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));

  const placketY = NORMIE_GRID + Math.floor(bodyH * 0.32);
  for (let x = cx - 2; x <= cx + 2; x++) {
    if (x >= 0 && x < NORMIE_GRID) wSet(c, x, placketY, false);
  }

  const seamY0 = NORMIE_GRID + Math.floor(bodyH * 0.18);
  const seamY1 = NORMIE_GRID + Math.floor(bodyH * 0.62);
  for (let y = seamY0; y <= seamY1; y++) {
    const i = y - NORMIE_GRID;
    const hw = standardRowHalfW(i, bodyH, neckHalf, shoulderHalf, tweak);
    wSet(c, cx - hw, y, false);
    wSet(c, cx + hw, y, false);
  }

  const hwH = standardRowHalfW(bodyH - 1, bodyH, neckHalf, shoulderHalf, tweak);
  for (const y of [c.totalH - 2, c.totalH - 1]) {
    for (let x = cx - hwH; x <= cx + hwH; x++) {
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, true);
    }
  }
}

/** Tee: sleeve cap, crew armholes, dashed chest stripe, rib hem. */
function paintTee(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  const wBody = Math.round(mix(neckHalf, shoulderHalf * 0.92, 0.75));
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW = wBody;
    if (p < 0.08) halfW = Math.round(mix(neckHalf, wBody, p / 0.08));
    if (p > 0.1 && p < 0.24) halfW = Math.min(19, halfW + 2);
    if (p > 0.88) halfW = Math.max(neckHalf, Math.round(wBody * (1 - (p - 0.88) / 0.12 * 0.14)));
    paintSpan(c, y, cx, halfW, p > 0.12 && p < 0.88, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));

  for (let row = 0; row < Math.min(4, bodyH); row++) {
    const y = NORMIE_GRID + row;
    const w = Math.round(mix(neckHalf, wBody, row / 4));
    for (const side of [-1, 1] as const) {
      for (const d of [0, 1] as const) {
        const x = cx + side * (w - d);
        if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, false);
      }
    }
  }

  const stripeY = NORMIE_GRID + Math.floor(bodyH * 0.3);
  const skip = ((tweak * 1000) | 0) % 3;
  for (
    let x = Math.max(0, cx - wBody + 2);
    x <= Math.min(NORMIE_GRID - 1, cx + wBody - 2);
    x++
  ) {
    if ((x + skip) % 4 !== 0) wSet(c, x, stripeY, false);
  }

  const rib0 = NORMIE_GRID + Math.floor(bodyH * 0.82);
  for (let y = rib0; y < c.totalH; y++) {
    const wR = Math.max(neckHalf + 1, Math.round(wBody * 0.92));
    for (let x = cx - wR; x <= cx + wR; x++) {
      if (x < 0 || x >= NORMIE_GRID) continue;
      if ((x + y) % 2 === 0) wSet(c, x, y, false);
    }
  }
}

/**
 * Tank: scoop is at the neck/upper chest — widest opening at the top, tapering
 * shut before the mid-torso so the belly stays a solid shirt block. Armholes
 * only bite the outer silhouette.
 */
function paintTank(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  const wBody = Math.round(mix(neckHalf, shoulderHalf * 0.78, 0.65));

  const rowHalfW = (i: number) => {
    const p = i / Math.max(1, bodyH - 1);
    let halfW = wBody;
    if (p < 0.06) halfW = Math.round(mix(neckHalf, wBody, p / 0.06));
    if (p > 0.9) halfW = Math.max(neckHalf, Math.round(wBody * (1 - (p - 0.9) / 0.1 * 0.12)));
    return halfW;
  };

  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    paintSpan(c, y, cx, rowHalfW(i), false, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));

  const scoopEnd = Math.max(
    6,
    Math.min(bodyH - 8, Math.floor(bodyH * 0.24)),
  );
  for (let i = 0; i <= scoopEnd; i++) {
    const y = NORMIE_GRID + i;
    const t = scoopEnd > 0 ? i / scoopEnd : 0;
    const hw = rowHalfW(i);
    const strapW = i < Math.ceil(scoopEnd * 0.38) ? 1 : 2;
    const open01 = (1 - t) ** 1.25;
    let halfOpen = Math.round(Math.max(0, hw - strapW) * open01);
    if (i <= 2) {
      halfOpen = Math.max(
        halfOpen,
        Math.round(Math.max(0, hw - strapW) * (0.94 - i * 0.12)),
      );
    }
    if (halfOpen <= 0) continue;
    for (let dx = -halfOpen; dx <= halfOpen; dx++) {
      const x = cx + dx;
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, false);
    }
  }

  const lipY = NORMIE_GRID + Math.min(scoopEnd, Math.max(2, Math.floor(scoopEnd * 0.72)));
  const hwLip = rowHalfW(lipY - NORMIE_GRID);
  const lipHalf = Math.min(hwLip - 1, Math.round(mix(1, hwLip - 1, 0.55)));
  if (lipHalf > 0) {
    for (const side of [-1, 1] as const) {
      const x = cx + side * lipHalf;
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, lipY, false);
    }
  }

  const armI0 = 1;
  const armI1 = Math.min(bodyH - 8, Math.floor(bodyH * 0.3));
  const strapPad = 2;
  for (let i = armI0; i <= armI1; i++) {
    const y = NORMIE_GRID + i;
    const hw = rowHalfW(i);
    const span = Math.max(1, armI1 - armI0);
    const bite = 1 + Math.floor(((i - armI0) / span) * 4);
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < Math.min(bite, Math.max(1, hw - strapPad)); k++) {
        const x = cx + side * (hw - k);
        if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, false);
      }
    }
  }

  const sideY0 = NORMIE_GRID + Math.floor(bodyH * 0.42);
  const sideY1 = NORMIE_GRID + Math.floor(bodyH * 0.72);
  for (let y = sideY0; y <= sideY1; y++) {
    if ((y - sideY0 + ((tweak * 100) | 0)) % 3 !== 0) continue;
    const hw = rowHalfW(y - NORMIE_GRID);
    wSet(c, cx - hw, y, false);
    wSet(c, cx + hw, y, false);
  }

  const hemY = c.totalH - 1;
  const wH = Math.max(neckHalf, Math.round(wBody * 0.94));
  for (let x = cx - wH; x <= cx + wH; x++) {
    if (x >= 0 && x < NORMIE_GRID && Math.abs(x - cx) > wH - 2) wSet(c, x, hemY, false);
  }
}

/** Hood volume, draw cords, kangaroo pocket window, rib cuffs. */
function paintHoodie(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  const puff = Math.min(19, shoulderHalf + 3);
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW: number;
    if (p < 0.12) {
      const u = p / 0.12;
      halfW = Math.round(mix(neckHalf + 1, puff, u));
    } else if (p < 0.55) {
      halfW = puff;
    } else {
      halfW = Math.max(2, Math.round(puff * (1 - (p - 0.55) / 0.45 * 0.22)));
    }
    paintSpan(c, y, cx, halfW, true, i);
  }
  for (let i = 0; i < Math.min(4, bodyH); i++) {
    const y = NORMIE_GRID + i;
    const extra = 2 - Math.floor(i / 2);
    for (let dx = -(neckHalf + extra); dx <= neckHalf + extra; dx++) {
      const ax = Math.abs(dx);
      if (ax === neckHalf + extra) wSet(c, cx + dx, y, true);
    }
  }

  const cordY0 = NORMIE_GRID + Math.floor(bodyH * 0.12);
  const cordY1 = NORMIE_GRID + Math.floor(bodyH * 0.3);
  for (let y = cordY0; y <= cordY1; y++) {
    for (const dx of [-4, 4] as const) {
      const x = cx + dx;
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, false);
    }
  }

  const pkTop = NORMIE_GRID + Math.floor(bodyH * 0.56);
  const pkBot = Math.min(c.totalH - 3, NORMIE_GRID + Math.floor(bodyH * 0.74));
  const pkHalf = Math.min(6, Math.max(4, Math.floor(puff * 0.45)));
  for (let y = pkTop; y <= pkBot; y++) {
    for (let x = cx - pkHalf; x <= cx + pkHalf; x++) {
      if (x < 0 || x >= NORMIE_GRID) continue;
      const edge = x === cx - pkHalf || x === cx + pkHalf || y === pkTop || y === pkBot;
      if (!edge) wSet(c, x, y, false);
    }
  }

  const rib0 = NORMIE_GRID + Math.floor(bodyH * 0.84);
  const wRib = Math.max(2, Math.round(puff * 0.9));
  for (let y = rib0; y < c.totalH; y++) {
    for (let x = cx - wRib; x <= cx + wRib; x++) {
      if (x < 0 || x >= NORMIE_GRID) continue;
      if ((x + y + ((tweak * 50) | 0)) % 2 === 0) wSet(c, x, y, false);
    }
  }

  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 5, c.totalH - 1));
}

/** Sharp shoulders + shallow V carve at center. */
function paintSuit(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW: number;
    if (p < 0.12) {
      halfW = neckHalf;
    } else if (p < 0.18) {
      const u = (p - 0.12) / 0.06;
      halfW = Math.round(mix(neckHalf, shoulderHalf, u));
    } else if (p < 0.78) {
      halfW = shoulderHalf;
    } else {
      halfW = Math.max(2, Math.round(shoulderHalf * (1 - (p - 0.78) / 0.22 * 0.25)));
    }
    paintSpan(c, y, cx, halfW, false, i);
    if (p < 0.2) {
      const vDepth = Math.max(0, Math.floor(((0.2 - p) / 0.2) * 3));
      for (let d = 0; d < vDepth; d++) wSet(c, cx + d, y, false);
      for (let d = 0; d < vDepth; d++) wSet(c, cx - d, y, false);
    }
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** A-line flare toward hem — long coat. */
function paintCoat(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  const maxFlare = Math.min(19, Math.round(shoulderHalf * 1.18));
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW: number;
    if (p < 0.1) {
      halfW = Math.round(mix(neckHalf, shoulderHalf, p / 0.1));
    } else {
      halfW = Math.round(mix(shoulderHalf, maxFlare, (p - 0.1) / 0.9));
    }
    paintSpan(c, y, cx, halfW, true, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Strong A-line — dress silhouette. */
function paintDress(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  const maxFlare = Math.min(19, Math.round(shoulderHalf * 1.28));
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    const halfW = Math.round(mix(neckHalf + 1, maxFlare, p * p));
    paintSpan(c, y, cx, halfW, true, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/**
 * Denim bib overalls (classic workwear read at 40×40): bib + split pocket,
 * straps and rivets, waistband + zipper fly, side buttons, leg split,
 * wearer's-right thigh utility stack, wearer's-left hammer loop tab.
 */
function paintOveralls(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  const slim = Math.max(neckHalf + 2, Math.round(shoulderHalf * 0.82));
  const rowHalfW = (i: number) => {
    const p = i / Math.max(1, bodyH - 1);
    let halfW = slim;
    if (p < 0.07) halfW = Math.round(mix(neckHalf, slim, p / 0.07));
    if (p > 0.88) halfW = Math.max(neckHalf + 1, Math.round(slim * (1 - (p - 0.88) / 0.12 * 0.12)));
    return halfW;
  };

  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    paintSpan(c, y, cx, rowHalfW(i), false, i);
  }

  const bibTop = NORMIE_GRID + Math.min(4, Math.floor(bodyH * 0.1));
  const bibBot = NORMIE_GRID + Math.floor(bodyH * 0.44);
  const bibHalf = Math.min(9, Math.max(5, neckHalf + 3));
  for (let y = bibTop; y <= bibBot; y++) {
    for (let x = cx - bibHalf; x <= cx + bibHalf; x++) {
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, true);
    }
  }

  const pocketLipY = bibTop + Math.max(2, Math.floor((bibBot - bibTop) * 0.18));
  for (let x = cx - bibHalf + 2; x <= cx + bibHalf - 2; x++) {
    if (x >= 0 && x < NORMIE_GRID) wSet(c, x, pocketLipY, false);
  }
  const divideBot = bibBot - 2;
  for (let y = pocketLipY + 1; y <= divideBot; y++) {
    wSet(c, cx, y, false);
  }

  const strapOut = Math.min(12, neckHalf + 4);
  const sx0 = cx - strapOut;
  const sx1 = cx + strapOut;
  for (let y = NORMIE_GRID; y < bibTop; y++) {
    for (const sx of [sx0, sx0 + 1, sx1 - 1, sx1]) {
      if (sx >= 0 && sx < NORMIE_GRID) wSet(c, sx, y, true);
    }
  }

  const rivetY = bibTop;
  for (const rx of [cx - bibHalf, cx + bibHalf]) {
    if (rx >= 0 && rx < NORMIE_GRID) wSet(c, rx, rivetY, true);
  }

  const adjY = NORMIE_GRID + Math.max(1, Math.floor((bibTop - NORMIE_GRID) / 2));
  for (const base of [sx0 + 1, sx1 - 1] as const) {
    if (base >= 0 && base < NORMIE_GRID) {
      wSet(c, base, adjY, true);
      wSet(c, base, adjY + 1, true);
    }
  }

  const stitchY = bibBot - 3;
  for (let dy = 0; dy < 3; dy++) {
    const y = stitchY + dy;
    if (y <= bibTop || y > bibBot) continue;
    for (let x = cx - bibHalf + 1; x < cx + bibHalf; x++) {
      if (x >= 0 && x < NORMIE_GRID && (x + y + ((tweak * 100) | 0)) % 3 === 0) {
        wSet(c, x, y, false);
      }
    }
  }

  const waistY = NORMIE_GRID + Math.floor(bodyH * 0.46);
  for (let x = Math.max(0, cx - slim); x <= Math.min(NORMIE_GRID - 1, cx + slim); x++) {
    wSet(c, x, waistY, true);
  }
  for (let x = cx - 1; x <= cx + 1; x++) {
    if (x >= 0 && x < NORMIE_GRID) wSet(c, x, waistY, false);
  }
  const flyLen = Math.min(6, Math.max(3, Math.floor(bodyH * 0.14)));
  for (let k = 1; k <= flyLen; k++) {
    const y = waistY + k;
    if (y >= c.totalH) break;
    wSet(c, cx, y, false);
  }

  const btnY = waistY - 1;
  for (const side of [-1, 1] as const) {
    const bx = cx + side * Math.min(slim, 18);
    if (bx >= 0 && bx < NORMIE_GRID) wSet(c, bx, btnY, true);
  }

  const crotchY = NORMIE_GRID + Math.floor(bodyH * 0.52);
  for (let y = crotchY; y < c.totalH; y++) {
    wSet(c, cx, y, false);
    if (y >= crotchY + Math.floor(bodyH * 0.18)) {
      wSet(c, cx - 1, y, false);
      wSet(c, cx + 1, y, false);
    }
  }

  const thighBase = NORMIE_GRID + Math.floor(bodyH * 0.56);
  const wearersRight = -1;
  for (let stack = 0; stack < 2; stack++) {
    const uy = thighBase + stack * 5;
    const hi = rowHalfW(Math.min(bodyH - 1, uy - NORMIE_GRID));
    const ucx = cx + wearersRight * Math.max(3, hi - 4);
    for (let py = 0; py < 3; py++) {
      for (let px = -1; px <= 1; px++) {
        const x = ucx + px;
        const y = uy + py;
        if (x < 0 || x >= NORMIE_GRID || y >= c.totalH) continue;
        const edge = Math.abs(px) === 1 || py === 0 || py === 2;
        if (!edge) wSet(c, x, y, false);
      }
    }
  }

  const hammerY = thighBase + 3;
  for (let dy = 0; dy < 5; dy++) {
    const y = hammerY + dy;
    if (y >= c.totalH) break;
    const i = y - NORMIE_GRID;
    const hi = rowHalfW(Math.min(bodyH - 1, i));
    const x = cx + hi + 1;
    if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, true);
  }

  const kneeY = NORMIE_GRID + Math.floor(bodyH * 0.68);
  for (const side of [-1, 1] as const) {
    const kx = cx + side * (slim - 3);
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const x = kx + px;
        if (x >= 0 && x < NORMIE_GRID) wSet(c, x, kneeY + py, true);
      }
    }
  }

  const hipY = NORMIE_GRID + Math.floor(bodyH * 0.62);
  for (const side of [-1, 1] as const) {
    const hx = cx + side * (slim - 2);
    for (let py = 0; py < 3; py++) {
      for (let px = 0; px < 2; px++) {
        const x = hx + px;
        if (x >= 0 && x < NORMIE_GRID) wSet(c, x, hipY + py, true);
      }
    }
  }

  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Pants only: high waist, fly, pocket hints, split legs, ankle cuffs. */
function paintPants(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf, tweak } = c;
  const waistRow = Math.floor(bodyH * 0.42);
  const hipHalf = Math.min(19, Math.max(neckHalf + 3, Math.round(shoulderHalf * 0.86)));
  const hemHalf = Math.max(neckHalf + 1, hipHalf - 2);

  for (let i = waistRow; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const t = (i - waistRow) / Math.max(1, bodyH - 1 - waistRow);
    const halfW = Math.round(mix(hipHalf, hemHalf, t * 0.75));
    paintSpan(c, y, cx, halfW, false, i);
  }

  const waistY = NORMIE_GRID + waistRow;
  for (let x = cx - hipHalf; x <= cx + hipHalf; x++) {
    if (x >= 0 && x < NORMIE_GRID) wSet(c, x, waistY, true);
  }

  const pocketY = waistY + 1;
  for (const side of [-1, 1] as const) {
    const px = cx + side * (hipHalf - 1);
    for (let k = 0; k < 3; k++) {
      const x = px - side * k;
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, pocketY + k, false);
    }
  }

  const flyLen = Math.min(6, Math.max(3, Math.floor(bodyH * 0.16)));
  for (let k = 0; k < flyLen; k++) {
    const y = waistY + 1 + k;
    if (y >= c.totalH) break;
    wSet(c, cx, y, false);
  }

  const crotchY = NORMIE_GRID + Math.floor(bodyH * 0.56);
  for (let y = crotchY; y < c.totalH; y++) {
    wSet(c, cx, y, false);
    if (y >= crotchY + Math.floor(bodyH * 0.18)) {
      wSet(c, cx - 1, y, false);
      wSet(c, cx + 1, y, false);
    }
  }

  const seamY0 = waistY + 2;
  const seamY1 = NORMIE_GRID + Math.floor(bodyH * 0.8);
  for (let y = seamY0; y <= seamY1; y++) {
    const i = y - NORMIE_GRID;
    const t = (i - waistRow) / Math.max(1, bodyH - 1 - waistRow);
    const halfW = Math.round(mix(hipHalf, hemHalf, t * 0.75));
    if ((y + ((tweak * 100) | 0)) % 3 !== 0) continue;
    wSet(c, cx - halfW, y, false);
    wSet(c, cx + halfW, y, false);
  }

  for (const y of [c.totalH - 2, c.totalH - 1]) {
    for (let x = cx - hemHalf; x <= cx + hemHalf; x++) {
      if (x >= 0 && x < NORMIE_GRID) wSet(c, x, y, true);
    }
  }

  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Wide body + outer sleeve columns on lower half. */
function paintRobe(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  const wide = Math.min(19, shoulderHalf + 4);
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW = Math.round(mix(neckHalf, wide, Math.min(1, p * 1.4)));
    paintSpan(c, y, cx, halfW, true, i);
  }
  const sleeveStart = NORMIE_GRID + Math.floor(bodyH * 0.35);
  for (let y = sleeveStart; y < c.totalH; y++) {
    const halfW = Math.min(
      19,
      Math.round(mix(neckHalf, wide, (y - NORMIE_GRID) / Math.max(1, bodyH - 1))),
    );
    wSet(c, cx - halfW, y, true);
    wSet(c, cx + halfW, y, true);
    wSet(c, cx - halfW + 1, y, true);
    wSet(c, cx + halfW - 1, y, true);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Horizontal plate bands. */
function paintArmor(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW = Math.round(mix(neckHalf, shoulderHalf, Math.min(1, p * 2.2)));
    if (i % 5 === 4) halfW = Math.max(neckHalf, halfW - 2);
    paintSpan(c, y, cx, halfW, false, i);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Compact + side stripes. */
function paintSport(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  const hi = Math.round(mix(neckHalf, shoulderHalf, 0.88));
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    let halfW = hi;
    if (p < 0.1) halfW = Math.round(mix(neckHalf, hi, p / 0.1));
    if (p > 0.88) halfW = Math.max(neckHalf, Math.round(hi * (1 - (p - 0.88) / 0.12 * 0.15)));
    paintSpan(c, y, cx, halfW, false, i);
  }
  const y0 = NORMIE_GRID + Math.floor(bodyH * 0.15);
  const y1 = c.totalH - 1 - Math.floor(bodyH * 0.12);
  const stripeIn = Math.max(2, hi - 3);
  for (let y = y0; y <= y1; y++) {
    wSet(c, cx - stripeIn, y, true);
    wSet(c, cx + stripeIn, y, true);
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

/** Moderate A-line + belt gap row. */
function paintTunic(c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) {
  const { bodyH, cx, neckHalf, shoulderHalf } = c;
  const maxW = Math.min(19, Math.round(shoulderHalf * 1.12));
  const beltRow = NORMIE_GRID + Math.floor(bodyH * 0.52);
  for (let i = 0; i < bodyH; i++) {
    const y = NORMIE_GRID + i;
    const p = i / Math.max(1, bodyH - 1);
    const halfW = Math.round(mix(neckHalf + 1, maxW, p * 0.95));
    paintSpan(c, y, cx, halfW, true, i);
    if (y === beltRow) {
      for (let x = cx - 2; x <= cx + 2; x++) wSet(c, x, y, false);
    }
  }
  neckCarve(c, chin, NORMIE_GRID, Math.min(NORMIE_GRID + 4, c.totalH - 1));
}

const PAINTERS: Record<
  BodyTemplate,
  (c: TorsoCtx, chin: ReturnType<typeof chinSpanFromFace>) => void
> = {
  standard: paintStandard,
  tee: paintTee,
  tank: paintTank,
  pants: paintPants,
  hoodie: paintHoodie,
  suit: paintSuit,
  coat: paintCoat,
  overalls: paintOveralls,
  dress: paintDress,
  robe: paintRobe,
  armor: paintArmor,
  sport: paintSport,
  tunic: paintTunic,
};

/**
 * Build composite bitmap: face on top, outfit template below.
 */
export function buildBodyComposite(
  faceBits1600: string,
  opts: Partial<BodyGenOptions> = {},
): { width: number; height: number; cells: boolean[] } {
  const o = { ...DEFAULT_OPTS, ...opts };
  const template: BodyTemplate = o.template ?? "standard";
  const bodyH = BODY_GRID;
  const face = parsePixels1600(faceBits1600);
  const totalH = NORMIE_GRID + BODY_GRID;
  const cells = new Array<boolean>(NORMIE_GRID * totalH).fill(false);

  for (let y = 0; y < NORMIE_GRID; y++) {
    for (let x = 0; x < NORMIE_GRID; x++) {
      cells[y * NORMIE_GRID + x] = face[y * NORMIE_GRID + x];
    }
  }

  const chin = chinSpanFromFace(face);
  const tweak = deriveTweak(faceBits1600, o.styleT);
  const boost = Math.max(0, Math.min(12, Math.round(o.shoulderBoost)));
  const neckHalf = Math.max(1, Math.ceil(chin.width / 2));
  const shoulderHalf = Math.min(
    19,
    Math.max(neckHalf + 2, neckHalf + boost),
  );

  const ctx: TorsoCtx = {
    face,
    faceBits: faceBits1600,
    cells,
    totalH,
    bodyH,
    cx: chin.center,
    neckHalf,
    shoulderHalf,
    tweak,
  };

  const painter = PAINTERS[template] ?? paintStandard;
  painter(ctx, chin);
  carryFaceSkinIntoNeckGaps(ctx, chin);

  return { width: NORMIE_GRID, height: totalH, cells };
}

/** API-style 0/1 string for composite (row-major). */
export function compositeToBits(composite: {
  width: number;
  height: number;
  cells: boolean[];
}): string {
  let s = "";
  for (let i = 0; i < composite.cells.length; i++) {
    s += composite.cells[i] ? "1" : "0";
  }
  return s;
}

/** Match on-chain preview colors from API docs: on #48494b, off #e3e5e4. */
export function drawCompositeToCanvas(
  canvas: HTMLCanvasElement,
  composite: { width: number; height: number; cells: boolean[] },
  scale: number,
) {
  const { width: w, height: h, cells } = composite;
  const s = Math.max(1, Math.floor(scale));
  canvas.width = w * s;
  canvas.height = h * s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const on = [0x48, 0x49, 0x4b, 255] as const;
  const off = [0xe3, 0xe5, 0xe4, 255] as const;
  const img = ctx.createImageData(w * s, h * s);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x] ? on : off;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const px = x * s + dx;
          const py = y * s + dy;
          const j = (py * (w * s) + px) * 4;
          img.data[j] = v[0];
          img.data[j + 1] = v[1];
          img.data[j + 2] = v[2];
          img.data[j + 3] = v[3];
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
