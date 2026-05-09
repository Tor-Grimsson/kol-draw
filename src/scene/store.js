import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { presetCamera, cameraBasis } from '../math/camera.js'
import { makeCuboid, IDENT3 } from '../math/cuboid.js'
import { add3, scale3 } from '../math/vec.js'
import { ALL_INSERT_PRESETS, SCENE_PRESETS } from './presets.js'
import { validateVarName } from './expr.js'

/**
 * @typedef {'1pt'|'2pt'|'3pt'|'4pt'|'5pt'|'stereo'|'equi'|'ortho'} PerspectiveMode
 *
 * Pinhole family:
 *   1/2/3pt — same projection, different camera orientations.
 * Curved:
 *   4pt    = cylindrical (verticals straight, horizontals curve).
 *   5pt    = spherical equidistant fisheye (front + back hemispheres in one disk).
 *   stereo = stereographic fisheye (conformal — preserves angles, less squished).
 *   equi   = equirectangular (full 360°×180° longitude/latitude map).
 *   ortho  = orthographic (parallel projection, no foreshortening).
 *
 * @typedef {object} CameraKnobs
 * @property {number} distance   Eye-to-pivot distance.
 * @property {number} focal      Focal length (image-plane units per world unit at unit depth).
 * @property {number} yawDeg     Camera yaw (rotation around world Y).
 * @property {number} pitchDeg   Camera pitch (rotation around camera right axis). Positive tilts up; negative tilts down.
 * @property {import('../math/vec.js').Vec3} pivot   Look-at point — orbit centre / pan target.
 *
 * @typedef {object} ArmatureConfig
 * @property {import('../composition/armature.js').ArmatureSystem | 'none'} system
 * @property {boolean} showLines
 * @property {boolean} showNodes
 * @property {boolean} snap            Snap-while-dragging toggle.
 * @property {number}  snapRadiusPx    Snap radius in viewBox pixels.
 *
 * @typedef {object} OverlayConfig
 * @property {boolean} groundGrid       World y=0 grid (infinite reference, off by default).
 * @property {number}  gridExtent       Half-size of grid in world units.
 * @property {number}  gridStep         Cell size in world units.
 * @property {boolean} vps              Show vanishing-point markers.
 * @property {boolean} construction     Per-cuboid lines from corners to VPs.
 *
 * @typedef {object} SceneFrame
 * @property {import('../math/vec.js').Vec3} center   Composition's spatial anchor.
 * @property {import('../math/vec.js').Vec3} size     Box extents along x, y, z.
 * @property {number}  divisions                      Grid cell count along each face axis.
 * @property {boolean} show                           Master toggle.
 * @property {boolean} showFloor                      Floor (bottom face) grid.
 * @property {boolean} showBox                        Wireframe of the volume.
 * @property {boolean} showAnchor                     Center crosshair (drag handle).
 *
 * @typedef {'svg'|'three'|'split'} ViewMode
 *
 * @typedef {object} SceneState
 * @property {PerspectiveMode} mode
 * @property {CameraKnobs} knobs
 * @property {import('../math/camera.js').Camera} camera   Derived from mode + knobs.
 * @property {import('../math/cuboid.js').Cuboid[]} cuboids
 * @property {ArmatureConfig} armature
 * @property {OverlayConfig} overlay
 * @property {SceneFrame} scene
 * @property {ViewMode} viewMode
 * @property {string | null} selectedCuboidId                      Cuboid id to show the rotation gimbal on.
 * @property {(id: string | null) => void} setSelectedCuboid
 * @property {string[]} snapshots                                  Data URLs of captured SVG overlays.
 * @property {(url: string) => void} addSnapshot
 * @property {() => void} clearSnapshots
 * @property {(mode: PerspectiveMode) => void} setMode
 * @property {(patch: Partial<CameraKnobs>) => void} setKnobs
 * @property {(patch: Partial<ArmatureConfig>) => void} setArmature
 * @property {(patch: Partial<OverlayConfig>) => void} setOverlay
 * @property {(patch: Partial<SceneFrame>) => void} setScene
 * @property {(v: ViewMode) => void} setViewMode
 * @property {(c: import('../math/cuboid.js').Cuboid) => void} addCuboid
 * @property {() => void} addCuboidAtCamera
 * @property {(presetId: string) => void} addShapePreset
 * @property {(presetId: string) => void} loadScenePreset
 * @property {() => void} clearCuboids
 * @property {(id: string, patch: Partial<import('../math/cuboid.js').Cuboid>) => void} updateCuboid
 * @property {(id: string) => void} removeCuboid
 * @property {(id: string) => void} toggleCuboidVisibility
 * @property {(from: number, to: number) => void} reorderCuboid
 */

