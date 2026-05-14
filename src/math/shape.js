import { vertices as boxVertices, EDGE_INDICES as BOX_EDGES, applyMat3, IDENT3 } from './cuboid.js'
import { cameraBasis } from './camera.js'
import { buildCsg } from './csg.js'

/**
 * Generic 3D shape model. Replaces the bare-cuboid model so the studio can
 * support boxes, pyramids, prisms, cylinders, spheres, and 1D linework
 * (arcs / circles / future polylines, splines) uniformly.
 *
 * Layout: every shape has a `center` (world position), `size` (axis-aligned
 * bounding-box extents along x/y/z), and a `kind`. The mesh generator turns
 * those into `{ vertices, edges, faces }` for projection/rendering. Linework
 * shapes have empty `faces` — their renderable geometry is the edge list,
 * which forms a polyline.
 *
 * The `csg` kind is a boolean (union / subtract / intersect) of two
 * operand shapes referenced by id (`params.operandIds`); resolution lives
 * in `csg.js`. CSG operands are eval'd in world space so the resulting
 * shape carries identity center / rotation — its mesh verts are already
 * world-space.
 *
 * @typedef {'box'|'pyramid'|'prism'|'cylinder'|'sphere'|'arc'|'polyline'|'csg'|'mesh'} ShapeKind
 *
 * @typedef {object} Shape
 * @property {ShapeKind} kind
 * @property {import('./vec.js').Vec3} center
 * @property {import('./vec.js').Vec3} size
 * @property {string} id
 * @property {import('./cuboid.js').Mat3} [rotation]  Optional row-major 3×3 rotation matrix.
 * @property {object} [params]   Kind-specific extras (cylinder segments, sphere subdivisions, arc startAngle/endAngle/segments).
 * @property {import('./vec.js').Vec3[]} [vertexOffsets]  Per-vertex local-space offsets — node-mode deformation. When set, each entry is added (after rotation) to the computed default vertex position. Length must match the shape's vertex count for the override to apply.
 * @property {{ stroke?: string, fill?: string, opacity?: number }} [style]  Per-shape rendering style. Stroke applies to edges (SVG) and linework (3D); fill applies to face polygons (SVG) and mesh material color (3D). Falls back to theme defaults when unset.
 *
 * @typedef {object} Mesh
 * @property {import('./vec.js').Vec3[]} vertices
 * @property {[number, number][]} edges        Pairs of vertex indices.
 * @property {{ vertexIndices: number[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]} faces  Empty for linework shapes.
 */

/** @type {(opts?: Partial<Shape>) => Shape} */
export const makeShape = (opts = {}) => ({
  kind: opts.kind ?? 'box',
  center: opts.center ?? [0, 0, 0],
  size: opts.size ?? [1, 1, 1],
  id: opts.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
  params: opts.params,
})

const centroidOf = (verts, idxs) => {
  const out = [0, 0, 0]
  for (const i of idxs) {
    out[0] += verts[i][0]
    out[1] += verts[i][1]
    out[2] += verts[i][2]
  }
  out[0] /= idxs.length
  out[1] /= idxs.length
  out[2] /= idxs.length
  return /** @type {import('./vec.js').Vec3} */ (out)
}

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/**
 * Compute outward face normal for a face whose vertex order is CCW when
 * viewed from outside the shape (right-hand rule).
 */
const faceNormal = (verts, idxs) => {
  const a = verts[idxs[0]]
  const b = verts[idxs[1]]
  const c = verts[idxs[2]]
  return norm3(cross3(sub3(b, a), sub3(c, a)))
}

const BOX_FACE_INDICES = [
  { idx: [0, 4, 6, 2], normal: [-1, 0, 0] },
  { idx: [1, 3, 7, 5], normal: [1, 0, 0] },
  { idx: [0, 1, 5, 4], normal: [0, -1, 0] },
  { idx: [2, 6, 7, 3], normal: [0, 1, 0] },
  { idx: [0, 2, 3, 1], normal: [0, 0, -1] },
  { idx: [4, 5, 7, 6], normal: [0, 0, 1] },
]

