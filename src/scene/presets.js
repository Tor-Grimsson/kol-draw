import { makeCuboid } from '../math/cuboid.js'

/**
 * Primitive presets — geometric primitives (box / pyramid / prism /
 * cylinder / sphere) the user can drop into the scene. Kind drives mesh
 * generation; size drives bounding-box extents.
 *
 * @typedef {object} PrimitivePreset
 * @property {string} id
 * @property {string} kind                              'box' | 'pyramid' | 'prism' | 'cylinder' | 'sphere' | 'arc'
 * @property {string} label
 * @property {import('../math/vec.js').Vec3} size
 * @property {object} [params]                          Kind-specific extras (cylinder segments, sphere subdivisions, arc startAngle/endAngle/segments)
 */

/** @type {PrimitivePreset[]} */
export const PRIMITIVE_PRESETS = [
  { id: 'cube',     kind: 'box',      label: 'Cube',     size: [1.5, 1.5, 1.5] },
  { id: 'plinth',   kind: 'box',      label: 'Plinth',   size: [2.5, 0.6, 2.5] },
  { id: 'column',   kind: 'box',      label: 'Column',   size: [0.8, 3.5, 0.8] },
  { id: 'slab',     kind: 'box',      label: 'Slab',     size: [4, 0.3, 2.5] },
  { id: 'beam',     kind: 'box',      label: 'Beam',     size: [0.4, 0.4, 4] },
  { id: 'wall',     kind: 'box',      label: 'Wall',     size: [4, 3, 0.25] },
  { id: 'tile',     kind: 'box',      label: 'Tile',     size: [1, 0.1, 1] },
  { id: 'pyramid',  kind: 'pyramid',  label: 'Pyramid',  size: [2, 2, 2] },
  { id: 'prism',    kind: 'prism',    label: 'Prism',    size: [2, 1.5, 3] },
  { id: 'cylinder', kind: 'cylinder', label: 'Cylinder', size: [1.5, 2.5, 1.5], params: { segments: 24 } },
  { id: 'sphere',   kind: 'sphere',   label: 'Sphere',   size: [1.5, 1.5, 1.5], params: { stacks: 10, slices: 16 } },
  { id: 'circle',   kind: 'arc',      label: 'Circle',   size: [1.5, 0, 1.5],   params: { startAngle: 0, endAngle: 360, segments: 48 } },
  { id: 'half-arc', kind: 'arc',      label: 'Half arc', size: [1.5, 0, 1.5],   params: { startAngle: 0, endAngle: 180, segments: 32 } },
  { id: 'polyline', kind: 'polyline', label: 'Polyline', size: [1, 1, 1],       params: { anchors: [{ point: [-1, 0, -1] }, { point: [1, 0, -1] }, { point: [1, 0, 1] }], closed: false } },
  { id: 'square',   kind: 'polyline', label: 'Square',   size: [1, 1, 1],       params: { anchors: [{ point: [-1, 0, -1] }, { point: [1, 0, -1] }, { point: [1, 0, 1] }, { point: [-1, 0, 1] }], closed: true } },
  // Curve preset: a 4-anchor closed loop with mirrored tangents → bean shape.
  { id: 'curve',    kind: 'polyline', label: 'Curve',    size: [1, 1, 1],       params: {
    anchors: [
      { point: [-1.2, 0, 0],   out: [0, 0, 0.8],  in: [0, 0, -0.8] },
      { point: [0,    0, 1.2], out: [1, 0, 0],    in: [-1, 0, 0] },
      { point: [1.2,  0, 0],   out: [0, 0, -0.8], in: [0, 0, 0.8] },
      { point: [0,    0, -1.2], out: [-1, 0, 0],  in: [1, 0, 0] },
    ],
    closed: true,
    segments: 16,
  } },
]

/**
 * Organic presets — non-box shapes that read as natural / sculptural
 * forms. All built on the sphere or cylinder primitives with non-cubic
 * extents; lower poly counts give a hand-formed feel.
 *
 * @type {PrimitivePreset[]}
 */
