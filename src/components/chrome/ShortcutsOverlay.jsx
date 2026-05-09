import Icon from '../loaders/icons/Icon.jsx'

/**
 * Keyboard-shortcuts cheat sheet. Single source of truth for what's bound
 * where; surfaced via the `s` key. Grouped by intent so users can scan to
 * the section they care about.
 *
 * Layout: full-screen translucent backdrop + centered card. Click outside
 * the card or press `s` / `Esc` again to dismiss (parent owns the
 * keyboard handler).
 */

const GROUPS = [
  {
    label: 'Tools',
    items: [
      { keys: 'V', desc: 'Select tool — shape-level' },
      { keys: 'A', desc: 'Node tool — anchors / tangents' },
      { keys: 'P', desc: 'Pen tool — toggle on/off' },
      { keys: 'K', desc: 'Scale tool — drag canvas to scale selection' },
      { keys: 'Esc', desc: 'Finish pen draft / exit scale tool / dismiss overlay' },
      { keys: 'Enter', desc: 'Finish pen draft' },
      { keys: 'Alt (during pen-drag)', desc: 'Break tangent symmetry' },
      { keys: 'Cmd / Ctrl + drag edge', desc: 'Bend polyline segment' },
      { keys: 'Click open polyline endpoint (in pen mode)', desc: 'Resume drawing from that polyline' },
      { keys: 'Shift (during pen drag)', desc: 'Axis-lock tangent to nearest local axis' },
    ],
  },
  {
    label: 'Editing',
    items: [
      { keys: 'Delete  /  Backspace', desc: 'Remove selected shape(s)  •  pen mode: undo last anchor' },
      { keys: 'Cmd / Ctrl + D', desc: 'Duplicate selected shape(s)' },
      { keys: 'Cmd / Ctrl + A', desc: 'Select all visible shapes' },
      { keys: 'Cmd / Ctrl + I', desc: 'Invert selection' },
      { keys: 'Cmd / Ctrl + Z', desc: 'Undo' },
      { keys: 'Cmd / Ctrl + Shift + Z', desc: 'Redo' },
      { keys: 'Tab  /  Shift+Tab', desc: 'Cycle selection through visible shapes' },
      { keys: 'H  /  Shift + H', desc: 'Hide selected  /  show all hidden' },
      { keys: 'Cmd / Ctrl + ]   ↔   Cmd + [', desc: 'Bring forward  /  send back   (Shift = front / back)' },
      { keys: ',  /  .', desc: 'Scale selected  ×0.9 / ×1.1   (Shift = ×0.5 / ×2)' },
      { keys: 'Alt + click anchor', desc: 'Toggle anchor between corner ↔ smooth' },
      { keys: 'Shift + drag', desc: 'Marquee: add to selection  •  Pen click+drag: tangent' },
    ],
  },
  {
    label: 'Camera',
    items: [
      { keys: '←  →', desc: 'Yaw  ±5° (Shift = ×4)  •  with selection: nudge ±0.1' },
      { keys: '↑  ↓', desc: 'Pitch ±5° (Shift = ×4)  •  with selection: nudge ±0.1' },
      { keys: '[  ]', desc: 'Distance ±0.5 (Shift = ×4)' },
      { keys: '+  −', desc: 'Focal ±0.1' },
      { keys: 'R', desc: 'Reset perspective preset' },
      { keys: 'Space (hold)', desc: 'Pan camera (drag)' },
      { keys: 'Alt (hold)', desc: 'Orbit camera (drag)' },
    ],
  },
  {
    label: '3D view',
    items: [
      { keys: 'T', desc: 'Translate gizmo' },
      { keys: 'R', desc: 'Rotate gizmo' },
      { keys: 'E', desc: 'Scale gizmo' },
    ],
  },
  {
    label: 'Snapshots',
    items: [
      { keys: 'I', desc: 'Capture current canvas as overlay' },
      { keys: 'Shift+I', desc: 'Clear all snapshots' },
    ],
  },
  {
    label: 'Help',
    items: [
      { keys: 'S', desc: 'Toggle this shortcuts overlay' },
    ],
  },
]

const Kbd = ({ children }) => (
  <kbd className="font-mono text-[10px] bg-fg-08 text-emphasis px-1.5 py-0.5 rounded leading-none whitespace-nowrap">
    {children}
  </kbd>
)

export default function ShortcutsOverlay({ open, onClose }) {
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-surface-secondary border border-fg-08 rounded shadow-lg max-w-3xl w-[min(720px,90vw)] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-fg-08">
          <h2 className="kol-helper-12 uppercase tracking-wide text-emphasis">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-meta hover:text-emphasis hover:bg-fg-08"
          >
            <Icon name="cross" size={12} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col gap-1.5">
              <div className="kol-helper-10 uppercase tracking-wide text-meta mb-1">{g.label}</div>
              {g.items.map((it) => (
                <div key={it.keys} className="flex items-center justify-between gap-3 kol-helper-12 text-body">
                  <span className="text-meta truncate">{it.desc}</span>
                  <Kbd>{it.keys}</Kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-fg-08 kol-helper-10 text-meta">
          Press <Kbd>S</Kbd> or <Kbd>Esc</Kbd> to dismiss.
        </div>
      </div>
    </div>
  )
}