const buildBox = (s) => {
  const v = boxVertices(s)
  const M = s.rotation || IDENT3
  const faces = BOX_FACE_INDICES.map(({ idx, normal }) => ({
    vertexIndices: idx,
    normal: applyMat3(M, normal),
    centroid: centroidOf(v, idx),
  }))
  return { vertices: v, edges: BOX_EDGES, faces }
}

const buildPyramid = (s) => {
  // Square base at y = center.y - size.y/2, apex at (center.x, center.y + size.y/2, center.z)
  const [cx, cy, cz] = s.center
  const [sx, sy, sz] = s.size
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  /** @type {import('./vec.js').Vec3[]} */
  const v = [
    [cx - hx, cy - hy, cz - hz], // 0  base back-left
    [cx + hx, cy - hy, cz - hz], // 1  base back-right
    [cx + hx, cy - hy, cz + hz], // 2  base front-right
    [cx - hx, cy - hy, cz + hz], // 3  base front-left
    [cx,      cy + hy, cz],      // 4  apex
  ]
  /** @type {[number, number][]} */
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // base ring
    [0, 4], [1, 4], [2, 4], [3, 4], // base → apex
  ]
  /** @type {{ vertexIndices: number[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]} */
  const faces = [
    { vertexIndices: [3, 2, 1, 0], normal: [0, -1, 0], centroid: centroidOf(v, [3, 2, 1, 0]) }, // base, CCW from below
    { vertexIndices: [0, 1, 4],    normal: faceNormal(v, [0, 1, 4]), centroid: centroidOf(v, [0, 1, 4]) }, // back
    { vertexIndices: [1, 2, 4],    normal: faceNormal(v, [1, 2, 4]), centroid: centroidOf(v, [1, 2, 4]) }, // right
    { vertexIndices: [2, 3, 4],    normal: faceNormal(v, [2, 3, 4]), centroid: centroidOf(v, [2, 3, 4]) }, // front
    { vertexIndices: [3, 0, 4],    normal: faceNormal(v, [3, 0, 4]), centroid: centroidOf(v, [3, 0, 4]) }, // left
  ]
  return { vertices: v, edges, faces }
}

const buildPrism = (s) => {
  // Triangular prism — equilateral triangle cross-section in XY plane, extruded along Z.
  const [cx, cy, cz] = s.center
  const [sx, sy, sz] = s.size
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  /** @type {import('./vec.js').Vec3[]} */
  const v = [
    [cx,      cy + hy, cz - hz], // 0  back top
    [cx - hx, cy - hy, cz - hz], // 1  back bottom-left
    [cx + hx, cy - hy, cz - hz], // 2  back bottom-right
    [cx,      cy + hy, cz + hz], // 3  front top
    [cx - hx, cy - hy, cz + hz], // 4  front bottom-left
    [cx + hx, cy - hy, cz + hz], // 5  front bottom-right
  ]
  /** @type {[number, number][]} */
  const edges = [
    [0, 1], [1, 2], [2, 0],
    [3, 4], [4, 5], [5, 3],
    [0, 3], [1, 4], [2, 5],
  ]
  /** @type {{ vertexIndices: number[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]} */
  const faces = [
    { vertexIndices: [0, 2, 1],    normal: [0, 0, -1],            centroid: centroidOf(v, [0, 2, 1]) }, // back triangle
    { vertexIndices: [3, 4, 5],    normal: [0, 0, 1],             centroid: centroidOf(v, [3, 4, 5]) }, // front triangle
    { vertexIndices: [1, 2, 5, 4], normal: [0, -1, 0],            centroid: centroidOf(v, [1, 2, 5, 4]) }, // bottom
    { vertexIndices: [0, 1, 4, 3], normal: faceNormal(v, [0, 1, 4]), centroid: centroidOf(v, [0, 1, 4, 3]) }, // left
    { vertexIndices: [2, 0, 3, 5], normal: faceNormal(v, [2, 0, 3]), centroid: centroidOf(v, [2, 0, 3, 5]) }, // right
  ]
  return { vertices: v, edges, faces }
}

