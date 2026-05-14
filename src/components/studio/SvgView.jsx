import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useScene, PROJECTION_KIND } from '../../scene/store.js'
import {
  project,
  unproject,
  horizonImageY,
  pitchFromHorizonY,
  vanishingPoint,
  projectPolyline,
  depthForKind,
} from '../../math/project.js'
import { applyMat3, applyMat3Transpose, mat3Mul, rotMat, IDENT3 } from '../../math/cuboid.js'
import { verticesOf, edgesOf, sortShapeFaces, isShapeBackface, makeShape, buildMesh } from '../../math/shape.js'
import { setCsgDragSuspended } from '../../math/csg.js'
import { lines as armatureLines, nodes as armatureNodes } from '../../composition/armature.js'
import { boxEdges, floorGridLines } from '../../composition/sceneFrame.js'
import { sub3, dot3, add3, scale3 } from '../../math/vec.js'
import { cameraBasis } from '../../math/camera.js'
import { nearestNode } from '../../composition/anchors.js'
import { panActiveRef, orbitActiveRef } from '../../scene/useKeyboardCamera.js'

import { VIEWBOX_W, VIEWBOX_H, SCALE } from './viewport.js'

const toPx = (p) => [VIEWBOX_W / 2 + p[0] * SCALE, VIEWBOX_H / 2 - p[1] * SCALE]
const fromPx = (vb) => [(vb[0] - VIEWBOX_W / 2) / SCALE, (VIEWBOX_H / 2 - vb[1]) / SCALE]

/** Vanishing-point axis dirs / colors / labels. Module-scope so memoized
 *  consumers can use them as stable deps. */
const VP_AXES = /** @type {const} */ ([
  { dir: [1, 0, 0], label: 'X', color: '#d97706' }, // amber
  { dir: [0, 1, 0], label: 'Y', color: '#16a34a' }, // green
  { dir: [0, 0, 1], label: 'Z', color: '#2563eb' }, // blue
])
const VP_PX_LIMIT = 100 * Math.max(VIEWBOX_W, VIEWBOX_H)

/** Per-cuboid construction lines from corners to VPs (pinhole) or along
 *  curved axis trajectories (curved projections). The curved branch is the
 *  most expensive thing in SvgView's render — 8 verts × 3 axes × ±sign × 18
 *  sample points = ~864 polyline points per cuboid. Memoized on
 *  `[cuboid, camera, kind, vps, isPinhole]` so unrelated drag-ticks don't
 *  re-run any of it. */
const CuboidConstructionLines = memo(function CuboidConstructionLines({
  cuboid, camera, kind, isPinhole, vps,
}) {
  const elements = useMemo(() => {
    const verts = verticesOf(cuboid)
    if (isPinhole) {
      const projVerts = verts.map((v) => {
        const ip = project(v, camera, kind)
        return ip ? toPx(ip) : null
      })
      return projVerts.flatMap((pv, vi) =>
        pv === null
          ? []
          : vps.flatMap((vp) =>
              vp.px === null
                ? []
                : [(
                    <line
                      key={`cons-${cuboid.id}-${vi}-${vp.label}`}
                      x1={pv[0]} y1={pv[1]}
                      x2={vp.px[0]} y2={vp.px[1]}
                      stroke={vp.color}
                    />
                  )],
            ),
      )
    }
    // Curved: extend corners along world axes; let projectPolyline render
    // the convergence trajectories.
    const FAR = 50
    return verts.flatMap((v, vi) =>
      VP_AXES.flatMap((ax) =>
        [+1, -1].flatMap((sign) => {
          const far = [
            v[0] + ax.dir[0] * FAR * sign,
            v[1] + ax.dir[1] * FAR * sign,
            v[2] + ax.dir[2] * FAR * sign,
          ]
          const runs = projectPolyline(v, far, camera, kind, 18)
          return runs.map((r, ri) => (
            <polyline
              key={`cons-${cuboid.id}-${vi}-${ax.label}-${sign}-${ri}`}
              points={r.map(toPx).map(([x, y]) => `${x},${y}`).join(' ')}
              stroke={ax.color}
            />
          ))
        }),
      ),
    )
  }, [cuboid, camera, kind, isPinhole, vps])
  return (
    <g
      fill={isPinhole ? undefined : 'none'}
      strokeWidth="0.5"
      opacity={isPinhole ? 0.35 : 0.4}
      pointerEvents="none"
    >
      {elements}
    </g>
  )
})

/** Per-cuboid edge polylines, memoized on `[cuboid, camera, kind]`. The
 *  expensive call is `projectPolyline` (28 samples × 12 edges per cuboid for
 *  curved projections). When the user drags one cuboid, only that cuboid's
 *  reference changes — all others' useMemo cache hits, the projection work
 *  collapses from O(N) to O(1) per drag tick.
 *
 *  `cuboid.style.stroke` overrides the theme default — per-shape colour
 *  customisation flows through here. */
const CuboidEdges = memo(function CuboidEdges({ cuboid, camera, kind }) {
  const segments = kind === 'pinhole' ? 2 : 28
  const polylines = useMemo(
    () =>
      edgesOf(cuboid).flatMap(([a, b], i) => {
        const runs = projectPolyline(a, b, camera, kind, segments)
        return runs.map((run, ri) => ({
          key: `${cuboid.id}-edge-${i}-${ri}`,
          points: run.map(toPx).map(([x, y]) => `${x},${y}`).join(' '),
        }))
      }),
    [cuboid, camera, kind, segments],
  )
  return polylines.map((p) => (
    <polyline
      key={p.key}
      points={p.points}
      fill="none"
      stroke={cuboid.style?.stroke ?? 'var(--kol-surface-on-tertiary)'}
      strokeWidth={cuboid.style?.strokeWidth ?? 1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  ))
})

/** Edge polylines for a csg shape — same projection pipeline as
 *  `<CuboidEdges>`, but the edge list comes from `buildMesh(cuboid,
 *  shapesById)` (feature edges extracted in `csg.js` from the boolean
 *  result mesh). The csg cache short-circuits buildCsg when neither
 *  operator nor operand fields have changed, so this stays cheap on
 *  drag-tick re-renders. */
const CsgEdges = memo(function CsgEdges({ cuboid, camera, kind, shapesById }) {
  const segments = kind === 'pinhole' ? 2 : 28
  const polylines = useMemo(() => {
    const mesh = buildMesh(cuboid, shapesById)
    if (!mesh.edges || mesh.edges.length === 0) return []
    return mesh.edges.flatMap(([ai, bi], i) => {
      const a = mesh.vertices[ai]
      const b = mesh.vertices[bi]
      const runs = projectPolyline(a, b, camera, kind, segments)
      return runs.map((run, ri) => ({
        key: `${cuboid.id}-csg-edge-${i}-${ri}`,
        points: run.map(toPx).map(([x, y]) => `${x},${y}`).join(' '),
      }))
    })
  }, [cuboid, camera, kind, segments, shapesById])
  return polylines.map((p) => (
    <polyline
      key={p.key}
      points={p.points}
      fill="none"
      stroke={cuboid.style?.stroke ?? 'var(--kol-surface-on-tertiary)'}
      strokeWidth={cuboid.style?.strokeWidth ?? 1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  ))
})

/**
 * Closed face outline. For pinhole (segments=2) this collapses to the same
 * 4 corners projected directly. For curved projections (segments>>2) each
 * edge becomes a polyline that follows the curve.
 *
 * Returns null if any face edge clips OR if the resulting outline's
 * bounding box is bigger than the canvas — that signals a projection wrap
 * (cylindrical at θ=±π, equirectangular at the seam, etc.) and the
 * "polygon" would be a giant artifact across the screen.
 */
const projectPoly = (verts, cam, kind, segments) => {
  const out = []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % verts.length]
    const runs = projectPolyline(a, b, cam, kind, segments)
    if (runs.length !== 1) return null
    const run = runs[0]
    // Drop each edge's last sample — it's the next edge's first sample.
    for (let j = 0; j < run.length - 1; j++) {
      const px = toPx(run[j])
      if (px[0] < minX) minX = px[0]
      if (px[0] > maxX) maxX = px[0]
      if (px[1] < minY) minY = px[1]
      if (px[1] > maxY) maxY = px[1]
      out.push(px)
    }
  }
  // Wrap detection: a face that "jumps" produces a bounding box wider than
  // the canvas. Skip rendering it; the wireframe edges still draw.
  if (maxX - minX > VIEWBOX_W * 1.2 || maxY - minY > VIEWBOX_H * 1.5) return null
  return out
}

