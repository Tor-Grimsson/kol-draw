/**
 * Input — single-input atom built on the .kol-control shell.
 *
 *   variant="filled" (default) — persistent solid bg
 *   variant="ghost"            — borderless at rest, reveals on hover/focus
 *   variant="outline"          — bordered, transparent bg (also: the
 *                                forced-reveal / "is-edited" state of a
 *                                ghost field — flip variant to outline)
 *
 *   size="sm" / "md" (default) / "lg" — matched padding + type class
 *
 * Sizing:
 *   chars — HTML `size` attribute on the inner input. When set, the inner
 *     <input> sizes to N characters and the shell hugs (padding + prefix +
 *     N chars + suffix + padding). Use for known-format values (hex,
 *     percentage, integer counts). Drops `flex-1` so the input doesn't
 *     overflow into empty trailing space.
 *   width — explicit shell width override (e.g. "100%", "240px"). For
 *     stretch behavior, set the shell width and let the inner input fill.
 *
 * Props:
 *   prefix / suffix — small static text (e.g. "#", "%") rendered inside
 *     the shell at text-meta. aria-hidden — affordances, not labels.
 *   uppercase — adds Tailwind `uppercase` to the input element only.
 *
 * Chrome (bg/border/padding/transition/disabled) comes from .kol-control;
 * Input owns prefix/suffix layout + the inner <input> styling.
 */

const SIZE_TYPE = { sm: 'kol-mono-12', md: 'kol-mono-14', lg: 'kol-mono-16' }

export default function Input({
  type = 'text',
  value,
  onChange,
  variant = 'filled',
  size = 'md',
  chars,
  prefix,
  suffix,
  placeholder,
  disabled = false,
  uppercase = false,
  width,
  className = '',
  inputClassName = '',
  ...inputProps
}) {
  const isNumber = type === 'number'
  const fixedChars = typeof chars === 'number'

  const shellCls = [
    'kol-control',
    `kol-control--${variant}`,
    `kol-control-${size}`,
    SIZE_TYPE[size],
    'cursor-text',
    className,
  ].filter(Boolean).join(' ')

  /* Pin inner input height to the typography token's line-height. Without
   * this the `<input>` renders ~0.5px taller than the equivalent <button>
   * or <label> at the same kol-mono-N — Chromium computes input height
   * from the font's ascender+descender (font-metric), not strictly from
   * CSS line-height. Result: kol-control-sm ends up 26.5px instead of 26.
   * h-4 / h-[18px] / h-[22px] match the kol-mono-12 / -14 / -16 line-heights. */
  const heightCls = size === 'sm' ? 'h-4' : size === 'md' ? 'h-[18px]' : 'h-[22px]'

  const inputCls = [
    'min-w-0 bg-transparent border-none outline-none text-auto',
    heightCls,
    !fixedChars && 'flex-1',
    /* Balance the dim prefix/suffix visual weight with extra inner padding
     * on the opposite side. Without this the bright value sits closer to
     * the affordance than to the empty edge, reads off-balance. */
    prefix !== undefined && 'pr-1',
    suffix !== undefined && 'pl-1',
    uppercase && 'uppercase',
    isNumber && 'hide-number-spinners',
    inputClassName,
  ].filter(Boolean).join(' ')

  return (
    <label
      className={shellCls}
      style={width ? { width: typeof width === 'number' ? `${width}px` : width } : undefined}
      aria-disabled={disabled || undefined}
    >
      {prefix !== undefined && (
        <span aria-hidden="true" className="text-meta pr-1 shrink-0">{prefix}</span>
      )}
      <input
        type={type}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        size={fixedChars ? chars : undefined}
        className={inputCls}
        {...inputProps}
      />
      {suffix !== undefined && (
        <span aria-hidden="true" className="text-meta pl-1 shrink-0">{suffix}</span>
      )}
    </label>
  )
}
