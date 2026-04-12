import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  fetchNormieTransformVersions,
  imageCurrentPngUrl,
  imageOriginalPngUrl,
} from "../lib/normies-api";
import {
  buildEvolutionFramePlan,
  encodeGif,
  fetchAndRasterizeFrames,
  loadImageUrl,
} from "../lib/gif-evolution";
import {
  synthesizeMotionLoopFrames,
  type MotionLoopKind,
} from "../lib/gif-motion-loop";
import { SiteFooter } from "../components/SiteFooter";
import "../App.css";

const ID_MIN = 0;
const ID_MAX = 9999;

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < ID_MIN || n > ID_MAX) return null;
  return n;
}

type Phase =
  | "idle"
  | "versions"
  | "images"
  | "encode"
  | "done"
  | "error";

type OutputMode = "evolution" | "motion";

export default function GifEvolutionPage() {
  const inputId = useId();
  const [rawId, setRawId] = useState("0");
  const [maxFrames, setMaxFrames] = useState(12);
  const [outSize, setOutSize] = useState(400);
  const [prependOriginal, setPrependOriginal] = useState(true);
  const [frameDelayMs, setFrameDelayMs] = useState(500);

  const [outputMode, setOutputMode] = useState<OutputMode>("evolution");
  const [motionKind, setMotionKind] = useState<MotionLoopKind>("bounce");
  const [motionUseOriginal, setMotionUseOriginal] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadUrlRef = useRef<string | null>(null);

  const revokeDownload = useCallback(() => {
    const u = downloadUrlRef.current;
    if (u) URL.revokeObjectURL(u);
    downloadUrlRef.current = null;
    setDownloadUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const u = downloadUrlRef.current;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const id = parseId(rawId);
      if (id === null) {
        setErr(`Token ID must be an integer ${ID_MIN}–${ID_MAX}.`);
        return;
      }

      abortRef.current?.abort();
      revokeDownload();

      const ac = new AbortController();
      abortRef.current = ac;
      setErr(null);

      try {
        if (outputMode === "motion") {
          setPhase("images");
          setProgress("Loading art…");
          const url = motionUseOriginal
            ? imageOriginalPngUrl(id)
            : imageCurrentPngUrl(id);
          const img = await loadImageUrl(url, ac.signal);
          setPhase("encode");
          setProgress("Encoding GIF…");
          const fcN = Math.floor(Number(maxFrames));
          const fc = Math.max(
            2,
            Math.min(15, Number.isFinite(fcN) ? fcN : 12),
          );
          const frames = synthesizeMotionLoopFrames(
            img,
            outSize,
            fc,
            motionKind,
          );
          const bytes = await encodeGif(frames, outSize, frameDelayMs);
          const blob = new Blob([bytes], { type: "image/gif" });
          const blobUrl = URL.createObjectURL(blob);
          downloadUrlRef.current = blobUrl;
          setDownloadUrl(blobUrl);
          setPhase("done");
          setProgress(null);
          return;
        }

        setPhase("versions");
        setProgress("Loading version list…");

        const versions = await fetchNormieTransformVersions(id, {
          limit: 200,
          signal: ac.signal,
        });

        const plan = buildEvolutionFramePlan(
          id,
          versions,
          maxFrames,
          prependOriginal,
        );

        if (plan.urls.length === 0) {
          setErr(
            "No evolution frames: no indexed edits for this token and “Prepend original” is off. Try “Mint motion loop” for a fun GIF from a single image, or turn on “Prepend original”.",
          );
          setPhase("error");
          setProgress(null);
          return;
        }

        setPhase("images");
        setProgress(`Loading images 0/${plan.urls.length}…`);

        const frames = await fetchAndRasterizeFrames(plan.urls, outSize, {
          signal: ac.signal,
          onProgress: (done, total) => {
            setProgress(`Loading images ${done}/${total}…`);
          },
        });

        setPhase("encode");
        setProgress("Encoding GIF…");

        const bytes = await encodeGif(frames, outSize, frameDelayMs);
        const blob = new Blob([bytes], { type: "image/gif" });
        const blobUrl = URL.createObjectURL(blob);
        downloadUrlRef.current = blobUrl;
        setDownloadUrl(blobUrl);
        setPhase("done");
        setProgress(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setPhase("idle");
          setProgress(null);
          return;
        }
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
        setProgress(null);
      }
    },
    [
      rawId,
      maxFrames,
      outSize,
      prependOriginal,
      frameDelayMs,
      revokeDownload,
      outputMode,
      motionKind,
      motionUseOriginal,
    ],
  );

  const busy = phase === "versions" || phase === "images" || phase === "encode";

  return (
    <div className="layout">
      <header className="header">
        <h1 className="title">GIF evolution</h1>
        <p className="subtitle">
          <strong>Evolution</strong> stitches indexed canvas versions from{" "}
          <a
            href="https://api.normies.art/"
            target="_blank"
            rel="noreferrer"
          >
            api.normies.art
          </a>{" "}
          (great for customized Normies). <strong>Mint motion loop</strong>{" "}
          builds a short loop from <em>one</em> PNG—no edit history needed—so
          “stock” Normies still get a shareable GIF. Image loads are throttled on
          evolution mode.
        </p>
      </header>

      <form className="toolbar gif-toolbar" onSubmit={onSubmit}>
        <label className="field" htmlFor={inputId}>
          Token ID
        </label>
        <input
          id={inputId}
          className="input"
          type="text"
          inputMode="numeric"
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          disabled={busy}
          aria-invalid={parseId(rawId) === null && rawId.trim() !== ""}
        />

        <label className="field">
          Mode
          <select
            className="input input--select"
            value={outputMode}
            onChange={(e) =>
              setOutputMode(e.target.value as OutputMode)
            }
            disabled={busy}
          >
            <option value="evolution">Evolution (history)</option>
            <option value="motion">Mint motion loop</option>
          </select>
        </label>

        {outputMode === "motion" ? (
          <>
            <label className="field">
              Motion
              <select
                className="input input--select"
                value={motionKind}
                onChange={(e) =>
                  setMotionKind(e.target.value as MotionLoopKind)
                }
                disabled={busy}
              >
                <option value="bounce">Bounce (bob + pulse)</option>
                <option value="bob">Bob</option>
                <option value="pulse">Pulse</option>
                <option value="wiggle">Wiggle</option>
              </select>
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={motionUseOriginal}
                onChange={(e) => setMotionUseOriginal(e.target.checked)}
                disabled={busy}
              />{" "}
              Use original art
            </label>
          </>
        ) : (
          <>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={prependOriginal}
                onChange={(e) => setPrependOriginal(e.target.checked)}
                disabled={busy}
              />{" "}
              Prepend original
            </label>
          </>
        )}

        <label className="field">
          Frames
          <input
            className="input input--narrow"
            type="number"
            min={outputMode === "motion" ? 2 : 1}
            max={15}
            value={maxFrames}
            onChange={(e) => setMaxFrames(Number(e.target.value))}
            disabled={busy}
          />
        </label>

        <label className="field">
          Size (px)
          <select
            className="input input--select"
            value={outSize}
            onChange={(e) => setOutSize(Number(e.target.value))}
            disabled={busy}
          >
            <option value={320}>320</option>
            <option value={400}>400</option>
            <option value={480}>480</option>
          </select>
        </label>

        <label className="field">
          Frame delay (ms)
          <input
            className="input input--narrow"
            type="number"
            min={50}
            max={3000}
            step={50}
            value={frameDelayMs}
            onChange={(e) => setFrameDelayMs(Number(e.target.value))}
            disabled={busy}
          />
        </label>

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Working…" : "Generate GIF"}
        </button>
      </form>

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      {progress && <p className="gif-progress">{progress}</p>}

      {phase === "done" && downloadUrl && (
        <p className="gif-download">
          <a
            className="btn btn--ghost"
            href={downloadUrl}
            download={`normie-${rawId.trim() || "0"}-${outputMode === "motion" ? "motion" : "evolution"}.gif`}
          >
            Download GIF
          </a>
        </p>
      )}

      <SiteFooter />
    </div>
  );
}
