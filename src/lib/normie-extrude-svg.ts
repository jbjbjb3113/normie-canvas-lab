import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY } from "./normie-3d-mesh-gradient";

/** API “pixel off” / canvas background (light grey). */
const NORMIE_OFF_COLOR = new THREE.Color("#e3e5e4");

/** Canvas plate lip (same units as face extrude slider, pre-fit scale). Kept thin. */
const BACKGROUND_PLATE_EXTRUDE_DEPTH = 0.1;

/** Foreground / face paths cap for deeper shadows on the plate (same units). */
export const MAX_FACE_EXTRUDE_DEPTH = 16;

/**
 * Solid block behind the lip (same units). Not tied to face extrude depth.
 */
const BACKGROUND_PLATE_FIXED_SOLID_DEPTH = 0.9;

/** Bevel knobs need roughly this much depth to stay valid. */
const MIN_DEPTH_FOR_BEVEL = 1.25;

/**
 * Plate sits on **negative Z** (away from default camera on +Z). Small gap vs z=0 so
 * bevels / numeric noise on the face cap do not intersect the plate.
 */
const PLATE_Z_GAP_FLAT = 1e-4;
const PLATE_Z_GAP_BEVEL = 0.35;

export type ExtrudeSvgOptions = {
  depth: number;
  bevel: boolean;
  /**
   * When true (default), skip SVG fills that match the Normies light background
   * so only the dark “pixel on” art is extruded — not the square plate.
   */
  foregroundOnly?: boolean;
};

/**
 * Light fills (background plate) are bright; “pixel on” art uses #48494b and similar.
 */
export function isLikelyNormieLightBackground(color: THREE.Color): boolean {
  const lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  if (lum > 0.78) return true;
  const dr = color.r - NORMIE_OFF_COLOR.r;
  const dg = color.g - NORMIE_OFF_COLOR.g;
  const db = color.b - NORMIE_OFF_COLOR.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  return dist < 0.06;
}

/**
 * Plate “forward” (along extrude +Z from the SVG plane): cap so the thin plate
 * never spans more than `maxForward` — ExtrudeGeometry can overshoot slightly on curves.
 */
function clampPlateGeometryZToForwardExtent(
  geom: THREE.BufferGeometry,
  maxForward: number,
): void {
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) return;
  const z0 = bb.min.z;
  const z1 = bb.max.z;
  const span = z1 - z0;
  const pos = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;

  if (span < 1e-8) {
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, 0);
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getZ(i) - z0) / span;
      pos.setZ(i, t * maxForward);
    }
  }
  pos.needsUpdate = true;
  geom.computeBoundingBox();
  geom.computeVertexNormals();
}

function addPlateWithSolidBacking(
  parent: THREE.Group,
  shape: THREE.Shape,
  material: THREE.MeshStandardMaterial,
  bevel: boolean,
): void {
  const plateExtrude: THREE.ExtrudeGeometryOptions = {
    depth: BACKGROUND_PLATE_EXTRUDE_DEPTH,
    bevelEnabled: false,
    bevelThickness: 0,
    bevelSize: 0,
    bevelOffset: 0,
    bevelSegments: 1,
    steps: 1,
  };

  let frontGeom: THREE.ExtrudeGeometry;
  try {
    frontGeom = new THREE.ExtrudeGeometry(shape, plateExtrude);
  } catch {
    return;
  }

  clampPlateGeometryZToForwardExtent(frontGeom, BACKGROUND_PLATE_EXTRUDE_DEPTH);

  frontGeom.computeBoundingBox();
  const bb = frontGeom.boundingBox;
  if (!bb) {
    frontGeom.dispose();
    return;
  }

  const plateBackZ = BACKGROUND_PLATE_EXTRUDE_DEPTH;
  const backDepth = BACKGROUND_PLATE_FIXED_SOLID_DEPTH;
  const assembly = new THREE.Group();
  assembly.add(new THREE.Mesh(frontGeom, material));

  if (backDepth > 1e-4) {
    const bw = Math.max(bb.max.x - bb.min.x, 1e-6);
    const bh = Math.max(bb.max.y - bb.min.y, 1e-6);
    const bx = (bb.max.x + bb.min.x) / 2;
    const by = (bb.max.y + bb.min.y) / 2;
    const backGeom = new THREE.BoxGeometry(bw, bh, backDepth);
    const backMat = material.clone();
    const backMesh = new THREE.Mesh(backGeom, backMat);
    backMesh.position.set(bx, by, plateBackZ + backDepth / 2);
    assembly.add(backMesh);
  }

  const plateZExtent = BACKGROUND_PLATE_EXTRUDE_DEPTH + BACKGROUND_PLATE_FIXED_SOLID_DEPTH;
  const zGap = bevel ? PLATE_Z_GAP_BEVEL : PLATE_Z_GAP_FLAT;
  /** Camera on +Z: face uses z ≥ 0; plate lives z < 0 so the art is in front. */
  assembly.position.z = -plateZExtent - zGap;

  parent.add(assembly);
}

