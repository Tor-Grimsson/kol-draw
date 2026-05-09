import Icon from '../loaders/icons/Icon'

/**
 * ViewToggle — control for switching between view modes.
 *
 *   variant="text"   — segmented bare buttons; active uses kol-control--filled,
 *                      inactive is bare text-meta with text-emphasis on hover.
 *   variant="icon"   — bordered chip-row container holding square icon
 *                      buttons. Active uses bg-fg-absolute-24.
 *   variant="single" — single button binary toggle. Click flips between the
 *                      two `options` values. The button shows the *current*
 *                      option's label; active = on (kol-control--filled),
 *                      inactive = off (bare text). Use for compact on/off
 *                      where a segmented two-button toggle is overkill.
 *
 * Built on the .kol-control shell. Default options use grid-06 / list-01
 * icons; consumers can pass `options` to override. For `variant="single"`,
 * the FIRST option in `options` is the "off" value; the SECOND is "on".
 */
const ViewToggle = ({
  viewMode,
  onViewChange,
  variant = 'text',
  options = [
    { value: 'grid', label: 'Grid view', icon: 'grid-06' },
    { value: 'list', label: 'List view', icon: 'list-01' }
  ],
  className = ''
}) => {
  const isIconVariant   = variant === 'icon'
  const isSingleVariant = variant === 'single'

  if (isSingleVariant) {
    const [offOpt, onOpt] = options
    const isOn = viewMode === onOpt.value
    const next = isOn ? offOpt.value : onOpt.value
    const cls  = isOn
      ? `kol-control kol-control--filled kol-control-sm kol-mono-12 ${className}`
      : `kol-control kol-control-sm kol-mono-12 text-meta hover:text-emphasis ${className}`
    /* Both labels stack in a single grid cell so the button width is fixed
     * to the longer label — flipping state never reflows the row. */
    return (
      <button
        type="button"
        onClick={() => onViewChange(next)}
        className={cls}
        aria-pressed={isOn}
        title={isOn ? onOpt.label : offOpt.label}
      >
        <span className="grid">
          <span className={`col-start-1 row-start-1 ${isOn ? '' : 'invisible'}`}>{onOpt.label}</span>
          <span className={`col-start-1 row-start-1 ${isOn ? 'invisible' : ''}`}>{offOpt.label}</span>
        </span>
      </button>
    )
  }

  const containerClasses = isIconVariant
    ? `inline-flex items-center gap-1 p-1 bg-surface-secondary rounded ${className}`
    : `flex gap-2 ${className}`

  const buttonClasses = (isActive) => {
    if (isIconVariant) {
      // Inset "well" pattern — container is bg-fg-04 (slight lift from page),
      // active button uses bg-fg-absolute-24 (theme-invariant black, always
      // darkens regardless of theme) so it reads as recessed/pressed.
      return `inline-flex items-center justify-center p-1.5 rounded transition-colors text-emphasis cursor-pointer ${
        isActive ? 'bg-fg-absolute-24' : 'hover:bg-fg-absolute-08'
      }`
    }
    /* Active = filled chip. Inactive = bare-text on the shell base — no
     * border-reveal hover. (Earlier ghost variant revealed an outline on
     * hover; that's deliberately gone.) */
    return isActive
      ? 'kol-control kol-control--filled kol-control-sm kol-mono-12'
      : 'kol-control kol-control-sm kol-mono-12 text-meta hover:text-emphasis'
  }

  return (
    <div className={containerClasses}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onViewChange(option.value)}
          className={buttonClasses(viewMode === option.value)}
          aria-label={option.label}
          aria-pressed={viewMode === option.value}
          title={option.label}
        >
          {isIconVariant && option.icon ? (
            <Icon name={option.icon} size={14} />
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  )
}

export default ViewToggle
