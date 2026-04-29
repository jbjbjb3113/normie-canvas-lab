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
import { encodeFramesToWebm, transcodeWebmToMp4 } from "../lib/video-export";
import { NormiesHeaderArt } from "../components/NormiesHeaderArt";
import { SiteNav } from "../components/SiteNav";
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
type GifPreset = "default" | "x-chat-safe";

export default function GifEvolutionPage() {
  const inputId = useId();
  const [rawId, setRawId] = useState("0");
  const [maxFrames, setMaxFrames] = useState(12);
  const [outSize, setOutSize] = useState(400);
  const [prependOriginal, setPrependOriginal] = useState(true);
  const [frameDelayMs, setFrameDelayMs] = useState(500);

  const [outputMode, setOutputMode] = useState<OutputMode>("evolution");
  const [preset, setPreset] = useState<GifPreset>("default");
  const [motionKind, setMotionKind] = useState<MotionLoopKind>("bounce");
  const [motionUseOriginal, setMotionUseOriginal] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [mp4DownloadUrl, setMp4DownloadUrl] = useState<string | null>(null);
  const [exportingMp4, setExportingMp4] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const mp4DownloadUrlRef = useRef<string | null>(null);

  const revokeDownload = useCallback(() => {
    const u = downloadUrlRef.current;
    if (u) URL.revokeObjectURL(u);
    downloadUrlRef.current = null;
    setDownloadUrl(null);
  }, []);

  const revokeMp4Download = useCallback(() => {
    const u = mp4DownloadUrlRef.current;
    if (u) URL.revokeObjectURL(u);
    mp4DownloadUrlRef.current = null;
    setMp4DownloadUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const u = downloadUrlRef.current;
      if (u) URL.revokeObjectURL(u);
      const mp4 = mp4DownloadUrlRef.current;
      if (mp4) URL.revokeObjectURL(mp4);
    };
  }, []);

  const buildFrames = useCallback(
    async (id: number, ac: AbortController): Promise<Uint8ClampedArray[]> => {
      if (outputMode === "motion") {
        setPhase("images");
        setProgress("Loading art…");
        const url = motionUseOriginal ? imageOriginalPngUrl(id) : imageCurrentPngUrl(id);
        const img = await loadImageUrl(url, ac.signal);
        const fcN = Math.floor(Number(maxFrames));
        const fc = Math.max(2, Math.min(15, Number.isFinite(fcN) ? fcN : 12));
        return synthesizeMotionLoopFrames(img, outSize, fc, motionKind);
      }

      setPhase("versions");
      setProgress("Loading version list…");
      const versions = await fetchNormieTransformVersions(id, {
        limit: 200,
        signal: ac.signal,
      });
      const plan = buildEvolutionFramePlan(id, versions, maxFrames, prependOriginal);
      if (plan.urls.length === 0) {
        throw new Error(
          "No evolution frames: no indexed edits for this token and “Prepend original” is off. Try “Mint motion loop” or enable “Prepend original”.",
        );
      }

      setPhase("images");
      setProgress(`Loading images 0/${plan.urls.length}…`);
      return fetchAndRasterizeFrames(plan.urls, outSize, {
        signal: ac.signal,
        onProgress: (done, total) => setProgress(`Loading images ${done}/${total}…`),
      });
    },
    [maxFrames, motionKind, motionUseOriginal, outSize, outputMode, prependOriginal],
  );

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
      revokeMp4Download();

      const ac = new AbortController();
      abortRef.current = ac;
      setErr(null);

      try {
        const frames = await buildFrames(id, ac);
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
      buildFrames,
      rawId,
      outSize,
      frameDelayMs,
      revokeDownload,
      revokeMp4Download,
    ],
  );

  const onExportMp4 = useCallback(async () => {
    const id = parseId(rawId);
    if (id === null) {
      setErr(`Token ID must be an integer ${ID_MIN}–${ID_MAX}.`);
      return;
    }
    abortRef.current?.abort();
    revokeMp4Download();
    const ac = new AbortController();
    abortRef.current = ac;
    setErr(null);
    setExportingMp4(true);
    try {
      const frames = await buildFrames(id, ac);
      const fps = Math.max(6, Math.min(20, Math.round(1000 / frameDelayMs)));
      setPhase("encode");
      setProgress("Encoding WebM…");
      const webmBlob = await encodeFramesToWebm({
        framesRgba: frames,
        size: outSize,
        fps,
      });
      setProgress("Transcoding to MP4…");
      const mp4Blob = await transcodeWebmToMp4({
        webmBlob,
        outputName: `normie-${id}-x-safe.mp4`,
      });
      const blobUrl = URL.createObjectURL(mp4Blob);
      mp4DownloadUrlRef.current = blobUrl;
      setMp4DownloadUrl(blobUrl);
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
    } finally {
      setExportingMp4(false);
    }
  }, [buildFrames, frameDelayMs, outSize, rawId, revokeMp4Download]);

  const busy =
    phase === "versions" || phase === "images" || phase === "encode" || exportingMp4;
  const headerTokenId = parseId(rawId);

  const applyPreset = useCallback((next: GifPreset) => {
    setPreset(next);
    if (next === "x-chat-safe") {
      // Conservative playback profile for chat clients (including X group chat).
      setOutSize(480);
      setMaxFrames(12);
      setFrameDelayMs(83);
      setPrependOriginal(true);
      return;
    }
    setOutSize(400);
    setMaxFrames(12);
    setFrameDelayMs(500);
    setPrependOriginal(true);
  }, []);

  return (
    <div className="layout">
      <header className="header">
        <div className="header__intro">
          <h1 className="title">Normie GIF evolution</h1>
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
        </div>
        <NormiesHeaderArt tokenId={headerTokenId} />
      </header>

      <SiteNav />

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
        <label className="field">
          Preset
          <select
            className="input input--select"
            value={preset}
            onChange={(e) => applyPreset(e.target.value as GifPreset)}
            disabled={busy}
          >
            <option value="default">Default</option>
            <option value="x-chat-safe">X group chat safe</option>
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
        <button
          className="btn btn--ghost"
          type="button"
          disabled={busy}
          onClick={() => void onExportMp4()}
          title="Builds WebM, then transcodes to MP4 for X"
        >
          {exportingMp4 ? "Exporting MP4…" : "Export X-safe MP4"}
        </button>
      </form>

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      {progress && <p className="gif-progress">{progress}</p>}
      {preset === "x-chat-safe" && !busy && (
        <p className="gif-progress">
          X-safe preset active. If X still rejects playback, shorten the loop or
          convert to MP4 before posting.
        </p>
      )}

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
      {phase === "done" && mp4DownloadUrl && (
        <p className="gif-download">
          <a
            className="btn btn--ghost"
            href={mp4DownloadUrl}
            download={`normie-${rawId.trim() || "0"}-x-safe.mp4`}
          >
            Download MP4
          </a>
        </p>
      )}

    </div>
  );
}
