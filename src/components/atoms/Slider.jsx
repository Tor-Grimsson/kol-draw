import { useEffect, useMemo, useState } from 'react'
import Input from './Input'

/**
 * Slider Component
 *
 * Reusable range slider with label and value display.
 *
 * Variants (post-2026-04-30 restructure — bordered `default` retired):
 *   default — bare track + boxed value (was `minimal`). Most usage.
 *   subtle  — filled rounded chip; for inspector-style controls.
 *
 * Track color is exposed as the `--kol-slider-track` CSS variable on
 * `.slider-black`. Default = fg-64; subtle overrides to full ink.
 * Override per-instance via style={{ '--kol-slider-track': '...' }}.
 *
 * @param {Object} props
 * @param {string} props.label - Slider label text
 * @param {number} props.min - Minimum value
 * @param {number} props.max - Maximum value
 * @param {number} props.value - Current value
 * @param {Function} props.onChange - Change handler
 * @param {'default'|'subtle'} props.variant - Visual variant (default: 'default')
 * @param {string} props.className - Additional wrapper classes
 * @param {string} props.fontSize - Font size for label/value (e.g., '11px')
 * @param {number} props.step - Slider step increment (default: 1)
 * @param {Function} props.formatValue - Optional formatter for displayed value
 */
const Slider = ({
  label,
  min = 0,
  max = 100,
  value = 0,
  onChange,
  variant = 'default',
  className = '',
  fontSize,
  step = 1,
  formatValue
}) => {
  const handleChange = (e) => {
    if (onChange) {
      onChange(Number(e.target.value))
    }
  }

  const variantClass = variant === 'subtle' ? 'control-slider-subtle' : 'control-slider'
  const decimals = useMemo(() => {
    if (formatValue) return null
    if (!Number.isFinite(step)) return 0
    if (step >= 1) return 0
    const decimalPart = step.toString().split('.')[1]
    return decimalPart ? decimalPart.length : 2
  }, [formatValue, step])

  const displayValue = useMemo(() => {
    if (formatValue) return formatValue(value)
    if (decimals && decimals > 0) {
      return Number(value).toFixed(decimals)
    }
    return String(Math.round(value))
  }, [decimals, formatValue, value])

  /* Editable readout — local string state lets the user type intermediate
   * values (e.g. "-" while entering a negative) without clamping mid-keystroke.
   * Commits on blur / Enter; reverts to current value on Escape.
   *
   * The sync effect mirrors `displayValue` into `draft` when the user isn't
   * actively editing. The "cascading renders" lint warning trips because
   * setDraft schedules a follow-up render — that's the intent here, so the
   * draft can hydrate from upstream while the editor is dormant. */
  const [draft, setDraft]       = useState(displayValue)
  const [editing, setEditing]   = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!editing) setDraft(displayValue) }, [displayValue, editing])

  const commit = () => {
    setEditing(false)
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || onChange == null) {
      setDraft(displayValue)
      return
    }
    const clamped = Math.max(min, Math.min(max, parsed))
    onChange(clamped)
    setDraft(String(clamped))
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.currentTarget.blur() }
    if (e.key === 'Escape') { setDraft(displayValue); setEditing(false); e.currentTarget.blur() }
  }

  return (
    <div className={`${variantClass} gap-3 shadow-none ${className}`}>
      {label && (
        <label className="kol-helper-12 whitespace-nowrap shrink-0 w-fit" style={fontSize ? { fontSize } : undefined}>
          {label}
        </label>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="slider-black flex-1 w-full cursor-pointer"
      />
      <Input
        type="text"
        inputMode="decimal"
        variant="filled"
        size="sm"
        width={64}
        value={draft}
        onFocus={(e) => { setEditing(true); e.target.select() }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        inputClassName="text-center"
      />
    </div>
  )
}

export default Slider
