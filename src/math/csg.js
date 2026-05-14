import { BufferGeometry, BufferAttribute } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'
import { buildMeshBase } from './shape.js'

/**
 * Boolean (CSG) shape resolver. A `kind: 'csg'` shape carries
 * `params: { operator, operandIds: [idA, idB] }`. This module turns that
 * into a `{vertices, edges, faces}` mesh by:
 *   1. resolving each operand from the shapesById map (recursively if the
 *      operand is itself csg);
 *   2. converting each operand's mesh into an indexed BufferGeometry;
 *   3. running three-bvh-csg's Evaluator on the two Brushes;
 *   4. converting the result BufferGeometry back to the Mesh shape that
 *      SvgView and ThreeView already consume.
 *
 * Operand verts are world-space (buildMeshBase already bakes center +
 * rotation), so Brushes use identity matrices and the result is also
 * world-space — the consuming renderers render the csg shape at world
 * origin (no translate / rotate at the parent <mesh> / <g> level).
 *
 * Caching: one entry per csg shape id, keyed by a JSON hash over the
 * operator + operand fields (kind / center / size / rotation / params /
 * vertexOffsets). Cache survives across renders because zustand's
 * immutable updates only change the operand reference + hash when the
 * operand actually changed; otherwise the hash matches and we skip the
 * full eval.
 *
 * Cycle / depth guard: the recursion carries a `visited: Set<id>` that
 * tracks the csg shapes currently on the stack; depth is capped at
 * MAX_DEPTH. A self-referencing or chained-cycle csg returns an empty
 * mesh rather than blowing the stack.
 */

const OP_MAP = {
  union: ADDITION,
  subtract: SUBTRACTION,
  intersect: INTERSECTION,
}

const MAX_DEPTH = 8

const EMPTY_MESH = Object.freeze({ vertices: [], edges: [], faces: [] })

/** Operands must produce a face-bearing mesh. Linework / lights / bg
 *  filter out — Brush requires triangulated geometry. */
const SOLID_KINDS = new Set(['box', 'pyramid', 'prism', 'cylinder', 'sphere', 'csg'])

const evaluator = new Evaluator()
// Single material out (no per-source groups).
evaluator.useGroups = false
// Default attributes include `normal` — but our operand BufferGeometries
// only carry positions (we compute normals downstream from the triangle
// list). Limit the evaluator to position so it doesn't crash trying to
// copy a non-existent normal attribute.
evaluator.attributes = ['position']

/** id → { hash, mesh }. Module-level so it survives across React renders;
 *  zustand updates create new operand refs only when content changes, so
 *  the hash discriminates correctly. */
const cache = new Map()

/** Drag-throttle flag — when true, `buildCsgInner` returns the cached
 *  result even if the operand hash changed. Drag-tick re-renders skip
 *  the ~10–50ms boolean eval and use last-good geometry; the next render
 *  after pointerup runs a fresh eval. SvgView toggles this from its
 *  pointer handlers. */
let dragSuspended = false
export const setCsgDragSuspended = (b) => { dragSuspended = !!b }

const fieldsHash = (s) =>
  s
    ? JSON.stringify({
        k: s.kind,
        c: s.center,
        z: s.size,
        r: s.rotation,
        p: s.params,
        v: s.vertexOffsets,
      })
    : ''

const computeHash = (shape, opA, opB) =>
  `${shape.params?.operator ?? '?'}|${fieldsHash(opA)}|${fieldsHash(opB)}`

/** Triangulate a {vertices, faces} mesh into an indexed BufferGeometry.
 *  Faces fan-triangulate from index 0. mergeVertices indexes + welds
 *  duplicate positions so the Brush sees a manifold-shaped mesh. */
const meshToGeometry = (mesh) => {
  const positions = []
  for (const f of mesh.faces) {
    const idxs = f.vertexIndices
    for (let i = 1; i < idxs.length - 1; i++) {
      const v0 = mesh.vertices[idxs[0]]
      const va = mesh.vertices[idxs[i]]
      const vb = mesh.vertices[idxs[i + 1]]
      positions.push(
        v0[0], v0[1], v0[2],
        va[0], va[1], va[2],
        vb[0], vb[1], vb[2],
      )
    }
  }
  if (positions.length === 0) return null
  const arr = new Float32Array(positions)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(arr, 3))
  // Brush requires indexed geometry; mergeVertices() returns indexed.
  return mergeVertices(g)
}

