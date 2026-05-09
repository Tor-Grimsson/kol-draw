// Smoke checks for math primitives. Run: `pnpm smoke`
// Plain assertions, no test framework — keeps step 1 self-contained.

import { add3, sub3, dot3, cross3, len3, norm3 } from '../../src/math/vec.js'
import { makeCamera, presetCamera, cameraBasis } from '../../src/math/camera.js'
import { pinhole, unproject, horizonImageY, pitchFromHorizonY, vanishingPoint, projectSegment, knobsFromVP, cylindrical, spherical, project, projectPolyline } from '../../src/math/project.js'
import { buildMesh, makeShape, sortShapeFaces } from '../../src/math/shape.js'

let failed = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = Array.isArray(want)
    ? want.length === got?.length && want.every((w, i) => Math.abs(got[i] - w) < tol)
    : Math.abs(got - want) < tol
  if (!ok) {
    failed++
    console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

// vec
eq('add3', add3([1, 2, 3], [4, 5, 6]), [5, 7, 9])
eq('sub3', sub3([5, 7, 9], [1, 2, 3]), [4, 5, 6])
eq('dot3 orthogonal', dot3([1, 0, 0], [0, 1, 0]), 0)
eq('dot3 parallel', dot3([2, 0, 0], [3, 0, 0]), 6)
eq('cross3 right-handed', cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1])
eq('len3', len3([3, 4, 0]), 5)
eq('norm3', norm3([0, 5, 0]), [0, 1, 0])

// camera basis: default camera looks down -Z, world up [0,1,0]
//   forward = [0,0,-1]
//   right   = forward × up = [0,0,-1] × [0,1,0] = [0*0 - (-1)*1, (-1)*0 - 0*0, 0*1 - 0*0] = [1, 0, 0]
//   up      = right × forward = [1,0,0] × [0,0,-1] = [0*(-1) - 0*0, 0*0 - 1*(-1), 1*0 - 0*0] = [0, 1, 0]
const cam = makeCamera()
const basis = cameraBasis(cam)
eq('basis.right',   basis.right,   [1, 0, 0])
eq('basis.up',      basis.up,      [0, 1, 0])
eq('basis.forward', basis.forward, [0, 0, -1])

// pinhole: default cam at [0,0,5], focal=1.
// Point at origin -> depth 5, x=0, y=0 -> [0, 0]
eq('pinhole origin', pinhole([0, 0, 0], cam), [0, 0])
// Point at [1, 0, 0] -> depth 5, x=1 -> [1/5, 0]
eq('pinhole right unit', pinhole([1, 0, 0], cam), [1 / 5, 0])
// Point at [0, 2, 0] -> depth 5, y=2 -> [0, 2/5]
eq('pinhole up 2', pinhole([0, 2, 0], cam), [0, 2 / 5])
// Point behind camera (z=10, beyond eye) -> null
eq('pinhole behind', pinhole([0, 0, 10], cam), null)

// presets: 1pt forward should be straight along -Z
const c1 = presetCamera('1pt')
eq('1pt forward', c1.forward, [0, 0, -1])
// 2pt: yaw 30deg, pitch 0 — forward should still be in the XZ plane
const c2 = presetCamera('2pt')
eq('2pt forward.y is 0', c2.forward[1], 0)
// 3pt: pitchDeg = -20 (looking down). forward.y = sin(pitch) → negative.
const c3 = presetCamera('3pt')
if (c3.forward[1] >= 0) {
  console.error(`FAIL 3pt forward.y < 0 (pitch=-20 looks down)\n  got: ${c3.forward[1]}`)
  failed++
} else {
  console.log('ok   3pt forward.y < 0 (looking down)')
}

// cameraBasis singularity guard: forward straight down shouldn't collapse the basis.
{
  const cam = makeCamera({ forward: [0, -1, 0], up: [0, 1, 0] })
  const b = cameraBasis(cam)
  if (len3(b.right) < 0.5 || len3(b.up) < 0.5) {
    failed++
    console.error('FAIL cameraBasis straight-down: zero-length basis vectors', b)
  } else {
    console.log('ok   cameraBasis straight-down has non-degenerate basis')
  }
  // Same for straight up.
  const camUp = makeCamera({ forward: [0, 1, 0], up: [0, 1, 0] })
  const bUp = cameraBasis(camUp)
  if (len3(bUp.right) < 0.5 || len3(bUp.up) < 0.5) {
    failed++
    console.error('FAIL cameraBasis straight-up: zero-length basis vectors', bUp)
  } else {
    console.log('ok   cameraBasis straight-up has non-degenerate basis')
  }
}