const buildCylinder = (s) => {
  const segments = Math.max(6, s.params?.segments ?? 16)
  const [cx, cy, cz] = s.center
  const [sx, sy, sz] = s.size
  const hy = sy / 2
  const rx = sx / 2
  const rz = sz / 2
  /** @type {import('./vec.js').Vec3[]} */
  const v = []
  // 0..segments-1 = bottom ring; segments..2*segments-1 = top ring
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    v.push([cx + Math.cos(t) * rx, cy - hy, cz + Math.sin(t) * rz])
  }
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    v.push([cx + Math.cos(t) * rx, cy + hy, cz + Math.sin(t) * rz])
  }
  /** @type {[number, number][]} */
  const edges = []
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    edges.push([i, next]) // bottom ring
    edges.push([segments + i, segments + next]) // top ring
    edges.push([i, segments + i]) // verticals
  }
  /** @type {{ vertexIndices: number[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]} */
  const faces = []
  // side quads
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    const idxs = [i, next, segments + next, segments + i]
    faces.push({
      vertexIndices: idxs,
      normal: faceNormal(v, idxs),
      centroid: centroidOf(v, idxs),
    })
  }
  // bottom face (single n-gon, normal -y)
  const bottomIdxs = []
  for (let i = segments - 1; i >= 0; i--) bottomIdxs.push(i)
  faces.push({ vertexIndices: bottomIdxs, normal: [0, -1, 0], centroid: centroidOf(v, bottomIdxs) })
  // top face
  const topIdxs = []
  for (let i = 0; i < segments; i++) topIdxs.push(segments + i)
  faces.push({ vertexIndices: topIdxs, normal: [0, 1, 0], centroid: centroidOf(v, topIdxs) })
  return { vertices: v, edges, faces }
}

const buildSphere = (s) => {
  const stacks = Math.max(3, s.params?.stacks ?? 8)
  const slices = Math.max(4, s.params?.slices ?? 12)
  const [cx, cy, cz] = s.center
  const rx = s.size[0] / 2
  const ry = s.size[1] / 2
  const rz = s.size[2] / 2
  /** @type {import('./vec.js').Vec3[]} */
  const v = []
  // Top pole = 0, bottom pole = 1, then ring vertices stack-by-stack
  v.push([cx, cy + ry, cz]) // 0 top
  v.push([cx, cy - ry, cz]) // 1 bottom
  for (let i = 1; i < stacks; i++) {
    const phi = (i / stacks) * Math.PI // 0 to π
    const y = Math.cos(phi)
    const r = Math.sin(phi)
    for (let j = 0; j < slices; j++) {
      const theta = (j / slices) * Math.PI * 2
      v.push([cx + Math.cos(theta) * r * rx, cy + y * ry, cz + Math.sin(theta) * r * rz])
    }
  }
  const ringStart = (stack) => 2 + (stack - 1) * slices
  /** @type {[number, number][]} */
  const edges = []
  for (let stack = 1; stack < stacks; stack++) {
    for (let j = 0; j < slices; j++) {
      edges.push([ringStart(stack) + j, ringStart(stack) + ((j + 1) % slices)]) // around
      if (stack < stacks - 1) edges.push([ringStart(stack) + j, ringStart(stack + 1) + j]) // down
    }
  }
  // poles to first / last ring
  for (let j = 0; j < slices; j++) edges.push([0, ringStart(1) + j])
  for (let j = 0; j < slices; j++) edges.push([1, ringStart(stacks - 1) + j])

  /** @type {{ vertexIndices: number[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]} */
  const faces = []
  // top cap triangles
  for (let j = 0; j < slices; j++) {
    const idxs = [0, ringStart(1) + ((j + 1) % slices), ringStart(1) + j]
    faces.push({ vertexIndices: idxs, normal: faceNormal(v, idxs), centroid: centroidOf(v, idxs) })
  }
  // middle quads
  for (let stack = 1; stack < stacks - 1; stack++) {
    for (let j = 0; j < slices; j++) {
      const a = ringStart(stack) + j
      const b = ringStart(stack) + ((j + 1) % slices)
      const c = ringStart(stack + 1) + ((j + 1) % slices)
      const d = ringStart(stack + 1) + j
      const idxs = [a, b, c, d]
      faces.push({ vertexIndices: idxs, normal: faceNormal(v, idxs), centroid: centroidOf(v, idxs) })
    }
  }
  // bottom cap triangles
  for (let j = 0; j < slices; j++) {
    const idxs = [1, ringStart(stacks - 1) + j, ringStart(stacks - 1) + ((j + 1) % slices)]
    faces.push({ vertexIndices: idxs, normal: faceNormal(v, idxs), centroid: centroidOf(v, idxs) })
  }
  return { vertices: v, edges, faces }
}