/** Convert a CSG-output BufferGeometry into the {vertices, edges, faces}
 *  mesh shape the rest of kol-draw consumes. Each indexed triangle becomes
 *  one face; feature edges are extracted from edge → triangle adjacency
 *  (boundary edge OR crease > CREASE_ANGLE_RAD). */
const geometryToMesh = (geom) => {
  const indexed = geom.index ? geom : mergeVertices(geom)
  const posAttr = indexed.getAttribute('position')
  const indexAttr = indexed.getIndex()
  if (!posAttr || !indexAttr || indexAttr.count === 0) return EMPTY_MESH

  const vertCount = posAttr.count
  const triCount = indexAttr.count / 3

  const vertices = new Array(vertCount)
  for (let i = 0; i < vertCount; i++) {
    vertices[i] = [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]
  }

  const faces = new Array(triCount)
  const triNormals = new Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const a = indexAttr.getX(t * 3)
    const b = indexAttr.getX(t * 3 + 1)
    const c = indexAttr.getX(t * 3 + 2)
    const va = vertices[a]
    const vb = vertices[b]
    const vc = vertices[c]
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2]
    const vx = vc[0] - va[0], vy = vc[1] - va[1], vz = vc[2] - va[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    const normal = [nx, ny, nz]
    triNormals[t] = normal
    faces[t] = {
      vertexIndices: [a, b, c],
      normal,
      centroid: [
        (va[0] + vb[0] + vc[0]) / 3,
        (va[1] + vb[1] + vc[1]) / 3,
        (va[2] + vb[2] + vc[2]) / 3,
      ],
    }
  }

  // Edge → triangle adjacency. Each edge maps to its endpoint indices
  // and the list of triangles that contain it; used both for feature-
  // edge detection AND for flood-filling coplanar triangle groups.
  const edgeMap = new Map()
  const addEdge = (i, j, t) => {
    const lo = i < j ? i : j
    const hi = i < j ? j : i
    const key = `${lo}_${hi}`
    let entry = edgeMap.get(key)
    if (!entry) {
      entry = { i: lo, j: hi, tris: [] }
      edgeMap.set(key, entry)
    }
    entry.tris.push(t)
  }
  for (let t = 0; t < triCount; t++) {
    const a = indexAttr.getX(t * 3)
    const b = indexAttr.getX(t * 3 + 1)
    const c = indexAttr.getX(t * 3 + 2)
    addEdge(a, b, t)
    addEdge(b, c, t)
    addEdge(c, a, t)
  }

  // Triangle adjacency: for each pair of tris sharing a 2-tri edge,
  // record both directions. Used by the coplanar flood-fill below.
  const triAdj = new Array(triCount)
  for (let i = 0; i < triCount; i++) triAdj[i] = []
  for (const e of edgeMap.values()) {
    if (e.tris.length === 2) {
      triAdj[e.tris[0]].push(e.tris[1])
      triAdj[e.tris[1]].push(e.tris[0])
    }
  }

  // Flood-fill triangles into coplanar groups. Two adjacent tris belong
  // to the same group when their normals are nearly parallel (dot ≈ 1)
  // OR nearly anti-parallel (dot ≈ -1) — three-bvh-csg sometimes
  // outputs flipped winding on interior coplanar faces. Threshold tuned
  // tight (cos 8° ≈ 0.99) so that coplanar tris with FP noise still
  // group together but a real 30° crease doesn't accidentally fold in.
  const COS_COPLANAR = 0.99
  const groupOf = new Int32Array(triCount).fill(-1)
  let groupCount = 0
  for (let seed = 0; seed < triCount; seed++) {
    if (groupOf[seed] !== -1) continue
    const gid = groupCount++
    const stack = [seed]
    while (stack.length) {
      const ti = stack.pop()
      if (groupOf[ti] !== -1) continue
      groupOf[ti] = gid
      const n0 = triNormals[ti]
      for (const adj of triAdj[ti]) {
        if (groupOf[adj] !== -1) continue
        const n1 = triNormals[adj]
        const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]
        if (Math.abs(dot) > COS_COPLANAR) stack.push(adj)
      }
    }
  }

  // Feature edges = edges that AREN'T interior to a coplanar group.
  // - 1 adjacent tri (boundary): keep
  // - 2 adjacent tris in DIFFERENT groups: keep (real crease)
  // - 2 adjacent tris in the SAME group: hide (interior triangulation)
  // - 3+ adjacent tris (non-manifold): keep so the anomaly is visible
  const edges = []
  for (const e of edgeMap.values()) {
    if (e.tris.length === 1) {
      edges.push([e.i, e.j])
      continue
    }
    if (e.tris.length === 2) {
      if (groupOf[e.tris[0]] !== groupOf[e.tris[1]]) {
        edges.push([e.i, e.j])
      }
      continue
    }
    edges.push([e.i, e.j])
  }

  return { vertices, edges, faces }
}

