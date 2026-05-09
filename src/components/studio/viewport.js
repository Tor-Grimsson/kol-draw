/**
 * Shared viewport constants for the SVG and 3D renderers. Both views must
 * frame the scene identically — keeping the constants here means there's
 * exactly one place to change the canvas extent or world-units-per-pixel
 * mapping, and the FOV math in ThreeView is anchored to the same numbers
 * SvgView uses for its image-space projection.
 */

export const VIEWBOX_W = 1000
export const VIEWBOX_H = 700
/** Pixels per world-unit at unit depth (image-plane scale factor). */
export const SCALE = 500

/**
 * Vertical full-FOV (in degrees) for a Three.PerspectiveCamera that frames
 * the scene the same way the SVG view does, given a focal length in
 * "world units at unit depth."
 *
 * Derivation: SvgView's pinhole math returns image_y in world units at
 * unit depth, then maps to pixels via `image_y * SCALE`. The half-extent
 * of the canvas (in world units) is therefore `VIEWBOX_H / 2 / SCALE`.
 * For a Three camera with the same image plane, the half-vertical-FOV is
 * `atan(half-extent / focal)`.
 */
export const fovDegFromFocal = (focal) => {
  const halfExtent = VIEWBOX_H / 2 / SCALE
  return (2 * Math.atan(halfExtent / focal) * 180) / Math.PI
}