export const ORGANIC_PRESETS = [
  { id: 'orb',    kind: 'sphere',   label: 'Orb',    size: [2, 2, 2],          params: { stacks: 12, slices: 18 } },
  { id: 'egg',    kind: 'sphere',   label: 'Egg',    size: [1.2, 1.8, 1.2],    params: { stacks: 12, slices: 18 } },
  { id: 'disc',   kind: 'sphere',   label: 'Disc',   size: [2.5, 0.4, 2.5],    params: { stacks: 8,  slices: 24 } },
  { id: 'pebble', kind: 'sphere',   label: 'Pebble', size: [1.8, 1.0, 1.4],    params: { stacks: 8,  slices: 14 } },
  { id: 'lentil', kind: 'sphere',   label: 'Lentil', size: [2.4, 0.6, 2.4],    params: { stacks: 6,  slices: 16 } },
  { id: 'tube',   kind: 'cylinder', label: 'Tube',   size: [0.8, 3, 0.8],      params: { segments: 24 } },
  { id: 'drum',   kind: 'cylinder', label: 'Drum',   size: [2.4, 1.2, 2.4],    params: { segments: 24 } },
]

/**
 * Light presets — addable as layers. `params.type` selects directional vs
 * point in ThreeView. Position uses the cuboid's `center`; `size` is just
 * the SVG marker size.
 */
export const LIGHT_PRESETS = [
  { id: 'light-key',   kind: 'light', label: 'Key light',   size: [0.4, 0.4, 0.4], params: { type: 'directional', color: '#fff5e1', intensity: 1.0 } },
  { id: 'light-fill',  kind: 'light', label: 'Fill light',  size: [0.4, 0.4, 0.4], params: { type: 'directional', color: '#dde9ff', intensity: 0.5 } },
  { id: 'light-rim',   kind: 'light', label: 'Rim light',   size: [0.4, 0.4, 0.4], params: { type: 'directional', color: '#cfd8ec', intensity: 0.7 } },
  { id: 'light-point', kind: 'light', label: 'Point light', size: [0.4, 0.4, 0.4], params: { type: 'point',       color: '#ffffff', intensity: 1.0 } },
]

/**
 * Background presets. `mode: 'image'` paints a stretched bitmap (URL or
 * data-url, opacity, fit); `mode: 'solid'` paints a flat color across the
 * whole canvas. SvgView renders both as full-bleed elements; ThreeView
 * sets `scene.background` from the topmost background layer.
 */
export const BACKGROUND_PRESETS = [
  { id: 'bg-image', kind: 'background', label: 'Image', size: [1, 1, 1], params: { mode: 'image', url: '', opacity: 0.5, fit: 'cover' } },
  { id: 'bg-solid', kind: 'background', label: 'Solid', size: [1, 1, 1], params: { mode: 'solid', solidColor: '#1a1a1f', opacity: 1 } },
]

/** Lookup helper: every preset that the Insert menus dispatch to. */
export const ALL_INSERT_PRESETS = [
  ...PRIMITIVE_PRESETS,
  ...ORGANIC_PRESETS,
  ...LIGHT_PRESETS,
  ...BACKGROUND_PRESETS,
]

/** Back-compat alias for older imports that referred to SHAPE_PRESETS. */
export const SHAPE_PRESETS = PRIMITIVE_PRESETS

/**
 * Scene presets — full snapshots of the working state.
 *
 * @typedef {object} ScenePreset
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {import('./store.js').PerspectiveMode} mode
 * @property {Partial<import('./store.js').CameraKnobs>} knobs
 * @property {import('./store.js').SceneFrame} scene
 * @property {import('../math/cuboid.js').Cuboid[]} cuboids
 */

const sceneFrame = (overrides = {}) => ({
  center: [0, -1, 0],
  size: [8, 4, 6],
  divisions: 8,
  show: true,
  showFloor: true,
  showBox: true,
  showAnchor: true,
  ...overrides,
})