/**
 * Parses Normies SVG, extrudes filled paths into a centered group (Y flipped for SVG space).
 */
export function buildExtrudedGroupFromSvg(
  svgString: string,
  opts: ExtrudeSvgOptions,
): THREE.Group {
  const foregroundOnly = opts.foregroundOnly !== false;
  const faceDepth = Math.min(
    Math.max(opts.depth, 1e-4),
    MAX_FACE_EXTRUDE_DEPTH,
  );
  const loader = new SVGLoader();
  const data = loader.parse(svgString);
  const group = new THREE.Group();

  type PlateJob = {
    shapes: THREE.Shape[];
    material: THREE.MeshStandardMaterial;
  };
  const plateJobs: PlateJob[] = [];

  for (const path of data.paths) {
    const fillColor = path.color ?? new THREE.Color(0x48494b);
    const isPlate = isLikelyNormieLightBackground(fillColor);
    if (foregroundOnly && isPlate) {
      continue;
    }

    const material = new THREE.MeshStandardMaterial({
      color: fillColor,
      side: THREE.DoubleSide,
      metalness: 0.12,
      roughness: 0.58,
    });
    const shapes = SVGLoader.createShapes(path);
    if (!foregroundOnly && isPlate) {
      material.userData[NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY] = true;
      plateJobs.push({ shapes, material });
      continue;
    }

    for (const shape of shapes) {
      try {
        const bevelThis = opts.bevel && faceDepth >= MIN_DEPTH_FOR_BEVEL;
        const extrudeSettings: THREE.ExtrudeGeometryOptions = {
          depth: faceDepth,
          bevelEnabled: bevelThis,
          bevelThickness: bevelThis ? 0.6 : 0,
          bevelSize: bevelThis ? 0.35 : 0,
          bevelOffset: 0,
          bevelSegments: bevelThis ? 2 : 1,
        };
        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        group.add(new THREE.Mesh(geom, material));
      } catch {
        /* degenerate / self-intersecting — skip */
      }
    }
  }

  for (const job of plateJobs) {
    for (const shape of job.shapes) {
      try {
        addPlateWithSolidBacking(group, shape, job.material, opts.bevel);
      } catch {
        /* skip */
      }
    }
  }

  if (group.children.length === 0) {
    throw new Error(
      foregroundOnly
        ? "No dark paths to extrude (everything looked like background). Try “Include back plate”."
        : "No extrudable shapes found in SVG (empty paths?).",
    );
  }

  group.scale.y *= -1;

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const target = 2.4;
  group.scale.multiplyScalar(target / maxDim);

  return group;
}

export function disposeGroupContents(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh) {
      obj.dispose();
    }
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat?.dispose();
      }
    }
  });
}
