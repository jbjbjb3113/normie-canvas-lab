import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { NormiesHeaderArt } from "../components/NormiesHeaderArt";
import {
  fetchCanvasDiff,
  imageCurrentPngUrl,
  type CanvasDiff,
} from "../lib/normies-api";
import { loadImageUrl } from "../lib/gif-evolution";
import "../App.css";

const ID_MIN = 0;
const ID_MAX = 9999;

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < ID_MIN || n > ID_MAX) return null;
  return n;
}

function drawEditMap(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  diff: CanvasDiff,
  opts: {
    showAdded: boolean;
    showRemoved: boolean;
    markerSize: number;
  },
) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) return;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const { showAdded, showRemoved, markerSize } = opts;
  const m = Math.max(1, Math.min(4, Math.floor(markerSize)));

  if (showAdded && diff.added.length > 0) {
    ctx.fillStyle = "rgba(40, 220, 120, 0.55)";
    for (const p of diff.added) {
      ctx.fillRect(p.x, p.y, m, m);
    }
  }
  if (showRemoved && diff.removed.length > 0) {
    ctx.fillStyle = "rgba(255, 70, 90, 0.55)";
    for (const p of diff.removed) {
      ctx.fillRect(p.x, p.y, m, m);
    }
  }
}

export default function EditMapPage() {
  const inputId = useId();
  const [rawId, setRawId] = useState("0");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<CanvasDiff | null>(null);
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [showAdded, setShowAdded] = useState(true);
  const [showRemoved, setShowRemoved] = useState(true);
  const [markerSize, setMarkerSize] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapImage || !diff) return;
    drawEditMap(canvas, mapImage, diff, {
      showAdded,
      showRemoved,
      markerSize,
    });
  }, [mapImage, diff, showAdded, showRemoved, markerSize]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const id = parseId(rawId);
    if (id === null) {
      setErr(`Token ID must be an integer ${ID_MIN}–${ID_MAX}.`);
      return;
    }
    setLoading(true);
    setErr(null);
    setDiff(null);
    setMapImage(null);
    try {
      const [d, img] = await Promise.all([
        fetchCanvasDiff(id),
        loadImageUrl(imageCurrentPngUrl(id)),
      ]);
      setDiff(d);
      setMapImage(img);
      setActiveId(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setActiveId(null);
      setMapImage(null);
    } finally {
      setLoading(false);
    }
  };

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas || !activeId) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `normie-${activeId}-edit-map.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const headerTokenId = activeId ?? parseId(rawId);

  return (
    <div className="layout">
      <header className="header">
        <div className="header__intro">
          <h1 className="title">Edit map</h1>
          <p className="subtitle">
            Overlay <strong>added</strong> (green) and <strong>removed</strong>{" "}
            (red) pixels from the canvas diff on top of the current composited
            art—same data as the Lab, drawn as a map you can screenshot or
            download.
          </p>
        </div>
        <NormiesHeaderArt tokenId={headerTokenId} />
      </header>

      <form className="toolbar edit-map-toolbar" onSubmit={onSubmit}>
        <label className="field" htmlFor={inputId}>
          Token ID
        </label>
        <input
          id={inputId}
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          disabled={loading}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load map"}
        </button>
      </form>

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      {activeId !== null && diff && mapImage && (
        <section className="edit-map" aria-label="Edit map visualization">
          <div className="edit-map__controls">
            <label className="field field--check">
              <input
                type="checkbox"
                checked={showAdded}
                onChange={(e) => setShowAdded(e.target.checked)}
              />{" "}
              Show added ({diff.addedCount})
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={showRemoved}
                onChange={(e) => setShowRemoved(e.target.checked)}
              />{" "}
              Show removed ({diff.removedCount})
            </label>
            <label className="field">
              Marker size (px)
              <input
                className="input input--narrow"
                type="number"
                min={1}
                max={4}
                value={markerSize}
                onChange={(e) => setMarkerSize(Number(e.target.value))}
              />
            </label>
            <button type="button" className="btn btn--ghost" onClick={downloadPng}>
              Download PNG
            </button>
          </div>
          <div className="edit-map__frame">
            <canvas
              ref={canvasRef}
              className="edit-map__canvas"
              role="img"
              aria-label={`Normie ${activeId}: current art with diff overlay`}
            />
          </div>
        </section>
      )}

    </div>
  );
}