function SvgView() {
  const cuboids = useScene((s) => s.cuboids)
  const camera = useScene((s) => s.camera)
  const mode = useScene((s) => s.mode)
  const armature = useScene((s) => s.armature)
  const overlay = useScene((s) => s.overlay)
  const scene = useScene((s) => s.scene)
  const snapshots = useScene((s) => s.snapshots)
  const selectedCuboidId = useScene((s) => s.selectedCuboidId)
  const selectedIds = useScene((s) => s.selectedIds)
  const setSelectedCuboid = useScene((s) => s.setSelectedCuboid)
  const updateCuboid = useScene((s) => s.updateCuboid)
  const removeCuboid = useScene((s) => s.removeCuboid)
  const addCuboid = useScene((s) => s.addCuboid)
  const setScene = useScene((s) => s.setScene)
  const setKnobs = useScene((s) => s.setKnobs)
  const tool = useScene((s) => s.tool)
  const penDraftId = useScene((s) => s.penDraftId)
  const setPenDraft = useScene((s) => s.setPenDraft)
  const finishPenDraft = useScene((s) => s.finishPenDraft)
  const setSelection = useScene((s) => s.setSelection)
  const toggleSelection = useScene((s) => s.toggleSelection)
  // Local visual state for the marquee rectangle. Storing this here (vs the
  // global zustand store) means drag-tick updates re-render only SvgView,
  // not every other subscriber.
  const [marqueeRect, setMarqueeRect] = useState(null)
  // Cursor position in viewBox coords, tracked while pen mode is active.
  // Drives the rubber-band preview line from the last-placed anchor to
  // the cursor — telegraphs what segment the next click will draw.
  const [penPreviewPx, setPenPreviewPx] = useState(/** @type {[number, number] | null} */ (null))

  const kind = PROJECTION_KIND[mode]
  const isPinhole = kind === 'pinhole'

  const svgRef = useRef(null)
  const dragRef = useRef(/** @type {any} */ (null))
  const [activeGimbalAxis, setActiveGimbalAxis] = useState(/** @type {'x'|'y'|'z'|null} */ (null))
  const [hoverGimbalAxis, setHoverGimbalAxis] = useState(/** @type {'x'|'y'|'z'|null} */ (null))

  const isGeometry = (c) => {
    const k = c.kind || 'box'
    return k !== 'light' && k !== 'background'
  }
  const visibleAll = cuboids.filter((c) => !c.hidden)
  const visibleCuboids = visibleAll.filter(isGeometry)
  const backgroundLayers = visibleAll.filter((c) => {
    if (c.kind !== 'background') return false
    const p = c.params || {}
    return p.mode === 'solid' || (p.url && p.url.length > 0)
  })
  const lightLayers = visibleAll.filter((c) => c.kind === 'light')
  // csg shapes resolve operands by id at mesh-build time. Building this
  // map once per render keeps the lookups O(1) and gives buildCsg a
  // stable reference to feed its hash-based cache.
  const shapesById = useMemo(() => {
    const m = new Map()
    for (const c of cuboids) m.set(c.id, c)
    return m
  }, [cuboids])
  const visibleFaces = sortShapeFaces(visibleCuboids, camera, shapesById).filter((f) => !isShapeBackface(f, camera))
  const armatureOn = armature.system !== 'none'
  const aLines = armatureOn ? armatureLines(VIEWBOX_W, VIEWBOX_H, armature.system) : []
  const aNodes = armatureOn ? armatureNodes(VIEWBOX_W, VIEWBOX_H, armature.system) : []

  const eventToImage = (evt) => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const vbX = ((evt.clientX - rect.left) / rect.width) * VIEWBOX_W
    const vbY = ((evt.clientY - rect.top) / rect.height) * VIEWBOX_H
    return fromPx([vbX, vbY])
  }

  const startFaceDrag = (id) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const cub = cuboids.find((c) => c.id === id)
    if (!cub) return
    e.stopPropagation()
    // Shift+click on a shape's face — toggle in/out of selection. Standard
    // editor convention (Photoshop / Figma / Illustrator): shift adds, or
    // removes if already selected. No drag setup; user does multi-select
    // first, then a follow-up plain drag moves the group.
    if (e.shiftKey) {
      toggleSelection(id)
      return
    }
    // Multi-drag detection: if the clicked shape is already part of a
    // multi-selection, drag ALL selected shapes together. Clicking a
    // shape outside the current selection replaces the selection
    // with just that one (standard single-shape drag).
    const wasInSel = selectedIds.includes(id)
    const dragIds = wasInSel && selectedIds.length > 1 ? selectedIds : [id]
    if (!wasInSel) setSelectedCuboid(id)
    // Node tool — face-click selects only. No body-translate.
    // The user works through anchor / corner / tangent handles instead.
    // Standard V (select) vs A (direct-select) divergence.
    if (tool === 'node') return
    // CSG shapes have an identity center / rotation — moving them via face
    // drag wouldn't visually do anything (the result mesh is in world
    // space). Click selects; transform the result by editing the operands.
    if (cub.kind === 'csg') return
    const depth = depthForKind(cub.center, camera, kind)
    if (depth <= 1e-6) return // bail before claiming pointer capture
    e.currentTarget.setPointerCapture(e.pointerId)
    if (dragIds.length > 1) {
      // Multi-shape translate — drag delta applies to every selected
      // shape's center. Snap is skipped: the primary shape's snap
      // would silently shift the whole group; users can fine-tune via
      // single-shape drag or the Inspector.
      const targets = dragIds
        .map((sid) => {
          const c = cuboids.find((cc) => cc.id === sid)
          return c ? { id: sid, startCenter: c.center } : null
        })
        .filter(Boolean)
      dragRef.current = {
        kind: 'face-multi',
        targets,
        depth,
        startMouseImg: eventToImage(e),
        captureEl: e.currentTarget,
        pointerId: e.pointerId,
      }
      return
    }
    dragRef.current = {
      kind: 'face',
      id,
      startCenter: cub.center,
      depth,
      startMouseImg: eventToImage(e),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  const startCornerDrag = (id, vIndex) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const cub = cuboids.find((c) => c.id === id)
    if (!cub) return
    // Use the deformed vertex set (verticesOf applies vertexOffsets), so
    // corner handles in node mode start from the current visible position.
    const v = verticesOf(cub)
    if (vIndex < 0 || vIndex >= v.length) return
    const depth = depthForKind(v[vIndex], camera, kind)
    if (depth <= 1e-6) return // bail before claiming pointer capture / propagation

    if (tool === 'node') {
      // Node mode — drag THIS one vertex independently. Other vertices
      // stay put; the shape deforms (axis-alignment is broken, that's
      // the whole point). Storage: per-vertex local-space offsets in
      // `vertexOffsets`, applied by `buildMesh` after the kind-specific
      // computed default. Translation / rotation continue to work
      // because offsets are local-space.
      e.stopPropagation()
      if (selectedCuboidId !== id) setSelectedCuboid(id)
      e.currentTarget.setPointerCapture(e.pointerId)
      // World position of the *clean* (un-offset) default vertex — the
      // anchor against which the local-space offset is measured.
      const cleanV = verticesOf({ ...cub, vertexOffsets: undefined })
      dragRef.current = {
        kind: 'node-vertex',
        id,
        vIndex,
        defaultVertex: cleanV[vIndex],
        startOffsets: cub.vertexOffsets,
        startRotation: cub.rotation || IDENT3,
        depth,
        captureEl: e.currentTarget,
        pointerId: e.pointerId,
      }
      return
    }

    // Select mode — corner-resize from the opposite vertex. Box-only;
    // deformed shapes (vertexOffsets present) bail since their corner
    // semantics are anchor-driven rather than size-driven. Rotated
    // boxes are supported: we transform the world delta into the box's
    // local frame so `size` stays axis-aligned in local-space and the
    // rotation matrix is preserved.
    if (cub.kind && cub.kind !== 'box') return
    if (cub.vertexOffsets) return
    e.stopPropagation()
    if (selectedCuboidId !== id) setSelectedCuboid(id)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'corner',
      id,
      startVertex: v[vIndex],
      // Anchor: opposite vertex at drag-start. Captured once so it stays put
      // even as the cuboid mutates; lets the dragged corner pass through it
      // and continue, inverting the cuboid onto the other side.
      startOpposite: v[7 - vIndex],
      startRotation: cub.rotation || IDENT3,
      depth,
      startMouseImg: eventToImage(e),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  const startHorizonDrag = (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'horizon',
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /** Polyline anchor drag — translates the i-th anchor's `point` in
   *  `params.anchors`. Stored in local space (relative to center, before
   *  shape rotation); on each tick we unproject the cursor at the anchor's
   *  world depth and transpose-rotate back to local. */
  const startVertexDrag = (id, vertexIndex) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const cub = cuboids.find((c) => c.id === id)
    if (!cub || cub.kind !== 'polyline') return
    const anchors = cub.params?.anchors ?? []
    if (vertexIndex < 0 || vertexIndex >= anchors.length) return

    // Alt+click anchor — toggle corner ↔ smooth (Illustrator's convert-
    // anchor shortcut). Smooth: mirrored tangents along the local edge
    // direction (averaged from neighbors). Corner: drop both tangents.
    if (e.altKey) {
      e.stopPropagation()
      useScene.getState().pushHistory()
      const a = anchors[vertexIndex]
      const hasTangent = !!(a.in || a.out)
      let nextAnchor
      if (hasTangent) {
        // Strip tangents — anchor becomes a corner.
        // eslint-disable-next-line no-unused-vars
        const { in: _i, out: _o, ...rest } = a
        nextAnchor = rest
      } else {
        // Compute a smooth tangent from the local curve direction. For an
        // open path's endpoint, fall back to the single available neighbor.
        const closed = !!cub.params?.closed
        const n = anchors.length
        const prevIdx = closed
          ? (vertexIndex - 1 + n) % n
          : Math.max(0, vertexIndex - 1)
        const nextIdx = closed
          ? (vertexIndex + 1) % n
          : Math.min(n - 1, vertexIndex + 1)
        const prev = anchors[prevIdx].point
        const next = anchors[nextIdx].point
        const dir = sub3(next, prev)
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
        const t = [(dir[0] / len) * 0.5, (dir[1] / len) * 0.5, (dir[2] / len) * 0.5]
        nextAnchor = { ...a, in: [-t[0], -t[1], -t[2]], out: [t[0], t[1], t[2]] }
      }
      const newAnchors = anchors.map((x, i) => (i === vertexIndex ? nextAnchor : x))
      updateCuboid(id, { params: { ...(cub.params || {}), anchors: newAnchors } })
      if (selectedCuboidId !== id) setSelectedCuboid(id)
      return
    }

    const M = cub.rotation || IDENT3
    const rotated = applyMat3(M, anchors[vertexIndex].point)
    /** @type {import('../../math/vec.js').Vec3} */
    const wp = [
      cub.center[0] + rotated[0],
      cub.center[1] + rotated[1],
      cub.center[2] + rotated[2],
    ]
    const depth = depthForKind(wp, camera, kind)
    if (depth <= 1e-6) return // bail before claiming pointer capture
    e.stopPropagation()
    if (selectedCuboidId !== id) setSelectedCuboid(id)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'vertex',
      id,
      vertexIndex,
      startCenter: cub.center,
      startRotation: M,
      depth,
      startMouseImg: eventToImage(e),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /** Polyline edge interaction — plain click selects the polyline (handy
   *  since polylines have no face to click); Cmd/Ctrl+click+drag bends the
   *  edge segment by setting tangents on the two flanking anchors,
   *  mirroring the drag direction so the curve bows toward the cursor.
   *  Math: for a cubic bezier with mirrored mid-tangents, the midpoint at
   *  t=0.5 sits at `(A + B)/2 + 3·tangent/8`. So `tangent = (4/3) · drag`
   *  makes the curve pass through the cursor at the segment midpoint. */
  const startBendOrSelect = (cuboidId, edgeIndex) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    e.stopPropagation()
    const cub = cuboids.find((c) => c.id === cuboidId)
    if (!cub || cub.kind !== 'polyline') return
    if (!(e.metaKey || e.ctrlKey)) {
      if (selectedCuboidId !== cuboidId) setSelectedCuboid(cuboidId)
      return
    }
    const anchors = cub.params?.anchors ?? []
    const closed = !!cub.params?.closed
    const numEdges = closed && anchors.length > 2 ? anchors.length : anchors.length - 1
    if (edgeIndex < 0 || edgeIndex >= numEdges) return
    const nextIdx = (edgeIndex + 1) % anchors.length
    const M = cub.rotation || IDENT3
    const aWorld = add3(cub.center, applyMat3(M, anchors[edgeIndex].point))
    const bWorld = add3(cub.center, applyMat3(M, anchors[nextIdx].point))
    const midWorld = scale3(add3(aWorld, bWorld), 0.5)
    const depth = depthForKind(midWorld, camera, kind)
    if (depth <= 1e-6) return
    if (selectedCuboidId !== cuboidId) setSelectedCuboid(cuboidId)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'bend',
      id: cuboidId,
      edgeIndex,
      nextIdx,
      startRotation: M,
      depth,
      startMouseImg: eventToImage(e),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /** Tangent handle drag — moves anchor.in or anchor.out (offsets from
   *  anchor.point in local space). When `mirror` is true (default for
   *  smooth points), the opposite handle is set to the negation so the
   *  curve stays C¹-continuous. Hold Alt to break the symmetry — same
   *  semantic as Illustrator's pen tool. */
  const startTangentDrag = (id, vertexIndex, which) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const cub = cuboids.find((c) => c.id === id)
    if (!cub || cub.kind !== 'polyline') return
    const anchors = cub.params?.anchors ?? []
    const a = anchors[vertexIndex]
    if (!a) return
    const M = cub.rotation || IDENT3
    const handleLocal = which === 'in' ? (a.in ?? [0, 0, 0]) : (a.out ?? [0, 0, 0])
    const handleWorldOffset = applyMat3(M, [
      a.point[0] + handleLocal[0],
      a.point[1] + handleLocal[1],
      a.point[2] + handleLocal[2],
    ])
    /** @type {import('../../math/vec.js').Vec3} */
    const wp = [
      cub.center[0] + handleWorldOffset[0],
      cub.center[1] + handleWorldOffset[1],
      cub.center[2] + handleWorldOffset[2],
    ]
    const depth = depthForKind(wp, camera, kind)
    if (depth <= 1e-6) return
    e.stopPropagation()
    if (selectedCuboidId !== id) setSelectedCuboid(id)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'tangent',
      id,
      vertexIndex,
      which,
      mirror: !e.altKey,
      startCenter: cub.center,
      startRotation: M,
      startAnchorPoint: a.point,
      depth,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  const startVPDrag = (axis) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const knobs = useScene.getState().knobs
    dragRef.current = {
      kind: 'vp',
      axis,
      startClient: [e.clientX, e.clientY],
      startYaw: knobs.yawDeg,
      startPitch: knobs.pitchDeg,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  const startSceneDrag = (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const depth = depthForKind(scene.center, camera, kind)
    if (depth <= 1e-6) return // bail before claiming pointer capture / propagation
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'scene',
      startCenter: scene.center,
      depth,
      startMouseImg: eventToImage(e),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /**
   * Spacebar-held pan: translate the camera laterally without rotating it.
   * Math: capture the camera's right/up basis at drag-start (constant during
   * drag since orientation doesn't change), then convert image-space cursor
   * delta to a world-space pivot offset at a chosen reference depth.
   */
  const startPanDrag = (e) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const knobsNow = useScene.getState().knobs
    const sceneNow = useScene.getState().scene
    const { right, up, forward } = cameraBasis(camera)
    const sceneDepth = dot3(sub3(sceneNow.center, camera.position), forward)
    const refDepth = sceneDepth > 0.5 ? sceneDepth : knobsNow.distance
    dragRef.current = {
      kind: 'pan',
      startMouseImg: eventToImage(e),
      startPivot: knobsNow.pivot,
      startRight: right,
      startUp: up,
      startFocal: camera.focal,
      refDepth,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /**
   * Gimbal-axis drag — grab one of the three colored rings around a selected
   * cuboid. Rotation is the angular sweep of the cursor around the cuboid's
   * projected center; that sweep gets composed onto the cuboid's local axis
   * via matrix multiplication, so dragging the visible X ring always
   * rotates around that ring no matter what other rotations are in play.
   */
  const startGimbalDrag = (id, axis) => (e) => {
    if (panActiveRef.current || orbitActiveRef.current) return
    const cub = cuboids.find((c) => c.id === id)
    if (!cub) return
    // Project the cuboid center to viewBox-pixel space; cursor angle is
    // measured around it for the angular-sweep gesture.
    const ipCenter = project(cub.center, camera, kind)
    if (!ipCenter) return // bail before claiming pointer capture / propagation
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (selectedCuboidId !== id) setSelectedCuboid(id)
    const [cx, cy] = toPx(ipCenter)
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W
    const vbY = ((e.clientY - rect.top) / rect.height) * VIEWBOX_H
    // SVG atan2 increases CW on screen. Right-hand-rule positive rotation is
    // CCW *from the +axis end*, so the screen↔world spin direction matches
    // only when the camera is on the -axis side of the ring. Flip the sign
    // when we're looking at the +face so dragging always spins the ring the
    // direction the cursor moved.
    const axisLocal = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
    const ringAxisWorld = applyMat3(cub.rotation || IDENT3, axisLocal)
    const toCam = sub3(camera.position, cub.center)
    const sign = dot3(ringAxisWorld, toCam) > 0 ? -1 : 1
    dragRef.current = {
      kind: 'gimbal',
      id,
      axis,
      startRotation: cub.rotation || IDENT3,
      centerPx: [cx, cy],
      startAngle: Math.atan2(vbY - cy, vbX - cx),
      sign,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
    setActiveGimbalAxis(axis)
  }

  /** Alt-held orbit: relative-delta gesture, identical to VP-axis drag. */
  const startOrbitDrag = (e) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const knobsNow = useScene.getState().knobs
    dragRef.current = {
      kind: 'orbit',
      startClient: [e.clientX, e.clientY],
      startYaw: knobsNow.yawDeg,
      startPitch: knobsNow.pitchDeg,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /**
   * Dispatch on the SVG root: routes pointerdowns by which modifier is held.
   * Falls through to deselect when clicking empty canvas with no modifier
   * (inner handlers stopPropagation, so this only runs for unclaimed clicks).
   */
  const onCanvasPointerDown = (e) => {
    if (orbitActiveRef.current) startOrbitDrag(e)
    else if (panActiveRef.current) startPanDrag(e)
    else if (tool === 'pen') startPenDrag(e)
    else startMarqueeDrag(e)
  }

  /**
   * Scale tool drag — captures every selected shape's baseline (size,
   * center, vertexOffsets, polyline anchors) plus a pivot at the
   * selection centroid. On move, the cursor's image-space distance from
   * the pivot drives a uniform scale factor; each baseline is multiplied
   * and each center is pushed outward proportionally so the group scales
   * around the pivot. csg / light / background shapes are skipped (their
   * size is inert).
   */
  const startScaleDrag = (e) => {
    const state = useScene.getState()
    if (state.selectedIds.length === 0) return
    const sel = state.selectedIds
      .map((sid) => cuboids.find((c) => c.id === sid))
      .filter((s) => s && s.kind !== 'csg' && s.kind !== 'light' && s.kind !== 'background')
    if (sel.length === 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    /** @type {import('../../math/vec.js').Vec3} */
    const pivot = [0, 0, 0]
    for (const t of sel) {
      pivot[0] += t.center[0]
      pivot[1] += t.center[1]
      pivot[2] += t.center[2]
    }
    pivot[0] /= sel.length
    pivot[1] /= sel.length
    pivot[2] /= sel.length
    const pivotImg = project(pivot, camera, kind)
    if (!pivotImg) return
    const pivotPx = toPx(pivotImg)
    const startVb = clientToVb(e)
    const startDist = Math.hypot(startVb[0] - pivotPx[0], startVb[1] - pivotPx[1])
    if (startDist < 4) return // ambiguous — drag started right on pivot
    state.pushHistory()
    dragRef.current = {
      kind: 'scale',
      pivot,
      pivotPx,
      startDist,
      targets: sel.map((t) => ({
        id: t.id,
        startSize: t.size,
        startCenter: t.center,
        startVertexOffsets: t.vertexOffsets,
        startParams: t.params,
      })),
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /** Convert a pointer event's client coords to viewBox coords. The SVG
   *  scales to its container; this divides by the container size and
   *  multiplies by the viewBox extent. */
  const clientToVb = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / rect.width) * VIEWBOX_W,
      ((e.clientY - rect.top) / rect.height) * VIEWBOX_H,
    ]
  }

  /** Marquee-rect drag — empty-canvas click+drag in select / node modes
   *  draws a selection rectangle. On release, every visible shape whose
   *  projected bounding box overlaps the rectangle joins the selection.
   *  Shift held = additive (union with existing selection); otherwise
   *  the new selection replaces.
   *
   *  A click without movement ends with a 0×0 rect → no shapes hit →
   *  setSelection([]) → clean deselect. Same as the previous click-empty-
   *  to-deselect behavior. */
  const startMarqueeDrag = (e) => {
    const startVb = clientToVb(e)
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const additive = e.shiftKey
    const startSelection = additive ? [...useScene.getState().selectedIds] : []
    setMarqueeRect({ x0: startVb[0], y0: startVb[1], x1: startVb[0], y1: startVb[1] })
    dragRef.current = {
      kind: 'marquee',
      startVb,
      additive,
      startSelection,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /**
   * Pen-tool click. Each canvas click appends an anchor to the in-progress
   * draft polyline (or starts a new draft at the click point). Clicking
   * within ~14 pixels of the draft's first anchor closes the path and
   * finishes. Click+drag (move > a few pixels before pointerup) sets a
   * smooth tangent on the just-placed anchor — Illustrator pen semantics.
   *
   * Depth comes from the scene-frame's centre via `depthForKind` so all
   * anchors land on the same world-plane regardless of projection mode.
   */
  const startPenDrag = (e) => {
    e.stopPropagation()
    const cur = eventToImage(e)
    const sceneNow = useScene.getState().scene
    const sceneDepth = depthForKind(sceneNow.center, camera, kind)
    if (sceneDepth <= 1e-6) return
    // Each pen click is one undo entry. Capture pre-click state before
    // any mutation (close-loop, extend, append, or new draft).
    useScene.getState().pushHistory()
    const draft = penDraftId ? cuboids.find((c) => c.id === penDraftId) : null

    // Close-path check: within 14 image-pixels of the first anchor's
    // projection on a draft with at least 2 anchors.
    if (draft && (draft.params?.anchors?.length ?? 0) >= 2) {
      const first = draft.params.anchors[0]
      const M = draft.rotation || IDENT3
      const r = applyMat3(M, first.point)
      const ip = project([draft.center[0] + r[0], draft.center[1] + r[1], draft.center[2] + r[2]], camera, kind)
      if (ip) {
        const [fx, fy] = toPx(ip)
        const [cx, cy] = toPx(cur)
        if (Math.hypot(cx - fx, cy - fy) < 14) {
          updateCuboid(draft.id, { params: { ...(draft.params || {}), closed: true } })
          finishPenDraft()
          return
        }
      }
    }

    // Extend an existing open polyline — when there's no active draft and
    // the click lands within ~14 px of an open polyline's LAST anchor,
    // resume drafting from that polyline. The clicked anchor stays as-is;
    // the user's NEXT click is what appends a new anchor.
    if (!draft) {
      const [cx, cy] = toPx(cur)
      for (const c of cuboids) {
        if (c.hidden || c.kind !== 'polyline' || c.params?.closed) continue
        const anchors = c.params?.anchors ?? []
        if (anchors.length < 1) continue
        const lastIdx = anchors.length - 1
        const M = c.rotation || IDENT3
        const r = applyMat3(M, anchors[lastIdx].point)
        const ip = project([c.center[0] + r[0], c.center[1] + r[1], c.center[2] + r[2]], camera, kind)
        if (!ip) continue
        const [lx, ly] = toPx(ip)
        if (Math.hypot(cx - lx, cy - ly) < 14) {
          setPenDraft(c.id)
          if (selectedCuboidId !== c.id) setSelectedCuboid(c.id)
          return
        }
      }
    }

    // World position at scene depth, then snap to nearest armature node if
    // armature snap is on. Snap radius matches the existing face-drag UX so
    // pen-mode clicks click into the same composition anchors face-drag does.
    const wpRaw = unproject(cur, camera, sceneDepth, kind)
    const wp = maybeSnap(wpRaw, sceneDepth)

    // Append a new anchor or start a new draft.
    let draftId, anchorIndex, anchorPointWorld
    if (draft) {
      const local = sub3(wp, draft.center)
      const next = [...(draft.params?.anchors ?? []), { point: local }]
      updateCuboid(draft.id, { params: { ...(draft.params || {}), anchors: next } })
      draftId = draft.id
      anchorIndex = next.length - 1
      anchorPointWorld = wp
    } else {
      const newShape = makeShape({
        kind: 'polyline',
        center: wp,
        size: [1, 1, 1],
        params: { anchors: [{ point: [0, 0, 0] }], closed: false, segments: 16 },
      })
      addCuboid(newShape)
      setPenDraft(newShape.id)
      setSelectedCuboid(newShape.id)
      draftId = newShape.id
      anchorIndex = 0
      anchorPointWorld = wp
    }

    // Track this press so a click+drag converts the anchor to a smooth
    // point with mirrored tangents based on drag delta.
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'pen',
      draftId,
      anchorIndex,
      anchorPointWorld,
      depth: sceneDepth,
      captureEl: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  /**
   * Wheel / two-finger trackpad zoom — attached as a non-passive DOM listener
   * (React's `onWheel` defaults to passive, which silently ignores
   * preventDefault and lets the browser scroll the page instead). Standard
   * CAD pattern: scroll = dolly (change distance to pivot). Pinch (ctrlKey
   * on macOS trackpad) gets a tighter rate.
   */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    // macOS trackpad pinch fires `wheel` with ctrlKey:true (synthetic). On
    // Windows/Linux ctrl+wheel is a real ctrl-and-wheel for browser zoom — we
    // must NOT hijack that. Heuristic: smooth-scroll deltaMode 0 + small
    // delta is trackpad pinch; large-step deltaMode 0 or non-zero deltaMode
    // is a real wheel device.
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    const onWheel = (e) => {
      const isTrackpadPinch = e.ctrlKey && (isMac || (e.deltaMode === 0 && Math.abs(e.deltaY) < 50))
      if (e.ctrlKey && !isTrackpadPinch) return // let browser zoom
      e.preventDefault()
      const knobsNow = useScene.getState().knobs
      const rate = isTrackpadPinch ? 0.01 : 0.0015
      const factor = Math.exp(e.deltaY * rate)
      useScene.getState().setKnobs({ distance: knobsNow.distance * factor })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * Take a candidate world point being dragged at `depth`, project it,
   * and if snap is enabled and a composition node is within the snap
   * radius (in viewBox px), substitute the snapped image position. Returns
   * the (possibly-snapped) world point.
   */
  const maybeSnap = (worldPoint, depth) => {
    if (!armatureOn || !armature.snap || aNodes.length === 0) return worldPoint
    const ip = project(worldPoint, camera, kind)
    if (!ip) return worldPoint
    const [px, py] = toPx(ip)
    const hit = nearestNode({ x: px, y: py }, aNodes, armature.snapRadiusPx)
    if (!hit) return worldPoint
    return unproject(fromPx([hit.x, hit.y]), camera, depth, kind)
  }

  const onMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    // Push the pre-gesture state to undo history once per drag, on the
    // first move tick that actually mutates. Marquee (selection-only)
    // skipped — undoing a marquee select would surprise users. Pen-
    // click and tangent-toggle paths handle their own pushHistory at
    // the click site since they mutate immediately, not via onMove.
    if (!drag.historyPushed && drag.kind !== 'marquee' && drag.kind !== 'pen') {
      useScene.getState().pushHistory()
      drag.historyPushed = true
    }
    // Suspend CSG re-eval during a drag — keeps drag-tick re-renders
    // cheap by returning the cached boolean mesh even when an operand
    // moves. On pointerup we clear the flag so the next render runs a
    // fresh eval with the final operand state.
    setCsgDragSuspended(true)
    const cur = eventToImage(e)
    if (drag.kind === 'face') {
      const wStart = unproject(drag.startMouseImg, camera, drag.depth, kind)
      const wCur = unproject(cur, camera, drag.depth, kind)
      const worldDelta = sub3(wCur, wStart)
      const naive = add3(drag.startCenter, worldDelta)
      updateCuboid(drag.id, { center: maybeSnap(naive, drag.depth) })
    } else if (drag.kind === 'face-multi') {
      // Apply the same world delta to every captured target's start
      // center so the multi-selection translates as a rigid group.
      const wStart = unproject(drag.startMouseImg, camera, drag.depth, kind)
      const wCur = unproject(cur, camera, drag.depth, kind)
      const worldDelta = sub3(wCur, wStart)
      for (const t of drag.targets) {
        updateCuboid(t.id, { center: add3(t.startCenter, worldDelta) })
      }
    } else if (drag.kind === 'scale') {
      const curVb = clientToVb(e)
      const curDist = Math.hypot(curVb[0] - drag.pivotPx[0], curVb[1] - drag.pivotPx[1])
      const factor = Math.max(0.01, curDist / drag.startDist)
      for (const t of drag.targets) {
        const patch = {
          size: [t.startSize[0] * factor, t.startSize[1] * factor, t.startSize[2] * factor],
          center: [
            drag.pivot[0] + (t.startCenter[0] - drag.pivot[0]) * factor,
            drag.pivot[1] + (t.startCenter[1] - drag.pivot[1]) * factor,
            drag.pivot[2] + (t.startCenter[2] - drag.pivot[2]) * factor,
          ],
        }
        // Mirror store.scaleShape's deformation/anchor scaling so node-
        // mode edits and polyline curves stay proportional.
        if (t.startVertexOffsets) {
          patch.vertexOffsets = t.startVertexOffsets.map((o) =>
            o ? [o[0] * factor, o[1] * factor, o[2] * factor] : o,
          )
        }
        if (t.startParams && t.startParams.anchors) {
          const nextParams = { ...t.startParams }
          nextParams.anchors = t.startParams.anchors.map((a) => {
            const r = { point: [a.point[0] * factor, a.point[1] * factor, a.point[2] * factor] }
            if (a.in) r.in = [a.in[0] * factor, a.in[1] * factor, a.in[2] * factor]
            if (a.out) r.out = [a.out[0] * factor, a.out[1] * factor, a.out[2] * factor]
            return r
          })
          patch.params = nextParams
        }
        if (t.startParams && t.startParams.vertices) {
          // Frozen-mesh shapes — scale local vertices + face centroids
          // around their own origin. The shape's center moves outward
          // from the pivot via the existing patch.center logic.
          const nextParams = { ...(patch.params ?? t.startParams) }
          nextParams.vertices = t.startParams.vertices.map((v) =>
            [v[0] * factor, v[1] * factor, v[2] * factor],
          )
          nextParams.faces = (t.startParams.faces || []).map((f) => ({
            ...f,
            centroid: [f.centroid[0] * factor, f.centroid[1] * factor, f.centroid[2] * factor],
          }))
          patch.params = nextParams
        }
        updateCuboid(t.id, patch)
      }
    } else if (drag.kind === 'corner') {
      const wStart = unproject(drag.startMouseImg, camera, drag.depth, kind)
      const wCur = unproject(cur, camera, drag.depth, kind)
      const worldDelta = sub3(wCur, wStart)
      const naiveVertex = add3(drag.startVertex, worldDelta)
      const newVertex = maybeSnap(naiveVertex, drag.depth)
      // Center is the midpoint of the two world-space corners (dragged +
      // opposite-anchor), unchanged by rotation. Size is the magnitude of
      // the diagonal IN LOCAL FRAME — for unrotated boxes that's the same
      // as the world delta, but for rotated boxes the world diagonal has
      // off-axis components that local-frame mapping unwinds. The
      // rotation matrix itself stays put.
      const center = scale3(add3(newVertex, drag.startOpposite), 0.5)
      const worldDiag = sub3(newVertex, drag.startOpposite)
      const localDiag = applyMat3Transpose(drag.startRotation, worldDiag)
      const size = [Math.abs(localDiag[0]), Math.abs(localDiag[1]), Math.abs(localDiag[2])]
      updateCuboid(drag.id, { center, size })
    } else if (drag.kind === 'bend') {
      const wStart = unproject(drag.startMouseImg, camera, drag.depth, kind)
      const wCur = unproject(cur, camera, drag.depth, kind)
      const worldDelta = sub3(wCur, wStart)
      // (4/3) factor places the bezier midpoint at the cursor when both
      // flanking tangents point the same direction (out_A == in_B).
      const tangentLocal = applyMat3Transpose(
        drag.startRotation,
        scale3(worldDelta, 4 / 3),
      )
      const target = cuboids.find((c) => c.id === drag.id)
      if (!target) return
      const nextAnchors = (target.params?.anchors ?? []).map((a, i) => {
        if (i === drag.edgeIndex) return { ...a, out: tangentLocal }
        if (i === drag.nextIdx) return { ...a, in: tangentLocal }
        return a
      })
      updateCuboid(drag.id, { params: { ...(target.params || {}), anchors: nextAnchors } })
    } else if (drag.kind === 'node-vertex') {
      // Move just this single corner. Compute the desired world position,
      // then express it as a local-space offset from the clean default
      // vertex so rotations / translations of the whole shape continue
      // to behave normally.
      const wCur = unproject(cur, camera, drag.depth, kind)
      const newWorld = maybeSnap(wCur, drag.depth)
      const worldOffset = sub3(newWorld, drag.defaultVertex)
      const localOffset = applyMat3Transpose(drag.startRotation, worldOffset)
      const target = cuboids.find((c) => c.id === drag.id)
      if (!target) return
      const totalLen = verticesOf({ ...target, vertexOffsets: undefined }).length
      const base = drag.startOffsets ?? Array(totalLen).fill([0, 0, 0])
      const next = base.map((o, i) => (i === drag.vIndex ? localOffset : (o ?? [0, 0, 0])))
      updateCuboid(drag.id, { vertexOffsets: next })
    } else if (drag.kind === 'vertex') {
      const wCur = unproject(cur, camera, drag.depth, kind)
      const snapped = maybeSnap(wCur, drag.depth)
      // Convert world position back to local: subtract center, then apply
      // the inverse rotation (transpose for orthonormal matrices).
      const offset = sub3(snapped, drag.startCenter)
      const local = applyMat3Transpose(drag.startRotation, offset)
      const target = cuboids.find((c) => c.id === drag.id)
      if (!target) return
      const nextAnchors = (target.params?.anchors ?? []).map((a, i) =>
        i === drag.vertexIndex ? { ...a, point: local } : a,
      )
      updateCuboid(drag.id, { params: { ...(target.params || {}), anchors: nextAnchors } })
    } else if (drag.kind === 'marquee') {
      const cur = clientToVb(e)
      setMarqueeRect({
        x0: drag.startVb[0],
        y0: drag.startVb[1],
        x1: cur[0],
        y1: cur[1],
      })
    } else if (drag.kind === 'pen') {
      // Click+drag during pen-down → set the just-placed anchor's `out`
      // tangent based on world-space drag delta, mirror to `in` for a
      // smooth point. Pointerup (endDrag) commits.
      const wCur = unproject(cur, camera, drag.depth, kind)
      const tangentWorld = sub3(wCur, drag.anchorPointWorld)
      // Threshold: ignore micro-movements so plain clicks stay corner-anchors.
      const lenSq = tangentWorld[0]*tangentWorld[0] + tangentWorld[1]*tangentWorld[1] + tangentWorld[2]*tangentWorld[2]
      if (lenSq < 0.0025) return // < 0.05 world units; below this, treat as click
      const target = cuboids.find((c) => c.id === drag.draftId)
      if (!target) return
      const M = target.rotation || IDENT3
      let tangentLocal = applyMat3Transpose(M, tangentWorld)
      // Shift held during pen drag → axis-lock the tangent to its
      // dominant local axis. Standard Illustrator pen behavior;
      // produces clean horizontal / vertical / depth-aligned curves.
      if (e.shiftKey) {
        const ax = Math.abs(tangentLocal[0])
        const ay = Math.abs(tangentLocal[1])
        const az = Math.abs(tangentLocal[2])
        if (ax >= ay && ax >= az) tangentLocal = [tangentLocal[0], 0, 0]
        else if (ay >= ax && ay >= az) tangentLocal = [0, tangentLocal[1], 0]
        else tangentLocal = [0, 0, tangentLocal[2]]
      }
      const next = (target.params?.anchors ?? []).map((a, i) => {
        if (i !== drag.anchorIndex) return a
        return {
          ...a,
          out: tangentLocal,
          in: [-tangentLocal[0], -tangentLocal[1], -tangentLocal[2]],
        }
      })
      updateCuboid(drag.draftId, { params: { ...(target.params || {}), anchors: next } })
    } else if (drag.kind === 'tangent') {
      const wCur = unproject(cur, camera, drag.depth, kind)
      // World tangent-tip → local tangent-tip → tangent offset = tip - anchor.point
      const offset = sub3(wCur, drag.startCenter)
      const localTip = applyMat3Transpose(drag.startRotation, offset)
      const tangent = sub3(localTip, drag.startAnchorPoint)
      const target = cuboids.find((c) => c.id === drag.id)
      if (!target) return
      const nextAnchors = (target.params?.anchors ?? []).map((a, i) => {
        if (i !== drag.vertexIndex) return a
        const next = { ...a }
        if (drag.which === 'in') {
          next.in = tangent
          if (drag.mirror) next.out = [-tangent[0], -tangent[1], -tangent[2]]
        } else {
          next.out = tangent
          if (drag.mirror) next.in = [-tangent[0], -tangent[1], -tangent[2]]
        }
        return next
      })
      updateCuboid(drag.id, { params: { ...(target.params || {}), anchors: nextAnchors } })
    } else if (drag.kind === 'horizon') {
      setKnobs({ pitchDeg: pitchFromHorizonY(cur[1], camera.focal) })
    } else if (drag.kind === 'scene') {
      const wStart = unproject(drag.startMouseImg, camera, drag.depth, kind)
      const wCur = unproject(cur, camera, drag.depth, kind)
      const worldDelta = sub3(wCur, wStart)
      setScene({ center: add3(drag.startCenter, worldDelta) })
    } else if (drag.kind === 'pan') {
      const dx = cur[0] - drag.startMouseImg[0]
      const dy = cur[1] - drag.startMouseImg[1]
      const sx = (dx * drag.refDepth) / drag.startFocal
      const sy = (dy * drag.refDepth) / drag.startFocal
      const worldDelta = add3(
        scale3(drag.startRight, -sx),
        scale3(drag.startUp, -sy),
      )
      setKnobs({ pivot: add3(drag.startPivot, worldDelta) })
    } else if (drag.kind === 'vp') {
      // Relative orbit gesture, with fixed pixel-to-degree gains. Per-axis
      // mapping so dragging an axis line moves *that* axis intuitively:
      //   X axis → yaw (and a bit of pitch)
      //   Y axis → pitch only (the Y axis line is vertical in image space)
      //   Z axis → -yaw (Z VP sits opposite X VP) plus pitch
      const dx = e.clientX - drag.startClient[0]
      const dy = e.clientY - drag.startClient[1]
      const yawSens = 0.25 // deg/px
      const pitchSens = 0.2
      let yawDeg = drag.startYaw
      let pitchDeg = drag.startPitch + dy * pitchSens
      if (drag.axis === 'x') yawDeg += dx * yawSens
      else if (drag.axis === 'z') yawDeg -= dx * yawSens
      setKnobs({ yawDeg, pitchDeg })
    } else if (drag.kind === 'rotate') {
      // Shift+drag: combined yaw + pitch on local Y and X axes, composed via matrix.
      const dx = e.clientX - drag.startClient[0]
      const dy = e.clientY - drag.startClient[1]
      const sens = 0.5
      const local = mat3Mul(rotMat('y', dx * sens), rotMat('x', dy * sens))
      updateCuboid(drag.id, { rotation: mat3Mul(drag.startRotation, local) })
    } else if (drag.kind === 'gimbal') {
      // Angular sweep around the cuboid's projected center.
      const svg = svgRef.current
      const rect = svg.getBoundingClientRect()
      const vbX = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W
      const vbY = ((e.clientY - rect.top) / rect.height) * VIEWBOX_H
      const ang = Math.atan2(vbY - drag.centerPx[1], vbX - drag.centerPx[0])
      let dDeg = ((ang - drag.startAngle) * 180) / Math.PI
      while (dDeg > 180) dDeg -= 360
      while (dDeg < -180) dDeg += 360
      updateCuboid(drag.id, {
        rotation: mat3Mul(drag.startRotation, rotMat(drag.axis, dDeg * drag.sign)),
      })
    } else if (drag.kind === 'orbit') {
      const dx = e.clientX - drag.startClient[0]
      const dy = e.clientY - drag.startClient[1]
      setKnobs({
        yawDeg: drag.startYaw + dx * 0.3,
        pitchDeg: drag.startPitch + dy * 0.25,
      })
    }
  }

  const endDrag = (e) => {
    const drag = dragRef.current
    if (!drag) return
    // Marquee commit: hit-test every visible shape's projected bbox
    // against the marquee rect. Shape's vertex set comes from
    // `verticesOf` (sampled mesh verts for boxes / arcs / polylines /
    // etc.); the bbox of those projected points is what we test.
    if (drag.kind === 'marquee' && marqueeRect) {
      const x1 = Math.min(marqueeRect.x0, marqueeRect.x1)
      const y1 = Math.min(marqueeRect.y0, marqueeRect.y1)
      const x2 = Math.max(marqueeRect.x0, marqueeRect.x1)
      const y2 = Math.max(marqueeRect.y0, marqueeRect.y1)
      const hits = []
      for (const c of visibleCuboids) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        let any = false
        for (const v of verticesOf(c)) {
          const ip = project(v, camera, kind)
          if (!ip) continue
          any = true
          const [px, py] = toPx(ip)
          if (px < minX) minX = px
          if (py < minY) minY = py
          if (px > maxX) maxX = px
          if (py > maxY) maxY = py
        }
        if (any && maxX >= x1 && minX <= x2 && maxY >= y1 && minY <= y2) {
          hits.push(c.id)
        }
      }
      const next = drag.additive
        ? Array.from(new Set([...drag.startSelection, ...hits]))
        : hits
      setSelection(next)
      setMarqueeRect(null)
    }
    // Release on the element that received the capture, not on the SVG root
    // (which never had it). Browser auto-releases on pointerup, but
    // pointercancel arriving without a paired pointerup needs the explicit
    // release on the right element.
    const el = drag.captureEl ?? e.currentTarget
    el?.releasePointerCapture?.(drag.pointerId ?? e.pointerId)
    dragRef.current = null
    setCsgDragSuspended(false)
    setActiveGimbalAxis(null)
  }

  const horizonY = isPinhole ? horizonImageY(camera) : null
  const horizonPx = horizonY === null ? null : VIEWBOX_H / 2 - horizonY * SCALE

  // segments per render group: each entry is { runs: pixel-space polylines, key }.
  // For pinhole, every run is a 2-point straight segment; for curved projections
  // each run is a sampled polyline that approximates the curved image of the
  // straight world line.
  const SEGMENTS_PER_LINE = isPinhole ? 2 : 28
  const linesToRuns = (worldSegments, prefix) =>
    worldSegments.flatMap(([a, b], i) => {
      const runs = projectPolyline(a, b, camera, kind, SEGMENTS_PER_LINE)
      return runs.map((run, ri) => ({
        runs: run.map(toPx),
        key: `${prefix}-${i}-${ri}`,
      }))
    })

  // ---- world ground grid (y=0 plane) ----
  let groundRuns = []
  if (overlay.groundGrid) {
    const ext = overlay.gridExtent
    const step = overlay.gridStep
    /** @type {[import('../../math/vec.js').Vec3, import('../../math/vec.js').Vec3][]} */
    const segs = []
    for (let k = -ext; k <= ext + 1e-9; k += step) {
      segs.push([[k, 0, -ext], [k, 0, ext]])
      segs.push([[-ext, 0, k], [ext, 0, k]])
    }
    groundRuns = linesToRuns(segs, 'g')
  }

  // ---- scene frame (positioned, finite reference box) ----
  let sceneFloorRuns = []
  let sceneBoxRuns = []
  /** @type {[number, number] | null} */
  let sceneAnchorPx = null
  if (scene.show) {
    if (scene.showFloor) sceneFloorRuns = linesToRuns(floorGridLines(scene), 'sf')
    if (scene.showBox) sceneBoxRuns = linesToRuns(boxEdges(scene), 'sb')
    if (scene.showAnchor) {
      const ip = project(scene.center, camera, kind)
      if (ip) sceneAnchorPx = toPx(ip)
    }
  }

  // ---- vanishing points (X / Y / Z axes) ---- VP_AXES + VP_PX_LIMIT live
  // at module scope so memoized children depending on `vps` get stable deps.
  /**
   * Clamp a VP to the viewBox edge. Returns where to draw the marker, plus
   * an offscreen flag and the original direction (so we can draw a chevron
   * pointing toward the true VP position).
   */
  const clampToEdge = ([x, y]) => {
    const PAD = 14
    const W = VIEWBOX_W
    const H = VIEWBOX_H
    const inside = x >= PAD && x <= W - PAD && y >= PAD && y <= H - PAD
    if (inside) return { x, y, offscreen: false, angleDeg: 0 }
    const cx = W / 2
    const cy = H / 2
    const dx = x - cx
    const dy = y - cy
    if (dx === 0 && dy === 0) return { x: cx, y: cy, offscreen: false, angleDeg: 0 }
    const ts = []
    if (dx !== 0) ts.push((dx > 0 ? W - PAD - cx : PAD - cx) / dx)
    if (dy !== 0) ts.push((dy > 0 ? H - PAD - cy : PAD - cy) / dy)
    const t = Math.min(...ts.filter((v) => v > 0))
    return {
      x: cx + t * dx,
      y: cy + t * dy,
      offscreen: true,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    }
  }
  // ---- gimbal (rotation rings on the selected cuboid) ----
  const GIMBAL_AXES = /** @type {const} */ ([
    { axis: 'x', color: '#dc2626' }, // red
    { axis: 'y', color: '#16a34a' }, // green
    { axis: 'z', color: '#2563eb' }, // blue
  ])
  const GIMBAL_SEGMENTS = 36
  const ringLocalPoints = (axis, radius) => {
    const out = []
    for (let i = 0; i <= GIMBAL_SEGMENTS; i++) {
      const t = (i / GIMBAL_SEGMENTS) * Math.PI * 2
      const c = Math.cos(t) * radius
      const s = Math.sin(t) * radius
      out.push(
        axis === 'x' ? [0, c, s] :
        axis === 'y' ? [c, 0, s] :
                       [c, s, 0],
      )
    }
    return out
  }
  // Hidden cuboids must NOT show gizmo / corner handles — otherwise the
  // user gets invisible-but-grabbable controls floating in space.
  const selectedCuboid = selectedCuboidId
    ? cuboids.find((c) => c.id === selectedCuboidId && !c.hidden)
    : null
  const gimbalRings = []
  if (selectedCuboid) {
    const { center, size, rotation } = selectedCuboid
    const radius = (Math.max(size[0], size[1], size[2]) / 2) * 1.25
    for (const { axis, color } of GIMBAL_AXES) {
      const localPts = ringLocalPoints(axis, radius)
      const M = rotation || IDENT3
      const worldPts = localPts.map((p) => {
        const r = applyMat3(M, p)
        return [center[0] + r[0], center[1] + r[1], center[2] + r[2]]
      })
      // Subdivide each consecutive pair through projectPolyline so the ring
      // curves correctly in non-pinhole projections.
      const runs = []
      for (let i = 0; i < worldPts.length - 1; i++) {
        const polylines = projectPolyline(worldPts[i], worldPts[i + 1], camera, kind, isPinhole ? 1 : 4)
        for (const r of polylines) runs.push(r)
      }
      gimbalRings.push({ axis, color, runs })
    }
  }

  // VPs only exist in pinhole — cylindrical/spherical have no convergence
  // points for arbitrary world directions (lines bend instead). Memoized so
  // memo'd children reading `vps` (e.g. CuboidConstructionLines) only
  // re-render when camera changes, not on every drag tick.
  const vps = useMemo(
    () => (isPinhole
      ? VP_AXES.map((axis) => {
          const ip = vanishingPoint(axis.dir, camera)
          if (!ip) return { ...axis, px: null, edge: null }
          const [x, y] = toPx(ip)
          if (Math.abs(x) > VP_PX_LIMIT || Math.abs(y) > VP_PX_LIMIT) return { ...axis, px: null, edge: null }
          return { ...axis, px: [x, y], edge: clampToEdge([x, y]) }
        })
      : []),
    [isPinhole, camera],
  )

  return (
    <svg
      ref={svgRef}
      data-studio-svg=""
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      xmlns="http://www.w3.org/2000/svg"
      className="block w-full h-full select-none"
      // Inherit the body cursor (set by App.jsx#TOOL_CURSORS based on
      // active tool) so V / A / K / P each show their dedicated glyph
      // over the canvas. Without `cursor: inherit`, the SVG falls back
      // to the browser's default arrow and the tool cursor only shows
      // off-canvas. Per-element cursors (cursor-grab on faces,
      // cursor-move on anchor handles, cursor-ns-resize on the horizon
      // hit-zone) still override on hover via specificity — those are
      // intentional affordances within select / node modes.
      style={{ cursor: 'inherit' }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragStart={(e) => e.preventDefault()}
    >

      {backgroundLayers.map((bg) => {
        const p = bg.params || {}
        if (p.mode === 'solid') {
          return (
            <rect
              key={`bg-${bg.id}`}
              data-bg=""
              x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H}
              fill={p.solidColor ?? '#000'}
              opacity={p.opacity ?? 1}
              pointerEvents="none"
            />
          )
        }
        return (
          <image
            key={`bg-${bg.id}`}
            data-bg=""
            href={p.url}
            x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H}
            opacity={p.opacity ?? 0.5}
            preserveAspectRatio={(p.fit ?? 'cover') === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
            pointerEvents="none"
            draggable={false}
            style={{ pointerEvents: 'none', WebkitUserDrag: 'none', userSelect: 'none' }}
          />
        )
      })}

      {overlay.groundGrid && groundRuns.length > 0 && (
        <g stroke="var(--kol-surface-on-tertiary)" strokeWidth="0.5" fill="none" opacity="0.4" pointerEvents="none">
          {groundRuns.map(({ runs, key }) => (
            <polyline key={`grid-${key}`} points={runs.map(([x, y]) => `${x},${y}`).join(' ')} />
          ))}
        </g>
      )}

      {sceneFloorRuns.length > 0 && (
        <g stroke="var(--kol-surface-on-tertiary)" strokeWidth="0.6" fill="none" opacity="0.4" pointerEvents="none">
          {sceneFloorRuns.map(({ runs, key }) => (
            <polyline key={key} points={runs.map(([x, y]) => `${x},${y}`).join(' ')} />
          ))}
        </g>
      )}

      {sceneBoxRuns.length > 0 && (
        <g stroke="var(--kol-surface-on-tertiary)" strokeWidth="0.85" fill="none" opacity="0.55" pointerEvents="none" strokeDasharray="4 3">
          {sceneBoxRuns.map(({ runs, key }) => (
            <polyline key={key} points={runs.map(([x, y]) => `${x},${y}`).join(' ')} />
          ))}
        </g>
      )}

      {overlay.construction &&
        visibleCuboids
          // Linework shapes (arcs, polylines) — construction lines from N
          // sampled points to every VP would be a noise field, not a
          // useful overlay. csg results have many irregular vertices for
          // the same reason — skip.
          .filter((c) => c.kind !== 'arc' && c.kind !== 'polyline' && c.kind !== 'csg' && c.kind !== 'mesh')
          .map((c) => (
            <CuboidConstructionLines
              key={`cons-${c.id}`}
              cuboid={c}
              camera={camera}
              kind={kind}
              isPinhole={isPinhole}
              vps={vps}
            />
          ))}

      {armatureOn && armature.showLines && (
        <g stroke="#aa3bff" strokeWidth="0.6" opacity="0.45" pointerEvents="none">
          {aLines.map((l, i) => (
            <line key={`arm-l-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
          ))}
        </g>
      )}

      {isPinhole && horizonPx !== null && horizonPx >= -200 && horizonPx <= VIEWBOX_H + 200 && (
        <g>
          {/* invisible wide hit area for easier grabbing */}
          <line
            x1={-1000}
            y1={horizonPx}
            x2={VIEWBOX_W + 1000}
            y2={horizonPx}
            stroke="transparent"
            strokeWidth="14"
            className="cursor-ns-resize"
            onPointerDown={startHorizonDrag}
          />
          <line
            x1={-1000}
            y1={horizonPx}
            x2={VIEWBOX_W + 1000}
            y2={horizonPx}
            stroke="var(--kol-surface-on-tertiary)"
            strokeOpacity="0.25"
            strokeWidth="0.75"
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        </g>
      )}

      {visibleFaces.map((f, i) => {
        const pts = projectPoly(f.vertices, camera, kind, SEGMENTS_PER_LINE)
        if (!pts) return null
        // Per-shape fill via cuboid.style.fill — defaults to the theme
        // surface tone when unset.
        const owner = cuboids.find((c) => c.id === f.shapeId)
        const fill = owner?.style?.fill ?? 'var(--kol-surface-primary)'
        const opacity = owner?.style?.opacity ?? 1
        return (
          <polygon
            key={`${f.shapeId}-${f.normal}-${i}`}
            points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={fill}
            opacity={opacity}
            stroke="none"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={startFaceDrag(f.shapeId)}
            onContextMenu={(e) => {
              e.preventDefault()
              removeCuboid(f.shapeId)
            }}
          />
        )
      })}

      {visibleCuboids.map((c) =>
        c.kind === 'csg' ? (
          <CsgEdges key={c.id} cuboid={c} camera={camera} kind={kind} shapesById={shapesById} />
        ) : (
          <CuboidEdges key={c.id} cuboid={c} camera={camera} kind={kind} />
        ),
      )}

      {/* Gimbal rings — available in select (V) and node (A) modes so the
        * user can rotate the whole shape while still doing per-anchor
        * edits in node mode. Hidden in pen (P) mode: pen is for drawing
        * anchors + bezier curves, not transforming existing shapes. */}
      {tool !== 'pen' && tool !== 'scale' && selectedCuboid && gimbalRings.map(({ axis, color, runs }) => {
        const active = activeGimbalAxis === axis
        const hover = !active && hoverGimbalAxis === axis
        const strokeWidth = active ? 3.5 : hover ? 2.5 : 1.5
        const strokeOpacity = active ? 1 : hover ? 0.95 : 0.55
        return (
          <g key={`gimbal-${axis}`}>
            {/* fat invisible hit polylines per run for grabbing + hover-tracking */}
            {runs.map((run, i) => (
              <polyline
                key={`gimbal-hit-${axis}-${i}`}
                points={run.map(toPx).map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="transparent"
                strokeWidth="14"
                strokeLinecap="round"
                className="cursor-move"
                onPointerDown={startGimbalDrag(selectedCuboid.id, axis)}
                onPointerEnter={() => setHoverGimbalAxis(axis)}
                onPointerLeave={() => setHoverGimbalAxis((a) => (a === axis ? null : a))}
              />
            ))}
            {/* visible ring — three states: idle / hover / active */}
            {runs.map((run, i) => (
              <polyline
                key={`gimbal-ring-${axis}-${i}`}
                points={run.map(toPx).map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                style={active ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined}
                pointerEvents="none"
              />
            ))}
          </g>
        )
      })}

      {snapshots.length > 0 &&
        snapshots.map((url, i) => (
          <image
            key={`snap-${i}`}
            data-snapshot=""
            href={url}
            x={0}
            y={0}
            width={VIEWBOX_W}
            height={VIEWBOX_H}
            opacity={0.35}
            preserveAspectRatio="none"
            pointerEvents="none"
            draggable={false}
            style={{ pointerEvents: 'none', WebkitUserDrag: 'none', userSelect: 'none' }}
          />
        ))}

      {scene.show && scene.showAnchor && sceneAnchorPx !== null && (
        <g>
          <circle
            cx={sceneAnchorPx[0]}
            cy={sceneAnchorPx[1]}
            r={11}
            fill="transparent"
            stroke="#aa3bff"
            strokeWidth="1.25"
            strokeOpacity="0.85"
            className="cursor-move"
            onPointerDown={startSceneDrag}
          />
          <circle
            cx={sceneAnchorPx[0]}
            cy={sceneAnchorPx[1]}
            r={2.5}
            fill="#aa3bff"
            pointerEvents="none"
          />
          <line
            x1={sceneAnchorPx[0] - 16}
            y1={sceneAnchorPx[1]}
            x2={sceneAnchorPx[0] - 4}
            y2={sceneAnchorPx[1]}
            stroke="#aa3bff"
            strokeWidth="1"
            pointerEvents="none"
          />
          <line
            x1={sceneAnchorPx[0] + 4}
            y1={sceneAnchorPx[1]}
            x2={sceneAnchorPx[0] + 16}
            y2={sceneAnchorPx[1]}
            stroke="#aa3bff"
            strokeWidth="1"
            pointerEvents="none"
          />
          <line
            x1={sceneAnchorPx[0]}
            y1={sceneAnchorPx[1] - 16}
            x2={sceneAnchorPx[0]}
            y2={sceneAnchorPx[1] - 4}
            stroke="#aa3bff"
            strokeWidth="1"
            pointerEvents="none"
          />
          <line
            x1={sceneAnchorPx[0]}
            y1={sceneAnchorPx[1] + 4}
            x2={sceneAnchorPx[0]}
            y2={sceneAnchorPx[1] + 16}
            stroke="#aa3bff"
            strokeWidth="1"
            pointerEvents="none"
          />
        </g>
      )}

      {overlay.vps &&
        vps.map((vp) => {
          if (vp.px === null || vp.edge === null) return null
          const axisKey = vp.label.toLowerCase()
          const cx = VIEWBOX_W / 2
          const cy = VIEWBOX_H / 2
          // Where the marker sits visually: actual VP if onscreen, otherwise clamped to edge.
          const mx = vp.edge.offscreen ? vp.edge.x : vp.px[0]
          const my = vp.edge.offscreen ? vp.edge.y : vp.px[1]
          return (
            <g
              key={`vp-${vp.label}`}
              className="cursor-move"
              onPointerDown={startVPDrag(axisKey)}
            >
              {/* fat invisible hit line — entire axis is grabbable */}
              <line
                x1={cx}
                y1={cy}
                x2={mx}
                y2={my}
                stroke="transparent"
                strokeWidth="22"
                strokeLinecap="round"
              />
              {/* visible thin axis line */}
              <line
                x1={cx}
                y1={cy}
                x2={mx}
                y2={my}
                stroke={vp.color}
                strokeWidth="1"
                strokeOpacity="0.55"
                strokeDasharray="3 4"
                pointerEvents="none"
              />
              {/* marker at the end */}
              {vp.edge.offscreen ? (
                <>
                  <g transform={`translate(${mx},${my}) rotate(${vp.edge.angleDeg})`} pointerEvents="none">
                    <path d="M0,0 L-14,-7 L-14,7 Z" fill={vp.color} opacity="0.9" />
                  </g>
                  <text
                    x={mx}
                    y={my}
                    dx={-Math.cos((vp.edge.angleDeg * Math.PI) / 180) * 22}
                    dy={-Math.sin((vp.edge.angleDeg * Math.PI) / 180) * 22 + 4}
                    fontSize="10"
                    fontFamily="monospace"
                    textAnchor="middle"
                    fill={vp.color}
                    pointerEvents="none"
                  >
                    VP{vp.label}
                  </text>
                </>
              ) : (
                <>
                  <line x1={mx - 8} y1={my} x2={mx + 8} y2={my} stroke={vp.color} strokeWidth="1.5" pointerEvents="none" />
                  <line x1={mx} y1={my - 8} x2={mx} y2={my + 8} stroke={vp.color} strokeWidth="1.5" pointerEvents="none" />
                  <text
                    x={mx + 10}
                    y={my - 6}
                    fontSize="10"
                    fontFamily="monospace"
                    fill={vp.color}
                    pointerEvents="none"
                  >
                    VP{vp.label}
                  </text>
                </>
              )}
            </g>
          )
        })}

      {tool !== 'scale' && visibleCuboids
        // Corner-resize handles use box-style 8-vertex topology with
        // opposite-vertex anchoring. Linework shapes (arcs, polylines)
        // use free vertex lists where that pairing has no meaning;
        // csg / mesh shapes have arbitrary vertex counts and no axis-
        // aligned bounds → handles are meaningless.
        .filter((c) => c.kind !== 'arc' && c.kind !== 'polyline' && c.kind !== 'csg' && c.kind !== 'mesh')
        .flatMap((c) =>
          verticesOf(c).map((v, i) => {
            const ip = project(v, camera, kind)
            if (!ip) return null
            const [x, y] = toPx(ip)
            return (
              <circle
                key={`${c.id}-corner-${i}`}
                cx={x}
                cy={y}
                r={5}
                // White-fill in node mode telegraphs that nodes are
                // individually grabbable. Surface-primary (theme-tinted)
                // in select mode keeps boxes / pyramids reading as a
                // unit when the corner-drag does whole-shape resize.
                fill={tool === 'node' ? '#ffffff' : 'var(--kol-surface-primary)'}
                stroke={tool === 'node' ? '#aa3bff' : 'var(--kol-surface-on-tertiary)'}
                strokeWidth="1.25"
                className={tool === 'node' ? 'cursor-move' : (isPinhole ? 'cursor-nwse-resize' : 'cursor-default')}
                onPointerDown={startCornerDrag(c.id, i)}
              />
            )
          }),
        )}

      {/* Polyline edge hit zones (selected polyline only) — invisible
        * thick lines along each segment. Plain click selects the
        * polyline (useful when there's no face to grab); Cmd / Ctrl +
        * click + drag bends the segment into a curve. The hit zones
        * sit *under* the anchor / tangent handles in paint order so
        * those still win when overlapping. */}
      {selectedCuboid?.kind === 'polyline' && (() => {
        const c = selectedCuboid
        const anchors = c.params?.anchors ?? []
        const closed = !!c.params?.closed
        const M = c.rotation || IDENT3
        const numEdges = closed && anchors.length > 2 ? anchors.length : Math.max(0, anchors.length - 1)
        if (numEdges === 0) return null
        const toScreen = (local) => {
          const r = applyMat3(M, local)
          /** @type {import('../../math/vec.js').Vec3} */
          const wp = [c.center[0] + r[0], c.center[1] + r[1], c.center[2] + r[2]]
          const ip = project(wp, camera, kind)
          return ip ? toPx(ip) : null
        }
        return Array.from({ length: numEdges }, (_, i) => {
          const next = (i + 1) % anchors.length
          const a = toScreen(anchors[i].point)
          const b = toScreen(anchors[next].point)
          if (!a || !b) return null
          return (
            <line
              key={`${c.id}-bend-hit-${i}`}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke="transparent" strokeWidth="14"
              className="cursor-crosshair"
              onPointerDown={startBendOrSelect(c.id, i)}
            />
          )
        })
      })()}

      {/* Polyline anchor + tangent-handle UI.
        *
        * Visibility rules:
        *   V (select) tool — anchors + tangents on the SELECTED polyline only.
        *   A (node)   tool — anchors on EVERY visible polyline so the user
        *                     can grab any node directly. Tangents stay
        *                     scoped to the selected polyline (rendering
        *                     them on every shape would be a noise field).
        *
        * Anchor circle = drag to move that single point. Tangent handles
        * are smaller open circles connected by a thin dashed line; drag
        * mirrors the opposite handle by default, Alt breaks symmetry. */}
      {(() => {
        const polylineTargets = tool === 'node'
          ? visibleCuboids.filter((c) => c.kind === 'polyline')
          : (selectedCuboid?.kind === 'polyline' ? [selectedCuboid] : [])
        if (polylineTargets.length === 0) return null
        return polylineTargets.flatMap((c) => {
          const anchors = c.params?.anchors ?? []
          const M = c.rotation || IDENT3
          const showTangents = c.id === selectedCuboid?.id
          const toScreen = (local) => {
            const r = applyMat3(M, local)
            /** @type {import('../../math/vec.js').Vec3} */
            const wp = [c.center[0] + r[0], c.center[1] + r[1], c.center[2] + r[2]]
            const ip = project(wp, camera, kind)
            return ip ? toPx(ip) : null
          }
          return anchors.flatMap((a, i) => {
            const anchorPx = toScreen(a.point)
            if (!anchorPx) return []
            const els = []
            if (showTangents && a.in) {
              const tipPx = toScreen([a.point[0] + a.in[0], a.point[1] + a.in[1], a.point[2] + a.in[2]])
              if (tipPx) {
                els.push(
                  <line key={`${c.id}-tan-in-line-${i}`}
                    x1={anchorPx[0]} y1={anchorPx[1]} x2={tipPx[0]} y2={tipPx[1]}
                    stroke="#aa3bff" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.7"
                    pointerEvents="none"
                  />,
                  <circle key={`${c.id}-tan-in-${i}`}
                    cx={tipPx[0]} cy={tipPx[1]} r={3.5}
                    fill="var(--kol-surface-primary)" stroke="#aa3bff" strokeWidth="1"
                    className="cursor-move"
                    onPointerDown={startTangentDrag(c.id, i, 'in')}
                  />,
                )
              }
            }
            if (showTangents && a.out) {
              const tipPx = toScreen([a.point[0] + a.out[0], a.point[1] + a.out[1], a.point[2] + a.out[2]])
              if (tipPx) {
                els.push(
                  <line key={`${c.id}-tan-out-line-${i}`}
                    x1={anchorPx[0]} y1={anchorPx[1]} x2={tipPx[0]} y2={tipPx[1]}
                    stroke="#aa3bff" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.7"
                    pointerEvents="none"
                  />,
                  <circle key={`${c.id}-tan-out-${i}`}
                    cx={tipPx[0]} cy={tipPx[1]} r={3.5}
                    fill="var(--kol-surface-primary)" stroke="#aa3bff" strokeWidth="1"
                    className="cursor-move"
                    onPointerDown={startTangentDrag(c.id, i, 'out')}
                  />,
                )
              }
            }
            // Anchor itself, rendered last so it sits on top of tangent
            // ends. White fill in node mode signals "grab a single
            // node"; surface-primary (themed) in select mode keeps the
            // anchor visually subdued.
            const isSelectedShape = c.id === selectedCuboid?.id
            els.push(
              <circle key={`${c.id}-vertex-${i}`}
                cx={anchorPx[0]} cy={anchorPx[1]} r={5}
                fill={tool === 'node' ? '#ffffff' : 'var(--kol-surface-primary)'}
                stroke={isSelectedShape ? '#aa3bff' : 'var(--kol-surface-on-tertiary)'}
                strokeWidth={isSelectedShape ? 1.5 : 1}
                className="cursor-move"
                onPointerDown={startVertexDrag(c.id, i)}
              />,
            )
            return els
          })
        })
      })()}

      {lightLayers.map((lt) => {
        const ip = project(lt.center, camera, kind)
        if (!ip) return null
        const [x, y] = toPx(ip)
        const color = lt.params?.color ?? '#ffffff'
        const isSel = selectedCuboidId === lt.id
        return (
          <g key={`light-${lt.id}`} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); setSelectedCuboid(lt.id) }}>
            <circle cx={x} cy={y} r={isSel ? 9 : 7} fill={color} stroke="var(--kol-surface-on-tertiary)" strokeWidth="1" opacity={isSel ? 1 : 0.85} />
            {/* radial spokes — sun glyph */}
            {[0, 45, 90, 135].map((a) => {
              const r1 = isSel ? 12 : 10
              const r2 = isSel ? 17 : 14
              const rad = (a * Math.PI) / 180
              return (
                <line
                  key={`light-spoke-${lt.id}-${a}`}
                  x1={x + Math.cos(rad) * r1}
                  y1={y + Math.sin(rad) * r1}
                  x2={x + Math.cos(rad) * r2}
                  y2={y + Math.sin(rad) * r2}
                  stroke={color}
                  strokeWidth="1.25"
                  pointerEvents="none"
                />
              )
            })}
          </g>
        )
      })}

      {armatureOn && armature.showNodes && (
        <g fill="#aa3bff" pointerEvents="none">
          {aNodes.map((n, i) => (
            <circle key={`arm-n-${i}`} cx={n.x} cy={n.y} r={2 + n.weight} opacity="0.6" />
          ))}
        </g>
      )}

      {/* Marquee-select rectangle — visible during the drag, removed on
        * release. Filled with a low-alpha tint of the selection color so
        * shapes underneath are still legible. */}
      {marqueeRect && (
        <rect
          x={Math.min(marqueeRect.x0, marqueeRect.x1)}
          y={Math.min(marqueeRect.y0, marqueeRect.y1)}
          width={Math.abs(marqueeRect.x1 - marqueeRect.x0)}
          height={Math.abs(marqueeRect.y1 - marqueeRect.y0)}
          fill="rgba(170, 59, 255, 0.08)"
          stroke="#aa3bff"
          strokeWidth="1"
          strokeDasharray="3 2"
          pointerEvents="none"
        />
      )}

      {/* Pen-mode close-path target — dashed ring on the draft's first
        * anchor to telegraph the click-target for closing the loop. Only
        * shown when the draft has ≥ 2 anchors (one anchor can't close).
        * Rendered before the pen overlay rect so the rect's pointer
        * capture still wins; the ring is purely visual. */}
      {tool === 'pen' && penDraftId && (() => {
        const draft = cuboids.find((c) => c.id === penDraftId)
        const anchors = draft?.params?.anchors ?? []
        if (!draft || anchors.length < 2) return null
        const M = draft.rotation || IDENT3
        const r = applyMat3(M, anchors[0].point)
        /** @type {import('../../math/vec.js').Vec3} */
        const wp = [draft.center[0] + r[0], draft.center[1] + r[1], draft.center[2] + r[2]]
        const ip = project(wp, camera, kind)
        if (!ip) return null
        const [x, y] = toPx(ip)
        return (
          <g pointerEvents="none">
            <circle cx={x} cy={y} r={11} fill="none" stroke="#aa3bff" strokeWidth="1.25" strokeDasharray="3 2" opacity="0.85" />
            <circle cx={x} cy={y} r={3.5} fill="#aa3bff" opacity="0.85" />
          </g>
        )
      })()}

      {/* Pen rubber-band preview — dashed line from the last placed
        * anchor of the active draft to the cursor. Tells the user what
        * segment the next pen click will commit. */}
      {tool === 'pen' && penPreviewPx && penDraftId && (() => {
        const draft = cuboids.find((c) => c.id === penDraftId)
        const anchors = draft?.params?.anchors ?? []
        if (!draft || anchors.length === 0) return null
        const last = anchors[anchors.length - 1]
        const M = draft.rotation || IDENT3
        const r = applyMat3(M, last.point)
        /** @type {import('../../math/vec.js').Vec3} */
        const wp = [draft.center[0] + r[0], draft.center[1] + r[1], draft.center[2] + r[2]]
        const ip = project(wp, camera, kind)
        if (!ip) return null
        const [x0, y0] = toPx(ip)
        return (
          <line
            x1={x0} y1={y0}
            x2={penPreviewPx[0]} y2={penPreviewPx[1]}
            stroke="#aa3bff" strokeWidth="1" strokeDasharray="3 3"
            opacity="0.55" pointerEvents="none"
          />
        )
      })()}

      {/* Pen-mode overlay — full-canvas transparent intercept that
        * captures every pointerdown so pen clicks land regardless of which
        * inner element they're over. Rendered last (top of paint order)
        * so it sits above face polygons / corner handles / etc. Cursor
        * inherits from `<body>` (set in App.jsx via TOOL_CURSORS) so the
        * pen-shaped glyph shows here, not a generic crosshair. */}
      {tool === 'pen' && (
        <rect
          x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H}
          fill="transparent"
          style={{ cursor: 'inherit' }}
          onPointerDown={startPenDrag}
          onPointerMove={(e) => setPenPreviewPx(clientToVb(e))}
          onPointerLeave={() => setPenPreviewPx(null)}
        />
      )}

      {/* Scale-mode overlay — same pattern as pen: a full-canvas
        * transparent intercept on top of every shape / handle so the
        * body cursor (`nwse-resize` from TOOL_CURSORS) shows uniformly
        * regardless of what's underneath, and pointer-down on any pixel
        * starts the scale gesture instead of shape-specific drags. */}
      {tool === 'scale' && (
        <rect
          x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H}
          fill="transparent"
          style={{ cursor: 'inherit' }}
          onPointerDown={startScaleDrag}
        />
      )}
    </svg>
  )
}

export default SvgView
