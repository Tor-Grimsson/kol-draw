/**
 * Plain-function vector ops. All vectors are tuples of numbers.
 * @typedef {[number, number]} Vec2
 * @typedef {[number, number, number]} Vec3
 */

/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** @type {(a: Vec3, s: number) => Vec3} */
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
/** @type {(a: Vec3, b: Vec3) => number} */
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** @type {(a: Vec3) => number} */
export const len3 = (a) => Math.hypot(a[0], a[1], a[2])
/** @type {(a: Vec3) => Vec3} */
export const norm3 = (a) => {
  const l = len3(a)
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
}

/** @type {(a: Vec2, b: Vec2) => Vec2} */
export const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]]
/** @type {(a: Vec2, b: Vec2) => Vec2} */
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]]
/** @type {(a: Vec2, s: number) => Vec2} */
export const scale2 = (a, s) => [a[0] * s, a[1] * s]
/** @type {(a: Vec2) => number} */
export const len2 = (a) => Math.hypot(a[0], a[1])
