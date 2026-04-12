import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Fit camera and orbit target to the pivot’s contents (model only).
 * Handles tiny voxel meshes vs large SVG units without a fixed camera Z.
 */
export function fitCameraToPivotContent(
  pivot: THREE.Group,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  floorGrid: THREE.GridHelper,
  opts?: { padding?: number },
): void {
  const box = new THREE.Box3().setFromObject(pivot);
  if (box.isEmpty()) return;

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const center = sphere.center;
  const r = Math.max(sphere.radius, 1e-4);
  const padding = opts?.padding ?? 1.22;

  const fovRad = (camera.fov * Math.PI) / 180;
  const dist = (r / Math.sin(fovRad / 2)) * padding;

  controls.target.copy(center);
  const offset = new THREE.Vector3(0.15 * r, 0.2 * r, dist);
  camera.position.copy(center).add(offset);

  camera.near = Math.max(0.004, dist / 600);
  camera.far = Math.max(400, dist * 20 + r * 10);
  camera.updateProjectionMatrix();

  /** Let you zoom in for detail and pull back far past the initial frame. */
  controls.minDistance = Math.max(0.012, r * 0.055);
  controls.maxDistance = Math.max(80, r * 90, controls.minDistance * 4);
  controls.update();

  floorGrid.position.set(center.x, box.min.y - 0.06 * r, center.z);
}
