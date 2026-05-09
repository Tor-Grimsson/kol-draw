/**
 * PropertyInput — stacked label + input for inspector-style property panels.
 *   type="number" → Stepper (chevron buttons)
 *   type="text" / "color" / etc → Input (filled variant)
 *
 * Use in a `grid grid-cols-2 gap-4` for x/y/width/height/rotation row pairs.
 */
import Label from '../atoms/Label'
import Input from '../atoms/Input'
import Stepper from '../atoms/Stepper'

export default function PropertyInput({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  className = '',
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <Label className="kol-helper-10">{label}</Label>
      {type === 'number' ? (
        <Stepper value={value} onChange={onChange} min={min} max={max} step={step} />
      ) : (
        <Input type={type} value={value} onChange={onChange} className="w-full" />
      )}
    </div>
  )
}
