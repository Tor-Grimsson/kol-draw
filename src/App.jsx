import { useEffect, useState } from 'react'
import SvgView from './components/studio/SvgView.jsx'
import ThreeView from './components/studio/ThreeView.jsx'
import ShortcutsOverlay from './components/chrome/ShortcutsOverlay.jsx'
// Re-use the canonical icon SVGs as cursor URLs. The dedicated cursor
// glyphs in `16-miscellaneous` (cursor-selector, cursor-node) ship with
// explicit white-fill + black-stroke colours so they render legibly on
// any canvas tone. The pen-tool icon in `10-editing-content` uses
// `fill="currentColor"` (a fill-only icon designed for the toolbar);
// we import it via `?raw` and add a black outline at runtime so it
// stays visible against dark themes when used as a cursor.
import cursorSelectorUrl from './components/loaders/icons/svg/16-miscellaneous/cursor-selector.svg?url'
import cursorNodeUrl from './components/loaders/icons/svg/16-miscellaneous/cursor-node.svg?url'
import penIconRaw from './components/loaders/icons/svg/10-editing-content/pen.svg?raw'
import LayersPanel from './components/studio/LayersPanel.jsx'
import InspectorPanel from './components/studio/InspectorPanel.jsx'
import { ControlsPanel } from './components/studio/ControlsPanel.jsx'
import SideRail from './components/chrome/SideRail.jsx'
import TopBar from './components/chrome/TopBar.jsx'
import ViewToggle from './components/molecules/ViewToggle.jsx'
import Icon from './components/loaders/icons/Icon.jsx'
import { useScene } from './scene/store.js'
import { useKeyboardCamera, useSpacebarPan, useAltOrbit, useModifierResetOnBlur, usePenToolShortcuts, useDeleteShortcut, useEditingShortcuts } from './scene/useKeyboardCamera.js'
import { useSnapshotKey } from './scene/useSnapshotKey.js'

const VIEW_OPTIONS = [
  { value: 'svg',        label: 'SVG line view',  icon: 'pencil' },
  { value: 'three',      label: '3D solid view',  icon: 'shape-cube' },
  { value: 'three-wire', label: '3D wire view',   icon: 'line-grid' },
  { value: 'split',      label: 'Split view',     icon: 'columns' },
]

// Render pen icon as a visible cursor: white fill + black outline (paint-
// order: stroke puts the outline behind the fill so it reads as a halo).
const penCursorSvg = penIconRaw
  .replace(/fill="currentColor"/g, 'fill="white"')
  .replace('<svg ', '<svg style="paint-order:stroke;stroke:black;stroke-width:1.5;stroke-linejoin:round" ')
const penCursorUrl = `data:image/svg+xml;utf8,${encodeURIComponent(penCursorSvg)}`

/**
 * Per-tool cursor strings. Sourced from the canonical icon library so
 * the cursor matches whatever glyph the toolbar uses.
 *
 * Hotspot offsets calibrate the click point to the visible tip of each
 * cursor — for the arrow-style selector / node cursors that's the
 * upper-left arrow tip (3, 3); for the pen, the lower-left nib (4, 20).
 *
 * Fallback to a built-in cursor keyword if the icon URL fails to load.
 */
const TOOL_CURSORS = {
  select: `url("${cursorSelectorUrl}") 3 3, default`,
  node:   `url("${cursorNodeUrl}") 3 3, default`,
  pen:    `url("${penCursorUrl}") 4 20, crosshair`,
  // Scale uses the OS diagonal-resize cursor — no dedicated SVG glyph.
  // The canvas pointer is the gesture handle, not a positional pointer.
  scale:  'nwse-resize',
}

