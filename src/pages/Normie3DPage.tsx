import {
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Normie3DViewer,
  type Normie3DExportUiState,
  type Normie3DLoadParams,
  type Normie3DViewerHandle,
} from "../components/Normie3DViewer";
import { SiteFooter } from "../components/SiteFooter";
import "../App.css";

const ID_MIN = 0;
const ID_MAX = 9999;

/** Default Normie shown on first visit; form + initial load stay in sync. */
const DEFAULT_3D_TOKEN_ID = 9098;

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < ID_MIN || n > ID_MAX) return null;
  return n;
}

export default function Normie3DPage() {
  const inputId = useId();
  const bakeExportTitleId = useId();
  const viewerRef = useRef<Normie3DViewerHandle>(null);
  const [exportBakeGradientGlb, setExportBakeGradientGlb] = useState(false);
  const [exportUi, setExportUi] = useState<Normie3DExportUiState>({
    activeId: null,
    loading: false,
    exporting: false,
    canBakeGradientGlb: true,
  });
  const onExportUiState = useCallback((s: Normie3DExportUiState) => {
    setExportUi((prev) =>
      prev.activeId === s.activeId &&
      prev.loading === s.loading &&
      prev.exporting === s.exporting &&
      prev.canBakeGradientGlb === s.canBakeGradientGlb
        ? prev
        : s,
    );
  }, []);

  const [rawId, setRawId] = useState(String(DEFAULT_3D_TOKEN_ID));
  const [useOriginalSvg, setUseOriginalSvg] = useState(false);
  const [extrudeDepth, setExtrudeDepth] = useState(2);
  const [bevel, setBevel] = useState(false);
  const [includeBackgroundPlate, setIncludeBackgroundPlate] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [loadParams, setLoadParams] = useState<Normie3DLoadParams | null>(() => ({
    tokenId: DEFAULT_3D_TOKEN_ID,
    useOriginalSvg: false,
    extrudeDepth: 2,
    bevel: false,
    includeBackgroundPlate: true,
  }));

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const id = parseId(rawId);
      if (id === null) {
        setErr(`Token ID must be an integer ${ID_MIN}–${ID_MAX}.`);
        return;
      }
      setErr(null);
      setLoadParams({
        tokenId: id,
        useOriginalSvg,
        extrudeDepth,
        bevel,
        includeBackgroundPlate,
      });
    },
    [rawId, useOriginalSvg, extrudeDepth, bevel, includeBackgroundPlate],
  );

  return (
    <div className="layout">
      <header className="header">
        <h1 className="title">Normies GLB Creator</h1>
        <p className="subtitle">
          Load a Normie as <strong>SVG</strong> from{" "}
          <a href="https://api.normies.art/" target="_blank" rel="noreferrer">
            api.normies.art
          </a>
          , extrude paths in the browser, spin on a turntable, and download a{" "}
          <strong>GLB</strong> for Blender, game engines, or social pipelines.
          By default only <strong>dark “pixel on”</strong> fills are extruded — the
          light grey <strong>#e3e5e4</strong> square plate is treated as background
          and skipped so the GLB is just the face. Optional{" "}
          <strong>Include back plate</strong> adds a thin canvas block (fixed{" "}
          <strong>0.1</strong> + <strong>0.9</strong> solid, same scale) on the{" "}
          <strong>far</strong> side of the art so the face stays in front. Face depth uses
          the slider (max <strong>16</strong>). Unofficial fan tool — CC0 art.
        </p>
      </header>

      <form className="toolbar normie-3d-toolbar" onSubmit={onSubmit}>
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
        <label className="field field--check">
          <input
            type="checkbox"
            checked={useOriginalSvg}
            onChange={(e) => setUseOriginalSvg(e.target.checked)}
          />{" "}
          Original SVG (pre-canvas)
        </label>
        <label className="field" title="Face / art extrusion (max 16). Back plate is fixed separately.">
          Extrude depth
          <input
            className="input input--narrow"
            type="number"
            min={1}
            max={16}
            value={extrudeDepth}
            onChange={(e) => setExtrudeDepth(Number(e.target.value))}
          />
        </label>
        <label
          className="field field--check"
          title="Thin fixed plate (0.1 + 0.9) on −Z of the art plane so it sits behind the face with the default camera."
        >
          <input
            type="checkbox"
            checked={includeBackgroundPlate}
            onChange={(e) => setIncludeBackgroundPlate(e.target.checked)}
          />{" "}
          Include back plate
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={bevel}
            onChange={(e) => setBevel(e.target.checked)}
          />{" "}
          Bevel (heavier mesh)
        </label>
        <button className="btn" type="submit">
          Load 3D
        </button>

        <section
          className="normie-3d-bake-colors-section normie-3d-toolbar__bake-colors"
          aria-labelledby={bakeExportTitleId}
        >
          <div
            id={bakeExportTitleId}
            className="normie-3d-bake-colors-section__title"
          >
            Bake colors
          </div>
          <p className="normie-3d-bake-colors-section__hint">
            GLB export can bake the live mesh gradient into vertex colors (plain{" "}
            <code className="normie-3d-bake-colors-section__code">
              MeshStandardMaterial
            </code>
            , no custom shader). Solid face / background swatches are already in the
            exported materials. Turn on mesh gradient and blend below the preview,
            then enable the checkbox to include gradient in the bake. Filename adds{" "}
            <code className="normie-3d-bake-colors-section__code">-baked</code> when
            this runs.
          </p>
          <div className="normie-3d-viewer-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={
                exportUi.activeId === null ||
                exportUi.exporting ||
                exportUi.loading
              }
              onClick={() => void viewerRef.current?.downloadGlb()}
            >
              {exportUi.exporting ? "Exporting…" : "Download GLB"}
            </button>
            <label
              className="field field--check normie-3d-viewer-actions__bake"
              title="Bakes the mesh gradient into vertex colors (solid materials only). GLB uses standard materials—no custom shader. Filename gets a “-baked” suffix."
            >
              <input
                type="checkbox"
                checked={exportBakeGradientGlb}
                disabled={
                  exportUi.activeId === null ||
                  !exportUi.canBakeGradientGlb ||
                  exportUi.loading
                }
                onChange={(e) => setExportBakeGradientGlb(e.target.checked)}
              />{" "}
              Bake gradient into GLB
            </label>
          </div>
        </section>
      </form>

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      <Normie3DViewer
        ref={viewerRef}
        loadParams={loadParams}
        layout="page"
        showExportButton={false}
        exportBakeGradientGlb={exportBakeGradientGlb}
        onExportBakeGradientGlbChange={setExportBakeGradientGlb}
        onExportUiState={onExportUiState}
      />

      <p className="normie-3d-hint">
        Use the <strong>corner icon on the 3D preview</strong> to grow it over the
        page in this tab (press <strong>Esc</strong> to exit). After load we{" "}
        <strong>frame the mesh
        once</strong> — then the camera is free: orbit (drag),{" "}
        <strong>pan</strong> (right-drag or shift-drag), zoom (scroll), with a wide
        zoom range. Use <strong>Re-frame camera</strong> to snap back. Default{" "}
        <strong>turntable spins the mesh</strong>; optional{" "}
        <strong>Orbit camera (auto)</strong> spins the view independently. WebGL
        in your browser (no plugin).
      </p>

      <SiteFooter />
    </div>
  );
}
