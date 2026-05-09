import { sub3, dot3, scale3, add3 } from './vec.js'
import { cameraBasis } from './camera.js'

/**
 * Pinhole projection. Returns image-plane coordinates in the camera's local
 * (right, up) basis, scaled by focal/depth. Returns null if the point is
 * behind or on the camera plane.
 *
 * Image coords are in "world units at unit depth" — caller maps to pixels.
 * Convention: +x is right on screen, +y is up on screen (caller flips for
 * SVG/canvas if needed).
 *
 * @param {import('./vec.js').Vec3} p   World-space point.
 * @param {import('./camera.js').Camera} cam
 * @returns {import('./vec.js').Vec2 | null}
 */
export const pinhole = (p, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const z = dot3(rel, forward) // depth along view axis
  // Reject points on or behind the camera AND points within ε in front; the
  // latter would amplify image coords to millions and breach SVG/canvas limits.
  if (z < 1e-6) return null
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const f = cam.focal
  return [(f * x) / z, (f * y) / z]
}

/**
 * Inverse of pinhole at a chosen depth (depth = signed distance along the
 * camera's forward axis).
 *
 * @param {import('./vec.js').Vec2} imgXY
 * @param {import('./camera.js').Camera} cam
 * @param {number} z
 * @returns {import('./vec.js').Vec3}
 */
const unprojectPinhole = (imgXY, cam, z) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const sx = (imgXY[0] * z) / f
  const sy = (imgXY[1] * z) / f
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, sx), scale3(up, sy))),
  )
}

/**
 * Inverse of `cylindrical` at a chosen `horizDist` = sqrt(x² + z²) — the
 * radial distance from the camera in the camera-XZ plane (the cylinder
 * coordinate that's preserved during a drag).
 */
const unprojectCylindrical = (imgXY, cam, horizDist) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const theta = imgXY[0] / f
  const x = horizDist * Math.sin(theta)
  const z = horizDist * Math.cos(theta)
  const y = (imgXY[1] / f) * horizDist
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, x), scale3(up, y))),
  )
}

/**
 * Inverse of `spherical` at a chosen `rho` = sqrt(x² + y² + z²) — the
 * radial distance from the camera (the sphere coordinate that's preserved
 * during a drag).
 */
const unprojectSpherical = (imgXY, cam, rho) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const r = Math.hypot(imgXY[0], imgXY[1])
  const phi = r / f
  const psi = r < 1e-9 ? 0 : Math.atan2(imgXY[1], imgXY[0])
  const z = rho * Math.cos(phi)
  const horiz = rho * Math.sin(phi)
  const x = horiz * Math.cos(psi)
  const y = horiz * Math.sin(psi)
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, x), scale3(up, y))),
  )
}

/**
 * Dispatched inverse projection. The `depth` argument's meaning depends on
 * `kind` — see each projection's inverse for details. The companion
 * `depthForKind` helper extracts the right depth from a known world point.
 *
 * @param {import('./vec.js').Vec2} imgXY
 * @param {import('./camera.js').Camera} cam
 * @param {number} depth
 * @param {ProjectionKind} [kind='pinhole']
 * @returns {import('./vec.js').Vec3}
 */
/** Inverse of stereographic at a chosen rho (radial distance). */
const unprojectStereographic = (imgXY, cam, rho) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const r = Math.hypot(imgXY[0], imgXY[1])
  const phi = 2 * Math.atan2(r, 2 * f)
  const psi = r < 1e-9 ? 0 : Math.atan2(imgXY[1], imgXY[0])
  const z = rho * Math.cos(phi)
  const horiz = rho * Math.sin(phi)
  const x = horiz * Math.cos(psi)
  const y = horiz * Math.sin(psi)
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, x), scale3(up, y))),
  )
}

/** Inverse of equirectangular at a chosen rho (radial distance). */
const unprojectEquirectangular = (imgXY, cam, rho) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const theta = imgXY[0] / f
  const phi = imgXY[1] / f
  const cosphi = Math.cos(phi)
  const x = rho * cosphi * Math.sin(theta)
  const y = rho * Math.sin(phi)
  const z = rho * cosphi * Math.cos(theta)
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, x), scale3(up, y))),
  )
}

/** Inverse of orthographic at a chosen depth (forward-axis distance). */
const unprojectOrthographic = (imgXY, cam, z) => {
  const { right, up, forward } = cameraBasis(cam)
  const f = cam.focal
  const x = imgXY[0] / f
  const y = imgXY[1] / f
  return add3(
    cam.position,
    add3(scale3(forward, z), add3(scale3(right, x), scale3(up, y))),
  )
}