/**
 * Linework: arc or circle on the local XZ plane (y = 0 in local space),
 * swept from `startAngle` to `endAngle` (degrees). Sampled into N+1
 * vertices connected by N edges. No faces — renderers must check
 * `mesh.faces.length === 0` if they want to skip face-only paths.
 *
 * Local-space parametric:
 *   x_local = (size.x / 2) * cos(angle)
 *   z_local = (size.z / 2) * sin(angle)
 *   y_local = 0
 * Transformed to world via `rotation` (defaulting to identity), then
 * offset by `center`. `size.y` is unused for v1 (reserved for future tube
 * thickness).
 *
 * Defaults: startAngle=0, endAngle=360 (full circle), segments=48.
 */
const buildArc = (s) => {
  const segments = Math.max(2, s.params?.segments ?? 48)
  const startDeg = s.params?.startAngle ?? 0
  const endDeg = s.params?.endAngle ?? 360
  const start = (startDeg * Math.PI) / 180
  const end = (endDeg * Math.PI) / 180
  const M = s.rotation || IDENT3
  const [cx, cy, cz] = s.center
  const rx = s.size[0] / 2
  const rz = s.size[2] / 2
  /** @type {import('./vec.js').Vec3[]} */
  const v = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = start + t * (end - start)
    const lx = Math.cos(angle) * rx
    const lz = Math.sin(angle) * rz
    /** @type {import('./vec.js').Vec3} */
    const local = [lx, 0, lz]
    const rotated = applyMat3(M, local)
    v.push([cx + rotated[0], cy + rotated[1], cz + rotated[2]])
  }
  /** @type {[number, number][]} */
  const edges = []
  for (let i = 0; i < segments; i++) edges.push([i, i + 1])
  return { vertices: v, edges, faces: [] }
}

/**
 * Linework: bezier-capable path through `params.anchors`. Each anchor is
 * `{ point: Vec3, in?: Vec3, out?: Vec3 }` in local space (relative to
 * `center` before rotation). Tangent fields are *offsets* from the
 * anchor's `point`, so a smooth point with mirrored handles has
 * `in = -out`.
 *
 * Sampling rule per segment (anchor i → anchor i+1):
 *   - If neither `i.out` nor `(i+1).in` is set → straight line, 1 edge.
 *   - Otherwise → cubic bezier with control points
 *       p0 = i.point, p1 = i.point + (i.out ?? 0),
 *       p2 = (i+1).point + ((i+1).in ?? 0), p3 = (i+1).point
 *     sampled into `params.segments` (default 16) sub-edges.
 *
 * `params.closed` adds a closing segment from the last anchor back to the
 * first. Faces empty. Mesh.vertices are SAMPLED curve points, not anchors —
 * the inspector + tangent UI read anchors from `shape.params` directly.
 */
