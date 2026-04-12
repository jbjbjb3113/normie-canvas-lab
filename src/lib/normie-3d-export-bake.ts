import * as THREE from "three";
import {
  getMeshGradientFrozenBBox,
  NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY,
  type MeshGradientState,
} from "./normie-3d-mesh-gradient";

function axisIndex(a: MeshGradientState["axis"]): number {
  return a === "x" ? 0 : a === "y" ? 1 : 2;
}

function gradT(worldPos: THREE.Vector3, axis: number, box: THREE.Box3): number {
  const { min, max } = box;
  let span: number;
  let t: number;
  if (axis === 0) {
    span = Math.max(max.x - min.x, 1e-5);
    t = (worldPos.x - min.x) / span;
  } else if (axis === 1) {
    span = Math.max(max.y - min.y, 1e-5);
    t = (worldPos.y - min.y) / span;
  } else {
    span = Math.max(max.z - min.z, 1e-5);
    t = (worldPos.z - min.z) / span;
  }
  return THREE.MathUtils.clamp(t, 0, 1);
}

function stripGradientShaderHooks(m: THREE.MeshStandardMaterial): void {
  Reflect.deleteProperty(m, "onBeforeCompile");
  delete m.userData.normieGradientInstalled;
  delete m.userData.normieGradientUniforms;
  m.needsUpdate = true;
}

/**
 * Writes per-vertex colors matching the live mesh-gradient shader, clears custom
 * `onBeforeCompile` on export materials, and sets `vertexColors` + white `color`
 * so GLTFExporter embeds plain albedo (no custom shader).
 */
export function bakeMeshGradientVertexColorsForGlb(
  exportRoot: THREE.Object3D,
  sourceModel: THREE.Object3D,
  state: MeshGradientState,
): void {
  const blend = state.enabled ? THREE.MathUtils.clamp(state.blend, 0, 1) : 0;
  if (blend <= 0) return;

  let box = getMeshGradientFrozenBBox(sourceModel);
  if (!box) {
    sourceModel.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(sourceModel);
    if (box.isEmpty()) return;
  }

  const axis = axisIndex(state.axis);
  const gradA = new THREE.Color(state.colorA);
  const gradB = new THREE.Color(state.colorB);
  const gradC = new THREE.Color();
  const base = new THREE.Color();
  const final = new THREE.Color();
  const wp = new THREE.Vector3();

  exportRoot.updateMatrixWorld(true);

  exportRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material) && obj.material.length > 1) return;

    const mat0 = Array.isArray(obj.material)
      ? obj.material[0]
      : obj.material;
    if (!(mat0 instanceof THREE.MeshStandardMaterial)) return;
    if (mat0.userData[NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY]) return;
    if (mat0.map) return;

    const geom = obj.geometry;
    const pos = geom.getAttribute("position");
    if (!pos || pos.count === 0) return;

    const colors = new Float32Array(pos.count * 3);
    obj.updateMatrixWorld(true);

    for (let i = 0; i < pos.count; i++) {
      wp.fromBufferAttribute(pos, i);
      wp.applyMatrix4(obj.matrixWorld);
      const t = gradT(wp, axis, box);
      gradC.copy(gradA).lerp(gradB, t);
      base.copy(mat0.color);
      final.copy(base).lerp(gradC, blend);
      colors[i * 3] = final.r;
      colors[i * 3 + 1] = final.g;
      colors[i * 3 + 2] = final.b;
    }

    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const em = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (em instanceof THREE.MeshStandardMaterial) {
      stripGradientShaderHooks(em);
      em.vertexColors = true;
      em.color.setRGB(1, 1, 1);
      em.needsUpdate = true;
    }
  });
}
