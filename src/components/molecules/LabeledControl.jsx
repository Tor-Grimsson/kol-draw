/**
 * LabeledControl — generic slot for label + interactive control body.
 *
 * Default layout: label on top (`flex-col`). Pass `inline` for a horizontal
 * label-left / control-right layout (label fixed-width, control flex-1).
 *
 * Compose with any control as children:
 *   <LabeledControl label="Columns · 4">
 *     <Slider ... />
 *   </LabeledControl>
 *   <LabeledControl inline label="Weight">
 *     <Input ... />
 *   </LabeledControl>
 *
 * Props:
 *   label  — small label text (uppercase, kol-helper-10).
 *   hint   — optional secondary text after the label (lower-case, less
 *            weight). Useful for current-value displays, units, etc.
 *   inline — bool. When true, renders horizontally with label on the left.
 *   labelWidth — px width for the label column when `inline`. Default 48.
 *   children — the control body.
 *   className — additional classes on the wrapper.
 */
export default function LabeledControl({
  label,
  hint,
  inline = false,
  labelWidth = 48,
  children,
  className = '',
}) {
  const showLabel  = !!label
  const labelInner = (
    <>
      {label}
      {hint !== undefined && (
        <span className="ml-2 normal-case tracking-normal text-subtle">{hint}</span>
      )}
    </>
  )

  if (inline) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        {showLabel && (
          <span
            className="kol-helper-10 uppercase tracking-widest text-meta shrink-0"
            style={{ width: labelWidth }}
          >
            {labelInner}
          </span>
        )}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {showLabel && (
        <span className="kol-helper-10 uppercase tracking-widest text-meta">{labelInner}</span>
      )}
      {children}
    </div>
  )
}