// pinhole near-plane guard: a point ε in front of the eye returns null.
{
  const cam = makeCamera() // looking down -Z from [0,0,5]
  // Point at z=4.999999 sits ε in front. dot(rel, forward) = -(4.999999 - 5) = 1e-6. Right at the threshold.
  const pNear = pinhole([0, 0, 4.999999], cam)
  // We accept either `null` (rejected) or a small finite number — but never huge values.
  if (pNear !== null && (Math.abs(pNear[0]) > 100 || Math.abs(pNear[1]) > 100)) {
    failed++
    console.error('FAIL pinhole near-plane explodes:', pNear)
  } else {
    console.log('ok   pinhole near-plane bounded')
  }
}
// unproject is the inverse of pinhole at a chosen depth.
{
  const c = presetCamera('3pt')
  const w = [1.5, -0.7, 2.3]
  const ip = pinhole(w, c)
  // depth = dot(w - cam.position, forward)
  const { forward } = cameraBasis(c)
  const z = dot3(sub3(w, c.position), forward)
  const back = unproject(ip, c, z)
  eq('unproject round-trip', back, w, 1e-9)
}

// vanishing points
{
  const c1 = presetCamera('1pt') // forward [0,0,-1], focal 1.2
  // X axis is parallel to image plane → VP_x at infinity
  if (vanishingPoint([1, 0, 0], c1) !== null) {
    failed++
    console.error('FAIL VP_x in 1pt should be null (parallel to image plane)')
  } else {
    console.log('ok   VP_x null in 1pt')
  }
  // Z axis points into the camera → VP_z at image origin (0, 0)
  eq('VP_z in 1pt', vanishingPoint([0, 0, 1], c1), [0, 0])

  const c2 = presetCamera('2pt') // yaw 30, pitch 0
  // Both X and Z VPs should be finite, both with image_y = 0 (horizon at center)
  const vx = vanishingPoint([1, 0, 0], c2)
  const vz = vanishingPoint([0, 0, 1], c2)
  if (!vx || !vz) {
    failed++
    console.error('FAIL VP_x or VP_z null in 2pt')
  } else {
    eq('VP_x.y at horizon (2pt)', vx[1], 0, 1e-9)
    eq('VP_z.y at horizon (2pt)', vz[1], 0, 1e-9)
    // X and Z VPs sit on opposite sides of center
    if (Math.sign(vx[0]) === Math.sign(vz[0])) {
      failed++
      console.error('FAIL VP_x and VP_z should be on opposite sides in 2pt')
    } else {
      console.log('ok   VP_x and VP_z on opposite sides (2pt)')
    }
  }
  // Y axis still parallel to image plane → VP_y at infinity
  if (vanishingPoint([0, 1, 0], c2) !== null) {
    failed++
    console.error('FAIL VP_y in 2pt should be null')
  } else {
    console.log('ok   VP_y null in 2pt')
  }
}

// projectSegment: a fully-visible segment round-trips
{
  const cam = makeCamera()
  const a = [-1, 0, 0]
  const b = [1, 0, 0]
  const seg = projectSegment(a, b, cam)
  if (!seg) {
    failed++
    console.error('FAIL visible segment returned null')
  } else {
    eq('seg endpoint A', seg[0], pinhole(a, cam))
    eq('seg endpoint B', seg[1], pinhole(b, cam))
  }
  // segment fully behind camera → null
  const back = projectSegment([0, 0, 100], [0, 0, 50], cam)
  if (back !== null) {
    failed++
    console.error('FAIL segment behind camera should be null')
  } else {
    console.log('ok   seg behind camera null')
  }
  // segment crossing the near plane → returns clipped projection (no throw)
  const cross = projectSegment([0, 0, -10], [0, 0, 100], cam)
  if (!cross) {
    failed++
    console.error('FAIL crossing segment returned null')
  } else {
    console.log('ok   seg crosses near plane')
  }
}

