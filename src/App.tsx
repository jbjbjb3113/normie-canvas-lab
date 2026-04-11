import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  fetchBurnCommitDetail,
  fetchBurnsForReceiver,
  fetchCanvasDiff,
  fetchCanvasInfo,
  fetchNormieTransformVersions,
  imageCurrentPngUrl,
  imageOriginalPngUrl,
  type BurnCommitmentDetail,
  type NormieTransformVersion,
} from "./lib/normies-api";
import "./App.css";

const ID_MIN = 0;
const ID_MAX = 9999;

const NORMIES_CONTRACT =
  "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438" as const;

function openseaItemUrl(tokenId: string) {
  return `https://opensea.io/item/ethereum/${NORMIES_CONTRACT}/${tokenId}`;
}

function etherscanTxUrl(txHash: string) {
  return `https://etherscan.io/tx/${txHash}`;
}

function formatTs(seconds: string) {
  const n = Number.parseInt(seconds, 10);
  if (!Number.isFinite(n)) return seconds;
  return new Date(n * 1000).toLocaleString();
}

function shortAddr(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Edit these to your public name / site / social. */
const FOOTER_CREDIT_LABEL = "@Trailertrsh";
const FOOTER_CREDIT_HREF = "https://x.com/trailertrsh";

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
  const [burnCommits, setBurnCommits] = useState<BurnCommitmentDetail[]>([]);
  const [transformVersions, setTransformVersions] = useState<
    NormieTransformVersion[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [burnsErr, setBurnsErr] = useState<string | null>(null);
  const [versionsErr, setVersionsErr] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  /** Burns (AP in) + transform versions (edits toward current canvas). */
  const loadHistory = useCallback(async (tokenId: number, signal: AbortSignal) => {
    setHistoryLoading(true);
    setBurnsErr(null);
    setVersionsErr(null);
    setBurnCommits([]);
    setTransformVersions([]);

    const isAbort = (e: unknown) =>
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");

    try {
      const burnList = await fetchBurnsForReceiver(tokenId, {
        limit: 80,
        offset: 0,
        signal,
      });
      const detailSlice = burnList.slice(0, 24);
      const details = await Promise.all(
        detailSlice.map((c) => fetchBurnCommitDetail(c.commitId, signal)),
      );
      setBurnCommits(details);
    } catch (e) {
      if (!isAbort(e)) {
        setBurnsErr(e instanceof Error ? e.message : String(e));
      }
    }

    if (!signal.aborted) {
      try {
        const versionsRaw = await fetchNormieTransformVersions(tokenId, {
          limit: 120,
          offset: 0,
          signal,
        });
        // Newest first from API → reverse for chronological (oldest edit first).
        setTransformVersions([...versionsRaw].reverse());
      } catch (e) {
        if (!isAbort(e)) {
          setVersionsErr(e instanceof Error ? e.message : String(e));
        }
      }
    }

    setHistoryLoading(false);
  }, []);

  const load = useCallback(
    async (id: number) => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      setLoading(true);
      setErr(null);
      try {
        const [d, i] = await Promise.all([
          fetchCanvasDiff(id, ac.signal),
          fetchCanvasInfo(id, ac.signal),
        ]);
        setDiff(d);
        setInfo(i);
        setActiveId(id);
        setCacheBust((k) => k + 1);
        void loadHistory(id, ac.signal);
      } catch (e) {
        setDiff(null);
        setInfo(null);
        setBurnCommits([]);
        setTransformVersions([]);
        setBurnsErr(null);
        setVersionsErr(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [loadHistory],
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

          <section className="burns" aria-label="On-chain history for this Normie">
            <h2 className="burns__title">Provenance toward this Normie</h2>
            <p className="burns__lede">
              <strong>Burns</strong> = other Normies destroyed in a commit where
              #{activeId} was the <strong>receiver</strong> of action points
              (fuel). <strong>Canvas edits</strong> = each on-chain transform
              that spent AP to reach today&apos;s look. Data from{" "}
              <a
                href="https://api.normies.art/"
                target="_blank"
                rel="noreferrer"
              >
                api.normies.art
              </a>{" "}
              (indexer).
            </p>
            {historyLoading && (
              <p className="burns__muted">Loading on-chain history…</p>
            )}
            {burnsErr && (
              <div className="banner banner--err" role="alert">
                Burns: {burnsErr}
              </div>
            )}
            {versionsErr && (
              <div className="banner banner--err" role="alert">
                Canvas edits: {versionsErr}
              </div>
            )}

            <h3 className="burns__subtitle">Burns → AP credited here</h3>
            <p className="burns__hint">
              Up to 24 commits shown (detail); list API returns up to 80.
            </p>
            {!historyLoading && !burnsErr && burnCommits.length === 0 && (
              <p className="burns__muted">
                No burn commits where this token was the receiver — or indexer
                empty.
              </p>
            )}
            {!historyLoading &&
              !burnsErr &&
              burnCommits.map((c) => (
                <article key={c.commitId} className="burn-card">
                  <div className="burn-card__head">
                    <span className="burn-card__id">Commit #{c.commitId}</span>
                    <a
                      className="burn-card__tx"
                      href={etherscanTxUrl(c.txHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View tx
                    </a>
                  </div>
                  <dl className="burn-card__meta">
                    <div>
                      <dt>When</dt>
                      <dd>{formatTs(c.timestamp)}</dd>
                    </div>
                    <div>
                      <dt>Normies burned (count)</dt>
                      <dd>{c.tokenCount}</dd>
                    </div>
                    <div>
                      <dt>AP to receiver</dt>
                      <dd>{c.transferredActionPoints}</dd>
                    </div>
                    <div>
                      <dt>Total actions (commit)</dt>
                      <dd>{c.totalActions}</dd>
                    </div>
                  </dl>
                  {c.burnedTokens && c.burnedTokens.length > 0 && (
                    <ul className="burn-card__tokens">
                      {c.burnedTokens.map((t) => (
                        <li key={`${c.commitId}-${t.tokenId}`}>
                          <a
                            href={openseaItemUrl(t.tokenId)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{t.tokenId}
                          </a>
                          <span className="burn-card__px">
                            {" "}
                            ({t.pixelCount} px)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}

            <h3 className="burns__subtitle">Canvas edits (transforms)</h3>
            <p className="burns__hint">
              Each row is a <code>setTransformBitmap</code> step (oldest →
              newest). Links to Etherscan.
            </p>
            {!historyLoading && !versionsErr && transformVersions.length === 0 && (
              <p className="burns__muted">
                No transform history — never edited on canvas, or indexer
                unavailable.
              </p>
            )}
            {!historyLoading &&
              !versionsErr &&
              transformVersions.map((v) => (
                <article
                  key={`${v.txHash}-${v.version}`}
                  className="burn-card burn-card--compact"
                >
                  <div className="burn-card__head">
                    <span className="burn-card__id">
                      Edit v{v.version} · Δ{v.changeCount} px · total{" "}
                      {v.newPixelCount} px
                    </span>
                    <a
                      className="burn-card__tx"
                      href={etherscanTxUrl(v.txHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View tx
                    </a>
                  </div>
                  <dl className="burn-card__meta">
                    <div>
                      <dt>When</dt>
                      <dd>{formatTs(v.timestamp)}</dd>
                    </div>
                    <div>
                      <dt>By</dt>
                      <dd title={v.transformer}>{shortAddr(v.transformer)}</dd>
                    </div>
                    <div>
                      <dt>Block</dt>
                      <dd>{v.blockNumber}</dd>
                    </div>
                  </dl>
                </article>
              ))}
          </section>
        </>
      )}

      <footer className="footer">
        <p>
          Unofficial fan tool — not affiliated with NORMIES, its creators, or
          any marketplace.
        </p>
        <p>
          Built by{" "}
          <a href={FOOTER_CREDIT_HREF} target="_blank" rel="noreferrer">
            {FOOTER_CREDIT_LABEL}
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