function App() {
  const viewMode = useScene((s) => s.viewMode)
  const setViewMode = useScene((s) => s.setViewMode)
  const tool = useScene((s) => s.tool)
  const setTool = useScene((s) => s.setTool)
  const finishPenDraft = useScene((s) => s.finishPenDraft)
  useKeyboardCamera()
  useSpacebarPan()
  useAltOrbit()
  useModifierResetOnBlur()
  useSnapshotKey()
  usePenToolShortcuts()
  useDeleteShortcut()
  useEditingShortcuts()

  // Global cursor indicator per active tool. Each tool gets its dedicated
  // SVG cursor (cursor-selector / cursor-node from the icon library, plus
  // the pen icon with a runtime-added halo so it stays visible against
  // dark themes). Restored on unmount.
  useEffect(() => {
    const prev = document.body.style.cursor
    const next = TOOL_CURSORS[tool]
    if (next) document.body.style.cursor = next
    return () => { document.body.style.cursor = prev }
  }, [tool])

  // Shortcuts overlay — toggled by `s`, dismissed by Esc. Lives in App-
  // local state since nothing else needs to read it. Esc precedence:
  // when the overlay is open it absorbs Esc; otherwise the pen-tool
  // shortcut handler still gets it for finishing drafts.
  const [showShortcuts, setShowShortcuts] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const tag = (t && t.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 's') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      } else if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShowShortcuts(false)
      }
    }
    // Capture phase so Esc handling here can stopImmediatePropagation
    // before the pen-tool's bubble-phase handler runs.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [showShortcuts])

  return (
    <div className="kol-brand-layout">
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <SideRail />
      <div className="min-w-0">
        <div className="kol-editor-shell">
          <TopBar />
          <div className="kol-editor-grid">
            <aside className="kol-editor-left">
              <ControlsPanel tabs={['Scene', 'Armature']} />
              <LayersPanel />
            </aside>

            <div className="kol-editor-canvas-column">
              <div className="kol-editor-canvas-header">
                <div className="flex items-center gap-3 px-3 h-10">
                  <ViewToggle options={VIEW_OPTIONS} viewMode={viewMode} onViewChange={setViewMode} variant="icon" />
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setTool('select')}
                      title="Select tool (V)"
                      aria-pressed={tool === 'select'}
                      className={`w-7 h-7 rounded inline-flex items-center justify-center transition-colors ${tool === 'select' ? 'bg-fg-08 text-emphasis' : 'text-meta hover:text-emphasis hover:bg-fg-04'}`}
                    >
                      <Icon name="cursor-selector" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTool('node')}
                      title="Node tool (A) — direct anchor / tangent edit"
                      aria-pressed={tool === 'node'}
                      className={`w-7 h-7 rounded inline-flex items-center justify-center transition-colors ${tool === 'node' ? 'bg-fg-08 text-emphasis' : 'text-meta hover:text-emphasis hover:bg-fg-04'}`}
                    >
                      <Icon name="cursor-node" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => (tool === 'pen' ? finishPenDraft() : setTool('pen'))}
                      title={tool === 'pen' ? 'Exit pen tool (Esc)' : 'Pen tool (P)'}
                      aria-pressed={tool === 'pen'}
                      className={`w-7 h-7 rounded inline-flex items-center justify-center transition-colors ${tool === 'pen' ? 'bg-fg-08 text-emphasis' : 'text-meta hover:text-emphasis hover:bg-fg-04'}`}
                    >
                      <Icon name="pen" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTool(tool === 'scale' ? 'select' : 'scale')}
                      title={tool === 'scale' ? 'Exit scale tool (K / Esc)' : 'Scale tool (K) — drag on canvas to scale selection'}
                      aria-pressed={tool === 'scale'}
                      className={`w-7 h-7 rounded inline-flex items-center justify-center transition-colors ${tool === 'scale' ? 'bg-fg-08 text-emphasis' : 'text-meta hover:text-emphasis hover:bg-fg-04'}`}
                    >
                      <Icon name="arrow-expand" size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <main className="kol-editor-canvas">
                {viewMode === 'svg' && <SvgView />}
                {(viewMode === 'three' || viewMode === 'three-wire') && (
                  // Same scene, same camera, same controls — only the
                  // render style changes. `clean` = solid shaded only;
                  // `!clean` = solid shaded + wireframe edges overlaid on
                  // top + helpers (Blender's "Solid + wireframe" mode).
                  <ThreeView clean={viewMode === 'three'} />
                )}
                {viewMode === 'split' && (
                  <div className="h-full grid grid-cols-2 divide-x divide-fg-08">
                    <SvgView />
                    <ThreeView />
                  </div>
                )}
              </main>
            </div>

            <aside className="kol-editor-right">
              <InspectorPanel />
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
