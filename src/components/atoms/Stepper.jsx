/**
 * Stepper — number input + chevron buttons, built on the .kol-control shell.
 *
 *   size="sm" (default) / "md" / "lg" — matched padding + type class.
 *   Chevron scale follows the size: 8 / 10 / 12 px each, stacked.
 *
 * Loaded from `00-kol/chevron-{up,down}.svg` via the Icon registry — first
 * stroke icons in the kol curated set. For a plain number input without
 * bump affordance, use `<Input type="number" />`.
 */
import Icon from '../loaders/icons/Icon'

const SIZE_TYPE    = { sm: 'kol-mono-12', md: 'kol-mono-14', lg: 'kol-mono-16' }
const CHEVRON_SIZE = { sm: 8,             md: 10,            lg: 12 }

export default function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  size = 'sm',
  className = '',
  style = {},
  ...props
}) {
  const handleIncrement = () => {
    const newValue = Number(value) + step
    if (max !== undefined && newValue > max) return
    onChange?.({ target: { value: newValue } })
  }

  const handleDecrement = () => {
    const newValue = Number(value) - step
    if (min !== undefined && newValue < min) return
    onChange?.({ target: { value: newValue } })
  }

  const handleInputChange = (e) => {
    const newValue = e.target.value
    if (newValue === '' || newValue === '-') { onChange?.(e); return }
    const numValue = Number(newValue)
    if (isNaN(numValue)) return
    if (min !== undefined && numValue < min) return
    if (max !== undefined && numValue > max) return
    onChange?.(e)
  }

  const shellCls = [
    'kol-control',
    'kol-control--filled',
    `kol-control-${size}`,
    SIZE_TYPE[size],
    'relative',
    className,
  ].filter(Boolean).join(' ')

  /* Reserve right space inside the input so the value never tucks under the
   * chevrons. Chevrons themselves are absolute — shell height stays driven
   * by the input's line-height, not by chevron stack height. */
  const chevronWidth = CHEVRON_SIZE[size]
  const inputPaddingRight = chevronWidth + 4

  return (
    <div className={shellCls} style={style}>
      <input
        type="number"
        value={value ?? ''}
        onChange={handleInputChange}
        min={min}
        max={max}
        step={step}
        className="w-full min-w-0 bg-transparent border-none outline-none text-auto hide-number-spinners"
        style={{ paddingRight: `${inputPaddingRight}px` }}
        {...props}
      />
      <div className="absolute top-1/2 -translate-y-1/2 right-2 flex flex-col shrink-0 leading-none">
        <button
          type="button"
          onClick={handleIncrement}
          className="flex items-center justify-center text-meta hover:text-emphasis transition-colors"
          aria-label="Increment"
        >
          <Icon name="chevron-up" size={chevronWidth} />
        </button>
        <button
          type="button"
          onClick={handleDecrement}
          className="flex items-center justify-center text-meta hover:text-emphasis transition-colors"
          aria-label="Decrement"
        >
          <Icon name="chevron-down" size={chevronWidth} />
        </button>
      </div>
    </div>
  )
}
