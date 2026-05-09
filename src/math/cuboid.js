/**
 * Cuboid in world space. Rotation is stored as a 3×3 row-major matrix
 * (length-9 array). Composing rotations as matrices fixes the Euler
 * accumulation problem the gimbal hit: each ring drag composes on the
 * cuboid's *local* axis, so dragging the visible X ring always rotates
 * around that ring regardless of prior rotations.
 *
 * @typedef {[number, number, number, number, number, number, number, number, number]} Mat3
 *
 * @typedef {object} Cuboid
 * @property {import('./vec.js').Vec3} center  Center point.
 * @property {import('./vec.js').Vec3} size    Local-axis extents along x, y, z.
 * @property {Mat3} [rotation]                 Row-major 3×3 rotation matrix. Default identity.
 * @property {string} [id]                     Stable id for React keys.
 */

/** @type {Mat3} */
export const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * @typedef {object} Face
 * @property {string} cuboidId                       Source cuboid id.
 * @property {'+x'|'-x'|'+y'|'-y'|'+z'|'-z'} normal  Outward face normal direction (local axis label).
 * @property {import('./vec.js').Vec3} normalVec     Outward face normal as a unit world vector (rotated).
 * @property {[import('./vec.js').Vec3, import('./vec.js').Vec3, import('./vec.js').Vec3, import('./vec.js').Vec3]} vertices  CCW when viewed from outside.
 * @property {import('./vec.js').Vec3} centroid      Average of the 4 vertices.
 */

/** @type {(opts?: Partial<Cuboid> & { kind?: string, params?: object }) => Cuboid} */
export const makeCuboid = (opts = {}) => ({
  kind: opts.kind ?? 'box',
  center: opts.center ?? [0, 0, 0],
  size: opts.size ?? [1, 1, 1],
  rotation: opts.rotation ?? IDENT3,
  params: opts.params,
  id: opts.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
})

const DEG = Math.PI / 180

/** Apply a 3×3 row-major matrix to a vec3. */
export const applyMat3 = (m, v) => {
  if (!m) return v
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

/** Apply the transpose of a 3×3 row-major matrix to a vec3. For an
 *  orthonormal rotation the transpose equals the inverse — this is how we
 *  go from world-space deltas back to local-space coordinates after
 *  rotating a shape. */
export const applyMat3Transpose = (m, v) => {
  if (!m) return v
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ]
}

/** Multiply two 3×3 matrices: out = a · b. */
export const mat3Mul = (a, b) => /** @type {Mat3} */ ([
  a[0]*b[0] + a[1]*b[3] + a[2]*b[6],
  a[0]*b[1] + a[1]*b[4] + a[2]*b[7],
  a[0]*b[2] + a[1]*b[5] + a[2]*b[8],

  a[3]*b[0] + a[4]*b[3] + a[5]*b[6],
  a[3]*b[1] + a[4]*b[4] + a[5]*b[7],
  a[3]*b[2] + a[4]*b[5] + a[5]*b[8],

  a[6]*b[0] + a[7]*b[3] + a[8]*b[6],
  a[6]*b[1] + a[7]*b[4] + a[8]*b[7],
  a[6]*b[2] + a[7]*b[5] + a[8]*b[8],
])

/**
 * 3×3 rotation about a canonical local axis ('x', 'y', or 'z') by
 * `angleDeg`. Used by the gimbal-axis drag for local-frame composition:
 * `R_local = startRotation · rotMat(axis, angle)`.
 */
export const rotMat = (axis, angleDeg) => {
  const a = angleDeg * DEG
  const c = Math.cos(a), s = Math.sin(a)
  if (axis === 'x') return /** @type {Mat3} */ ([1, 0, 0,  0, c, -s,  0, s, c])
  if (axis === 'y') return /** @type {Mat3} */ ([c, 0, s,  0, 1, 0,  -s, 0, c])
  return                /** @type {Mat3} */ ([c, -s, 0,  s, c, 0,  0, 0, 1])
}

/**
 * Eight vertices of a cuboid, indexed by binary (x, y, z) sign — bit 0 is x,
 * bit 1 is y, bit 2 is z. So vertex 0 is (-x,-y,-z), vertex 7 is (+x,+y,+z).
 *
 * @param {Cuboid} c
 * @returns {import('./vec.js').Vec3[]}
 */
export const vertices = (c) => {
  const [cx, cy, cz] = c.center
  const [sx, sy, sz] = c.size
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const rot = c.rotation
  /** @type {import('./vec.js').Vec3[]} */
  const out = []
  for (let i = 0; i < 8; i++) {
    /** @type {import('./vec.js').Vec3} */
    const local = [
      i & 1 ? hx : -hx,
      i & 2 ? hy : -hy,
      i & 4 ? hz : -hz,
    ]
    const r = applyMat3(rot, local)
    out.push([cx + r[0], cy + r[1], cz + r[2]])
  }
  return out
}

