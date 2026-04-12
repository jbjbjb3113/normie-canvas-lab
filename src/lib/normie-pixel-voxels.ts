import * as THREE from "three";

const GRID = 40;
const EXPECTED = GRID * GRID;

/**
 * Builds a centered group from the Normies 40×40 pixel string (API `…/pixels`).
 * Uses one InstancedMesh of boxes — no SVG fills required.
 */
export function buildPixelVoxelGroup(
  pixels: string,
  depth: number,
): THREE.Group {
  if (pixels.length !== EXPECTED) {
    throw new Error(`Expected ${EXPECTED} pixel chars, got ${pixels.length}.`);
  }

  let onCount = 0;
  for (let i = 0; i < EXPECTED; i++) {
    if (pixels[i] === "1") onCount++;
  }
  if (onCount === 0) {
    throw new Error("Bitmap has no on-pixels.");
  }

  const group = new THREE.Group();
  const span = 2.4;
  const cell = span / GRID;
  const zThick = Math.max(cell * 0.12, (depth / 20) * cell * 1.8);

  const geom = new THREE.BoxGeometry(cell * 0.96, cell * 0.96, zThick);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x48494b,
    side: THREE.DoubleSide,
    metalness: 0.12,
    roughness: 0.58,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, onCount);

  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const i = row * GRID + col;
      if (pixels[i] !== "1") continue;
      const x = (col - (GRID - 1) / 2) * cell;
      const y = -((row - (GRID - 1) / 2) * cell);
      dummy.position.set(x, y, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const target = 2.4;
  group.scale.multiplyScalar(target / maxDim);

  return group;
}