// VP inverse: round-trip a VP through the inverse and the camera, expect same VP image
{
  const c = presetCamera('3pt') // yaw 30, pitch -20
  const vx = vanishingPoint([1, 0, 0], c)
  const vy = vanishingPoint([0, 1, 0], c)
  const vz = vanishingPoint([0, 0, 1], c)
  if (!vx || !vy || !vz) {
    failed++
    console.error('FAIL one of VP_x/y/z null in 3pt')
  } else {
    // Move VP_x to a chosen new image position, recompute camera, re-evaluate VP_x.
    const target = [0.5, 0.2]
    const knobs = knobsFromVP('x', target, c.focal)
    const cam2 = presetCamera('3pt', { ...knobs })
    const vx2 = vanishingPoint([1, 0, 0], cam2)
    eq('VP_x inverse round-trip', vx2, target, 1e-6)

    // VP_y: only y matters; new pitch should put VP_y at the requested y
    const targetY = 4.5
    const ky = knobsFromVP('y', [0, targetY], c.focal)
    const camY = presetCamera('3pt', { ...ky })
    const vy2 = vanishingPoint([0, 1, 0], camY)
    eq('VP_y inverse round-trip y', vy2[1], targetY, 1e-6)

    // VP_z
    const targetZ = [-0.7, 0.15]
    const kz = knobsFromVP('z', targetZ, c.focal)
    const camZ = presetCamera('3pt', { ...kz })
    const vz2 = vanishingPoint([0, 0, 1], camZ)
    eq('VP_z inverse round-trip', vz2, targetZ, 1e-6)

    // Negative-coord round-trips — the half that was broken under the old
    // one-sided atan2 inverses. A target with image_x < 0 must produce knobs
    // that round-trip back to the same image position.
    const tx_neg = [-0.5, 0.2]
    const knobs_xn = knobsFromVP('x', tx_neg, c.focal)
    const cam_xn = presetCamera('3pt', { ...knobs_xn })
    const vx_neg = vanishingPoint([1, 0, 0], cam_xn)
    eq('VP_x inverse round-trip (negative ix)', vx_neg, tx_neg, 1e-6)

    const ty_neg = -3.5 // VP_y below center (negative image_y)
    const knobs_yn = knobsFromVP('y', [0, ty_neg], c.focal)
    const cam_yn = presetCamera('3pt', { ...knobs_yn })
    const vy_neg = vanishingPoint([0, 1, 0], cam_yn)
    eq('VP_y inverse round-trip y (negative iy)', vy_neg[1], ty_neg, 1e-6)

    const tz_neg = [0.7, -0.15] // mirror of targetZ across both axes
    const knobs_zn = knobsFromVP('z', tz_neg, c.focal)
    const cam_zn = presetCamera('3pt', { ...knobs_zn })
    const vz_neg = vanishingPoint([0, 0, 1], cam_zn)
    eq('VP_z inverse round-trip (sign-flipped)', vz_neg, tz_neg, 1e-6)
  }
}

// curved projections: basic sanity
{
  const cam = makeCamera() // looking down -Z from +Z=5, focal 1
  // a point straight ahead (origin) projects to (0, 0) in any model
  eq('cylindrical origin', cylindrical([0, 0, 0], cam), [0, 0])
  eq('spherical origin', spherical([0, 0, 0], cam), [0, 0])
  // a point directly above origin: cylindrical y > 0 (vertical line stays vertical)
  const up = cylindrical([0, 1, 0], cam)
  if (!up || up[0] !== 0 || up[1] <= 0) {
    failed++
    console.error('FAIL cylindrical up not on +y axis:', up)
  } else {
    console.log('ok   cylindrical up on +y axis')
  }
  // dispatch sanity: project(p, cam, 'pinhole') === pinhole(p, cam)
  eq('project pinhole dispatch', project([1, 0, 0], cam, 'pinhole'), pinhole([1, 0, 0], cam))
  // polyline subdivision: a long horizontal line in cylindrical produces a curved polyline
  const runs = projectPolyline([-3, 0, 0], [3, 0, 0], cam, 'cylindrical', 16)
  if (runs.length === 0 || runs[0].length < 8) {
    failed++
    console.error('FAIL cylindrical polyline empty/short:', runs)
  } else {
    // middle point's |y| should be 0 (line is at world y=0); endpoints should bend
    const mid = runs[0][Math.floor(runs[0].length / 2)]
    const end = runs[0][runs[0].length - 1]
    if (Math.abs(mid[1]) > 1e-6) {
      failed++
      console.error('FAIL cylindrical mid not at y=0:', mid)
    } else {
      console.log('ok   cylindrical horizontal line stays at y=0 at center')
    }
    // Endpoints have nonzero x (away from center)
    if (Math.abs(end[0]) < 0.1) {
      failed++
      console.error('FAIL cylindrical endpoint x too small:', end)
    } else {
      console.log('ok   cylindrical endpoints sweep horizontally')
    }
  }
}

