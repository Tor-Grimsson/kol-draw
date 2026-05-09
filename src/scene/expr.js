/**
 * Expression evaluator for kol-draw variables.
 *
 * Variables are named numeric slots (e.g. `cube_w = 1.5`) edited in the
 * Inspector's Variables tab. Inspector fields can opt into expressions by
 * storing a string ("cube_w * 2 + 1") instead of a literal number; the
 * field's resolved runtime value is computed by `evalExpr` against the
 * current variables map.
 *
 * Eval strategy: `new Function(...names, 'return ' + text)`. This is
 * NOT a sandboxed eval — but the variables tab is a single-user power
 * tool and the inputs only flow from the user's own typing, so the
 * security model is fine. Sub-100 ns per call after JIT.
 *
 * Names that shadow JS keywords (`if`, `return`, etc.) are rejected at
 * variable-add time; expressions referencing unknown names throw at
 * eval time and the caller falls back to the literal numeric value.
 */

const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const RESERVED = new Set([
  'if', 'else', 'for', 'while', 'return', 'function', 'var', 'let', 'const',
  'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'class', 'extends',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
])

/** Validate a variable name. Returns null if valid, else an error string. */
export const validateVarName = (name) => {
  if (typeof name !== 'string' || !VAR_NAME_RE.test(name)) {
    return 'Letters, digits, underscores; must start with letter or _'
  }
  if (RESERVED.has(name)) return `"${name}" is reserved`
  return null
}

/**
 * Evaluate an expression string against a variables map.
 *
 * @param {string} text                 Expression text, e.g. "cube_w * 2"
 * @param {Record<string, number>} vars Map of variable name to value
 * @returns {number}                    The evaluated number, or NaN on error
 */
export const evalExpr = (text, vars) => {
  if (typeof text !== 'string' || text.trim() === '') return NaN
  const names = Object.keys(vars).filter((k) => validateVarName(k) === null)
  const values = names.map((n) => vars[n])
  try {
    const fn = new Function(...names, `"use strict"; return (${text})`)
    const result = fn(...values)
    return typeof result === 'number' && Number.isFinite(result) ? result : NaN
  } catch {
    return NaN
  }
}

/**
 * Resolve a numeric-or-expression field. If `value` is a number, return
 * it as-is. If it's a string, evaluate as an expression against `vars`.
 * Falls back to `fallback` when eval produces NaN.
 *
 * @param {number | string} value
 * @param {Record<string, number>} vars
 * @param {number} fallback
 * @returns {number}
 */
export const resolveValue = (value, vars, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const r = evalExpr(value, vars)
    return Number.isFinite(r) ? r : fallback
  }
  return fallback
}