/** @type {Record<PerspectiveMode, CameraKnobs>} */
const KNOB_DEFAULTS = {
  '1pt':    { distance: 8, focal: 1.2, yawDeg: 0,  pitchDeg: 0,   pivot: [0, 0, 0] },
  '2pt':    { distance: 8, focal: 1.2, yawDeg: 30, pitchDeg: 0,   pivot: [0, 0, 0] },
  '3pt':    { distance: 8, focal: 1.2, yawDeg: 30, pitchDeg: -20, pivot: [0, 0, 0] },
  '4pt':    { distance: 8, focal: 1.4, yawDeg: 0,  pitchDeg: 0,   pivot: [0, 0, 0] },
  '5pt':    { distance: 8, focal: 1.0, yawDeg: 0,  pitchDeg: 0,   pivot: [0, 0, 0] },
  'stereo': { distance: 8, focal: 0.7, yawDeg: 0,  pitchDeg: 0,   pivot: [0, 0, 0] },
  'equi':   { distance: 8, focal: 0.4, yawDeg: 0,  pitchDeg: 0,   pivot: [0, 0, 0] },
  'ortho':  { distance: 8, focal: 1.0, yawDeg: 30, pitchDeg: -30, pivot: [0, 0, 0] },
}

/** @type {Record<PerspectiveMode, import('../math/project.js').ProjectionKind>} */
export const PROJECTION_KIND = {
  '1pt':    'pinhole',
  '2pt':    'pinhole',
  '3pt':    'pinhole',
  '4pt':    'cylindrical',
  '5pt':    'spherical',
  'stereo': 'stereographic',
  'equi':   'equirectangular',
  'ortho':  'orthographic',
}

const initialMode = '2pt'

const HISTORY_CAP = 50

/** Snapshot of all undo-relevant state. Captures references (no deep
 *  clone) — safe because the rest of the store uses immutable updates,
 *  so a snapshot reference stays valid for restoration. Excludes
 *  ephemeral state like `tool`, `viewMode`, `snapshots` (the SVG
 *  ghost overlays — different from history snapshots). */
