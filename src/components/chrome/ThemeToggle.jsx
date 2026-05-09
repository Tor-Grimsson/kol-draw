import { useEffect, useState } from 'react'
import Icon from '../loaders/icons/Icon'

const STORAGE_KEY = 'kol-theme'

function getInitialTheme() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/**
 * Theme toggle — horizontal icon-swap button.
 *
 * Variants:
 *   icon     — minimal 32×32 icon-only button (no container chrome). For
 *              top-bar / nav-bar use where the toggle sits inline with other
 *              icon buttons.
 *   hop      — full-width labeled Button-primary-styled sidenav row
 *              (bg-fg-04, on-primary text). For sidenav rows where it pairs
 *              with other Button-primary "hop" entries.
 *   hop-bare — same shape + padding as hop, but fully transparent (no rest
 *              bg, no hover bg). For sidenav rows where the row should read
 *              as plain text + icon, not a button.
 *
 * Self-contained: owns theme state, writes `data-theme` to <html>, persists
 * to localStorage under `kol-theme`. The icon-swap animation slides a pair
 * of half-split theme-toggle icons horizontally — the `theme-toggle` SVG is
 * designed as a split circle, so the slide produces a visible light/dark flip.
 */
export default function ThemeToggle({ variant = 'icon', className = '' }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* storage blocked */ }
  }, [theme])

  const isDark = theme === 'dark'
  const next = isDark ? 'light' : 'dark'
  const handleToggle = () => setTheme(next)

  const iconSwap = (size) => (
    <span
      className="relative inline-block overflow-hidden"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="flex transition-transform duration-500 ease-in-out"
        style={{ width: size * 2, transform: isDark ? 'translateX(0)' : `translateX(-${size}px)` }}
      >
        <Icon name="theme-toggle" size={size} />
        <Icon name="theme-toggle" size={size} />
      </span>
    </span>
  )

  if (variant === 'hop' || variant === 'hop-bare') {
    const bare = variant === 'hop-bare'
    const chromeCls = bare
      ? 'w-full inline-flex items-center justify-start gap-2 py-1.5 px-6 kol-mono-14 bg-transparent text-emphasis transition-colors'
      : 'kol-btn kol-btn-primary kol-btn-md kol-mono-14 w-full justify-start gap-2'
    return (
      <button
        type="button"
        onClick={handleToggle}
        aria-label={`Switch to ${next} mode`}
        className={`${chromeCls} ${className}`.trim()}
      >
        <span className="inline-flex items-center justify-center shrink-0" aria-hidden="true">
          {iconSwap(16)}
        </span>
        {/* kol-sidenav-hop-label keeps the responsive label-hide rule firing
         * at narrow viewports without subjecting the button to the muted
         * sidenav-hop text-color override. */}
        <span className="kol-sidenav-hop-label flex-1 min-w-0 text-left">
          {isDark ? 'Dark mode' : 'Light mode'}
        </span>
      </button>
    )
  }

  // variant === 'icon' (default)
  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`inline-flex items-center justify-center w-8 h-8 p-0 bg-transparent border-0 cursor-pointer text-emphasis hover:opacity-80 transition-opacity duration-300 ${className}`.trim()}
    >
      {iconSwap(18)}
    </button>
  )
}
