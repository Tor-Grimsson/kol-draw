/**
 * Icon Component
 *
 * Dynamically loads and renders SVG icons from the svg/ directory (including subdirectories)
 *
 * @param {Object} props
 * @param {string} props.name - Icon name (matches SVG filename without extension)
 * @param {number|string} props.size - Icon size (default: 16)
 * @param {string} props.className - Additional classes
 * @param {Object} props.style - Inline styles
 * @param {ReactNode} props.children - Optional: Direct SVG path content for custom icons
 */
const svgModules    = import.meta.glob('./svg/**/*.svg',    { eager: true, query: '?raw', import: 'default' })
const kolSvgModules = import.meta.glob('./svg/00-kol/*.svg', { eager: true, query: '?raw', import: 'default' })

/* 00-kol/ is the canonical KOL stroke set. Build the cache from every folder
 * first, then overlay 00-kol/ on top so its versions win for any name that
 * also exists elsewhere (e.g. eye-off, lock, plus, trash — which had legacy
 * fill variants in other buckets). */
const ICON_CACHE = (() => {
  const cache = {}
  for (const [path, svg] of Object.entries(svgModules)) {
    const name = (path.split('/').pop() || '').replace('.svg', '')
    cache[name] = svg
  }
  for (const [path, svg] of Object.entries(kolSvgModules)) {
    const name = (path.split('/').pop() || '').replace('.svg', '')
    cache[name] = svg
  }
  return cache
})()

const normalizeSize = (value) => {
  if (typeof value === 'number') {
    return `${value}px`
  }
  if (typeof value === 'string') {
    return value
  }
  return '16px'
}

const applySizeToMarkup = (markup, sizeValue) => {
  let updated = markup

  if (/width="/i.test(updated)) {
    updated = updated.replace(/width="[^"]*"/i, `width="${sizeValue}"`)
  } else {
    updated = updated.replace('<svg', `<svg width="${sizeValue}"`)
  }

  if (/height="/i.test(updated)) {
    updated = updated.replace(/height="[^"]*"/i, `height="${sizeValue}"`)
  } else {
    updated = updated.replace('<svg', `<svg height="${sizeValue}"`)
  }

  return updated
}

const Icon = ({
  name,
  size = 16,
  className = '',
  style = {},
  children
}) => {
  // If children are provided, render directly (for custom icons)
  if (children) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className={`inline-block ${className}`}
        style={{
          verticalAlign: 'middle',
          ...style
        }}
      >
        {children}
      </svg>
    )
  }

  const svgMarkup = ICON_CACHE[name]

  if (!svgMarkup) {
    console.warn(`Icon "${name}" not found in svg directory`)
    return null
  }

  const dimension = normalizeSize(size)
  const sizedMarkup = applySizeToMarkup(svgMarkup, dimension)

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: dimension,
        height: dimension,
        lineHeight: 0,
        ...style
      }}
      dangerouslySetInnerHTML={{ __html: sizedMarkup }}
    />
  )
}

export default Icon
