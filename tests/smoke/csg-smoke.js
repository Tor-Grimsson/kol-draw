// CSG (boolean operations) smoke. Run: `pnpm smoke`
//
// Asserts that buildMesh() routes csg-kind shapes through three-bvh-csg
// correctly: union / subtract / intersect produce sane vertex+face
// counts; degenerate inputs (operand fully covers the other; disjoint
// operands) return empty meshes without throwing; nested CSG works;
// self-reference / cycle returns empty (no infinite loop).

import { makeCuboid } from '../../src/math/cuboid.js'
import { buildMesh } from '../../src/math/shape.js'
import { clearCsgCache } from '../../src/math/csg.js'

let failed = 0
const ok = (label, cond, detail = '') => {
  if (cond) {
    console.log(`ok   ${label}`)
  } else {
    failed++
    console.error(`FAIL ${label}${detail ? `\n  ${detail}` : ''}`)
  }
}

const shapesById = (...shapes) => {
  const m = new Map()
  for (const s of shapes) m.set(s.id, s)
  return m
}

const csgShape = (id, operator, idA, idB) => ({
  kind: 'csg',
  id,
  center: [0, 0, 0],
  size: [1, 1, 1],
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  params: { operator, operandIds: [idA, idB] },
})

// ---- 1. Union of two overlapping unit boxes ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'u-a', center: [0, 0, 0], size: [1, 1, 1] })
  const b = makeCuboid({ id: 'u-b', center: [0.5, 0, 0], size: [1, 1, 1] })
  const c = csgShape('u-csg', 'union', 'u-a', 'u-b')
  const mesh = buildMesh(c, shapesById(a, b, c))
  ok('union: faces > 0', mesh.faces.length > 0, `got ${mesh.faces.length}`)
  ok('union: vertices > 8', mesh.vertices.length > 8, `got ${mesh.vertices.length}`)
  ok('union: edges > 0', mesh.edges.length > 0, `got ${mesh.edges.length}`)
}

// ---- 2. Subtract A − B (B inside A) — non-empty ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 's-a', center: [0, 0, 0], size: [2, 2, 2] })
  const b = makeCuboid({ id: 's-b', center: [0, 0, 0], size: [1, 1, 1] })
  const c = csgShape('s-csg', 'subtract', 's-a', 's-b')
  const mesh = buildMesh(c, shapesById(a, b, c))
  ok('subtract-inside: non-empty', mesh.faces.length > 0, `got ${mesh.faces.length}`)
}

// ---- 3. Subtract A − B (B fully covers A) — empty ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 's2-a', center: [0, 0, 0], size: [1, 1, 1] })
  const b = makeCuboid({ id: 's2-b', center: [0, 0, 0], size: [2, 2, 2] })
  const c = csgShape('s2-csg', 'subtract', 's2-a', 's2-b')
  const mesh = buildMesh(c, shapesById(a, b, c))
  ok('subtract-covered: empty', mesh.faces.length === 0, `got ${mesh.faces.length}`)
}

// ---- 4. Intersect of disjoint boxes — empty ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'i-a', center: [0, 0, 0], size: [1, 1, 1] })
  const b = makeCuboid({ id: 'i-b', center: [5, 0, 0], size: [1, 1, 1] })
  const c = csgShape('i-csg', 'intersect', 'i-a', 'i-b')
  const mesh = buildMesh(c, shapesById(a, b, c))
  ok('intersect-disjoint: empty', mesh.faces.length === 0, `got ${mesh.faces.length}`)
}

// ---- 5. Intersect of overlapping boxes — non-empty ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'i2-a', center: [0, 0, 0], size: [1, 1, 1] })
  const b = makeCuboid({ id: 'i2-b', center: [0.5, 0, 0], size: [1, 1, 1] })
  const c = csgShape('i2-csg', 'intersect', 'i2-a', 'i2-b')
  const mesh = buildMesh(c, shapesById(a, b, c))
  ok('intersect-overlap: non-empty', mesh.faces.length > 0, `got ${mesh.faces.length}`)
}

// ---- 6. Nested CSG-of-CSG ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'n-a', center: [0, 0, 0], size: [2, 2, 2] })
  const b = makeCuboid({ id: 'n-b', center: [0.5, 0, 0], size: [2, 2, 2] })
  const k = makeCuboid({ id: 'n-k', center: [0, 0, 0], size: [0.8, 0.8, 0.8] })
  const inner = csgShape('n-inner', 'union', 'n-a', 'n-b')
  const outer = csgShape('n-outer', 'subtract', 'n-inner', 'n-k')
  const mesh = buildMesh(outer, shapesById(a, b, k, inner, outer))
  ok('nested: non-empty', mesh.faces.length > 0, `got ${mesh.faces.length}`)
}

// ---- 7. Self-reference cycle — must not loop ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'cy-a', center: [0, 0, 0], size: [1, 1, 1] })
  const self = csgShape('cy-self', 'union', 'cy-self', 'cy-a')
  const mesh = buildMesh(self, shapesById(a, self))
  ok('cycle: empty (no throw, no loop)', mesh.faces.length === 0)
}

// ---- 8. Cache hit on identical re-call ----
{
  clearCsgCache()
  const a = makeCuboid({ id: 'c-a', center: [0, 0, 0], size: [1, 1, 1] })
  const b = makeCuboid({ id: 'c-b', center: [0.5, 0, 0], size: [1, 1, 1] })
  const c = csgShape('c-csg', 'union', 'c-a', 'c-b')
  const map = shapesById(a, b, c)
  const m1 = buildMesh(c, map)
  const m2 = buildMesh(c, map)
  ok('cache: same result ref', m1 === m2)
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nall green')
