import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  fetchCanvasDiff,
  fetchCanvasInfo,
  imageCurrentPngUrl,
  imageOriginalPngUrl,
} from "./lib/normies-api";
import "./App.css";

const ID_MIN = 0;
const ID_MAX = 9999;

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < ID_MIN || n > ID_MAX) return null;
  return n;
}

export default function App() {
  const inputId = useId();
  const [rawId, setRawId] = useState("0");
  const [activeId, setActiveId] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<Awaited<
    ReturnType<typeof fetchCanvasDiff>
  > | null>(null);
  const [info, setInfo] = useState<Awaited<
    ReturnType<typeof fetchCanvasInfo>
  > | null>(null);
  const [cacheBust, setCacheBust] = useState(0);

  const load = useCallback(
    async (id: number) => {
      setLoading(true);
      setErr(null);
      const ac = new AbortController();
      try {
        const [d, i] = await Promise.all([
          fetchCanvasDiff(id, ac.signal),
          fetchCanvasInfo(id, ac.signal),
        ]);
        setDiff(d);
        setInfo(i);
        setActiveId(id);
        setCacheBust((k) => k + 1);
      } catch (e) {
        setDiff(null);
        setInfo(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseId(rawId);
    if (id === null) {
      setErr(`Token ID must be an integer ${ID_MIN}–${ID_MAX}.`);
      return;
    }
    void load(id);
  };

  const originalSrc = useMemo(
    () =>
      activeId === null
        ? ""
        : `${imageOriginalPngUrl(activeId)}?v=${cacheBust}`,
    [activeId, cacheBust],
  );
  const currentSrc = useMemo(
    () =>
      activeId === null ? "" : `${imageCurrentPngUrl(activeId)}?v=${cacheBust}`,
    [activeId, cacheBust],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="layout">
      <header className="header">
        <h1 className="title">Normie Canvas Lab</h1>
        <p className="subtitle">
          Original vs composited (NormiesCanvas) view — pixel diff and canvas
          stats from{" "}
          <a
            href="https://api.normies.art/"
            target="_blank"
            rel="noreferrer"
          >
            api.normies.art
          </a>
          .
        </p>
      </header>

      <form className="toolbar" onSubmit={onSubmit}>
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
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load"}
        </button>
      </form>

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      {activeId !== null && !err && info && diff && (
        <>
          <section className="panels" aria-label="Before and after">
            <figure className="panel">
              <figcaption>Original (pre-transform)</figcaption>
              <div className="frame">
                <img
                  src={originalSrc}
                  alt={`Normie #${activeId} original`}
                  width={400}
                  height={400}
                  decoding="async"
                />
              </div>
            </figure>
            <figure className="panel">
              <figcaption>Current (composited)</figcaption>
              <div className="frame">
                <img
                  src={currentSrc}
                  alt={`Normie #${activeId} current`}
                  width={400}
                  height={400}
                  decoding="async"
                />
              </div>
            </figure>
          </section>

          <section className="stats" aria-label="Canvas statistics">
            <div className="stat">
              <span className="stat__k">Customized</span>
              <span className="stat__v">
                {info.customized ? "Yes" : "No"}
              </span>
            </div>
            <div className="stat">
              <span className="stat__k">Level</span>
              <span className="stat__v">{info.level}</span>
            </div>
            <div className="stat">
              <span className="stat__k">Action points</span>
              <span className="stat__v">{info.actionPoints}</span>
            </div>
            <div className="stat">
              <span className="stat__k">Pixels added</span>
              <span className="stat__v">{diff.addedCount}</span>
            </div>
            <div className="stat">
              <span className="stat__k">Pixels removed</span>
              <span className="stat__v">{diff.removedCount}</span>
            </div>
            <div className="stat">
              <span className="stat__k">Net change</span>
              <span className="stat__v">{diff.netChange}</span>
            </div>
          </section>

          <div className="actions">
            <a
              className="btn btn--ghost"
              href={originalSrc}
              download={`normie-${activeId}-original.png`}
            >
              Download original PNG
            </a>
            <a
              className="btn btn--ghost"
              href={currentSrc}
              download={`normie-${activeId}-current.png`}
            >
              Download current PNG
            </a>
          </div>
        </>
      )}

      <footer className="footer">
        <p>
          Fan tool — not affiliated with NORMIES. Replace this line with your
          name / project link before shipping.
        </p>
      </footer>
    </div>
  );
}