const resolveOperand = (id, shapesById, depth, visited) => {
  if (!id) return null
  const op = shapesById.get(id)
  if (!op) return null
  if (!SOLID_KINDS.has(op.kind || 'box')) return null
  if (op.hidden) {
    // Operand is the *source* — even when the user has hidden the
    // operand layer (which Combine does by default to clean up the
    // canvas) we still need its geometry to resolve the csg.
  }
  if (op.kind === 'csg') {
    return buildCsgInner(op, shapesById, depth + 1, visited)
  }
  return buildMeshBase(op)
}

const buildCsgInner = (shape, shapesById, depth, visited) => {
  if (depth > MAX_DEPTH) return EMPTY_MESH
  if (visited.has(shape.id)) return EMPTY_MESH

  const operator = shape.params?.operator ?? 'union'
  const op = OP_MAP[operator]
  // three-bvh-csg's operator constants are numeric enums starting at 0
  // (ADDITION === 0). `if (!op)` would falsely reject union; explicit
  // undefined check skips only unknown operator strings.
  if (op === undefined) return EMPTY_MESH

  const [idA, idB] = shape.params?.operandIds ?? []
  const opA = idA ? shapesById.get(idA) : null
  const opB = idB ? shapesById.get(idB) : null

  const hash = computeHash(shape, opA, opB)
  const cached = cache.get(shape.id)
  if (cached && cached.hash === hash) return cached.mesh
  // Drag-suspend: if a pointer drag is active, prefer the stale cached
  // mesh over rebuilding. The next render after pointerup hits the
  // hash-mismatch path and re-evaluates with final operand state.
  if (dragSuspended && cached) return cached.mesh

  visited.add(shape.id)
  let result
  let geomA = null
  let geomB = null
  let outBrush = null
  try {
    const meshA = resolveOperand(idA, shapesById, depth, visited)
    const meshB = resolveOperand(idB, shapesById, depth, visited)
    if (
      !meshA || !meshB ||
      meshA.faces.length === 0 || meshB.faces.length === 0
    ) {
      return (result = EMPTY_MESH)
    }
    geomA = meshToGeometry(meshA)
    geomB = meshToGeometry(meshB)
    if (!geomA || !geomB) return (result = EMPTY_MESH)
    const brushA = new Brush(geomA)
    brushA.updateMatrixWorld()
    const brushB = new Brush(geomB)
    brushB.updateMatrixWorld()
    outBrush = evaluator.evaluate(brushA, brushB, op)
    const outGeom = outBrush?.geometry
    if (!outGeom) return (result = EMPTY_MESH)
    const posAttr = outGeom.getAttribute('position')
    if (!posAttr || posAttr.count === 0) return (result = EMPTY_MESH)
    result = geometryToMesh(outGeom)
    return result
  } catch (err) {
    console.warn('[csg] eval failed', err)
    result = EMPTY_MESH
    return result
  } finally {
    visited.delete(shape.id)
    if (geomA) geomA.dispose?.()
    if (geomB) geomB.dispose?.()
    if (outBrush?.geometry && outBrush.geometry !== geomA && outBrush.geometry !== geomB) {
      outBrush.geometry.dispose?.()
    }
    cache.set(shape.id, { hash, mesh: result ?? EMPTY_MESH })
  }
}

/**
 * Resolve a csg shape to a {vertices, edges, faces} mesh.
 *
 * @param {object} shape       The csg-kind shape (must have `params.operator` and `params.operandIds`).
 * @param {Map<string, object>} shapesById  Lookup of all shapes in the scene by id.
 * @returns {{ vertices: number[][], edges: [number, number][], faces: any[] }}
 */
export const buildCsg = (shape, shapesById) => {
  if (!shapesById) return EMPTY_MESH
  return buildCsgInner(shape, shapesById, 0, new Set())
}

/** Drop all cached csg results. Useful in tests + devtools. */
export const clearCsgCache = () => cache.clear()
