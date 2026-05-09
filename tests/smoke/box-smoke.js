// Smoke for cuboid + occlusion: render one box to console-logged SVG strings.
// Run: `pnpm smoke`

import { makeCuboid, vertices, edges } from '../../src/math/cuboid.js'
import { sortFaces, isBackface } from '../../src/math/occlusion.js'
import { presetCamera } from '../../src/math/camera.js'
import { pinhole } from '../../src/math/project.js'

const W = 800
const H = 600
const SCALE = 400 // pixels per world-unit-at-unit-depth

/** Map projected image coords ([-x,+x], [-y,+y]) to SVG pixel space (centered). */
const toPx = (p) => [W / 2 + p[0] * SCALE, H / 2 - p[1] * SCALE]

const cube = makeCuboid({ id: 'demo', center: [0, 0, 0], size: [2, 2, 2] })

// 2-point view: yawed off-axis, level horizon.
const cam = presetCamera('2pt', { distance: 6, focal: 1.2 })

console.log('-- vertices (world) --')
for (const v of vertices(cube)) console.log(v)

console.log('\n-- vertices (projected, pixels) --')
for (const v of vertices(cube)) {
  const ip = pinhole(v, cam)
  console.log(ip ? toPx(ip).map((n) => +n.toFixed(2)) : 'null (behind cam)')
}

console.log('\n-- visible faces (back-to-front, after backface cull) --')
const ordered = sortFaces([cube], cam).filter((f) => !isBackface(f, cam))
for (const f of ordered) {
  const projected = f.vertices.map((v) => pinhole(v, cam))
  if (projected.some((p) => p === null)) {
    console.log(`${f.normal}: clipped`)
    continue
  }
  const pts = projected.map(toPx).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  console.log(`<polygon data-face="${f.normal}" points="${pts}" />`)
}

console.log('\n-- edges (12) as <line> elements --')
for (const [a, b] of edges(cube)) {
  const pa = pinhole(a, cam)
  const pb = pinhole(b, cam)
  if (!pa || !pb) {
    console.log('<!-- clipped edge -->')
    continue
  }
  const [x1, y1] = toPx(pa)
  const [x2, y2] = toPx(pb)
  console.log(
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`,
  )
}

// Sanity: a cube viewed from outside should have exactly 3 visible faces in 3pt
// orientation (and 2 in pure 2pt, since one face axis is parallel to the image plane
// and degenerates). Let's assert 2pt -> at most 3, 3pt -> exactly 3.
const visible2 = sortFaces([cube], presetCamera('2pt')).filter((f) => !isBackface(f, presetCamera('2pt'))).length
const visible3 = sortFaces([cube], presetCamera('3pt')).filter((f) => !isBackface(f, presetCamera('3pt'))).length
console.log(`\n-- visible face counts --`)
console.log(`2pt: ${visible2}  (expect 2)`)
console.log(`3pt: ${visible3}  (expect 3)`)

if (visible3 !== 3) {
  console.error('FAIL: 3pt should show 3 faces')
  process.exit(1)
}
if (visible2 !== 2) {
  console.error(`FAIL: 2pt should show 2 faces, got ${visible2}`)
  process.exit(1)
}
console.log('\nall green')