/**
 * Six faces, each as a quad of vertex indices in the array returned by
 * `vertices()`. Quads are wound counter-clockwise when seen from *outside*
 * the box (right-hand rule with outward normal).
 *
 * @type {{ normal: Face['normal'], idx: [number, number, number, number] }[]}
 */
const FACE_TABLE = [
  // -x face (vertices with bit 0 cleared): 0,2,6,4 — looking down +x at the box
  { normal: '-x', idx: [0, 4, 6, 2] },
  // +x face (bit 0 set): 1,3,7,5 — looking down -x
  { normal: '+x', idx: [1, 3, 7, 5] },
  // -y face: 0,1,5,4 — looking down +y
  { normal: '-y', idx: [0, 1, 5, 4] },
  // +y face: 2,6,7,3 — looking down -y
  { normal: '+y', idx: [2, 6, 7, 3] },
  // -z face: 0,2,3,1 — looking down +z
  { normal: '-z', idx: [0, 2, 3, 1] },
  // +z face: 4,5,7,6 — looking down -z
  { normal: '+z', idx: [4, 5, 7, 6] },
]

const NORMAL_LOCAL = {
  '+x': /** @type {import('./vec.js').Vec3} */ ([1, 0, 0]),
  '-x': /** @type {import('./vec.js').Vec3} */ ([-1, 0, 0]),
  '+y': /** @type {import('./vec.js').Vec3} */ ([0, 1, 0]),
  '-y': /** @type {import('./vec.js').Vec3} */ ([0, -1, 0]),
  '+z': /** @type {import('./vec.js').Vec3} */ ([0, 0, 1]),
  '-z': /** @type {import('./vec.js').Vec3} */ ([0, 0, -1]),
}

/**
 * @param {Cuboid} c
 * @returns {Face[]}
 */
export const faces = (c) => {
  const v = vertices(c)
  const rot = c.rotation
  return FACE_TABLE.map(({ normal, idx }) => {
    const verts = /** @type {Face['vertices']} */ ([v[idx[0]], v[idx[1]], v[idx[2]], v[idx[3]]])
    /** @type {import('./vec.js').Vec3} */
    const centroid = [
      (verts[0][0] + verts[1][0] + verts[2][0] + verts[3][0]) / 4,
      (verts[0][1] + verts[1][1] + verts[2][1] + verts[3][1]) / 4,
      (verts[0][2] + verts[1][2] + verts[2][2] + verts[3][2]) / 4,
    ]
    return { cuboidId: c.id ?? '', normal, normalVec: applyMat3(rot, NORMAL_LOCAL[normal]), vertices: verts, centroid }
  })
}

/**
 * Twelve edges of a cuboid as pairs of vertex indices (matching `vertices()`).
 * Useful for wireframe rendering.
 * @type {[number, number][]}
 */
export const EDGE_INDICES = [
  // bottom (-y) rectangle
  [0, 1], [1, 5], [5, 4], [4, 0],
  // top (+y) rectangle
  [2, 3], [3, 7], [7, 6], [6, 2],
  // verticals connecting bottom to top
  [0, 2], [1, 3], [5, 7], [4, 6],
]

/**
 * @param {Cuboid} c
 * @returns {[import('./vec.js').Vec3, import('./vec.js').Vec3][]}
 */
export const edges = (c) => {
  const v = vertices(c)
  return EDGE_INDICES.map(([a, b]) => [v[a], v[b]])
}

/**
 * Compute a new cuboid (center + size) given the world positions of two
 * opposite corners. Caller is expected to capture the opposite corner ONCE
 * at drag-start and pass it back unchanged on every subsequent call —
 * otherwise the anchor walks with the geometry and the corner can't pass
 * through zero (the cuboid rebounds instead of inverting onto the other
 * side of the anchor).
 *
 * Sizes are absolute (positive) — when `newVertexWorld` crosses through
 * `oppositeWorld`, the cuboid's center mirrors to the other side of the
 * anchor and growth continues, which renders as a clean inversion.
 *
 * @param {import('./vec.js').Vec3} newVertexWorld
 * @param {import('./vec.js').Vec3} oppositeWorld
 * @returns {{ center: import('./vec.js').Vec3, size: import('./vec.js').Vec3 }}
 */
export const resizeFromVertex = (newVertexWorld, oppositeWorld) => {
  /** @type {import('./vec.js').Vec3} */
  const center = [
    (newVertexWorld[0] + oppositeWorld[0]) / 2,
    (newVertexWorld[1] + oppositeWorld[1]) / 2,
    (newVertexWorld[2] + oppositeWorld[2]) / 2,
  ]
  /** @type {import('./vec.js').Vec3} */
  const size = [
    Math.abs(newVertexWorld[0] - oppositeWorld[0]),
    Math.abs(newVertexWorld[1] - oppositeWorld[1]),
    Math.abs(newVertexWorld[2] - oppositeWorld[2]),
  ]
  return { center, size }
}
