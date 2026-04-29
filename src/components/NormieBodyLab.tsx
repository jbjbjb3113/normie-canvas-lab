import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchNormiePixelsPlain,
  fetchNormieTraits,
  type NormieTraitsResponse,
} from "../lib/normies-api";
import {
  BODY_TEMPLATES,
  buildBodyComposite,
  compositeToBits,
  drawCompositeToCanvas,
  NORMIE_GRID,
  type BodyTemplate,
} from "../lib/normieBodyGenerator";
import {
  buildPixlMetadataPreview,
  computePixlBodyTraits,
  mergeTraitAttributes,
  type TraitAttribute,
} from "../lib/pixlBodyTraits";

const ID_MIN = 0;
const ID_MAX = 9999;
const PREVIEW_SCALE = 8;

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < ID_MIN || n > ID_MAX) return null;
  return n;
}

export function NormieBodyLab() {
  const formId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rawId, setRawId] = useState("9098");
  const [useOriginal, setUseOriginal] = useState(false);
  const [showSeamOverlay, setShowSeamOverlay] = useState(true);
  const [shoulderBoost, setShoulderBoost] = useState(6);
  const [styleT, setStyleT] = useState(0.5);
  const [template, setTemplate] = useState<BodyTemplate>("standard");
  const [bits, setBits] = useState<string | null>(null);
  const [normieTraits, setNormieTraits] = useState<NormieTraitsResponse | null>(
    null,
  );
  const [traitsErr, setTraitsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const composite = bits
    ? buildBodyComposite(bits, { shoulderBoost, styleT, template })
    : null;

  const pixlTraits = useMemo(() => {
    if (!bits) return [];
    return computePixlBodyTraits({
      faceBits1600: bits,
      opts: { shoulderBoost, styleT, template },
    });
  }, [bits, shoulderBoost, styleT, template]);

  const normieTraitList: TraitAttribute[] = useMemo(() => {
    if (!normieTraits?.attributes?.length) return [];
    return normieTraits.attributes.map((a) => ({
      trait_type: a.trait_type,
      value: a.value,
      ...(a.display_type ? { display_type: a.display_type } : {}),
    }));
  }, [normieTraits]);

  const mergedTraits = useMemo(
    () => mergeTraitAttributes(normieTraitList, pixlTraits),
    [normieTraitList, pixlTraits],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !composite) return;
    drawCompositeToCanvas(c, composite, PREVIEW_SCALE);
    if (!showSeamOverlay) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const seamY = NORMIE_GRID * PREVIEW_SCALE;
    ctx.fillStyle = "rgba(74, 222, 128, 0.9)";
    ctx.fillRect(0, seamY - 1, c.width, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, seamY, c.width, 1);
  }, [composite, showSeamOverlay]);

  const loadPixels = useCallback(async () => {
    const id = parseId(rawId);
    if (id === null) {
      setErr(`Token ID must be ${ID_MIN}–${ID_MAX}.`);
      return;
    }
    setLoading(true);
    setErr(null);
    setHint(null);
    setTraitsErr(null);
    setNormieTraits(null);
    try {
      const [b, traits] = await Promise.all([
        fetchNormiePixelsPlain(id, useOriginal),
        fetchNormieTraits(id).catch((e) => {
          setTraitsErr(
            e instanceof Error ? e.message : "Could not load chain traits.",
          );
          return null;
        }),
      ]);
      setBits(b);
      if (traits) setNormieTraits(traits);
      setHint(
        useOriginal
          ? `Loaded original pixels for #${id}.`
          : `Loaded composited pixels for #${id}.`,
      );
    } catch (e) {
      setBits(null);
      setNormieTraits(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rawId, useOriginal]);

  const downloadPng = () => {
    const c = canvasRef.current;
    if (!c || c.width === 0 || !composite) return;
    const id = parseId(rawId) ?? "x";
    const a = document.createElement("a");
    a.download = `pixl-body-${id}-${template}-80h.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };

  const exportBits = async () => {
    if (!composite) return;
    const text = compositeToBits(composite);
    try {
      await navigator.clipboard.writeText(text);
      setHint(
        `Copied ${composite.width}×${composite.height} bitmap as 0/1 text (${text.length} chars).`,
      );
    } catch {
      setHint("Clipboard blocked — use download PNG.");
    }
  };

  const copyTraitJson = async () => {
    const id = parseId(rawId);
    if (id === null || !bits) return;
    const meta = buildPixlMetadataPreview({
      name: `Pixl body · Normie #${id}`,
      description:
        "Fan prototype: chain traits + derived Pixl body traits (snapshot-style metadata preview).",
      normieAttributes: normieTraitList,
      pixlAttributes: pixlTraits,
    });
    const text = JSON.stringify(meta, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setHint("Copied metadata JSON (attributes only — add image at mint).");
    } catch {
      setHint("Clipboard blocked for JSON.");
    }
  };

  return (
    <div className="body-lab">
      <p className="body-lab__lede">
        <strong>Pixl bodies</strong> — fetch a Normie’s <strong>40×40</strong>{" "}
        bitmap, then add a hard-sized <strong>40×40</strong> body panel below
        (composite <strong>40×80</strong>, same chain ink / background). Sliders
        tune shoulders and edge noise; <strong>outfit template</strong> picks the
        silhouette. Export PNG or <code>0</code>/<code>1</code> text; composited
        vs <code>original</code> pixels.
      </p>

      <div className="body-lab__form">
        <div className="body-lab__field">
          <label htmlFor={`${formId}-id`}>Token ID</label>
          <input
            id={`${formId}-id`}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            disabled={loading}
          />
        </div>
        <label className="body-lab__check">
          <input
            type="checkbox"
            checked={useOriginal}
            onChange={(e) => setUseOriginal(e.target.checked)}
            disabled={loading}
          />
          Original pixels (pre-canvas)
        </label>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void loadPixels()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load pixels"}
        </button>
      </div>

      <div className="body-lab__template-row">
        <label htmlFor={`${formId}-tpl`} className="body-lab__template-label">
          Outfit template
        </label>
        <select
          id={`${formId}-tpl`}
          className="input body-lab__template-select"
          value={template}
          onChange={(e) => setTemplate(e.target.value as BodyTemplate)}
          disabled={!bits}
        >
          {BODY_TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <label className="body-lab__check">
          <input
            type="checkbox"
            checked={showSeamOverlay}
            onChange={(e) => setShowSeamOverlay(e.target.checked)}
            disabled={!bits}
          />
          Show face/body seam
        </label>
      </div>

      <div className="body-lab__sliders">
        <div className="body-lab__slider-field">
          <label htmlFor={`${formId}-sh`}>Shoulder boost</label>
          <input
            id={`${formId}-sh`}
            type="range"
            min={0}
            max={12}
            value={shoulderBoost}
            onChange={(e) => setShoulderBoost(Number(e.target.value))}
            disabled={!bits}
          />
          <span className="body-lab__val">{shoulderBoost}</span>
        </div>
        <div className="body-lab__slider-field">
          <label htmlFor={`${formId}-st`}>Style noise</label>
          <input
            id={`${formId}-st`}
            type="range"
            min={0}
            max={100}
            value={Math.round(styleT * 100)}
            onChange={(e) => setStyleT(Number(e.target.value) / 100)}
            disabled={!bits}
          />
          <span className="body-lab__val">{Math.round(styleT * 100)}%</span>
        </div>
      </div>

      {err && (
        <p className="body-lab__err" role="alert">
          {err}
        </p>
      )}
      {hint && !err && (
        <p className="body-lab__hint" role="status">
          {hint}
        </p>
      )}

      {composite && (
        <>
          <div className="body-lab__preview-wrap">
            <canvas
              ref={canvasRef}
              className="body-lab__canvas"
              aria-label={`Pixl body preview, ${composite.width} by ${composite.height} cells`}
            />
            <p className="body-lab__meta">
              Face {NORMIE_GRID}×{NORMIE_GRID} · body {NORMIE_GRID}×{NORMIE_GRID}{" "}
              · composite {composite.width}×{composite.height} · preview ×
              {PREVIEW_SCALE} · colors <code>#48494b</code> /{" "}
              <code>#e3e5e4</code> (API PNG style)
            </p>
          </div>
          <div className="body-lab__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={downloadPng}
            >
              Download PNG
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void exportBits()}
            >
              Copy 0/1 text
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void copyTraitJson()}
            >
              Copy traits JSON
            </button>
          </div>

          {traitsErr && (
            <p className="body-lab__traits-warn" role="status">
              Traits: {traitsErr}
            </p>
          )}

          {bits && pixlTraits.length > 0 && (
            <div className="body-lab__traits">
              <h3 className="body-lab__traits-heading">Trait system (preview)</h3>
              <p className="body-lab__traits-note">
                <strong>Normie</strong> rows come from{" "}
                <code>/normie/:id/traits</code>. <strong>Pixl · …</strong> rows are
                derived from your face bitmap + sliders + template (OpenSea-style{" "}
                <code>trait_type</code> / <code>value</code>).
              </p>
              {normieTraitList.length > 0 && (
                <details className="body-lab__traits-block" open>
                  <summary>Normie (chain)</summary>
                  <ul className="body-lab__traits-list">
                    {normieTraitList.map((t, i) => (
                      <li key={`n-${i}-${t.trait_type}`}>
                        <span className="body-lab__traits-k">{t.trait_type}</span>
                        <span className="body-lab__traits-v">
                          {String(t.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="body-lab__traits-block" open>
                <summary>Pixl body (derived)</summary>
                <ul className="body-lab__traits-list">
                  {pixlTraits.map((t, i) => (
                    <li key={`p-${i}-${t.trait_type}`}>
                      <span className="body-lab__traits-k">{t.trait_type}</span>
                      <span className="body-lab__traits-v">{String(t.value)}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <details className="body-lab__traits-block">
                <summary>Merged ({mergedTraits.length} attributes)</summary>
                <ul className="body-lab__traits-list body-lab__traits-list--compact">
                  {mergedTraits.map((t, i) => (
                    <li key={`m-${i}-${t.trait_type}`}>
                      <span className="body-lab__traits-k">{t.trait_type}</span>
                      <span className="body-lab__traits-v">{String(t.value)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
