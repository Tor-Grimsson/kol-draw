import { unproject } from '../math/project.js'

/**
 * Image-space-driven placement: given a 2D anchor (composition node) on the
 * canvas and a desired depth from the camera, return the world-space point
 * that lies on the camera ray through the anchor at that depth.
 *
 * This is just a renamed re-export of `unproject`. The plan reserves
 * `worldFromAnchor` as the public anchor API name; the math lives in
 * `math/project.js`.
 *
 * @type {(anchor2: import('../math/vec.js').Vec2, cam: import('../math/camera.js').Camera, depth: number) => import('../math/vec.js').Vec3}
 */
export const worldFromAnchor = unproject

/**
 * Find the nearest node within `radius` of `point` (Euclidean, same
 * coordinate space for all three). Returns the node if one qualifies,
 * else null. Caller decides what to do with it (snap, highlight, etc.).
 *
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number, weight?: number }[]} nodes
 * @param {number} radius
 * @returns {{ x: number, y: number, weight?: number } | null}
 */
export const nearestNode = (point, nodes, radius) => {
  let best = null
  let bestDist = radius
  for (const n of nodes) {
    const d = Math.hypot(n.x - point.x, n.y - point.y)
    if (d < bestDist) {
      best = n
      bestDist = d
    }
  }
  return best
}
