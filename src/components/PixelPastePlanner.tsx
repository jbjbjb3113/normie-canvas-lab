import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildGm40x40, TEMPLATE_GRID_SIZE } from "../lib/pixelTemplates";

const GRID_MIN = 8;
const GRID_MAX = 128;
const DEFAULT_W = 40;
const DEFAULT_H = 40;

function clampGrid(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_W;
  return Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(n)));
}

function luminance(r: number, g: number, b: number, a: number): number {
  const f = a / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) * f;
}

/** Ordered4×4 Bayer matrix (0–15). Good for stippled 1-bit like GB Camera / Mac icons. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export type SampleMode = "flat" | "bayer4";

function toneMap(L: number, brightness: number, contrastPct: number): number {
  const c = contrastPct / 100;
  const v = (L - 128) * c + 128 + brightness;
  return Math.min(255, Math.max(0, v));
}

function sampleImageToCells(
  img: HTMLImageElement,
  w: number,
  h: number,
  thresholdPct: number,
  invert: boolean,
  mode: SampleMode,
  brightness: number,
  contrastPct: number,
): boolean[] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Array(w * h).fill(false);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const t = (thresholdPct / 100) * 255;
  const cells = new Array<boolean>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = i * 4;
      let L = luminance(data[j], data[j + 1], data[j + 2], data[j + 3]);
      L = toneMap(L, brightness, contrastPct);
      let thresh = t;
      if (mode === "bayer4") {
        const m = BAYER4[y & 3][x & 3];
        const spread = 6.8;
        thresh = Math.min(255, Math.max(0, t + (m - 7.5) * spread));
      }
      let on = L < thresh;
      if (invert) on = !on;
      cells[i] = on;
    }
  }
  return cells;
}

/** Starting point when loading the bundled Nakamoto card (busy bg + green face). */
export const NAKAMOTO_SAMPLE_PRESET = {
  sampleMode: "bayer4" as const,
  threshold: 42,
  contrastPct: 128,
  brightness: -16,
  invert: false,
};

export type SamplePreset = Partial<{
  sampleMode: SampleMode;
  threshold: number;
  contrastPct: number;
  brightness: number;
  invert: boolean;
}>;

function resizeCells(
  old: boolean[],
  ow: number,
  oh: number,
  nw: number,
  nh: number,
): boolean[] {
  const next = new Array(nw * nh).fill(false);
  for (let y = 0; y < Math.min(oh, nh); y++) {
    for (let x = 0; x < Math.min(ow, nw); x++) {
      next[y * nw + x] = old[y * ow + x];
    }
  }
  return next;
}

function gridToText(cells: boolean[], w: number, h: number): string {
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      row += cells[y * w + x] ? "1" : "0";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

/** Filled cells as `x,y` per line, 1-based to match human row/column counting. */
function gridToFilledCoordsText(cells: boolean[], w: number, h: number): string {
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x]) lines.push(`${x + 1},${y + 1}`);
    }
  }
  return lines.join("\n");
}

/** Match canvas.normies.art: bg #1a1b1c, “ink” / filled #e3e5e4 */
const MAP_OFF = [26, 27, 28, 255] as const;
const MAP_ON = [227, 229, 228, 255] as const;

function drawCellsToCanvas(
  canvas: HTMLCanvasElement,
  cells: boolean[],
  w: number,
  h: number,
) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = cells[i] ? MAP_ON : MAP_OFF;
    const j = i * 4;
    img.data[j] = v[0];
    img.data[j + 1] = v[1];
    img.data[j + 2] = v[2];
    img.data[j + 3] = v[3];
  }
  ctx.putImageData(img, 0, 0);
}

