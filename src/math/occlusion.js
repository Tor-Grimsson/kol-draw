import { sub3, dot3 } from './vec.js'
import { faces } from './cuboid.js'
import { cameraBasis } from './camera.js'

/**
 * Painter's algorithm: sort faces back-to-front (farthest from camera first)
 * so later faces overdraw nearer ones. Uses *forward-axis* depth (canonical
 * painter's), not eye-distance — eye-distance flips order between two faces
 * at the same view-axis depth but different lateral offsets. Real
 * intersection / cyclic-overlap cases still need the BSP/polygon-clipping
 * path noted in the plan as deferred.
 *
 * @param {import('./cuboid.js').Cuboid[]} cuboids
 * @param {import('./camera.js').Camera} cam
 * @returns {import('./cuboid.js').Face[]}
 */
export const sortFaces = (cuboids, cam) => {
  const { forward } = cameraBasis(cam)
  /** @type {{ face: import('./cuboid.js').Face, depth: number }[]} */
  const all = []
  for (const c of cuboids) {
    for (const f of faces(c)) {
      const rel = sub3(f.centroid, cam.position)
      const depth = dot3(rel, forward)
      all.push({ face: f, depth })
    }
  }
  all.sort((a, b) => b.depth - a.depth) // farther first
  return all.map((x) => x.face)
}

/**
 * Backface cull — true if the face is facing *away* from the camera and
 * therefore not visible from the outside of a closed cuboid. Compares the
 * centroid-to-eye vector against the face's outward normal.
 *
 * @param {import('./cuboid.js').Face} face
 * @param {import('./camera.js').Camera} cam
 * @returns {boolean}
 */
export const isBackface = (face, cam) => {
  /** @type {Record<import('./cuboid.js').Face['normal'], import('./vec.js').Vec3>} */
  const N = {
    '+x': [1, 0, 0], '-x': [-1, 0, 0],
    '+y': [0, 1, 0], '-y': [0, -1, 0],
    '+z': [0, 0, 1], '-z': [0, 0, -1],
  }
  const toEye = sub3(cam.position, face.centroid)
  // Prefer the rotated world-space normal when present; fall back to the
  // axis label for legacy faces (treated as identity rotation).
  return dot3(face.normalVec ?? N[face.normal], toEye) <= 0
}