// horizon: at pitch=0, horizon is at image_y=0
{
  const c2 = presetCamera('2pt') // pitch 0
  eq('horizon at pitch=0', horizonImageY(c2), 0, 1e-9)
  // round-trip pitch through horizon math
  const c3 = presetCamera('3pt') // pitch -20
  const y = horizonImageY(c3)
  if (y === null) {
    failed++
    console.error('FAIL horizon y not finite for 3pt')
  } else {
    eq('horizon→pitch round-trip 3pt', pitchFromHorizonY(y, c3.focal), -20, 1e-6)
  }
}

// All preset cameras should sit at distance 8 from origin and look back at it.
eq('1pt distance', len3(c1.position), 8)
eq('2pt distance', len3(c2.position), 8)
eq('3pt distance', len3(c3.position), 8)

// arc shape: vertex / edge / face counts and parametric placement
{
  // Full circle, radius 2, on local XZ plane, 8 segments → 9 verts, 8 edges, 0 faces.
  const arc = makeShape({
    kind: 'arc',
    center: [0, 0, 0],
    size: [4, 0, 4],
    params: { startAngle: 0, endAngle: 360, segments: 8 },
  })
  const mesh = buildMesh(arc)
  eq('arc vertex count', mesh.vertices.length, 9)
  eq('arc edge count', mesh.edges.length, 8)
  eq('arc face count', mesh.faces.length, 0)
  // First vertex at angle 0: (rx, 0, 0) = (2, 0, 0).
  eq('arc v[0]', mesh.vertices[0], [2, 0, 0], 1e-9)
  // Last vertex at angle 2π: also (2, 0, 0) since full sweep returns to start.
  eq('arc v[N] full circle', mesh.vertices[8], [2, 0, 0], 1e-9)

  // Half arc, 0 to 180°, 4 segments → first at +rx, last at -rx.
  const half = makeShape({
    kind: 'arc',
    center: [0, 0, 0],
    size: [4, 0, 4],
    params: { startAngle: 0, endAngle: 180, segments: 4 },
  })
  const halfMesh = buildMesh(half)
  eq('half-arc v[0]', halfMesh.vertices[0], [2, 0, 0], 1e-9)
  eq('half-arc v[N]', halfMesh.vertices[4], [-2, 0, 0], 1e-9)
  // Mid-vertex at 90°: (0, 0, +rz) = (0, 0, 2)
  eq('half-arc midpoint', halfMesh.vertices[2], [0, 0, 2], 1e-9)

  // Center offset: world point = center + local point.
  const offset = makeShape({
    kind: 'arc',
    center: [10, 5, -3],
    size: [2, 0, 2],
    params: { startAngle: 0, endAngle: 360, segments: 4 },
  })
  const offMesh = buildMesh(offset)
  eq('arc center offset v[0]', offMesh.vertices[0], [11, 5, -3], 1e-9)
}

