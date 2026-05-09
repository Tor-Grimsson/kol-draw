/**
 * Composition armature — image-space (canvas-relative) reference grids.
 *
 * Coordinates are normalized: x in [0, w], y in [0, h]. Caller maps to whatever
 * SVG viewBox / pixel space they're using. Output `nodes` are intersection
 * points (with `weight` ∈ {1, 2, 3} indicating visual importance for snapping
 * priority); `lines` are the structural division lines.
 *
 * @typedef {'thirds'|'phi'|'sqrt2'|'sqrt3'|'sqrt5'|'diagonals'} ArmatureSystem
 *
 * @typedef {object} Node
 * @property {number} x
 * @property {number} y
 * @property {number} weight   1 = secondary, 2 = standard intersection, 3 = power point.
 *
 * @typedef {object} Line
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {'major'|'minor'|'diagonal'} kind
 */

const PHI = (1 + Math.sqrt(5)) / 2
const PHI_INV = 1 / PHI // ≈ 0.618

/** Vertical and horizontal split fractions for a system. */
const splits = {
  thirds: [1 / 3, 2 / 3],
  phi: [1 - PHI_INV, PHI_INV], // ≈ [0.382, 0.618]
  sqrt2: [1 - 1 / Math.SQRT2, 1 / Math.SQRT2], // ≈ [0.293, 0.707]
  sqrt3: [1 - 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  sqrt5: [1 - 1 / Math.sqrt(5), 1 / Math.sqrt(5)],
}

/**
 * @param {number} w
 * @param {number} h
 * @param {ArmatureSystem} system
 * @returns {Line[]}
 */
export const lines = (w, h, system) => {
  if (system === 'diagonals') {
    // Bouleau-style: full diagonals + half-diagonals from each corner to the
    // midpoint of each opposite edge.
    /** @type {Line[]} */
    const out = [
      { x1: 0, y1: 0, x2: w, y2: h, kind: 'diagonal' },
      { x1: w, y1: 0, x2: 0, y2: h, kind: 'diagonal' },
    ]
    return out
  }

  const fr = splits[system]
  if (!fr) return []
  /** @type {Line[]} */
  const out = []
  for (const f of fr) {
    out.push({ x1: f * w, y1: 0, x2: f * w, y2: h, kind: 'major' })
    out.push({ x1: 0, y1: f * h, x2: w, y2: f * h, kind: 'major' })
  }
  return out
}

/**
 * @param {number} w
 * @param {number} h
 * @param {ArmatureSystem} system
 * @returns {Node[]}
 */
export const nodes = (w, h, system) => {
  if (system === 'diagonals') {
    // Center + four edge midpoints — the natural intersections of the basic diagonals.
    return [
      { x: w / 2, y: h / 2, weight: 3 },
      { x: w / 2, y: 0, weight: 1 },
      { x: w / 2, y: h, weight: 1 },
      { x: 0, y: h / 2, weight: 1 },
      { x: w, y: h / 2, weight: 1 },
    ]
  }

  const fr = splits[system]
  if (!fr) return []
  /** @type {Node[]} */
  const out = []
  for (const fx of fr) {
    for (const fy of fr) {
      out.push({ x: fx * w, y: fy * h, weight: 3 })
    }
  }
  return out
}