/** @type {ScenePreset[]} */
export const SCENE_PRESETS = [
  {
    id: 'empty',
    label: 'Empty',
    hint: 'Bare scene frame, no shapes',
    mode: '2pt',
    knobs: { distance: 8, focal: 1.2, yawDeg: 30, pitchDeg: 0, pivot: [0, 0, 0] },
    scene: sceneFrame(),
    cuboids: [],
  },
  {
    id: 'single',
    label: 'Single box',
    hint: 'One cube on the floor',
    mode: '2pt',
    knobs: { distance: 7, focal: 1.3, yawDeg: 30, pitchDeg: -10, pivot: [0, 0, 0] },
    scene: sceneFrame({ size: [6, 4, 6] }),
    cuboids: [
      makeCuboid({ id: 'p-single-1', center: [0, -0.25, 0], size: [1.5, 1.5, 1.5] }),
    ],
  },
  {
    id: 'three-blocks',
    label: 'Three blocks',
    hint: 'Cube + plinth + column',
    mode: '2pt',
    knobs: { distance: 9, focal: 1.2, yawDeg: 30, pitchDeg: -10, pivot: [0, 0, 0] },
    scene: sceneFrame({ size: [10, 5, 6] }),
    cuboids: [
      makeCuboid({ id: 'p-3b-1', center: [-2.4, -0.25, 0], size: [1.5, 1.5, 1.5] }),
      makeCuboid({ id: 'p-3b-2', center: [0,    -0.7,  0], size: [2, 0.6, 2] }),
      makeCuboid({ id: 'p-3b-3', center: [2.7,   0.25, 0], size: [0.8, 2.5, 0.8] }),
    ],
  },
  {
    id: 'stack',
    label: 'Stack',
    hint: 'Three cubes stacked',
    mode: '3pt',
    knobs: { distance: 8, focal: 1.3, yawDeg: 25, pitchDeg: -15, pivot: [0, 0, 0] },
    scene: sceneFrame({ size: [4, 5, 4] }),
    cuboids: [
      makeCuboid({ id: 'p-s-1', center: [0, -1.4, 0], size: [1.6, 1.2, 1.6] }),
      makeCuboid({ id: 'p-s-2', center: [0, -0.2, 0], size: [1.2, 1.0, 1.2] }),
      makeCuboid({ id: 'p-s-3', center: [0,  0.8, 0], size: [0.8, 0.8, 0.8] }),
    ],
  },
  {
    id: 'room',
    label: 'Empty room',
    hint: 'Floor + two walls, looking in',
    mode: '1pt',
    knobs: { distance: 6, focal: 1.4, yawDeg: 0, pitchDeg: -5, pivot: [0, 0, 0] },
    scene: sceneFrame({ size: [8, 5, 8], showBox: false }),
    cuboids: [
      makeCuboid({ id: 'p-room-floor',  center: [0, -2,    -2], size: [8,   0.2, 8] }),
      makeCuboid({ id: 'p-room-wall-l', center: [-4, 0,    -2], size: [0.2, 4,   8] }),
      makeCuboid({ id: 'p-room-wall-r', center: [4,  0,    -2], size: [0.2, 4,   8] }),
      makeCuboid({ id: 'p-room-wall-b', center: [0,  0,    -6], size: [8,   4,   0.2] }),
    ],
  },
  {
    id: 'street',
    label: 'Street',
    hint: 'Four buildings down a corridor',
    mode: '1pt',
    knobs: { distance: 12, focal: 1.5, yawDeg: 0, pitchDeg: 0, pivot: [0, 0, 0] },
    scene: sceneFrame({ size: [8, 5, 18], center: [0, 0, -4] }),
    cuboids: [
      makeCuboid({ id: 'p-st-l-1', center: [-3,  0,   -2],  size: [2, 4, 2] }),
      makeCuboid({ id: 'p-st-l-2', center: [-3, -0.5, -6],  size: [2, 3, 2] }),
      makeCuboid({ id: 'p-st-l-3', center: [-3,  0.5, -10], size: [2, 5, 2] }),
      makeCuboid({ id: 'p-st-r-1', center: [ 3,  0.5, -2],  size: [2, 5, 2] }),
      makeCuboid({ id: 'p-st-r-2', center: [ 3,  0,   -6],  size: [2, 4, 2] }),
      makeCuboid({ id: 'p-st-r-3', center: [ 3, -0.5, -10], size: [2, 3, 2] }),
    ],
  },
]