const snap = (s) => ({
  cuboids: s.cuboids,
  selectedIds: s.selectedIds,
  selectedCuboidId: s.selectedCuboidId,
  knobs: s.knobs,
  mode: s.mode,
  camera: s.camera,
  scene: s.scene,
  armature: s.armature,
  overlay: s.overlay,
  penDraftId: s.penDraftId,
})

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<SceneState>>} */
export const useScene = create(persist((set) => ({
  mode: initialMode,
  knobs: { ...KNOB_DEFAULTS[initialMode] },
  camera: presetCamera(initialMode, KNOB_DEFAULTS[initialMode]),
  cuboids: [
    makeCuboid({ id: 'demo-a', center: [0, 0, 0], size: [2, 2, 2] }),
    makeCuboid({ id: 'demo-b', center: [3, -0.5, -1], size: [1.5, 1, 1.5] }),
  ],

  armature: { system: 'none', showLines: true, showNodes: true, snap: true, snapRadiusPx: 18 },

  overlay: {
    groundGrid: false,
    gridExtent: 10,
    gridStep: 1,
    vps: true,
    construction: true,
  },

  scene: {
    center: [0, -1, 0],
    size: [8, 4, 6],
    divisions: 8,
    show: true,
    showFloor: false,
    showBox: false,
    showAnchor: true,
  },

  viewMode: 'svg',
  setViewMode: (v) => set({ viewMode: v }),

  // Multi-select model. `selectedIds` is the source of truth (an array
  // of cuboid ids). `selectedCuboidId` is kept as a mirror of
  // `selectedIds[0] ?? null` for read-compat with the many call sites
  // that only need a single selection (Inspector, gimbal, TransformControls).
  // All write paths must update both atomically — call `setSelection` /
  // `setSelectedCuboid` / `toggleSelection` rather than mutating fields
  // directly.
  selectedIds: [],
  selectedCuboidId: null,
  setSelectedCuboid: (id) => set({
    selectedIds: id ? [id] : [],
    selectedCuboidId: id,
  }),
  setSelection: (ids) => set({
    selectedIds: ids,
    selectedCuboidId: ids[0] ?? null,
  }),
  toggleSelection: (id) => set((s) => {
    const has = s.selectedIds.includes(id)
    const next = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
    return { selectedIds: next, selectedCuboidId: next[0] ?? null }
  }),

  // Undo / redo history — snapshot-based. `past` and `future` are stacks
  // of state captures; user-initiated mutations push the pre-mutation
  // state to `past` and clear `future`, so we can step backwards
  // through history. Capped at HISTORY_CAP entries.
  //
  // Drag-driven mutations (face translate, gimbal rotate, vertex move,
  // tangent edit, etc.) snapshot ONCE at drag-start via `pushHistory`,
  // not per drag-tick — otherwise a single move would create 60 entries
  // per second. Structural mutations (add / remove / reorder / toggle
  // visibility / preset load) auto-snapshot inside the action below.
  history: { past: [], future: [] },
  pushHistory: () => set((s) => {
    const past = [...s.history.past, snap(s)]
    if (past.length > HISTORY_CAP) past.shift()
    return { history: { past, future: [] } }
  }),
  undo: () => set((s) => {
    if (s.history.past.length === 0) return s
    const prev = s.history.past[s.history.past.length - 1]
    const newPast = s.history.past.slice(0, -1)
    const future = [...s.history.future, snap(s)]
    if (future.length > HISTORY_CAP) future.shift()
    return { ...prev, history: { past: newPast, future } }
  }),
  redo: () => set((s) => {
    if (s.history.future.length === 0) return s
    const next = s.history.future[s.history.future.length - 1]
    const newFuture = s.history.future.slice(0, -1)
    const past = [...s.history.past, snap(s)]
    if (past.length > HISTORY_CAP) past.shift()
    return { ...next, history: { past, future: newFuture } }
  }),

  // Tool model — closely follows Illustrator semantics:
  //   'select' (V) — shape-level selection: click selects, drag-handles
  //                  transform whole shapes via gimbal / TransformControls.
  //   'node'   (A) — direct selection: emphasis on per-anchor / per-tangent
  //                  manipulation. Currently shares behavior with 'select'
  //                  since both surfaces show anchor handles on the
  //                  selected polyline; reserves the slot for future
  //                  divergence (e.g. node-only marquee, hover-shows-anchors).
  //   'pen'    (P) — creation: canvas clicks append anchors to a draft
  //                  polyline. `penDraftId` tracks the in-progress shape.
  tool: 'select',
  penDraftId: null,
  setTool: (t) => set({ tool: t, penDraftId: t === 'pen' ? null : null }),
  setPenDraft: (id) => set({ penDraftId: id }),
  finishPenDraft: () => set({ penDraftId: null, tool: 'select' }),

  // Variables — named numeric slots (`{ cube_w: 1.5, h: 2 }`) referenced
  // by expression fields in the Inspector. v1: tab UI lets the user
  // create / edit / delete; field-level expression-input wiring is a
  // follow-on. Persisted across reloads via `partialize`.
  variables: {},
  addVariable: (name, value = 1) => set((s) => {
    if (validateVarName(name) !== null) return s
    if (s.variables[name] !== undefined) return s
    return { variables: { ...s.variables, [name]: Number(value) || 0 } }
  }),
  setVariable: (name, value) => set((s) => ({
    variables: { ...s.variables, [name]: Number(value) || 0 },
  })),
  renameVariable: (oldName, newName) => set((s) => {
    if (validateVarName(newName) !== null) return s
    if (!(oldName in s.variables) || newName in s.variables) return s
    const next = {}
    for (const k of Object.keys(s.variables)) {
      next[k === oldName ? newName : k] = s.variables[k]
    }
    return { variables: next }
  }),
  removeVariable: (name) => set((s) => {
    if (!(name in s.variables)) return s
    const next = { ...s.variables }
    delete next[name]
    return { variables: next }
  }),

  snapshots: [],
  addSnapshot: (url) =>
    set((s) => ({ snapshots: [...s.snapshots, url].slice(-5) })), // keep last 5
  clearSnapshots: () => set({ snapshots: [] }),

  // (Background and lights are now first-class layers — `kind: 'background'`
  // / `kind: 'light'`. Insert via the Insert menu; manage in the Layers panel.)

  setArmature: (patch) =>
    set((s) => ({ armature: { ...s.armature, ...patch } })),

  setOverlay: (patch) =>
    set((s) => ({ overlay: { ...s.overlay, ...patch } })),

  setScene: (patch) =>
    set((s) => ({ scene: { ...s.scene, ...patch } })),

  setMode: (mode) => {
    const knobs = { ...KNOB_DEFAULTS[mode] }
    set({ mode, knobs, camera: presetCamera(mode, knobs) })
  },

  setKnobs: (patch) =>
    set((s) => {
      const knobs = { ...s.knobs, ...patch }
      return { knobs, camera: presetCamera(s.mode, knobs) }
    }),

  // Structural mutations auto-push the pre-mutation state to history so
  // every "user gesture" boundary is undoable. Drag-tick mutations
  // (updateCuboid, setKnobs) deliberately don't auto-snapshot — drag
  // handlers in SvgView/ThreeView call pushHistory() once at drag-start.
  addCuboid: (c) => set((s) => {
    const past = [...s.history.past, snap(s)]
    if (past.length > HISTORY_CAP) past.shift()
    return { cuboids: [...s.cuboids, c], history: { past, future: [] } }
  }),

  addCuboidAtCamera: () =>
    set((s) => {
      const { forward } = cameraBasis(s.camera)
      const center = add3(s.camera.position, scale3(forward, 6))
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return {
        cuboids: [...s.cuboids, makeCuboid({ center, size: [1.5, 1.5, 1.5] })],
        history: { past, future: [] },
      }
    }),

  addShapePreset: (presetId) =>
    set((s) => {
      const preset = ALL_INSERT_PRESETS.find((p) => p.id === presetId)
      if (!preset) return s
      const { forward } = cameraBasis(s.camera)
      const center = add3(s.camera.position, scale3(forward, 6))
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return {
        cuboids: [
          ...s.cuboids,
          makeCuboid({ center, size: preset.size, kind: preset.kind, params: preset.params }),
        ],
        history: { past, future: [] },
      }
    }),

  /** Build a CSG (boolean) shape from the current 2-shape selection.
   *  Hides both operands so the canvas shows only the result; selects
   *  the new csg. Reject when selection isn't exactly two solid-kind
   *  shapes (linework / lights / backgrounds aren't valid operands).
   *  Operands stay editable in the layer tree — their geometry feeds
   *  into the csg via id reference; eye-toggling shows them alongside
   *  the result. Removing the csg restores their visibility. */
  combineSelection: (operator) =>
    set((s) => {
      if (s.selectedIds.length !== 2) return s
      const [idA, idB] = s.selectedIds
      const opA = s.cuboids.find((c) => c.id === idA)
      const opB = s.cuboids.find((c) => c.id === idB)
      const SOLID = new Set(['box', 'pyramid', 'prism', 'cylinder', 'sphere', 'csg'])
      if (!opA || !opB) return s
      if (!SOLID.has(opA.kind || 'box') || !SOLID.has(opB.kind || 'box')) return s
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      const newId = `s-${Math.random().toString(36).slice(2, 8)}`
      const csg = {
        kind: 'csg',
        id: newId,
        center: [0, 0, 0],
        size: [1, 1, 1],
        rotation: IDENT3,
        params: { operator, operandIds: [idA, idB] },
        ...(opA.style ? { style: { ...opA.style } } : {}),
      }
      return {
        cuboids: [
          ...s.cuboids.map((c) =>
            c.id === idA || c.id === idB ? { ...c, hidden: true } : c,
          ),
          csg,
        ],
        selectedIds: [newId],
        selectedCuboidId: newId,
        history: { past, future: [] },
      }
    }),

  loadScenePreset: (presetId) =>
    set((s) => {
      const preset = SCENE_PRESETS.find((p) => p.id === presetId)
      if (!preset) return s
      const knobs = { ...KNOB_DEFAULTS[preset.mode], ...preset.knobs }
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return {
        mode: preset.mode,
        knobs,
        camera: presetCamera(preset.mode, knobs),
        cuboids: preset.cuboids.map((c) => makeCuboid(c)),
        scene: { ...preset.scene },
        selectedIds: [],
        selectedCuboidId: null,
        penDraftId: null,
        history: { past, future: [] },
      }
    }),

  clearCuboids: () => set((s) => {
    const past = [...s.history.past, snap(s)]
    if (past.length > HISTORY_CAP) past.shift()
    return { cuboids: [], selectedIds: [], selectedCuboidId: null, history: { past, future: [] } }
  }),

  updateCuboid: (id, patch) =>
    set((s) => ({
      cuboids: s.cuboids.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  removeCuboid: (id) =>
    set((s) => {
      const removed = s.cuboids.find((c) => c.id === id)
      // Symmetric with `combineSelection` — when a csg shape is deleted,
      // restore the visibility of its operand shapes (which were hidden
      // automatically when the csg was created so the canvas would show
      // only the boolean result). The user can still re-hide them
      // individually via the eye toggle.
      const operandIds =
        removed?.kind === 'csg' ? (removed.params?.operandIds ?? []) : []
      const restoreSet = new Set(operandIds.filter(Boolean))
      const nextIds = s.selectedIds.filter((x) => x !== id)
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return {
        cuboids: s.cuboids
          .filter((c) => c.id !== id)
          .map((c) => (restoreSet.has(c.id) ? { ...c, hidden: false } : c)),
        selectedIds: nextIds,
        selectedCuboidId: nextIds[0] ?? null,
        history: { past, future: [] },
      }
    }),

  toggleCuboidVisibility: (id) =>
    set((s) => {
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return {
        cuboids: s.cuboids.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c)),
        history: { past, future: [] },
      }
    }),

  /** Uniform scale applied to a single shape, around its own center.
   *  Multiplies size, vertexOffsets (deformations), and polyline anchor
   *  coords + tangents by `factor`. Doesn't push history — caller
   *  batches multiple scaleShape calls into one history entry. */
  scaleShape: (id, factor) => set((s) => ({
    cuboids: s.cuboids.map((c) => {
      if (c.id !== id) return c
      const next = {
        ...c,
        size: [c.size[0] * factor, c.size[1] * factor, c.size[2] * factor],
      }
      if (c.vertexOffsets) {
        next.vertexOffsets = c.vertexOffsets.map((o) =>
          o ? [o[0] * factor, o[1] * factor, o[2] * factor] : o,
        )
      }
      if (c.kind === 'polyline' && c.params?.anchors) {
        next.params = {
          ...c.params,
          anchors: c.params.anchors.map((a) => {
            const out = { point: [a.point[0] * factor, a.point[1] * factor, a.point[2] * factor] }
            if (a.in) out.in = [a.in[0] * factor, a.in[1] * factor, a.in[2] * factor]
            if (a.out) out.out = [a.out[0] * factor, a.out[1] * factor, a.out[2] * factor]
            return out
          }),
        }
      }
      return next
    }),
  })),

  reorderCuboid: (from, to) =>
    set((s) => {
      const n = s.cuboids.length
      if (from < 0 || from >= n || to < 0 || to >= n || from === to) return s
      const next = s.cuboids.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      const past = [...s.history.past, snap(s)]
      if (past.length > HISTORY_CAP) past.shift()
      return { cuboids: next, history: { past, future: [] } }
    }),
}), {
  name: 'kol-draw-state',
  storage: createJSONStorage(() => localStorage),
  version: 1,
  // Persist only durable state. Skip ephemeral fields:
  //   - history, snapshots: session-local
  //   - penDraftId, selectedIds, selectedCuboidId: transient selection / draft
  //   - tool: always restart in 'select' mode for predictability
  // The persisted state hydrates on next mount, restoring scene + camera +
  // overlay / armature / scene-frame settings. Snapshots / undo history
  // start fresh on every session.
  partialize: (state) => ({
    cuboids: state.cuboids,
    knobs: state.knobs,
    mode: state.mode,
    camera: state.camera,
    scene: state.scene,
    armature: state.armature,
    overlay: state.overlay,
    viewMode: state.viewMode,
    variables: state.variables,
  }),
}))
