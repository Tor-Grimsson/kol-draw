import Icon from '../loaders/icons/Icon'

/**
 * Button Component
 *
 * Unified button component supporting both link and button variants with optional icons
 * Uses design system classes from theme.css
 *
 * @param {Object} props
 * @param {ReactNode} props.children - Button content
 * @param {'primary'|'secondary'|'accent'|'outline'|'ghost'} props.variant - Visual variant
 * @param {'sm'|'md'|'lg'} props.size - Button size (default: 'md')
 * @param {string} props.iconLeft - Icon name to display on the left
 * @param {string} props.iconRight - Icon name to display on the right
 * @param {string} props.iconLeftHover - Icon to show on hover (left position)
 * @param {string} props.iconRightHover - Icon to show on hover (right position)
 * @param {string} props.iconOnly - Icon name for icon-only button
 * @param {string} props.iconOnlyHover - Icon to show on hover (icon-only)
 * @param {boolean} props.animateIcon - Disable default hover states to focus on icon animation
 * @param {boolean} props.quiet - Dimmed at rest, brightens on hover; stays dimmed when disabled. For secondary icon-only chrome.
 * @param {number} props.iconSize - Size of the icon in pixels (default: 16)
 * @param {string} props.href - Link destination (makes it an <a>)
 * @param {Function} props.onClick - Click handler (makes it a <button>)
 * @param {string} props.className - Additional classes
 * @param {Object} props.style - Inline styles
 * @param {string} props.type - Button type attribute (default: 'button')
 * @param {boolean} props.disabled - Disabled state
 */
const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  iconLeftHover,
  iconRightHover,
  iconOnly,
  iconOnlyHover,
  animateIcon = false,
  quiet = false,
  iconSize = 16,
  href,
  onClick,
  className = '',
  style = {},
  type = 'button',
  disabled = false,
  ...props
}) => {
  const variantClass = variant === 'primary'
    ? 'kol-btn-primary'
    : variant === 'accent'
    ? 'kol-btn-accent'
    : variant === 'outline'
    ? 'kol-btn-outline'
    : variant === 'ghost'
    ? 'kol-btn-ghost'
    : 'kol-btn-secondary'

  // Add size class — pairs the padding rule with its mono type class.
  const sizeClass = size === 'sm'
    ? 'kol-btn-sm kol-mono-12'
    : size === 'lg'
    ? 'kol-btn-lg kol-mono-16'
    : 'kol-btn-md kol-mono-14'

  // Add kol-btn-animate class if animateIcon is true to disable default hover states
  const animateClass = animateIcon ? 'kol-btn-animate' : ''
  const quietClass   = quiet ? 'kol-btn-quiet' : ''

  const combinedClass = `kol-btn ${variantClass} ${sizeClass} ${animateClass} ${quietClass} ${className}`.trim()

  // Render icon with optional hover state
  const renderIcon = (iconName, iconHoverName) => {
    if (!iconName && !iconHoverName) return null

    // If no hover icon, render single icon
    if (!iconHoverName) {
      return <Icon name={iconName} size={iconSize} />
    }

    // Render both default and hover icons with positioning
    return (
      <span className="kol-icon-swap-container" style={{ position: 'relative', display: 'inline-flex', width: iconSize, height: iconSize, overflow: 'hidden' }}>
        <Icon
          name={iconName}
          size={iconSize}
          className="kol-icon-default"
          style={{ position: 'absolute' }}
        />
        <Icon
          name={iconHoverName}
          size={iconSize}
          className="kol-icon-hover"
          style={{ position: 'absolute' }}
        />
      </span>
    )
  }

  // Render content with icons
  const renderContent = () => {
    // Icon-only button
    if (iconOnly) {
      return renderIcon(iconOnly, iconOnlyHover)
    }

    // Button with icon(s) and text
    if (iconLeft || iconRight || iconLeftHover || iconRightHover) {
      return (
        <span className="flex items-center gap-2">
          {(iconLeft || iconLeftHover) && renderIcon(iconLeft, iconLeftHover)}
          {children}
          {(iconRight || iconRightHover) && renderIcon(iconRight, iconRightHover)}
        </span>
      )
    }

    // Text-only button
    return children
  }

  // Merge icon-only specific styles with user-provided styles
  const mergedStyle = iconOnly
    ? { lineHeight: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }
    : style

  // Render as button
  if (onClick || !href) {
    return (
      <button
        onClick={onClick}
        type={type}
        className={combinedClass}
        style={mergedStyle}
        disabled={disabled}
        aria-label={iconOnly ? (props['aria-label'] || 'Button') : undefined}
        {...props}
      >
        {renderContent()}
      </button>
    )
  }

  // Render as link
  return (
    <a
      href={href}
      className={combinedClass}
      style={mergedStyle}
      aria-label={iconOnly ? (props['aria-label'] || 'Link') : undefined}
      {...props}
    >
      {renderContent()}
    </a>
  )
}

export default Button