export const unproject = (imgXY, cam, depth, kind = 'pinhole') => {
  if (kind === 'cylindrical') return unprojectCylindrical(imgXY, cam, depth)
  if (kind === 'spherical') return unprojectSpherical(imgXY, cam, depth)
  if (kind === 'stereographic') return unprojectStereographic(imgXY, cam, depth)
  if (kind === 'equirectangular') return unprojectEquirectangular(imgXY, cam, depth)
  if (kind === 'orthographic') return unprojectOrthographic(imgXY, cam, depth)
  return unprojectPinhole(imgXY, cam, depth)
}

/**
 * Projection-specific scalar that should stay constant when the user drags
 * a known world point in image space. Pairs with `unproject(img, cam, depth, kind)`.
 */
export const depthForKind = (p, cam, kind) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const z = dot3(rel, forward)
  if (kind === 'cylindrical') return Math.hypot(x, z)
  if (kind === 'spherical' || kind === 'stereographic' || kind === 'equirectangular') {
    return Math.hypot(x, y, z)
  }
  // pinhole + orthographic both use forward-axis distance
  return z
}

/**
 * Cylindrical projection — the world is mapped onto a vertical cylinder
 * coaxial with the camera's up axis. Horizontal angles wrap to (-π, π].
 * Vertical world lines stay vertical; horizontal world lines curve. No
 * hemisphere clip — points behind the camera project to image_x near ±π·focal
 * and lines crossing behind will visibly wrap across the panorama.
 */
export const cylindrical = (p, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const z = dot3(rel, forward)
  const theta = Math.atan2(x, z)
  const horizDist = Math.hypot(x, z)
  // The cylinder's vertical singular axis (a line passing through the eye).
  // Return null so projectPolyline splits the run cleanly instead of drawing
  // a fake line through the origin.
  if (horizDist < 1e-9) return null
  return [cam.focal * theta, (cam.focal * y) / horizDist]
}

/**
 * Spherical equidistant fisheye. `r = focal · φ` with `φ` = angle from the
 * forward axis (full range [0, π]). The front hemisphere fills a disk of
 * radius `π/2 · focal`; the back hemisphere extends past that as a ring out
 * to `π · focal`. Classic 5-point fisheye + back-of-head wrap.
 */
export const spherical = (p, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const z = dot3(rel, forward)
  const rho = Math.sqrt(x * x + y * y + z * z)
  if (rho < 1e-9) return [0, 0]
  const phi = Math.acos(Math.max(-1, Math.min(1, z / rho))) // [0, π]
  const psi = Math.atan2(y, x)
  const r = cam.focal * phi
  return [r * Math.cos(psi), r * Math.sin(psi)]
}

/**
 * Stereographic fisheye — `r = 2·focal·tan(φ/2)`. Conformal (preserves
 * angles locally), much less squished at the edges than equidistant. Maps
 * the whole sphere except the antipode (φ → π → r → ∞); we clip just shy
 * to keep numbers finite.
 */
export const stereographic = (p, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const z = dot3(rel, forward)
  const rho = Math.sqrt(x * x + y * y + z * z)
  if (rho < 1e-9) return [0, 0]
  const phi = Math.acos(Math.max(-1, Math.min(1, z / rho)))
  if (phi > Math.PI * 0.985) return null
  const r = 2 * cam.focal * Math.tan(phi / 2)
  const psi = Math.atan2(y, x)
  return [r * Math.cos(psi), r * Math.sin(psi)]
}

/**
 * Equirectangular projection — full longitude × latitude map. The whole
 * sphere fits a rectangle of width `2π·focal` and height `π·focal`. The
 * left/right edges meet behind the camera (180° wrap).
 */
export const equirectangular = (p, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  const z = dot3(rel, forward)
  const horizDist = Math.hypot(x, z)
  const theta = Math.atan2(x, z) // longitude ∈ (-π, π]
  const phi = Math.atan2(y, horizDist) // latitude ∈ (-π/2, π/2)
  return [cam.focal * theta, cam.focal * phi]
}

/**
 * Orthographic — parallel projection, no foreshortening. `image = focal · (x, y)`.
 * Drops depth entirely; objects don't get smaller with distance. Plan /
 * elevation / isometric-style views land here when paired with the right
 * camera orientation.
 */
export const orthographic = (p, cam) => {
  const { right, up } = cameraBasis(cam)
  const rel = sub3(p, cam.position)
  const x = dot3(rel, right)
  const y = dot3(rel, up)
  return [cam.focal * x, cam.focal * y]
}

/**
 * @typedef {'pinhole'|'cylindrical'|'spherical'|'stereographic'|'equirectangular'|'orthographic'} ProjectionKind
 *
 * Dispatch by projection kind. SVG renderer just calls `project(p, cam, kind)`.
 *
 * @param {import('./vec.js').Vec3} p
 * @param {import('./camera.js').Camera} cam
 * @param {ProjectionKind} [kind='pinhole']
 * @returns {import('./vec.js').Vec2 | null}
 */