const buildPolyline = (s) => {
  /** @type {{ point: import('./vec.js').Vec3, in?: import('./vec.js').Vec3, out?: import('./vec.js').Vec3 }[]} */
  const anchors = s.params?.anchors ?? []
  const closed = !!s.params?.closed
  const segmentsPerCurve = Math.max(1, s.params?.segments ?? 16)
  const M = s.rotation || IDENT3
  const [cx, cy, cz] = s.center

  const toWorld = (local) => {
    const r = applyMat3(M, local)
    return [cx + r[0], cy + r[1], cz + r[2]]
  }
  const addLocal = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]]

  /** @type {import('./vec.js').Vec3[]} */
  const verts = []
  /** @type {[number, number][]} */
  const edges = []
  if (anchors.length === 0) return { vertices: verts, edges, faces: [] }

  let prevIdx = verts.push(toWorld(anchors[0].point)) - 1

  const pushSegment = (a, b) => {
    if (!a.out && !b.in) {
      const idx = verts.push(toWorld(b.point)) - 1
      edges.push([prevIdx, idx])
      prevIdx = idx
      return
    }
    const p0 = a.point
    const p1 = a.out ? addLocal(a.point, a.out) : a.point
    const p2 = b.in ? addLocal(b.point, b.in) : b.point
    const p3 = b.point
    for (let i = 1; i <= segmentsPerCurve; i++) {
      const t = i / segmentsPerCurve
      const u = 1 - t
      const u2 = u * u, t2 = t * t
      const u3 = u2 * u, t3 = t2 * t
      /** @type {import('./vec.js').Vec3} */
      const local = [
        u3 * p0[0] + 3 * u2 * t * p1[0] + 3 * u * t2 * p2[0] + t3 * p3[0],
        u3 * p0[1] + 3 * u2 * t * p1[1] + 3 * u * t2 * p2[1] + t3 * p3[1],
        u3 * p0[2] + 3 * u2 * t * p1[2] + 3 * u * t2 * p2[2] + t3 * p3[2],
      ]
      const idx = verts.push(toWorld(local)) - 1
      edges.push([prevIdx, idx])
      prevIdx = idx
    }
  }

  for (let i = 0; i < anchors.length - 1; i++) pushSegment(anchors[i], anchors[i + 1])
  if (closed && anchors.length > 2) {
    pushSegment(anchors[anchors.length - 1], anchors[0])
    // Close back to vertex 0 explicitly when last segment was straight (no
    // duplicate vertex was inserted at the end). For curved segments the
    // sampler already produced the closing vertex.
    const last = anchors[anchors.length - 1]
    const first = anchors[0]
    if (!last.out && !first.in) {
      // The straight-line pushSegment above appended the world `first.point`
      // as a duplicate vert; collapse it into vertex 0 by replacing the last
      // edge target.
      const e = edges[edges.length - 1]
      verts.pop()
      e[1] = 0
      prevIdx = 0
    }
  }

  return { vertices: verts, edges, faces: [] }
}

/**
 * Frozen-mesh shape: stored `params.vertices` are LOCAL-space vec3 array,
 * `params.edges` and `params.faces` reference indices into that array.
 * Built by `flattenCsg` after a boolean evaluation; behaves like a regular
 * shape (translate / rotate / scale all work) but the geometry no longer
 * references operands. Inspector treats it like a "primitive without size"
 * — Position + Scale + Style apply, W/H/D doesn't.
 */
const buildMeshShape = (s) => {
  const p = s.params || {}
  const baseVerts = p.vertices || []
  const baseEdges = p.edges || []
  const baseFaces = p.faces || []
  const M = s.rotation || IDENT3
  const [cx, cy, cz] = s.center
  const verts = baseVerts.map((v) => {
    const r = applyMat3(M, v)
    return [cx + r[0], cy + r[1], cz + r[2]]
  })
  const faces = baseFaces.map((f) => {
    const cr = applyMat3(M, f.centroid)
    return {
      vertexIndices: f.vertexIndices,
      normal: applyMat3(M, f.normal),
      centroid: [cx + cr[0], cy + cr[1], cz + cr[2]],
    }
  })
  return { vertices: verts, edges: baseEdges, faces }
}

/**
 * Internal: kind-dispatched mesh builder for any non-csg shape, with the
 * `vertexOffsets` post-pass applied. Also used by `csg.js` to resolve
 * operand geometry without going through the public `buildMesh` (which
 * would dispatch back into csg and need shapesById).
 *
 * @param {Shape} s
 * @returns {Mesh}
 */
