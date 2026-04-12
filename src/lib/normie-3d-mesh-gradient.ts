import * as THREE from "three";

/** Set on `MeshStandardMaterial.userData` (e.g. back plate) to skip mesh-gradient shaders. */
export const NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY = "normieSkipMeshGradient";

export type MeshGradientAxis = "x" | "y" | "z";

export type MeshGradientState = {
  enabled: boolean;
  colorA: string;
  colorB: string;
  axis: MeshGradientAxis;
  /** How much the gradient replaces the base albedo (0 = off, 1 = full). */
  blend: number;
};

export const defaultMeshGradientState: MeshGradientState = {
  enabled: true,
  colorA: "#1a1d28",
  colorB: "#4b5391",
  axis: "y",
  blend: 0.82,
};

const AXIS = { x: 0, y: 1, z: 2 } as const;

function axisIndex(a: MeshGradientAxis): number {
  return AXIS[a];
}

/** Uniform refs stored on material.userData after install. */
type GradientUniforms = {
  uGradA: { value: THREE.Color };
  uGradB: { value: THREE.Color };
  uGradMin: { value: THREE.Vector3 };
  uGradMax: { value: THREE.Vector3 };
  uGradAxis: { value: number };
  uGradBlend: { value: number };
};

const MESH_GRADIENT_FROZEN_BBOX_KEY = "normieGradientFrozenBBox";

function getOrCreateUniforms(
  mat: THREE.MeshStandardMaterial,
  box: THREE.Box3,
): GradientUniforms {
  const existing = mat.userData.normieGradientUniforms as
    | GradientUniforms
    | undefined;
  if (existing) return existing;

  const u: GradientUniforms = {
    uGradA: { value: new THREE.Color() },
    uGradB: { value: new THREE.Color() },
    uGradMin: { value: box.min.clone() },
    uGradMax: { value: box.max.clone() },
    uGradAxis: { value: 1 },
    uGradBlend: { value: 0 },
  };
  mat.userData.normieGradientUniforms = u;
  return u;
}

function installShaderHooks(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.normieGradientInstalled) return;
  mat.userData.normieGradientInstalled = true;

  mat.onBeforeCompile = (shader) => {
    const u = mat.userData.normieGradientUniforms as GradientUniforms;
    if (!u) return;

    shader.uniforms.uGradA = u.uGradA;
    shader.uniforms.uGradB = u.uGradB;
    shader.uniforms.uGradMin = u.uGradMin;
    shader.uniforms.uGradMax = u.uGradMax;
    shader.uniforms.uGradAxis = u.uGradAxis;
    shader.uniforms.uGradBlend = u.uGradBlend;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `
#include <common>
varying float vGradT;
uniform vec3 uGradMin;
uniform vec3 uGradMax;
uniform float uGradAxis;
`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `
vec4 gradWorldPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	gradWorldPos = instanceMatrix * gradWorldPos;
#endif
gradWorldPos = modelMatrix * gradWorldPos;
{
	vec3 wp = gradWorldPos.xyz;
	float span;
	float t;
	if ( uGradAxis < 0.5 ) {
		span = max( uGradMax.x - uGradMin.x, 1e-5 );
		t = ( wp.x - uGradMin.x ) / span;
	} else if ( uGradAxis < 1.5 ) {
		span = max( uGradMax.y - uGradMin.y, 1e-5 );
		t = ( wp.y - uGradMin.y ) / span;
	} else {
		span = max( uGradMax.z - uGradMin.z, 1e-5 );
		t = ( wp.z - uGradMin.z ) / span;
	}
	vGradT = clamp( t, 0.0, 1.0 );
}
#include <worldpos_vertex>
`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
#include <common>
varying float vGradT;
uniform vec3 uGradA;
uniform vec3 uGradB;
uniform float uGradBlend;
`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
#include <color_fragment>
{
	vec3 gC = mix( uGradA, uGradB, vGradT );
	diffuseColor.rgb = mix( diffuseColor.rgb, gC, uGradBlend );
}
`,
    );
  };

  mat.needsUpdate = true;
}

/**
 * World-axis gradient using mesh world AABB at install time (spinner may still
 * rotate; gradient is fixed in world space unless you re-apply after layout).
 */
export function applyMeshGradientToRoot(
  root: THREE.Object3D,
  state: MeshGradientState,
): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  root.userData[MESH_GRADIENT_FROZEN_BBOX_KEY] = {
    min: box.min.clone(),
    max: box.max.clone(),
  };

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.InstancedMesh)) {
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (m.userData[NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY]) continue;
      const u = getOrCreateUniforms(m, box);
      syncGradientUniforms(u, state);
      installShaderHooks(m);
    }
  });
}

export function updateMeshGradientUniforms(
  root: THREE.Object3D,
  state: MeshGradientState,
): void {
  const frozen = root.userData[MESH_GRADIENT_FROZEN_BBOX_KEY] as
    | { min: THREE.Vector3; max: THREE.Vector3 }
    | undefined;
  if (!frozen) {
    applyMeshGradientToRoot(root, state);
    return;
  }

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.InstancedMesh)) {
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (m.userData[NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY]) continue;
      const u = m.userData.normieGradientUniforms as GradientUniforms | undefined;
      if (!u) continue;
      u.uGradMin.value.copy(frozen.min);
      u.uGradMax.value.copy(frozen.max);
      syncGradientUniforms(u, state);
    }
  });
}

function syncGradientUniforms(u: GradientUniforms, state: MeshGradientState): void {
  u.uGradA.value.set(state.colorA);
  u.uGradB.value.set(state.colorB);
  u.uGradAxis.value = axisIndex(state.axis);
  u.uGradBlend.value = state.enabled
    ? THREE.MathUtils.clamp(state.blend, 0, 1)
    : 0;
}

/** First call installs shader; later calls only move colors / blend / axis. */
export function syncMeshGradient(
  root: THREE.Object3D,
  state: MeshGradientState,
): void {
  updateMeshGradientUniforms(root, state);
}

/** World-space AABB used for gradient `t`, if `applyMeshGradientToRoot` has run. */
export function getMeshGradientFrozenBBox(root: THREE.Object3D): THREE.Box3 | null {
  const d = root.userData[MESH_GRADIENT_FROZEN_BBOX_KEY] as
    | { min: THREE.Vector3; max: THREE.Vector3 }
    | undefined;
  if (!d?.min || !d?.max) return null;
  return new THREE.Box3(d.min.clone(), d.max.clone());
}

/** Typical Normies path fill; solid face albedo default. */
export const DEFAULT_FACE_MESH_COLOR = "#48494b";
/** Canvas “off” / plate tone; solid background albedo default. */
export const DEFAULT_BACKGROUND_MESH_COLOR = "#e3e5e4";

/**
 * Solid albedo only (no gradient): face meshes vs back plate
 * (`NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY`). Pixel voxels use the face color.
 */
export function syncMeshSolidColors(
  root: THREE.Object3D,
  faceHex: string,
  backgroundHex: string,
): void {
  const face = new THREE.Color(faceHex);
  const bg = new THREE.Color(backgroundHex);
  root.traverse((obj) => {
    if (
      !(obj instanceof THREE.Mesh) &&
      !(obj instanceof THREE.InstancedMesh)
    ) {
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (m.userData[NORMIE_SKIP_MESH_GRADIENT_USERDATA_KEY]) {
        m.color.copy(bg);
      } else {
        m.color.copy(face);
      }
      m.needsUpdate = true;
    }
  });
}
