/**
 * Scene-frame geometry — edges + grid lines for a positioned, sized
 * reference box. The scene frame anchors a composition in world space:
 * floor grid acts as the "stage", box wireframe defines the volume, and
 * the center is the structural anchor that per-object construction lines
 * relate to.
 *
 * Geometry is returned as world-space line segments; SvgView handles
 * projection and clipping.
 */

/**
 * @param {import('../scene/store.js').SceneFrame} frame
 * @returns {[import('../math/vec.js').Vec3, import('../math/vec.js').Vec3][]}
 */
export const boxEdges = (frame) => {
  const [cx, cy, cz] = frame.center
  const [hx, hy, hz] = [frame.size[0] / 2, frame.size[1] / 2, frame.size[2] / 2]
  /** @type {import('../math/vec.js').Vec3[]} */
  const v = []
  for (let i = 0; i < 8; i++) {
    v.push([
      cx + (i & 1 ? hx : -hx),
      cy + (i & 2 ? hy : -hy),
      cz + (i & 4 ? hz : -hz),
    ])
  }
  /** @type {[number, number][]} */
  const idx = [
    [0, 1], [1, 5], [5, 4], [4, 0],
    [2, 3], [3, 7], [7, 6], [6, 2],
    [0, 2], [1, 3], [5, 7], [4, 6],
  ]
  return idx.map(([a, b]) => [v[a], v[b]])
}

/**
 * Floor-face grid lines on the bottom of the scene box (y = center.y - size.y/2).
 * Lines run along world X and world Z, at `divisions + 1` evenly-spaced
 * positions across the floor.
 *
 * @param {import('../scene/store.js').SceneFrame} frame
 * @returns {[import('../math/vec.js').Vec3, import('../math/vec.js').Vec3][]}
 */
export const floorGridLines = (frame) => {
  const [cx, cy, cz] = frame.center
  const [sx, sy, sz] = frame.size
  const y = cy - sy / 2
  const x0 = cx - sx / 2
  const x1 = cx + sx / 2
  const z0 = cz - sz / 2
  const z1 = cz + sz / 2
  const n = Math.max(1, frame.divisions | 0)
  /** @type {[import('../math/vec.js').Vec3, import('../math/vec.js').Vec3][]} */
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = x0 + t * (x1 - x0)
    const z = z0 + t * (z1 - z0)
    out.push([[x, y, z0], [x, y, z1]]) // along +Z at this x
    out.push([[x0, y, z], [x1, y, z]]) // along +X at this z
  }
  return out
}