export const buildMeshBase = (s) => {
  if (s.kind === 'mesh') return buildMeshShape(s)
  const base = (() => {
    switch (s.kind) {
      case 'pyramid': return buildPyramid(s)
      case 'prism': return buildPrism(s)
      case 'cylinder': return buildCylinder(s)
      case 'sphere': return buildSphere(s)
      case 'arc': return buildArc(s)
      case 'polyline': return buildPolyline(s)
      case 'box':
      default: return buildBox(s)
    }
  })()
  const offsets = s.vertexOffsets
  if (!offsets || !Array.isArray(offsets) || offsets.length !== base.vertices.length) {
    return base
  }
  const M = s.rotation || IDENT3
  let anyNonZero = false
  const verts = base.vertices.map((v, i) => {
    const o = offsets[i]
    if (!o || (o[0] === 0 && o[1] === 0 && o[2] === 0)) return v
    anyNonZero = true
    const wo = applyMat3(M, o)
    return [v[0] + wo[0], v[1] + wo[1], v[2] + wo[2]]
  })
  if (!anyNonZero) return base
  return {
    vertices: verts,
    edges: base.edges,
    faces: base.faces.map((f) => ({
      vertexIndices: f.vertexIndices,
      normal: faceNormal(verts, f.vertexIndices),
      centroid: centroidOf(verts, f.vertexIndices),
    })),
  }
}

/**
 * Build the projection-ready mesh for a shape.
 *
 * For non-csg kinds: dispatches to `buildMeshBase` (kind-specific builder
 * + `vertexOffsets` post-pass). For `kind === 'csg'`: dispatches to
 * `buildCsg` which resolves operands via `shapesById`. Without
 * `shapesById`, csg shapes return an empty mesh — call sites that need
 * to render csg must pass the lookup.
 *
 * @param {Shape} s
 * @param {Map<string, Shape> | null} [shapesById]  Operand lookup for csg shapes.
 * @returns {Mesh}
 */
export const buildMesh = (s, shapesById = null) => {
  if (s.kind === 'csg') return buildCsg(s, shapesById)
  return buildMeshBase(s)
}

/**
 * Painter's depth-sort for arbitrary shape faces. Replaces cuboid-only
 * `sortFaces` for the generic shape model.
 *
 * `shapesById` is forwarded to `buildMesh` so csg shapes can resolve
 * their operands; non-csg shapes ignore it.
 *
 * @param {Shape[]} shapes
 * @param {import('./camera.js').Camera} cam
 * @param {Map<string, Shape> | null} [shapesById]
 * @returns {{ shapeId: string, vertices: import('./vec.js').Vec3[], normal: import('./vec.js').Vec3, centroid: import('./vec.js').Vec3 }[]}
 */
export const sortShapeFaces = (shapes, cam, shapesById = null) => {
  // Forward-axis depth (canonical painter's). Eye-distance ordering flips
  // two faces at equal view-axis depth but different lateral offsets.
  const { forward } = cameraBasis(cam)
  /** @type {{ depth: number, face: any }[]} */
  const all = []
  for (const s of shapes) {
    const mesh = buildMesh(s, shapesById)
    for (const f of mesh.faces) {
      const verts = f.vertexIndices.map((i) => mesh.vertices[i])
      const dx = f.centroid[0] - cam.position[0]
      const dy = f.centroid[1] - cam.position[1]
      const dz = f.centroid[2] - cam.position[2]
      const depth = dx * forward[0] + dy * forward[1] + dz * forward[2]
      all.push({
        depth,
        face: { shapeId: s.id, vertices: verts, normal: f.normal, centroid: f.centroid },
      })
    }
  }
  all.sort((a, b) => b.depth - a.depth)
  return all.map((x) => x.face)
}

/**
 * Backface cull for shape faces (uses the precomputed face normal).
 */
export const isShapeBackface = (face, cam) => {
  const toEye = [
    cam.position[0] - face.centroid[0],
    cam.position[1] - face.centroid[1],
    cam.position[2] - face.centroid[2],
  ]
  return face.normal[0] * toEye[0] + face.normal[1] * toEye[1] + face.normal[2] * toEye[2] <= 0
}

/** Convenience: return just the world-space vertices of a shape's mesh. */
export const verticesOf = (s) => buildMesh(s).vertices

/** Convenience: return edges as world-space [a, b] vec3 pairs. */
export const edgesOf = (s) => {
  const m = buildMesh(s)
  return m.edges.map(([a, b]) => [m.vertices[a], m.vertices[b]])
}
