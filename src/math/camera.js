import { norm3, cross3, len3 } from './vec.js'

/**
 * Camera state. Right-handed world: +X right, +Y up, +Z toward viewer (out of screen).
 * Camera looks down its local -Z. `forward` is what the camera sees; `right` and `up`
 * are derived to form an orthonormal basis.
 *
 * @typedef {object} Camera
 * @property {import('./vec.js').Vec3} position    World-space eye point.
 * @property {import('./vec.js').Vec3} forward     Unit view direction (where it's pointing).
 * @property {import('./vec.js').Vec3} up          Unit world-up reference (usually [0,1,0]).
 * @property {number} focal                        Focal length in image-plane units. Larger = narrower FOV.
 */

/** @type {(opts?: Partial<Camera>) => Camera} */
export const makeCamera = (opts = {}) => ({
  position: opts.position ?? [0, 0, 5],
  forward: norm3(opts.forward ?? [0, 0, -1]),
  up: norm3(opts.up ?? [0, 1, 0]),
  focal: opts.focal ?? 1,
})

/**
 * Build the camera-local basis (right, up, forward) from a Camera.
 * `right = forward × worldUp`, then `up = right × forward` to re-orthonormalize.
 *
 * When `forward` is collinear with `worldUp` (camera looking straight up or
 * straight down), `cross(forward, worldUp)` is the zero vector — gimbal lock.
 * We pick a perpendicular reference axis instead so the basis stays well-formed.
 * No clamping; extreme orientations are first-class.
 *
 * @param {Camera} cam
 * @returns {{ right: import('./vec.js').Vec3, up: import('./vec.js').Vec3, forward: import('./vec.js').Vec3 }}
 */
export const cameraBasis = (cam) => {
  const forward = norm3(cam.forward)
  let rightRaw = cross3(forward, cam.up)
  if (len3(rightRaw) < 1e-9) {
    // Gimbal lock: pick any axis not parallel to forward.
    const refUp = Math.abs(forward[2]) < 0.9
      ? /** @type {import('./vec.js').Vec3} */ ([0, 0, 1])
      : /** @type {import('./vec.js').Vec3} */ ([1, 0, 0])
    rightRaw = cross3(forward, refUp)
  }
  const right = norm3(rightRaw)
  const up = norm3(cross3(right, forward))
  return { right, up, forward }
}

/**
 * Orientation presets — the core insight from the plan: 1pt/2pt/3pt are not
 * different projections, they are different camera orientations of the same
 * pinhole. Each preset returns a Camera with `position` placed back from a
 * pivot point and `forward` aimed at the pivot with the named yaw/pitch.
 *
 * `pivot` is the look-at point the camera orbits and pans around. Pan
 * gestures translate the pivot; orbit gestures change yaw/pitch. Default
 * pivot is the world origin.
 *
 * 4pt / 5pt share the same camera orientation as 1pt by default — the
 * projection (cylindrical / spherical) is what makes them "extreme",
 * not the orientation. Caller can still override yaw/pitch per opts.
 *
 * @param {'1pt'|'2pt'|'3pt'|'4pt'|'5pt'} kind
 * @param {{ distance?: number, focal?: number, yawDeg?: number, pitchDeg?: number, pivot?: import('./vec.js').Vec3 }} [opts]
 * @returns {Camera}
 */
export const presetCamera = (kind, opts = {}) => {
  // Distance is the eye-to-pivot scalar; ≤ 0 puts the eye on or past the
  // pivot, which collapses every projected z to ≤ 0 and blanks the canvas.
  // That's not an "extreme perspective" — it's a degenerate camera. Floor it
  // at a small positive ε so sliding the slider through 0 stays previewable.
  const distance = Math.max(opts.distance ?? 8, 1e-3)
  const focal = opts.focal ?? 1
  const pivot = opts.pivot ?? [0, 0, 0]
  const worldUp = /** @type {import('./vec.js').Vec3} */ ([0, 1, 0])

  const defaults = {
    '1pt': { yaw: 0, pitch: 0 },
    '2pt': { yaw: 30, pitch: 0 },
    '3pt': { yaw: 30, pitch: -20 },
    '4pt': { yaw: 0, pitch: 0 },
    '5pt': { yaw: 0, pitch: 0 },
  }[kind]
  const yawDeg = opts.yawDeg ?? defaults.yaw
  const pitchDeg = opts.pitchDeg ?? defaults.pitch

  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180

  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)

  /** @type {import('./vec.js').Vec3} */
  // forward.y = sin(pitch): positive pitchDeg tilts camera UP, negative tilts DOWN.
  // The sign matches the store doc and the user's mental model; downstream
  // horizon and VP math are derived against this convention.
  const forward = norm3([sy * cp, sp, -cy * cp])
  // Eye sits opposite the look direction at `distance`, offset from the pivot.
  const position = [
    pivot[0] - forward[0] * distance,
    pivot[1] - forward[1] * distance,
    pivot[2] - forward[2] * distance,
  ]

  return { position, forward, up: worldUp, focal }
}