export const project = (p, cam, kind = 'pinhole') => {
  if (kind === 'cylindrical') return cylindrical(p, cam)
  if (kind === 'spherical') return spherical(p, cam)
  if (kind === 'stereographic') return stereographic(p, cam)
  if (kind === 'equirectangular') return equirectangular(p, cam)
  if (kind === 'orthographic') return orthographic(p, cam)
  return pinhole(p, cam)
}

/**
 * Project a world segment as a polyline of N+1 image points, sampling along
 * the world segment so curved projections (cylindrical, spherical) render
 * correctly. For pinhole, returns just two endpoints (or null if either is
 * clipped). For curved projections, returns up to N+1 points; if any sample
 * fails (null from the projection), the polyline is split at the gap and
 * only contiguous runs are returned.
 *
 * Caller decides how to render (e.g., one `<polyline>` per run).
 *
 * @param {import('./vec.js').Vec3} a
 * @param {import('./vec.js').Vec3} b
 * @param {import('./camera.js').Camera} cam
 * @param {ProjectionKind} kind
 * @param {number} [segments=24]
 * @returns {import('./vec.js').Vec2[][]}  Array of contiguous polyline runs.
 */
export const projectPolyline = (a, b, cam, kind, segments = 24) => {
  if (kind === 'pinhole') {
    const seg = projectSegment(a, b, cam)
    return seg ? [[seg[0], seg[1]]] : []
  }
  // Wrap-discontinuity threshold for curved projections. cylindrical /
  // equirectangular wrap at θ=±π giving an image_x jump of ~2π·focal; the
  // antipode of spherical/stereographic flips ψ. A jump larger than half
  // the canvas can't be a real adjacent-sample step — split into two runs
  // so we don't draw a stripe across the canvas.
  const wrapThreshold = Math.PI * cam.focal
  /** @type {import('./vec.js').Vec2[][]} */
  const runs = []
  /** @type {import('./vec.js').Vec2[]} */
  let cur = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    /** @type {import('./vec.js').Vec3} */
    const p = [
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
    ]
    const ip = project(p, cam, kind)
    if (!ip) {
      if (cur.length > 1) runs.push(cur)
      cur = []
      continue
    }
    if (cur.length > 0) {
      const prev = cur[cur.length - 1]
      const dx = ip[0] - prev[0]
      const dy = ip[1] - prev[1]
      if (Math.abs(dx) > wrapThreshold || Math.abs(dy) > wrapThreshold) {
        if (cur.length > 1) runs.push(cur)
        cur = []
      }
    }
    cur.push(ip)
  }
  if (cur.length > 1) runs.push(cur)
  return runs
}

/**
 * Vanishing point for a world-space direction. The VP is the limit of
 * pinhole projection along that direction at infinity: it's the same point
 * for `+d` and `-d`. Returns null when the direction is parallel to the
 * image plane (VP at infinity — no convergence in that direction).
 *
 * @param {import('./vec.js').Vec3} dir   World direction (need not be unit).
 * @param {import('./camera.js').Camera} cam
 * @returns {import('./vec.js').Vec2 | null}
 */
export const vanishingPoint = (dir, cam) => {
  const { right, up, forward } = cameraBasis(cam)
  const fz = dot3(dir, forward)
  if (Math.abs(fz) < 1e-9) return null
  const f = cam.focal
  return [(f * dot3(dir, right)) / fz, (f * dot3(dir, up)) / fz]
}

/**
 * Clip a world-space segment against the camera's near plane (depth = `near`)
 * and project both endpoints. If both endpoints are behind the near plane,
 * returns null (segment entirely invisible). If one is behind, the segment
 * is shortened to the intersection with the near plane.
 *
 * Used by long reference lines (ground grid, construction rays) so they
 * render correctly when one endpoint sits behind the eye.
 *
 * @param {import('./vec.js').Vec3} a
 * @param {import('./vec.js').Vec3} b
 * @param {import('./camera.js').Camera} cam
 * @param {number} [near=0.01]
 * @returns {[import('./vec.js').Vec2, import('./vec.js').Vec2] | null}
 */
export const projectSegment = (a, b, cam, near = 0.01) => {
  const { forward } = cameraBasis(cam)
  const za = dot3(sub3(a, cam.position), forward)
  const zb = dot3(sub3(b, cam.position), forward)
  // <= so a segment lying exactly on the near plane gets rejected instead of
  // calling pinhole with z=near and getting amplified-by-1/near image coords.
  if (za <= near && zb <= near) return null
  let pa = a
  let pb = b
  if (za <= near) {
    const u = (near - za) / (zb - za) // param along (a → b)
    pa = add3(a, scale3(sub3(b, a), u))
  } else if (zb <= near) {
    const u = (near - zb) / (za - zb) // param along (b → a)
    pb = add3(b, scale3(sub3(a, b), u))
  }
  const ipa = pinhole(pa, cam)
  const ipb = pinhole(pb, cam)
  return ipa && ipb ? [ipa, ipb] : null
}

