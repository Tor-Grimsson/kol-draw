/**
 * Serialize the studio's live SVG element and trigger a browser download.
 * Strips interaction-only artifacts (corner handles, transparent hit zones,
 * grab cursors) so the exported file is clean line art.
 *
 * Looks up the SVG via `[data-studio-svg]` rather than threading a ref
 * through every component — the studio currently renders at most one SVG
 * scene at a time, and the data-attribute is a stable contract.
 */
export const exportSvg = () => {
  const live = document.querySelector('svg[data-studio-svg]')
  if (!live) {
    console.warn('exportSvg: no SVG element found')
    return
  }
  const clone = live.cloneNode(true)

  // Drop interactive-only nodes (corner handles, invisible horizon hit area).
  // Corner handles use stroke="#08060d" but we keep them by default? They're
  // useful as anchors in printouts. Drop only the invisible hit zones —
  // anything with stroke="transparent".
  clone.querySelectorAll('[stroke="transparent"]').forEach((n) => n.remove())
  // Strip cursor / interaction classes so external SVG tools don't choke
  clone.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'))

  // Inline a white background since exported SVGs default to transparent.
  const vb = clone.getAttribute('viewBox')
  if (vb) {
    const [, , w, h] = vb.split(/\s+/).map(Number)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('x', '0')
    bg.setAttribute('y', '0')
    bg.setAttribute('width', String(w))
    bg.setAttribute('height', String(h))
    bg.setAttribute('fill', '#ffffff')
    clone.insertBefore(bg, clone.firstChild)
  }

  const xml = new XMLSerializer().serializeToString(clone)
  const blob = new Blob(
    ['<?xml version="1.0" encoding="UTF-8"?>\n', xml],
    { type: 'image/svg+xml' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kol-draw-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revoke so Firefox / Safari have time to actually start the
  // download — Chrome holds the URL alive across click() but the others
  // race the synchronous revoke and abort the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
