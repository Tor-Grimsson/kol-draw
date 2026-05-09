import { useEffect } from 'react'
import { useScene } from './store.js'

/**
 * Global keyboard controls for the camera. Mounted once at the app root.
 *
 * Bindings:
 *   ArrowLeft  / ArrowRight   – yaw  ∓ 5°
 *   ArrowUp    / ArrowDown    – pitch ∓ 5°  (Up = look up)
 *   Shift+Arrows              – 4× faster
 *   + / =                     – zoom in  (focal +0.1)
 *   - / _                     – zoom out (focal -0.1)
 *   [ / ]                     – distance ±0.5
 *   R                         – reset current perspective preset
 *
 * Spacebar is *not* handled here — it's a hold-to-pan modifier consumed by
 * SvgView (see `panActiveRef`). Press-and-hold space, then click-drag in the
 * canvas to slide the camera laterally without rotating it.
 *
 * Inputs are ignored when the user is typing in a form/leva field.
 */
export function useKeyboardCamera() {
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target
      const tag = (target && target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      // Don't hijack browser shortcuts (Cmd+R refresh, Cmd+= zoom, etc.).
      // Shift on its own is fine — used as a 4× speed modifier here.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const state = useScene.getState()
      const { knobs, mode, setKnobs, setMode } = state
      const speed = e.shiftKey ? 4 : 1

      // Arrow keys: when something is selected, nudge the selection in
      // world space (Illustrator convention). When the selection is
      // empty, fall through to camera yaw / pitch (existing behavior).
      // Shift = 4× step in either case.
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      if (isArrow && state.selectedIds.length > 0) {
        e.preventDefault()
        const step = 0.1 * speed
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
        state.pushHistory()
        for (const id of state.selectedIds) {
          const c = state.cuboids.find((cc) => cc.id === id)
          if (!c) continue
          state.updateCuboid(id, {
            center: [c.center[0] + dx, c.center[1] + dy, c.center[2]],
          })
        }
        return
      }

      let handled = true
      switch (e.key) {
        case 'ArrowLeft':
          setKnobs({ yawDeg: knobs.yawDeg - 5 * speed })
          break
        case 'ArrowRight':
          setKnobs({ yawDeg: knobs.yawDeg + 5 * speed })
          break
        case 'ArrowUp':
          setKnobs({ pitchDeg: knobs.pitchDeg - 5 * speed })
          break
        case 'ArrowDown':
          setKnobs({ pitchDeg: knobs.pitchDeg + 5 * speed })
          break
        case '+':
        case '=':
          setKnobs({ focal: knobs.focal + 0.1 })
          break
        case '-':
        case '_':
          setKnobs({ focal: knobs.focal - 0.1 })
          break
        case '[':
          setKnobs({ distance: knobs.distance - 0.5 * speed })
          break
        case ']':
          setKnobs({ distance: knobs.distance + 0.5 * speed })
          break
        case 'r':
        case 'R':
          setMode(mode)
          break
        default:
          handled = false
      }
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Module-scope flags set by held modifiers. SvgView reads these during
 * pointerdown to decide whether a gesture is normal (face/handle drag),
 * a spacebar-held pan, or an alt-held orbit. Using module refs instead of
 * state avoids re-rendering everyone every keystroke.
 */
export const panActiveRef = { current: false }
export const orbitActiveRef = { current: false }

const resetModifiers = () => {
  panActiveRef.current = false
  orbitActiveRef.current = false
  document.body.style.cursor = ''
}

const isTyping = (e) => {
  const t = e.target
  const tag = (t && t.tagName) || ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable
}

/**
 * Reset modifier refs when the window loses focus or the tab is hidden, so
 * modifiers can't get stuck "held" after alt-tab / cmd-tab / etc. Mount
 * once at root.
 */
export function useModifierResetOnBlur() {
  useEffect(() => {
    const onBlur = () => resetModifiers()
    const onVisibility = () => { if (document.hidden) resetModifiers() }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}

/** Wire spacebar press/release to flip `panActiveRef`. Mount once at root. */
export function useSpacebarPan() {
  useEffect(() => {
    const down = (e) => {
      if (e.code !== 'Space' || isTyping(e)) return
      // Bail on browser-shortcut combos (Cmd+Space = Spotlight, Ctrl+Space =
      // Linux composition switch, etc.) so we don't preventDefault them.
      if (e.metaKey || e.ctrlKey) return
      // Pen tool owns the pointer — don't let space-pan steal cursor focus.
      if (useScene.getState().tool === 'pen') return
      e.preventDefault()
      if (!panActiveRef.current) {
        panActiveRef.current = true
        if (!orbitActiveRef.current) document.body.style.cursor = 'grab'
      }
    }
    const up = (e) => {
      if (e.code !== 'Space' || isTyping(e)) return
      panActiveRef.current = false
      if (!orbitActiveRef.current) document.body.style.cursor = ''
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      if (!orbitActiveRef.current) document.body.style.cursor = ''
    }
  }, [])
}

/**
 * Alt (option on macOS) held → camera orbit modifier. Mirrors the standard
 * 3D-app pattern: hold Alt, click-drag in the canvas, camera orbits around
 * the pivot. Released → handler restored to normal.
 */
export function useAltOrbit() {
  useEffect(() => {
    const down = (e) => {
      // Tighten trigger: only the actual Alt key, not any handler that happens
      // to have e.altKey set as a side-effect of a browser-shortcut combo.
      if (e.key !== 'Alt' || isTyping(e)) return
      // Bail when Cmd/Ctrl is also held — those are browser shortcuts.
      if (e.metaKey || e.ctrlKey) return
      // Pen tool owns the pointer — Alt is the tangent-symmetry-breaking
      // modifier for pen drag, not an orbit trigger.
      if (useScene.getState().tool === 'pen') return
      if (!orbitActiveRef.current) {
        orbitActiveRef.current = true
        document.body.style.cursor = 'all-scroll'
      }
    }
    const up = (e) => {
      if (e.key !== 'Alt') return
      orbitActiveRef.current = false
      if (!panActiveRef.current) document.body.style.cursor = ''
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      if (!panActiveRef.current) document.body.style.cursor = ''
    }
  }, [])
}

/**
 * Tool keyboard shortcuts (Illustrator-style):
 *   v          — select tool (shape-level).
 *   a          — node tool (direct selection / anchors).
 *   p          — pen tool (toggle on/off).
 *   Esc, Enter — when in pen mode, finish the current draft.
 *
 * Bails on browser-shortcut combos and typed targets per the same rules
 * as `useKeyboardCamera`. Mount once at root.
 */
export function usePenToolShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e)) return
      const { tool, setTool, finishPenDraft } = useScene.getState()
      if (e.key === 'v') {
        e.preventDefault()
        setTool('select')
      } else if (e.key === 'a') {
        e.preventDefault()
        setTool('node')
      } else if (e.key === 'p') {
        e.preventDefault()
        setTool(tool === 'pen' ? 'select' : 'pen')
      } else if (e.key === 'k') {
        // Scale tool — drag on canvas scales selection from its centroid.
        // Press again to exit back to select.
        e.preventDefault()
        setTool(tool === 'scale' ? 'select' : 'scale')
      } else if ((e.key === 'Escape' || e.key === 'Enter') && (tool === 'pen' || tool === 'scale')) {
        e.preventDefault()
        if (tool === 'pen') finishPenDraft()
        else setTool('select')
      } else if (e.key === 'Tab') {
        // Tab / Shift+Tab cycle selection through visible shapes in
        // creation order. Wraps. Useful for keyboard-only walking
        // through a scene without aiming.
        e.preventDefault()
        const state = useScene.getState()
        const visible = state.cuboids.filter((c) => !c.hidden)
        if (visible.length === 0) return
        const currentIdx = state.selectedCuboidId
          ? visible.findIndex((c) => c.id === state.selectedCuboidId)
          : -1
        const dir = e.shiftKey ? -1 : 1
        const nextIdx = (currentIdx + dir + visible.length) % visible.length
        state.setSelectedCuboid(visible[nextIdx].id)
      } else if (e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>') {
        // Uniform scale of the selection. `,` shrinks, `.` grows. Step
        // sizes 0.9 / 1.1 by default; Shift (renders as `<` / `>` on US
        // layout) bumps to 0.5 / 2.0 for fast resizing.
        const state = useScene.getState()
        if (state.selectedIds.length === 0) return
        e.preventDefault()
        const isShrink = e.key === ',' || e.key === '<'
        const isLarge = e.shiftKey || e.key === '<' || e.key === '>'
        const factor = isShrink ? (isLarge ? 0.5 : 0.9) : (isLarge ? 2.0 : 1.1)
        state.pushHistory()
        for (const id of state.selectedIds) state.scaleShape(id, factor)
      } else if (e.key === 'h' || e.key === 'H') {
        const state = useScene.getState()
        if (e.shiftKey) {
          // Shift+H — un-hide every hidden shape (Blender's Alt+H).
          // Single history entry for the whole batch.
          e.preventDefault()
          const hasHidden = state.cuboids.some((c) => c.hidden)
          if (!hasHidden) return
          state.pushHistory()
          for (const c of state.cuboids) {
            if (c.hidden) state.updateCuboid(c.id, { hidden: false })
          }
        } else {
          // H — toggle visibility of selection.
          if (state.selectedIds.length === 0) return
          e.preventDefault()
          for (const id of state.selectedIds) state.toggleCuboidVisibility(id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Cmd / Ctrl-modifier editing shortcuts:
 *   Cmd+D — duplicate selected shape(s) at +0.5 offset along X+Z;
 *           the new copies become the selection.
 *   Cmd+A — select all visible shapes.
 *
 * `usePenToolShortcuts` and `useDeleteShortcut` BAIL on metaKey/ctrlKey
 * to leave browser shortcuts (Cmd+R reload, Cmd+S save, etc.) intact —
 * this hook deliberately runs only WHEN those modifiers are held, with
 * a dedicated whitelist of letter keys.
 */
export function useEditingShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (isTyping(e)) return
      const state = useScene.getState()
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        if (state.selectedIds.length === 0) return
        const dupes = []
        for (const id of state.selectedIds) {
          const orig = state.cuboids.find((c) => c.id === id)
          if (!orig) continue
          const dup = {
            ...orig,
            id: `s-${Math.random().toString(36).slice(2, 8)}`,
            center: [orig.center[0] + 0.5, orig.center[1], orig.center[2] + 0.5],
          }
          state.addCuboid(dup)
          dupes.push(dup.id)
        }
        if (dupes.length > 0) state.setSelection(dupes)
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        const ids = state.cuboids.filter((c) => !c.hidden).map((c) => c.id)
        state.setSelection(ids)
      } else if (e.key === 'i' || e.key === 'I') {
        // Cmd+I — invert selection across visible shapes.
        e.preventDefault()
        const visible = state.cuboids.filter((c) => !c.hidden)
        const sel = new Set(state.selectedIds)
        state.setSelection(visible.filter((c) => !sel.has(c.id)).map((c) => c.id))
      } else if (e.key === 'z' || e.key === 'Z') {
        // Cmd+Z = undo, Cmd+Shift+Z = redo. Standard combo.
        e.preventDefault()
        if (e.shiftKey) state.redo()
        else state.undo()
      } else if (e.key === ']') {
        // Cmd+] = bring forward one step  •  Cmd+Shift+] = to front.
        // Operates on the first selected shape; multi-select z-order
        // is uncommon enough to defer.
        if (state.selectedIds.length === 0) return
        e.preventDefault()
        const id = state.selectedIds[0]
        const idx = state.cuboids.findIndex((c) => c.id === id)
        if (idx === -1) return
        const target = e.shiftKey ? state.cuboids.length - 1 : Math.min(idx + 1, state.cuboids.length - 1)
        if (target !== idx) state.reorderCuboid(idx, target)
      } else if (e.key === '[') {
        // Cmd+[ = send back one step  •  Cmd+Shift+[ = to back.
        if (state.selectedIds.length === 0) return
        e.preventDefault()
        const id = state.selectedIds[0]
        const idx = state.cuboids.findIndex((c) => c.id === id)
        if (idx === -1) return
        const target = e.shiftKey ? 0 : Math.max(idx - 1, 0)
        if (target !== idx) state.reorderCuboid(idx, target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Delete / Backspace key — context-sensitive:
 *   Pen mode + active draft → removes the last anchor of the draft. If
 *     the draft drops to zero anchors, the whole draft cuboid is
 *     removed and pen mode stays active for a fresh start.
 *   Otherwise → removes every cuboid in `selectedIds` (multi-select aware).
 *
 * Bails on browser-shortcut combos and typed targets. Mount once at root.
 */
export function useDeleteShortcut() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e)) return
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const state = useScene.getState()
      // Pen mode + draft → remove last anchor
      if (state.tool === 'pen' && state.penDraftId) {
        e.preventDefault()
        const draft = state.cuboids.find((c) => c.id === state.penDraftId)
        if (!draft) return
        const anchors = draft.params?.anchors ?? []
        if (anchors.length <= 1) {
          // Empty draft — drop it entirely; user can click to restart.
          state.removeCuboid(state.penDraftId)
          state.setPenDraft(null)
        } else {
          state.updateCuboid(state.penDraftId, {
            params: { ...(draft.params || {}), anchors: anchors.slice(0, -1) },
          })
        }
        return
      }
      // Otherwise: bulk-delete the selection.
      if (state.selectedIds.length === 0) return
      e.preventDefault()
      for (const id of state.selectedIds) state.removeCuboid(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