/**
 * Image-plane y-coordinate of the horizon line for a pinhole camera with
 * world-up = [0,1,0]. For any horizontal direction in the world XZ plane,
 * the projection at infinity gives `image_y = -focal * tan(pitch)` regardless
 * of yaw. Returns null when the camera looks straight up or down (no finite
 * horizon in image).
 *
 * Convention (post pitch-sign fix): `forward.y = sin(pitch)`. Positive
 * pitchDeg = camera tilts up; negative = tilts down. Negative pitch (tilted
 * down) puts the horizon ABOVE center (positive image_y), which after `toPx`
 * y-flip lands above the canvas centerline.
 *
 * @param {import('./camera.js').Camera} cam
 * @returns {number | null}
 */
export const horizonImageY = (cam) => {
  // forward.y = sin(pitch); horizon_y = -focal · tan(pitch).
  const sinPitch = cam.forward[1]
  const cos2 = 1 - sinPitch * sinPitch
  if (cos2 <= 1e-12) return null // looking straight up or down
  const cosPitch = Math.sqrt(cos2)
  return (-cam.focal * sinPitch) / cosPitch
}

/**
 * Inverse of `vanishingPoint` for the camera knobs. Given a VP axis and
 * a desired image-plane position, returns the (yaw, pitch) in degrees that
 * places that VP at that position. Distance and focal are unchanged.
 *
 * Derivations (post pitch-sign fix, `forward.y = sin(pitch)`):
 *   VP_x = [ focal·cot(yaw)/cos(pitch),  -focal·tan(pitch) ]
 *   VP_y = [ 0,                           focal·cot(pitch) ]
 *   VP_z = [ -focal·tan(yaw)/cos(pitch), -focal·tan(pitch) ]
 *
 * Inverses use single-arg `atan` where the codomain (-π/2, π/2) is sufficient
 * — drags past that range would imply yaws outside ±90°, which alias onto VPs
 * with the same image_x via the (+d/-d) symmetry. Don't pretend the inverse
 * is unique past the principal branch.
 *
 * VP_y depends only on pitch (image_x always 0 with world-up [0,1,0] and no
 * camera roll), so dragging it horizontally has no effect.
 *
 * @param {'x'|'y'|'z'} axis
 * @param {import('./vec.js').Vec2} targetImage
 * @param {number} focal
 * @returns {{ yawDeg?: number, pitchDeg: number }}
 */
export const knobsFromVP = (axis, targetImage, focal) => {
  const [ix, iy] = targetImage
  const clampPitch = (rad) => {
    const lim = (89 * Math.PI) / 180
    return Math.max(-lim, Math.min(lim, rad))
  }
  if (axis === 'y') {
    // image_y = focal·cot(pitch) ⇒ tan(pitch) = focal/image_y
    // single-arg atan keeps pitch in (-π/2, π/2), bijective on iy ≠ 0.
    const pitch = clampPitch(Math.atan(focal / iy))
    return { pitchDeg: (pitch * 180) / Math.PI }
  }
  // For x and z axes: image_y is the horizon, image_y = -focal·tan(pitch).
  const pitch = clampPitch(Math.atan2(-iy, focal))
  const cp = Math.cos(pitch)
  let yaw
  if (axis === 'x') {
    // image_x = focal·cot(yaw)/cos(pitch) ⇒ tan(yaw) = focal/(image_x·cp)
    yaw = Math.atan(focal / (ix * cp))
  } else {
    // image_x = -focal·tan(yaw)/cos(pitch) ⇒ tan(yaw) = -image_x·cp/focal
    yaw = Math.atan2(-ix * cp, focal)
  }
  // wrap yaw into (-180, 180]
  let yawDeg = (yaw * 180) / Math.PI
  while (yawDeg > 180) yawDeg -= 360
  while (yawDeg <= -180) yawDeg += 360
  return { yawDeg, pitchDeg: (pitch * 180) / Math.PI }
}

/**
 * Inverse of `horizonImageY` for the pitch knob: given a target image_y for
 * the horizon and a focal length, returns the pitch (in degrees) that places
 * the horizon at that y. Camera yaw and other knobs unaffected.
 *
 * horizon_y = -focal·tan(pitch) ⇒ pitch = atan(-image_y / focal).
 *
 * @param {number} targetImageY
 * @param {number} focal
 * @returns {number} pitch in degrees, in (-90, 90).
 */
export const pitchFromHorizonY = (targetImageY, focal) => {
  const pitchRad = Math.atan2(-targetImageY, focal)
  return (pitchRad * 180) / Math.PI
}
