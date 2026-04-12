import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import {
  fetchNormiePixelsPlain,
  imageCompositedSvgUrl,
  imageOriginalSvgUrl,
} from "../lib/normies-api";
import { fitCameraToPivotContent } from "../lib/normie-3d-camera";
import { bakeMeshGradientVertexColorsForGlb } from "../lib/normie-3d-export-bake";
import {
  DEFAULT_BACKGROUND_MESH_COLOR,
  DEFAULT_FACE_MESH_COLOR,
  defaultMeshGradientState,
  syncMeshGradient,
  syncMeshSolidColors,
  type MeshGradientAxis,
} from "../lib/normie-3d-mesh-gradient";
import { mountMeshOnTurntable } from "../lib/normie-3d-pivot";
import {
  buildExtrudedGroupFromSvg,
  disposeGroupContents,
  MAX_FACE_EXTRUDE_DEPTH,
} from "../lib/normie-extrude-svg";
import { buildPixelVoxelGroup } from "../lib/normie-pixel-voxels";
import "../App.css";

/** Same angular scale as `OrbitControls.autoRotateSpeed` (rad/s factor 2π/60). */
const MESH_SPIN_RPM_FACTOR = (Math.PI * 2) / 60;

/** Initial `DirectionalLight.shadow.intensity` (0–1): subtle on face + back plate. */
const DEFAULT_SHADOW_INTENSITY = 0.38;

function shadowCatcherOpacity(intensity01: number): number {
  return THREE.MathUtils.lerp(0.08, 0.72, intensity01);
}

function IconExpandWindow() {
  return (
    <svg
      className="normie-3d-expand-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function IconContractWindow() {
  return (
    <svg
      className="normie-3d-expand-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M4 10V4h6M14 4h6v6M4 14v6h6M14 14v6h6" />
    </svg>
  );
}

export type Normie3DLoadParams = {
  tokenId: number;
  useOriginalSvg: boolean;
  extrudeDepth: number;
  bevel: boolean;
  includeBackgroundPlate: boolean;
};

export type Normie3DExportUiState = {
  activeId: number | null;
  loading: boolean;
  exporting: boolean;
  canBakeGradientGlb: boolean;
};

export type Normie3DViewerHandle = {
  downloadGlb: () => void;
};

export type Normie3DViewerProps = {
  /** When null, mesh is cleared. Otherwise loads / reloads with these settings. */
  loadParams: Normie3DLoadParams | null;
  /** Taller viewer on `/3d`, shorter panel on Lab. */
  layout?: "page" | "inline";
  className?: string;
  showExportButton?: boolean;
  /** Grid, lighting, turntable (default true; set false for a minimal embed). */
  showSceneControls?: boolean;
  /**
   * When `showExportButton` is false, parent renders export UI and should pass
   * these so the checkbox stays in sync with `downloadGlb`.
   */
  exportBakeGradientGlb?: boolean;
  onExportBakeGradientGlbChange?: (next: boolean) => void;
  /** For parent-hosted export controls (disabled states, bake eligibility). */
  onExportUiState?: (s: Normie3DExportUiState) => void;
};

function loadParamsEqual(
  a: Normie3DLoadParams | null,
  b: Normie3DLoadParams,
): boolean {
  if (!a) return false;
  return (
    a.tokenId === b.tokenId &&
    a.useOriginalSvg === b.useOriginalSvg &&
    a.extrudeDepth === b.extrudeDepth &&
    a.bevel === b.bevel &&
    a.includeBackgroundPlate === b.includeBackgroundPlate
  );
}

async function fetchSvgText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "image/svg+xml,*/*" },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `${res.status} ${res.statusText}`);
  }
  return res.text();
}

export const Normie3DViewer = forwardRef<
  Normie3DViewerHandle,
  Normie3DViewerProps
