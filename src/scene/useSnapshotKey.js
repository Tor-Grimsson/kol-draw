import { useEffect } from 'react'
import { useScene } from './store.js'

/**
 * Capture the live SVG canvas as an SVG data URL. Strips interaction-only
 * artifacts (corner handles, transparent hit zones, drag-only chrome) so
 * the overlay reads as a clean ghost of the geometry.
 */
const captureSvgSnapshot = () => {
  const live = document.querySelector('svg[data-studio-svg]')
  if (!live) return null
  const clone = live.cloneNode(true)
  // Drop transparent hit-targets and the corner / anchor / VP handles —
  // those are tools, not picture content.
  clone.querySelectorAll('[stroke="transparent"]').forEach((n) => n.remove())
  clone.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'))
  // Remove existing snapshots-in-snapshot to keep ghosts from compounding.
  clone.querySelectorAll('image[data-snapshot]').forEach((n) => n.remove())
  const xml = new XMLSerializer().serializeToString(clone)
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
}

/**
 * 'i'        — capture the current canvas as a translucent overlay (stack on top)
 * Shift+'I' — clear all overlays
 *
 * Useful for comparing perspectives: capture one view, change camera or
 * mode, see the new view layered over the previous as a ghost reference.
 *
 * 's' is reserved for the keyboard-shortcuts overlay (`useShortcutsOverlay`).
 */
export function useSnapshotKey() {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const tag = (t && t.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() !== 'i') return
      e.preventDefault()
      if (e.shiftKey) {
        useScene.getState().clearSnapshots()
      } else {
        const url = captureSvgSnapshot()
        if (url) useScene.getState().addSnapshot(url)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