// polyline shape: anchor-based bezier-capable path
{
  // Open polyline through 4 local anchors (no tangents) → 4 verts, 3 edges, 0 faces.
  const open = makeShape({
    kind: 'polyline',
    center: [0, 0, 0],
    size: [1, 1, 1],
    params: {
      anchors: [{ point: [-1, 0, -1] }, { point: [1, 0, -1] }, { point: [1, 0, 1] }, { point: [-1, 0, 1] }],
      closed: false,
    },
  })
  const openMesh = buildMesh(open)
  eq('polyline open vertex count', openMesh.vertices.length, 4)
  eq('polyline open edge count', openMesh.edges.length, 3)
  eq('polyline open face count', openMesh.faces.length, 0)
  eq('polyline open v[0]', openMesh.vertices[0], [-1, 0, -1], 1e-9)
  eq('polyline open v[3]', openMesh.vertices[3], [-1, 0, 1], 1e-9)

  // Closed (no tangents) → same 4 verts, 4 edges (closing edge wraps to vertex 0).
  const closed = makeShape({
    kind: 'polyline',
    center: [0, 0, 0],
    size: [1, 1, 1],
    params: {
      anchors: [{ point: [-1, 0, -1] }, { point: [1, 0, -1] }, { point: [1, 0, 1] }, { point: [-1, 0, 1] }],
      closed: true,
    },
  })
  const closedMesh = buildMesh(closed)
  eq('polyline closed edge count', closedMesh.edges.length, 4)
  eq('polyline closed vertex count', closedMesh.vertices.length, 4)
  const lastEdge = closedMesh.edges[3]
  eq('polyline closing edge from', lastEdge[0], 3)
  eq('polyline closing edge to', lastEdge[1], 0)

  // Center offset stacks on top of local points.
  const offset = makeShape({
    kind: 'polyline',
    center: [10, 5, -3],
    size: [1, 1, 1],
    params: { anchors: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }], closed: false },
  })
  const offMesh = buildMesh(offset)
  eq('polyline center offset v[0]', offMesh.vertices[0], [10, 5, -3], 1e-9)
  eq('polyline center offset v[1]', offMesh.vertices[1], [11, 5, -3], 1e-9)

  // Bezier curve segment: 2 anchors with mirrored tangents → segments+1 verts, segments edges.
  // Mathematically a horizontal line bowed upward in +y. The mid-sample at t=0.5 should
  // sit above the midpoint between anchors (positive y) due to the +y tangents.
  const bez = makeShape({
    kind: 'polyline',
    center: [0, 0, 0],
    size: [1, 1, 1],
    params: {
      anchors: [
        { point: [-1, 0, 0], out: [0.5, 1, 0] },
        { point: [ 1, 0, 0], in:  [-0.5, 1, 0] },
      ],
      closed: false,
      segments: 8,
    },
  })
  const bezMesh = buildMesh(bez)
  eq('bezier vertex count', bezMesh.vertices.length, 9)
  eq('bezier edge count', bezMesh.edges.length, 8)
  eq('bezier endpoint A', bezMesh.vertices[0], [-1, 0, 0], 1e-9)
  eq('bezier endpoint B', bezMesh.vertices[8], [1, 0, 0], 1e-9)
  // Mid-sample y > 0 → curve bowed upward.
  if (bezMesh.vertices[4][1] <= 0) {
    failed++
    console.error('FAIL bezier midpoint should bow into +y, got', bezMesh.vertices[4])
  } else {
    console.log('ok   bezier midpoint bows into +y')
  }
}

// Solid primitives — vertex / edge / face counts + outward-normal sanity.
{
  const box = makeShape({ kind: 'box', center: [0, 0, 0], size: [2, 2, 2] })
  const m = buildMesh(box)
  eq('box vertex count', m.vertices.length, 8)
  eq('box edge count', m.edges.length, 12)
  eq('box face count', m.faces.length, 6)
  // Each face normal is one of ±x/±y/±z (axis-aligned for an unrotated box).
  // At least one face should have normal pointing +y (the top).
  const hasUp = m.faces.some((f) => Math.abs(f.normal[1] - 1) < 1e-6)
  if (!hasUp) {
    failed++
    console.error('FAIL box +y face missing in normals:', m.faces.map((f) => f.normal))
  } else {
    console.log('ok   box has +y face')
  }
}