>(function Normie3DViewer(
  {
    loadParams,
    layout = "page",
    className,
    showExportButton = true,
    showSceneControls = true,
    exportBakeGradientGlb: exportBakeGradientGlbProp,
    onExportBakeGradientGlbChange,
    onExportUiState,
  },
  ref,
) {
  const bakeColorsSectionTitleId = useId();
  const mountRef = useRef<HTMLDivElement>(null);
  const webglCleanupRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    pivot: THREE.Group;
    floorGrid: THREE.GridHelper;
    ambient: THREE.AmbientLight;
    keyLight: THREE.DirectionalLight;
    fillLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    shadowFloor: THREE.Mesh;
    turntable: THREE.Object3D | null;
  } | null>(null);
  const rafRef = useRef(0);
  const modelRef = useRef<THREE.Group | null>(null);
  const viewerGeneration = useRef(0);
  const loadParamsRef = useRef(loadParams);
  loadParamsRef.current = loadParams;
  /** Read inside RAF tick — avoid stale closures for spin / speed. */
  const viewerOptsRef = useRef({
    spinMesh: true,
    /** Same units as `OrbitControls.autoRotateSpeed` (~2 ≈ one turn / 30s). */
    turntableSpeed: 0.2,
  });

  const [showGrid, setShowGrid] = useState(false);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [shadowIntensity, setShadowIntensity] = useState(
    DEFAULT_SHADOW_INTENSITY,
  );
  const [spinMesh, setSpinMesh] = useState(true);
  const [turntableSpeed, setTurntableSpeed] = useState(0.2);
  /** Optional: OrbitControls auto-rotate the *camera* around the target (independent of mesh spin). */
  const [orbitCamera, setOrbitCamera] = useState(false);
  const [cameraOrbitSpeed, setCameraOrbitSpeed] = useState(1.25);
  const [ambientIntensity, setAmbientIntensity] = useState(0);
  const [keyIntensity, setKeyIntensity] = useState(3);
  const [fillIntensity, setFillIntensity] = useState(0.12);
  const [rimIntensity, setRimIntensity] = useState(2.5);

  const [meshGradEnabled, setMeshGradEnabled] = useState(true);
  const [faceMeshColor, setFaceMeshColor] = useState(DEFAULT_FACE_MESH_COLOR);
  const [backgroundMeshColor, setBackgroundMeshColor] = useState(
    DEFAULT_BACKGROUND_MESH_COLOR,
  );
  const [meshGradColorA, setMeshGradColorA] = useState("#1a1d28");
  const [meshGradColorB, setMeshGradColorB] = useState("#4b5391");
  const [meshGradAxis, setMeshGradAxis] = useState<MeshGradientAxis>("y");
  const [meshGradBlend, setMeshGradBlend] = useState(0.82);
  /** GLB: bake gradient into vertex colors (no custom shader in file). */
  const [fallbackExportBakeGlb, setFallbackExportBakeGlb] = useState(false);
  const exportBakeControlled =
    exportBakeGradientGlbProp !== undefined &&
    onExportBakeGradientGlbChange !== undefined;
  const exportBakeGradientGlb = exportBakeControlled
    ? exportBakeGradientGlbProp
    : fallbackExportBakeGlb;
  const setExportBakeGradientGlb = exportBakeControlled
    ? onExportBakeGradientGlbChange
    : setFallbackExportBakeGlb;
  /** Full-viewport overlay for `/3d` page only — same tab, larger canvas. */
  const [expandOverlay, setExpandOverlay] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [meshSource, setMeshSource] = useState<"svg" | "pixels" | null>(null);
  /** Bumped when WebGL scene is attached so `useEffect` can load after `sceneRef` exists. */
  const [sceneGen, setSceneGen] = useState(0);

  viewerOptsRef.current.spinMesh = spinMesh;
  viewerOptsRef.current.turntableSpeed = turntableSpeed;

  useEffect(() => {
    if (!expandOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandOverlay(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expandOverlay]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.floorGrid.visible = showGrid;
  }, [showGrid, sceneGen]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.ambient.intensity = ambientIntensity;
    ctx.keyLight.intensity = keyIntensity;
    ctx.fillLight.intensity = fillIntensity;
    ctx.rimLight.intensity = rimIntensity;
  }, [
    ambientIntensity,
    keyIntensity,
    fillIntensity,
    rimIntensity,
    sceneGen,
  ]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.controls.autoRotate = orbitCamera;
    ctx.controls.autoRotateSpeed = cameraOrbitSpeed;
  }, [orbitCamera, cameraOrbitSpeed, sceneGen]);

  const reframeCamera = useCallback(() => {
    const ctx = sceneRef.current;
    if (!ctx || !modelRef.current) return;
    fitCameraToPivotContent(
      ctx.pivot,
      ctx.camera,
      ctx.controls,
      ctx.floorGrid,
    );
    ctx.controls.update();
  }, []);

  const resetColorDefaults = useCallback(() => {
    setFaceMeshColor(DEFAULT_FACE_MESH_COLOR);
    setBackgroundMeshColor(DEFAULT_BACKGROUND_MESH_COLOR);
    setMeshGradColorA(defaultMeshGradientState.colorA);
    setMeshGradColorB(defaultMeshGradientState.colorB);
  }, []);

  const runLoad = useCallback(async (p: Normie3DLoadParams) => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    setLoading(true);
    setErr(null);

    const genAtStart = viewerGeneration.current;
    let builtGroup: THREE.Group | null = null;
    try {
      const url = p.useOriginalSvg
        ? imageOriginalSvgUrl(p.tokenId)
        : imageCompositedSvgUrl(p.tokenId);
      const svg = await fetchSvgText(url);

      setMeshSource(null);
      try {
        builtGroup = buildExtrudedGroupFromSvg(svg, {
          depth: p.extrudeDepth,
          bevel: p.bevel,
          foregroundOnly: !p.includeBackgroundPlate,
        });
        setMeshSource("svg");
      } catch {
        try {
          builtGroup = buildExtrudedGroupFromSvg(svg, {
            depth: p.extrudeDepth,
            bevel: p.bevel,
            foregroundOnly: false,
          });
          setMeshSource("svg");
        } catch {
          const pixels = await fetchNormiePixelsPlain(
            p.tokenId,
            p.useOriginalSvg,
          );
          builtGroup = buildPixelVoxelGroup(
            pixels,
            Math.min(p.extrudeDepth, MAX_FACE_EXTRUDE_DEPTH),
          );
          setMeshSource("pixels");
        }
      }

      if (!builtGroup) {
        setLoading(false);
        return;
      }

      const ctx2 = sceneRef.current;
      if (
        !ctx2 ||
        viewerGeneration.current !== genAtStart ||
        !loadParamsEqual(loadParamsRef.current, p)
      ) {
        disposeGroupContents(builtGroup);
        return;
      }

      const oldTt = ctx2.pivot.getObjectByName("normieTurntable");
      if (oldTt) ctx2.pivot.remove(oldTt);
      if (modelRef.current) {
        disposeGroupContents(modelRef.current);
        modelRef.current = null;
      }

      const turntable = mountMeshOnTurntable(ctx2.pivot, builtGroup);
      ctx2.turntable = turntable;
      modelRef.current = builtGroup;
      fitCameraToPivotContent(
        ctx2.pivot,
        ctx2.camera,
        ctx2.controls,
        ctx2.floorGrid,
      );
      ctx2.controls.update();
      setActiveId(p.tokenId);
    } catch (e2) {
      if (builtGroup) disposeGroupContents(builtGroup);
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setActiveId(null);
      setMeshSource(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearModel = useCallback(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const tt = ctx.turntable;
    if (tt) {
      ctx.pivot.remove(tt);
      ctx.turntable = null;
    }
    if (modelRef.current) {
      disposeGroupContents(modelRef.current);
      modelRef.current = null;
    }
    setActiveId(null);
    setMeshSource(null);
    setErr(null);
  }, []);

  useEffect(() => {
    if (loadParams === null) {
      clearModel();
      return;
    }
    if (!sceneRef.current) return;
    void runLoad(loadParams);
  }, [loadParams, sceneGen, runLoad, clearModel]);

  useEffect(() => {
    const root = modelRef.current;
    if (!root || activeId === null) return;
    syncMeshSolidColors(root, faceMeshColor, backgroundMeshColor);
  }, [
    activeId,
    faceMeshColor,
    backgroundMeshColor,
    sceneGen,
  ]);

  useEffect(() => {
    const root = modelRef.current;
    if (!root || activeId === null) return;
    syncMeshGradient(root, {
      enabled: meshGradEnabled,
      colorA: meshGradColorA,
      colorB: meshGradColorB,
      axis: meshGradAxis,
      blend: meshGradBlend,
    });
  }, [
    activeId,
    meshGradEnabled,
    meshGradColorA,
    meshGradColorB,
    meshGradAxis,
    meshGradBlend,
    sceneGen,
  ]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.renderer.shadowMap.enabled = shadowsEnabled;
    ctx.renderer.shadowMap.needsUpdate = true;
    ctx.keyLight.castShadow = shadowsEnabled;
    ctx.shadowFloor.visible = shadowsEnabled;

    const str = shadowsEnabled ? shadowIntensity : 0;
    ctx.keyLight.shadow.intensity = str;
    const catcher = ctx.shadowFloor.material as THREE.ShadowMaterial;
    catcher.opacity = shadowsEnabled
      ? shadowCatcherOpacity(shadowIntensity)
      : catcher.opacity;

    const root = modelRef.current;
    if (root) {
      root.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.InstancedMesh
        ) {
          obj.castShadow = shadowsEnabled;
          obj.receiveShadow = shadowsEnabled;
        }
      });
    }
  }, [shadowsEnabled, shadowIntensity, sceneGen, activeId]);

  const onViewerCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (webglCleanupRef.current) {
      webglCleanupRef.current();
      webglCleanupRef.current = null;
    }
    sceneRef.current = null;

    if (!canvas) return;

    const mount = canvas.parentElement;
    if (!mount) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12141a);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    camera.position.set(0, 0.15, 4.2);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const floorGrid = new THREE.GridHelper(5, 24, 0x3d424d, 0x252830);
    floorGrid.position.y = -1.45;
    floorGrid.visible = false;
    scene.add(floorGrid);

    const ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xfff5eb, 3);
    keyLight.position.set(3.5, 5.5, 3.2);
    keyLight.castShadow = true;
    const sh = keyLight.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.near = 0.2;
    sh.camera.far = 28;
    const ortho = 6;
    sh.camera.left = -ortho;
    sh.camera.right = ortho;
    sh.camera.top = ortho;
    sh.camera.bottom = -ortho;
    sh.bias = -0.00025;
    sh.normalBias = 0.009;
    sh.intensity = DEFAULT_SHADOW_INTENSITY;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb8c4ff, 0.12);
    fillLight.position.set(-4.2, 2.2, -1.5);
    fillLight.castShadow = false;
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x7ec8ff, 2.5);
    rimLight.position.set(-1.2, 2.8, -5);
    rimLight.castShadow = false;
    scene.add(rimLight);

    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.ShadowMaterial({
        opacity: shadowCatcherOpacity(DEFAULT_SHADOW_INTENSITY),
      }),
    );
    shadowFloor.name = "normieShadowFloor";
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = -0.06;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    const pivot = new THREE.Group();
    scene.add(pivot);

    const controls = new OrbitControls(camera, renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.autoRotate = false;
    controls.minPolarAngle = 0.06;
    controls.maxPolarAngle = Math.PI - 0.06;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0, 0);
    controls.minDistance = 0.05;
    controls.maxDistance = 500;

    const onResize = () => {
      if (cancelled) return;
      const el = canvas.parentElement;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.max(2, Math.floor(r.width) || el.clientWidth || 640);
      const h = Math.max(2, Math.floor(r.height) || el.clientHeight || 480);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    let lastTick = performance.now();
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.07, (now - lastTick) / 1000);
      lastTick = now;
      const opt = viewerOptsRef.current;
      const tt = sceneRef.current?.turntable;
      if (opt.spinMesh && opt.turntableSpeed > 0 && tt) {
        tt.rotation.y += MESH_SPIN_RPM_FACTOR * opt.turntableSpeed * dt;
      }
      rafRef.current = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };

    onResize();
    ro = new ResizeObserver(() => onResize());
    ro.observe(mount);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      pivot,
      floorGrid,
      ambient,
      keyLight,
      fillLight,
      rimLight,
      shadowFloor,
      turntable: null,
    };
    tick();
    setSceneGen((g) => g + 1);

    webglCleanupRef.current = () => {
      viewerGeneration.current += 1;
      cancelled = true;
      ro?.disconnect();
      cancelAnimationFrame(rafRef.current);
      controls.dispose();
      renderer.dispose();
      scene.remove(floorGrid);
      floorGrid.dispose();
      scene.remove(shadowFloor);
      shadowFloor.geometry.dispose();
      (shadowFloor.material as THREE.Material).dispose();
      const tt = sceneRef.current?.turntable;
      if (tt) pivot.remove(tt);
      if (sceneRef.current) sceneRef.current.turntable = null;
      if (modelRef.current) {
        disposeGroupContents(modelRef.current);
        modelRef.current = null;
      }
      sceneRef.current = null;
    };
  }, [runLoad]);

  const downloadGlb = useCallback(async () => {
    const model = modelRef.current;
    if (!model || activeId === null || !loadParams) return;

    setExporting(true);
    setErr(null);
    try {
      const exportRoot = new THREE.Group();
      const tmpM = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();

      for (const child of model.children) {
        if (child instanceof THREE.InstancedMesh) {
          const im = child;
          const mat = im.material as THREE.MeshStandardMaterial;
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, tmpM);
            tmpM.decompose(pos, quat, scl);
            const m = new THREE.Mesh(im.geometry.clone(), mat.clone());
            m.position.copy(pos);
            m.quaternion.copy(quat);
            m.scale.copy(scl);
            exportRoot.add(m);
          }
        } else if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          exportRoot.add(
            new THREE.Mesh(child.geometry.clone(), mat.clone()),
          );
        }
      }
      exportRoot.position.copy(model.position);
      exportRoot.rotation.copy(model.rotation);
      exportRoot.scale.copy(model.scale);

      const wantsBakedGradientGlb =
        exportBakeGradientGlb && meshGradEnabled && meshGradBlend > 0;
      if (wantsBakedGradientGlb) {
        bakeMeshGradientVertexColorsForGlb(exportRoot, model, {
          enabled: meshGradEnabled,
          colorA: meshGradColorA,
          colorB: meshGradColorB,
          axis: meshGradAxis,
          blend: meshGradBlend,
        });
      }

      const exportScene = new THREE.Scene();
      exportScene.add(exportRoot);

      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(exportScene, {
        binary: true,
      });
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error("Expected binary GLB export");
      }
      const blob = new Blob([buffer], {
        type: "model/gltf-binary",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const tag = loadParams.useOriginalSvg ? "original" : "current";
      a.download = `normie-${activeId}-${tag}${wantsBakedGradientGlb ? "-baked" : ""}.glb`;
      a.click();
      URL.revokeObjectURL(a.href);

      exportRoot.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) {
            for (const x of m) x.dispose();
          } else {
            m.dispose();
          }
        }
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setExporting(false);
    }
  }, [
    activeId,
    loadParams,
    exportBakeGradientGlb,
    meshGradEnabled,
    meshGradColorA,
    meshGradColorB,
    meshGradAxis,
    meshGradBlend,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      downloadGlb: () => {
        void downloadGlb();
      },
    }),
    [downloadGlb],
  );

  useEffect(() => {
    if (!onExportUiState) return;
    onExportUiState({
      activeId,
      loading,
      exporting,
      canBakeGradientGlb: meshGradEnabled && meshGradBlend > 0,
    });
  }, [
    activeId,
    loading,
    exporting,
    meshGradEnabled,
    meshGradBlend,
    onExportUiState,
  ]);

  const viewClass =
    layout === "inline"
      ? "normie-3d-view normie-3d-view--inline"
      : "normie-3d-view";

  const toolbarCameraMotion = (
    <div className="normie-3d-scene-inner">
      <div className="normie-3d-scene-row normie-3d-scene-row--camera-actions">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={activeId === null}
          onClick={reframeCamera}
        >
          Re-frame camera
        </button>
        <span className="normie-3d-camera-hint">
          Drag orbit · right-drag / shift-drag pan · scroll zoom — not locked to
          the first shot.
        </span>
      </div>
      <div className="normie-3d-scene-row normie-3d-scene-row--sliders normie-3d-scene-row--motion">
        <label
          className={`field normie-3d-slider${spinMesh ? "" : " normie-3d-slider--disabled"}`}
          title="Same scale as camera auto-orbit: ~2 ≈ one turn per 30s. 0 = still mesh."
        >
          <span>Mesh spin rate</span>
          <input
            type="range"
            min={0}
            max={4}
            step={0.05}
            value={turntableSpeed}
            disabled={!spinMesh}
            onChange={(e) =>
              setTurntableSpeed(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">
            {turntableSpeed.toFixed(2)}
          </span>
        </label>
        <label
          className={`field normie-3d-slider${orbitCamera ? "" : " normie-3d-slider--disabled"}`}
          title="OrbitControls autoRotateSpeed: ~2 ≈ one turn per 30s"
        >
          <span>Camera orbit rate</span>
          <input
            type="range"
            min={0.2}
            max={4}
            step={0.05}
            value={cameraOrbitSpeed}
            disabled={!orbitCamera}
            onChange={(e) =>
              setCameraOrbitSpeed(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">
            {cameraOrbitSpeed.toFixed(2)}
          </span>
        </label>
      </div>
    </div>
  );

  const toolbarViewGradient = (
    <>
      <div className="normie-3d-scene-row normie-3d-scene-row--checks">
        <label className="field field--check">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />{" "}
          Show grid
        </label>
        <label className="field field--check" title="Real-time shadow map from key light">
          <input
            type="checkbox"
            checked={shadowsEnabled}
            onChange={(e) => setShadowsEnabled(e.target.checked)}
          />{" "}
          Shadows
        </label>
        <label
          className={`field normie-3d-slider normie-3d-slider--shadow-intensity${shadowsEnabled ? "" : " normie-3d-slider--disabled"}`}
          title="Shadow darkness on mesh (face, back plate) and on the ground catcher"
        >
          <span>Shadow intensity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={shadowIntensity}
            disabled={!shadowsEnabled}
            onChange={(e) =>
              setShadowIntensity(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">
            {Math.round(shadowIntensity * 100)}%
          </span>
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={spinMesh}
            onChange={(e) => setSpinMesh(e.target.checked)}
          />{" "}
          Turntable (spin mesh)
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={orbitCamera}
            onChange={(e) => setOrbitCamera(e.target.checked)}
          />{" "}
          Orbit camera (auto)
        </label>
      </div>
      <div className="normie-3d-scene-row normie-3d-scene-row--gradient">
        <div className="normie-3d-solid-mesh-colors">
          <label className="field normie-3d-gradient-swatch">
            <span>Face mesh</span>
            <input
              type="color"
              value={faceMeshColor}
              onChange={(e) => setFaceMeshColor(e.target.value)}
              aria-label="Face mesh solid color"
            />
          </label>
          <label className="field normie-3d-gradient-swatch">
            <span>Background mesh</span>
            <input
              type="color"
              value={backgroundMeshColor}
              onChange={(e) => setBackgroundMeshColor(e.target.value)}
              disabled={meshSource === "pixels"}
              aria-label="Background mesh solid color"
              title={
                meshSource === "pixels"
                  ? "No back plate in pixel mode"
                  : "Back plate and plate backing (when included)"
              }
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--small normie-3d-solid-mesh-colors__reset"
            disabled={activeId === null || loading}
            title="Restore face, background, and gradient A/B to their initial defaults"
            onClick={resetColorDefaults}
          >
            Reset color defaults
          </button>
        </div>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={meshGradEnabled}
            onChange={(e) => setMeshGradEnabled(e.target.checked)}
          />{" "}
          Mesh gradient (world axis)
        </label>
        <div className="normie-3d-gradient-colors">
          <label className="field normie-3d-gradient-swatch">
            <span>A</span>
            <input
              type="color"
              value={meshGradColorA}
              onChange={(e) => setMeshGradColorA(e.target.value)}
              aria-label="Gradient color A"
            />
          </label>
          <label className="field normie-3d-gradient-swatch">
            <span>B</span>
            <input
              type="color"
              value={meshGradColorB}
              onChange={(e) => setMeshGradColorB(e.target.value)}
              aria-label="Gradient color B"
            />
          </label>
        </div>
        <label className="field normie-3d-gradient-axis">
          <span>Axis</span>
          <select
            className="input input--narrow"
            value={meshGradAxis}
            onChange={(e) =>
              setMeshGradAxis(e.target.value as MeshGradientAxis)
            }
          >
            <option value="x">World X</option>
            <option value="y">World Y</option>
            <option value="z">World Z</option>
          </select>
        </label>
        <label
          className={`field normie-3d-slider${meshGradEnabled ? "" : " normie-3d-slider--disabled"}`}
          title="How much the gradient replaces the mesh base color"
        >
          <span>Gradient mix</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={meshGradBlend}
            disabled={!meshGradEnabled}
            onChange={(e) =>
              setMeshGradBlend(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">
            {meshGradBlend.toFixed(2)}
          </span>
        </label>
      </div>
    </>
  );

  const toolbarLightingRows = (
    <>
      <div className="normie-3d-scene-row normie-3d-scene-row--sliders normie-3d-scene-row--lights">
        <label className="field normie-3d-slider">
          <span>Ambient</span>
          <input
            type="range"
            min={0}
            max={1.25}
            step={0.02}
            value={ambientIntensity}
            onChange={(e) =>
              setAmbientIntensity(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">
            {ambientIntensity.toFixed(2)}
          </span>
        </label>
        <label className="field normie-3d-slider">
          <span>Key light</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={keyIntensity}
            onChange={(e) =>
              setKeyIntensity(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">{keyIntensity.toFixed(2)}</span>
        </label>
        <label className="field normie-3d-slider">
          <span>Fill (cool)</span>
          <input
            type="range"
            min={0}
            max={2.25}
            step={0.05}
            value={fillIntensity}
            onChange={(e) =>
              setFillIntensity(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">{fillIntensity.toFixed(2)}</span>
        </label>
        <label className="field normie-3d-slider">
          <span>Rim / edge</span>
          <input
            type="range"
            min={0}
            max={2.5}
            step={0.05}
            value={rimIntensity}
            onChange={(e) =>
              setRimIntensity(Number.parseFloat(e.target.value))
            }
          />
          <span className="normie-3d-slider__v">{rimIntensity.toFixed(2)}</span>
        </label>
      </div>
      <div className="normie-3d-scene-row normie-3d-scene-row--presets">
        <span className="field normie-3d-presets-label">Light presets</span>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setAmbientIntensity(0.1);
            setKeyIntensity(2.45);
            setFillIntensity(0.12);
            setRimIntensity(1.35);
          }}
        >
          Dramatic
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setAmbientIntensity(0.48);
            setKeyIntensity(1.35);
            setFillIntensity(0.38);
            setRimIntensity(0.55);
          }}
        >
          Balanced
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setAmbientIntensity(0.78);
            setKeyIntensity(0.85);
            setFillIntensity(0.5);
            setRimIntensity(0.18);
          }}
        >
          Soft / flat
        </button>
      </div>
    </>
  );

  const toolbarBelowCanvas = (
    <div className="normie-3d-scene-inner normie-3d-scene-inner--below-canvas">
      {toolbarViewGradient}
      <div className="normie-3d-scene-below__lighting">{toolbarLightingRows}</div>
    </div>
  );

  const sceneToolbarAboveBlock =
    showSceneControls &&
    (layout === "inline" ? (
      <details className="normie-3d-scene-details">
        <summary className="normie-3d-scene-details__summary">
          Camera & motion
        </summary>
        {toolbarCameraMotion}
      </details>
    ) : (
      <div className="normie-3d-scene-toolbar normie-3d-scene-toolbar--above-canvas">
        {toolbarCameraMotion}
      </div>
    ));

  const sceneToolbarBelowBlock =
    showSceneControls &&
    (layout === "inline" ? (
      <details className="normie-3d-scene-details normie-3d-scene-details--below-canvas">
        <summary className="normie-3d-scene-details__summary">
          View, gradient & lighting
        </summary>
        {toolbarBelowCanvas}
      </details>
    ) : (
      <div className="normie-3d-scene-toolbar normie-3d-scene-toolbar--below-canvas">
        {toolbarBelowCanvas}
      </div>
    ));

  const rootClass = [
    "normie-3d-viewer-root",
    expandOverlay && layout === "page" ? "normie-3d-viewer-root--expanded" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      {showExportButton && (
        <section
          className="normie-3d-bake-colors-section"
          aria-labelledby={bakeColorsSectionTitleId}
        >
          <div
            id={bakeColorsSectionTitleId}
            className="normie-3d-bake-colors-section__title"
          >
            Normies GLB Creator
          </div>
          <p className="normie-3d-bake-colors-section__hint">
            GLB export can bake the live mesh gradient into vertex colors (plain{" "}
            <code className="normie-3d-bake-colors-section__code">
              MeshStandardMaterial
            </code>
            , no custom shader). Solid face / background swatches are already in the
            exported materials. Turn on mesh gradient and blend above, then enable
            the checkbox to include gradient in the bake. Filename adds{" "}
            <code className="normie-3d-bake-colors-section__code">-baked</code>{" "}
            when this runs.
          </p>
          <div className="normie-3d-viewer-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={activeId === null || exporting || loading}
              onClick={() => void downloadGlb()}
            >
              {exporting ? "Exporting…" : "Download GLB"}
            </button>
            <label
              className="field field--check normie-3d-viewer-actions__bake"
              title="Bakes the mesh gradient into vertex colors (solid materials only). GLB uses standard materials—no custom shader. Filename gets a “-baked” suffix."
            >
              <input
                type="checkbox"
                checked={exportBakeGradientGlb}
                disabled={
                  activeId === null ||
                  !meshGradEnabled ||
                  meshGradBlend <= 0 ||
                  loading
                }
                onChange={(e) => setExportBakeGradientGlb(e.target.checked)}
              />{" "}
              Bake gradient into GLB
            </label>
          </div>
        </section>
      )}

      {err && (
        <div className="banner banner--err" role="alert">
          {err}
        </div>
      )}

      {sceneToolbarAboveBlock}

      <div
        ref={mountRef}
        className={viewClass}
        aria-label="3D turntable preview"
      >
        {layout === "page" && (
          <button
            type="button"
            className="normie-3d-expand-float"
            aria-label={
              expandOverlay
                ? "Exit expanded viewer"
                : "Expand 3D viewer to fill the window"
            }
            title={
              expandOverlay
                ? "Return to normal layout (Esc)"
                : "Expand the 3D preview to fill the window (same tab)"
            }
            onClick={() => setExpandOverlay((v) => !v)}
          >
            {expandOverlay ? <IconContractWindow /> : <IconExpandWindow />}
          </button>
        )}
        <canvas ref={onViewerCanvasRef} className="normie-3d-canvas" />
      </div>

      {sceneToolbarBelowBlock}

      {meshSource === "pixels" && activeId !== null && (
        <p className="normie-3d-source" role="status">
          Mesh from <strong>40×40 on-chain pixels</strong> (SVG had no solid
          fills Three.js could extrude).
        </p>
      )}
    </div>
  );
});

Normie3DViewer.displayName = "Normie3DViewer";