export function PixelPastePlanner() {
  const pasteId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pixelMapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [gridW, setGridW] = useState(DEFAULT_W);
  const [gridH, setGridH] = useState(DEFAULT_H);
  const [threshold, setThreshold] = useState(50);
  const [invert, setInvert] = useState(false);
  const [sampleMode, setSampleMode] = useState<SampleMode>("flat");
  const [brightness, setBrightness] = useState(0);
  const [contrastPct, setContrastPct] = useState(100);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [cells, setCells] = useState<boolean[]>(() =>
    new Array(DEFAULT_W * DEFAULT_H).fill(false),
  );
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const lastDims = useRef({ w: DEFAULT_W, h: DEFAULT_H });

  const w = clampGrid(gridW);
  const h = clampGrid(gridH);

  useEffect(() => {
    const cw = clampGrid(gridW);
    const ch = clampGrid(gridH);
    const { w: lw, h: lh } = lastDims.current;
    if (cw === lw && ch === lh) return;
    lastDims.current = { w: cw, h: ch };
    if (!source) {
      setCells((prev) => {
        if (prev.length === lw * lh) return resizeCells(prev, lw, lh, cw, ch);
        return new Array(cw * ch).fill(false);
      });
    }
  }, [gridW, gridH, source]);

  useEffect(() => {
    if (!source) return;
    const cw = clampGrid(gridW);
    const ch = clampGrid(gridH);
    setCells(
      sampleImageToCells(
        source,
        cw,
        ch,
        threshold,
        invert,
        sampleMode,
        brightness,
        contrastPct,
      ),
    );
  }, [
    source,
    gridW,
    gridH,
    threshold,
    invert,
    sampleMode,
    brightness,
    contrastPct,
  ]);

  const filledCount = useMemo(
    () => cells.reduce((n, c) => n + (c ? 1 : 0), 0),
    [cells],
  );

  useEffect(() => {
    const c = pixelMapCanvasRef.current;
    if (!c || cells.length !== w * h) return;
    drawCellsToCanvas(c, cells, w, h);
  }, [cells, w, h]);

  const applyFromImage = useCallback(
    (img: HTMLImageElement) => {
      const cw = clampGrid(gridW);
      const ch = clampGrid(gridH);
      setCells(
        sampleImageToCells(
          img,
          cw,
          ch,
          threshold,
          invert,
          sampleMode,
          brightness,
          contrastPct,
        ),
      );
    },
    [gridW, gridH, threshold, invert, sampleMode, brightness, contrastPct],
  );

  const loadImageFile = useCallback(
    (
      file: File,
      preset?: SamplePreset,
      meta?: { successHint?: string | null },
    ) => {
      let mime = file.type;
      if (!mime || mime === "application/octet-stream") {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".png")) mime = "image/png";
        else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
          mime = "image/jpeg";
        else if (lower.endsWith(".webp")) mime = "image/webp";
        else if (lower.endsWith(".gif")) mime = "image/gif";
        else mime = "image/png";
      }
      if (!mime.startsWith("image/")) {
        setPasteHint("That file is not an image.");
        return;
      }
      if (preset) {
        if (preset.sampleMode !== undefined) setSampleMode(preset.sampleMode);
        if (preset.threshold !== undefined) setThreshold(preset.threshold);
        if (preset.brightness !== undefined) setBrightness(preset.brightness);
        if (preset.contrastPct !== undefined) setContrastPct(preset.contrastPct);
        if (preset.invert !== undefined) setInvert(preset.invert);
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        void (async () => {
          try {
            await img.decode();
          } catch {
            /* still try to use bitmap */
          }
          setSource(img);
          if (meta && "successHint" in meta) {
            setPasteHint(meta.successHint ?? null);
          } else {
            setPasteHint(null);
          }
        })();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setPasteHint("Could not read that image.");
      };
      img.src = url;
    },
    [],
  );

  const loadBundledNakamotoReference = useCallback(async () => {
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}references/nakamoto-card.png`,
      );
      if (!res.ok) throw new Error(`Could not load reference (${res.status}).`);
      const blob = await res.blob();
      const file = new File([blob], "nakamoto-card.png", {
        type: blob.type || "image/png",
      });
      loadImageFile(file, NAKAMOTO_SAMPLE_PRESET, {
        successHint:
          "Nakamoto preset applied (Bayer + contrast). Best: square-crop the face in an editor, then re-load or paste.",
      });
    } catch (e) {
      setPasteHint(
        e instanceof Error ? e.message : "Could not load Nakamoto reference.",
      );
    }
  }, [loadImageFile]);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            loadImageFile(f);
            return;
          }
        }
      }
      setPasteHint("Clipboard has no image — copy an image first.");
    },
    [loadImageFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) loadImageFile(f);
    },
    [loadImageFile],
  );

  const setDimW = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    setGridW(Number.isFinite(n) ? n : DEFAULT_W);
  };

  const setDimH = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    setGridH(Number.isFinite(n) ? n : DEFAULT_H);
  };

  const reapplyFromSource = () => {
    if (source) applyFromImage(source);
  };

  const applyNakamotoSlidersOnly = useCallback(() => {
    setSampleMode(NAKAMOTO_SAMPLE_PRESET.sampleMode);
    setThreshold(NAKAMOTO_SAMPLE_PRESET.threshold);
    setBrightness(NAKAMOTO_SAMPLE_PRESET.brightness);
    setContrastPct(NAKAMOTO_SAMPLE_PRESET.contrastPct);
    setInvert(NAKAMOTO_SAMPLE_PRESET.invert);
    setPasteHint("Nakamoto slider preset — adjust threshold / brightness to taste.");
  }, []);

  const applyGmTemplate = useCallback(() => {
    const { w: tw, h: th } = TEMPLATE_GRID_SIZE;
    setSource(null);
    setGridW(tw);
    setGridH(th);
    lastDims.current = { w: tw, h: th };
    setCells(buildGm40x40());
    setPasteHint(
      "Template “GM” on 40×40. Reference image cleared so it is not re-sampled over the letters.",
    );
  }, []);

  /** While non-null, pointer is painting cells to `value` (draw vs erase from first cell). */
  const paintDragRef = useRef<{ value: boolean } | null>(null);

  const paintCell = useCallback((idx: number, value: boolean) => {
    setCells((prev) => {
      if (prev[idx] === value) return prev;
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
  }, []);

  const paintCellRef = useRef(paintCell);
  paintCellRef.current = paintCell;

  useEffect(() => {
    const endPaintDrag = () => {
      paintDragRef.current = null;
    };
    window.addEventListener("pointerup", endPaintDrag);
    window.addEventListener("pointercancel", endPaintDrag);
    window.addEventListener("blur", endPaintDrag);
    return () => {
      window.removeEventListener("pointerup", endPaintDrag);
      window.removeEventListener("pointercancel", endPaintDrag);
      window.removeEventListener("blur", endPaintDrag);
    };
  }, []);

  /** Fills gaps when the pointer moves quickly between tiny cells. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = paintDragRef.current;
      if (!drag) return;
      if (e.pointerType !== "touch" && e.buttons !== 1) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const cellEl = hit?.closest?.("[data-planner-cell]");
      if (!cellEl) return;
      const raw = (cellEl as HTMLElement).dataset.idx;
      const idx = raw === undefined ? NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(idx)) return;
      paintCellRef.current(idx, drag.value);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const onCellPointerDown = useCallback(
    (idx: number) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setCells((prev) => {
        const value = !prev[idx];
        paintDragRef.current = { value };
        const next = prev.slice();
        next[idx] = value;
        return next;
      });
    },
    [],
  );

  const onCellPointerEnter = useCallback((idx: number) => {
    const drag = paintDragRef.current;
    if (!drag) return;
    paintCellRef.current(idx, drag.value);
  }, []);

  const clearGrid = () => {
    setCells(new Array(w * h).fill(false));
  };

  const invertGrid = () => {
    setCells((prev) => prev.map((c) => !c));
  };

  const copyTextMap = async () => {
    const text = gridToText(cells, w, h);
    try {
      await navigator.clipboard.writeText(text);
      setPasteHint("Copied text grid (1 = fill, 0 = empty).");
    } catch {
      setPasteHint("Clipboard blocked — select the export area manually.");
    }
  };

  const copyFilledCoords = async () => {
    const text = gridToFilledCoordsText(cells, w, h);
    try {
      await navigator.clipboard.writeText(text);
      setPasteHint(
        text
          ? "Copied filled cells as x,y (1-based, one pair per line)."
          : "No filled cells to copy.",
      );
    } catch {
      setPasteHint("Clipboard blocked for coordinate list.");
    }
  };

  const downloadPixelMapPng = () => {
    const c = pixelMapCanvasRef.current;
    if (!c || c.width === 0) return;
    const a = document.createElement("a");
    a.download = `pixel-map-${w}x${h}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };

  return (
    <div className="paste-planner">
      <div
        className="paste-planner__drop"
        tabIndex={0}
        onPaste={onPaste}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <p className="paste-planner__drop-lede">
          <strong>Paste</strong> an image here (focus this box, then{" "}
          <kbd>Ctrl</kbd> or <kbd>Cmd</kbd>+<kbd>V</kbd>) or{" "}
          <strong>drop</strong> a file.
        </p>
        <div className="paste-planner__drop-actions">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => void loadBundledNakamotoReference()}
          >
            Load Nakamoto card reference
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose image…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="paste-planner__file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadImageFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {source && (
          <div className="paste-planner__thumb-wrap">
            <img
              className="paste-planner__thumb"
              src={source.src}
              alt="Source for sampling"
              width={Math.min(200, source.naturalWidth)}
              height="auto"
            />
          </div>
        )}
        <details className="paste-planner__nakamoto-tip">
          <summary>Stronger Nakamoto / busy-card workflow</summary>
          <ul className="paste-planner__nakamoto-tip-list">
            <li>
              <strong>Crop</strong> to a square on the face (or face + glasses).
              The full card won’t read at 40×40.
            </li>
            <li>
              Use <strong>Bayer 4×4</strong> + <strong>contrast</strong> for
              stipple like the competition; raise <strong>threshold</strong> if
              the Matrix rain speckles too much.
            </li>
            <li>
              <strong>Brightness</strong> down slightly can quiet the
              background; then paint hair / glasses back in with the drag tool.
            </li>
          </ul>
        </details>
      </div>

      {pasteHint && (
        <p className="paste-planner__hint" role="status">
          {pasteHint}
        </p>
      )}

      <div className="paste-planner__controls">
        <div className="paste-planner__field">
          <label htmlFor={`${pasteId}-w`}>Grid width</label>
          <input
            id={`${pasteId}-w`}
            className="input"
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridW}
            onChange={(e) => setDimW(e.target.value)}
          />
        </div>
        <div className="paste-planner__field">
          <label htmlFor={`${pasteId}-h`}>Grid height</label>
          <input
            id={`${pasteId}-h`}
            className="input"
            type="number"
            min={GRID_MIN}
            max={GRID_MAX}
            value={gridH}
            onChange={(e) => setDimH(e.target.value)}
          />
        </div>
        <div className="paste-planner__field">
          <label htmlFor={`${pasteId}-mode`}>1-bit sampling</label>
          <select
            id={`${pasteId}-mode`}
            className="input paste-planner__select"
            value={sampleMode}
            onChange={(e) =>
              setSampleMode(e.target.value as SampleMode)
            }
          >
            <option value="flat">Flat threshold</option>
            <option value="bayer4">Bayer 4×4 dither (stipple)</option>
          </select>
        </div>
        <div className="paste-planner__field paste-planner__field--grow">
          <label htmlFor={`${pasteId}-t`}>
            Threshold (darker = fill below)
          </label>
          <input
            id={`${pasteId}-t`}
            type="range"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <span className="paste-planner__threshold-val">{threshold}%</span>
        </div>
        <div className="paste-planner__field paste-planner__field--grow">
          <label htmlFor={`${pasteId}-bright`}>Brightness</label>
          <input
            id={`${pasteId}-bright`}
            type="range"
            min={-60}
            max={60}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
          />
          <span className="paste-planner__threshold-val">{brightness}</span>
        </div>
        <div className="paste-planner__field paste-planner__field--grow">
          <label htmlFor={`${pasteId}-contrast`}>Contrast</label>
          <input
            id={`${pasteId}-contrast`}
            type="range"
            min={60}
            max={180}
            value={contrastPct}
            onChange={(e) => setContrastPct(Number(e.target.value))}
          />
          <span className="paste-planner__threshold-val">{contrastPct}%</span>
        </div>
        <label className="paste-planner__check">
          <input
            type="checkbox"
            checked={invert}
            onChange={(e) => setInvert(e.target.checked)}
          />
          Invert
        </label>
      </div>

      <div className="paste-planner__actions">
        <button
          type="button"
          className="btn btn--small"
          onClick={applyGmTemplate}
        >
          Template: GM (40×40)
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!source}
          onClick={reapplyFromSource}
        >
          Re-sample image
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={applyNakamotoSlidersOnly}
        >
          Nakamoto slider preset
        </button>
        <button type="button" className="btn btn--small" onClick={clearGrid}>
          Clear grid
        </button>
        <button type="button" className="btn btn--small" onClick={invertGrid}>
          Invert cells
        </button>
        <button type="button" className="btn btn--small" onClick={copyTextMap}>
          Copy text map
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void copyFilledCoords()}
        >
          Copy filled x,y
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={downloadPixelMapPng}
        >
          Download pixel map PNG
        </button>
      </div>

      <p className="paste-planner__meta">
        {filledCount} filled cells · {w}×{h}. Click to toggle; drag across
        cells to paint (empty → fill, filled → erase). Match{" "}
        <a
          href="https://canvas.normies.art/"
          target="_blank"
          rel="noreferrer"
        >
          Community Canvas
        </a>{" "}
        size for a 1:1 map.{" "}
        <strong>This app does not post to their site</strong> — use the grid /
        export, then paint on canvas by hand.
      </p>

      <div
        className="paste-planner__grid"
        style={{
          gridTemplateColumns: `repeat(${w}, var(--paste-cell))`,
        }}
      >
        {cells.map((on, idx) => {
          const x = idx % w;
          const y = Math.floor(idx / w);
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              className={
                on
                  ? "paste-planner__cell paste-planner__cell--on"
                  : "paste-planner__cell"
              }
              data-planner-cell
              data-idx={idx}
              onPointerDown={onCellPointerDown(idx)}
              onPointerEnter={() => onCellPointerEnter(idx)}
              aria-label={`Cell ${x + 1}, ${y + 1}, ${on ? "filled" : "empty"}`}
            />
          );
        })}
      </div>

      <div className="paste-planner__pixel-map-wrap">
        <h3 className="paste-planner__pixel-map-heading">Pixel map preview</h3>
        <p className="paste-planner__pixel-map-note">
          One PNG pixel per grid cell (exact {w}×{h}). Scaled up with crisp
          edges — same data as the editor above.
        </p>
        <canvas
          ref={pixelMapCanvasRef}
          className="paste-planner__pixel-map-canvas"
          aria-label={`Pixel map ${w} by ${h}`}
        />
      </div>

      <details className="paste-planner__export">
        <summary>Text export (for reference)</summary>
        <pre className="paste-planner__pre">{gridToText(cells, w, h)}</pre>
      </details>
    </div>
  );
}
