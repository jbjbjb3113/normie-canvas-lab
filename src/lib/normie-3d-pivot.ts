import * as THREE from "three";

/**
 * Puts `mesh` on a vertical turntable: spin this group’s `rotation.y`, not the
 * scene pivot, so the mesh turns in place (avoids orbiting when `mesh.position`
 * was used only to re-center geometry).
 *
 * 1. `turntable.position` = bbox center (axis through mesh middle).
 * 2. `mesh.position.sub(center)` so geometry surrounds the turntable origin.
 * 3. Drop in Y so the combined AABB sits on y = 0 in `pivot` space.
 */
export function mountMeshOnTurntable(
  pivot: THREE.Group,
  mesh: THREE.Group,
): THREE.Group {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) {
    const t = new THREE.Group();
    t.name = "normieTurntable";
    t.add(mesh);
    pivot.add(t);
    return t;
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const turntable = new THREE.Group();
  turntable.name = "normieTurntable";
  turntable.position.copy(center);
  mesh.position.sub(center);
  turntable.add(mesh);
  pivot.add(turntable);

  turntable.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(turntable);
  turntable.position.y += -grounded.min.y;

  return turntable;
}