{
  const pyr = makeShape({ kind: 'pyramid', center: [0, 0, 0], size: [2, 2, 2] })
  const m = buildMesh(pyr)
  eq('pyramid vertex count', m.vertices.length, 5) // 4 base + 1 apex
  eq('pyramid edge count', m.edges.length, 8) // 4 base + 4 to apex
  eq('pyramid face count', m.faces.length, 5) // 1 base + 4 sides
  // Apex sits at +y (last vertex pushed in buildPyramid).
  eq('pyramid apex y', m.vertices[4][1], 1)
  // Base face has -y outward normal.
  const hasBase = m.faces.some((f) => Math.abs(f.normal[1] + 1) < 1e-6)
  if (!hasBase) {
    failed++
    console.error('FAIL pyramid -y base normal missing')
  } else {
    console.log('ok   pyramid has -y base')
  }
}

{
  const pr = makeShape({ kind: 'prism', center: [0, 0, 0], size: [2, 2, 2] })
  const m = buildMesh(pr)
  eq('prism vertex count', m.vertices.length, 6)
  eq('prism edge count', m.edges.length, 9)
  eq('prism face count', m.faces.length, 5) // 2 triangle ends + 3 rect sides
  // Front face has +z outward normal; back has -z.
  const hasFront = m.faces.some((f) => Math.abs(f.normal[2] - 1) < 1e-6)
  const hasBack = m.faces.some((f) => Math.abs(f.normal[2] + 1) < 1e-6)
  if (!hasFront || !hasBack) {
    failed++
    console.error('FAIL prism missing front or back triangle face')
  } else {
    console.log('ok   prism has front + back triangles')
  }
}

{
  const cyl = makeShape({
    kind: 'cylinder',
    center: [0, 0, 0],
    size: [2, 2, 2],
    params: { segments: 16 },
  })
  const m = buildMesh(cyl)
  eq('cylinder vertex count', m.vertices.length, 32) // 16 bottom + 16 top
  // Edge count: segments around bottom + around top + verticals = 16 + 16 + 16 = 48.
  eq('cylinder edge count', m.edges.length, 48)
  // Face count: segments side quads + 2 caps.
  eq('cylinder face count', m.faces.length, 18)
  // Cap face normals are exactly ±y.
  const capUp = m.faces.find((f) => Math.abs(f.normal[1] - 1) < 1e-6)
  const capDown = m.faces.find((f) => Math.abs(f.normal[1] + 1) < 1e-6)
  if (!capUp || !capDown) {
    failed++
    console.error('FAIL cylinder missing top/bottom cap')
  } else {
    console.log('ok   cylinder has top + bottom caps')
  }
}

{
  const sph = makeShape({
    kind: 'sphere',
    center: [0, 0, 0],
    size: [2, 2, 2],
    params: { stacks: 6, slices: 8 },
  })
  const m = buildMesh(sph)
  // 2 poles + (stacks-1) * slices = 2 + 5*8 = 42.
  eq('sphere vertex count', m.vertices.length, 42)
  // Faces: top cap (slices triangles) + (stacks-2) middle quad rings × slices + bottom cap.
  // = 8 + 4*8 + 8 = 48.
  eq('sphere face count', m.faces.length, 48)
  // Top vertex sits at +y of half-extent (size.y / 2 = 1).
  eq('sphere top pole y', m.vertices[0][1], 1)
  eq('sphere bottom pole y', m.vertices[1][1], -1)
}

// sortShapeFaces depth ordering — a face further from the camera sorts before
// a closer one (back-to-front for painter's). One box at z=-3 (far) and one
// at z=0 (near); from a +Z=5 camera, far comes first.
{
  const cam = makeCamera()
  const far = makeShape({ id: 'far', kind: 'box', center: [0, 0, -3], size: [1, 1, 1] })
  const near = makeShape({ id: 'near', kind: 'box', center: [0, 0, 0], size: [1, 1, 1] })
  const ordered = sortShapeFaces([far, near], cam)
  // First faces in the sorted list should belong to `far`.
  if (ordered[0].shapeId !== 'far') {
    failed++
    console.error('FAIL sortShapeFaces: expected far first, got', ordered[0].shapeId)
  } else {
    console.log('ok   sortShapeFaces orders far before near')
  }
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`)
  process.exit(1)
}
console.log('\nall green')
