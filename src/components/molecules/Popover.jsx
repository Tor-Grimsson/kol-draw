/* eslint-disable react-hooks/refs --
 * Disabled file-wide: floating-ui's API exposes callback-ref setters via
 * the popover object. The lint rule pattern-matches `.refs.X` and flags
 * any property access on this object as ref-current access (false
 * positive — the values it traverses are setter functions and prop
 * builders, not stale ref reads).
 */
import { useState } from 'react'
import { FloatingPortal, FloatingFocusManager } from '@floating-ui/react'
import { usePopover } from './usePopover'

/**
 * Popover primitives built on @floating-ui/react. The `usePopover` hook
 * lives in `./usePopover.js` (Vite Fast Refresh requires component files
 * to export only components — import the hook from there directly).
 *
 *   const popover = usePopover({ open, onOpenChange })
 *   <button ref={popover.setReference} {...popover.getReferenceProps()} />
 *   <PopoverPanel popover={popover}>...</PopoverPanel>
 *
 * `<PopoverPanel popover={...}>` renders the floater into a `FloatingPortal`
 * (escapes overflow:hidden ancestors), wraps in `FloatingFocusManager`
 * (focus trap + return-focus), applies the `.kol-popover` panel chrome.
 *
 * Position middleware: `offset` (gap), `flip` (auto-flip on overflow),
 * `shift` (slide along the cross-axis to stay in viewport), optional
 * `size` (clamp to available width/height). `autoUpdate` keeps everything
 * synced on scroll / resize / layout shift.
 *
 * Interaction defaults: click toggles, outside-click + Esc dismiss, role
 * defaults to `dialog` (use `role: 'menu' | 'listbox' | 'tooltip'` for
 * other shapes — also drives the right ARIA attrs on the reference).
 */

/**
 * Tooltip — hover-triggered popover with text content. Wraps any trigger
 * element. Built on `usePopover` with `hover: true`, `click: false`,
 * `role: 'tooltip'`. Includes keyboard focus trigger so tab-focused
 * controls also reveal the tooltip.
 *
 *   <Tooltip label="Pattern" shortcut="P" placement="bottom">
 *     <Button iconOnly="ptrn-checker" ... />
 *   </Tooltip>
 */
export function Tooltip({
  label,
  shortcut,
  placement = 'bottom',
  offset = 6,
  children,
  triggerClassName = 'inline-flex',
}) {
  const [open, setOpen] = useState(false)
  const popover = usePopover({
    open,
    onOpenChange: setOpen,
    placement,
    offset,
    role: 'tooltip',
    click: false,
    hover: true,
    focus: true,
  })

  return (
    <>
      <span
        ref={popover.setReference}
        {...popover.getReferenceProps()}
        className={triggerClassName}
      >
        {children}
      </span>
      <PopoverPanel
        popover={popover}
        focus={false}
        panel={false}
        className="kol-tooltip"
      >
        <span className="text-emphasis">{label}</span>
        {shortcut && <span className="kol-tooltip-key">{shortcut}</span>}
      </PopoverPanel>
    </>
  )
}

/**
 * PopoverPanel — renders the floater into a portal with default panel chrome.
 *
 * Props:
 *   popover         — the value returned from `usePopover`
 *   panel           — apply default `.kol-popover` chrome (default: true)
 *   modal           — focus modality (default: false — non-modal popover)
 *   focus           — wrap in FloatingFocusManager (default: true)
 *   className       — extra classes on the panel
 *   style           — extra inline styles merged with floatingStyles
 */
export function PopoverPanel({
  popover,
  children,
  panel = true,
  modal = false,
  focus = true,
  className = '',
  style: extraStyle,
}) {
  if (!popover.open) return null

  const { setFloating, floatingStyles, context, getFloatingProps } = popover
  const cls = [panel && 'kol-popover', className].filter(Boolean).join(' ')

  /* `data-editor-keep-selection` mirrors the marker on the EditorShell
   * root. Popovers render via FloatingPortal (mounted on <body>, outside
   * the shell), so the editor's document-level click-away handler would
   * otherwise treat clicks on popover content as "outside the editor"
   * and deselect. Tagging the panel here keeps that handler happy for
   * every popover — color picker, dropdowns, menus, tooltips. Harmless
   * for non-editor consumers since they ignore the attr. */
  const node = (
    <div
      ref={setFloating}
      style={extraStyle ? { ...floatingStyles, ...extraStyle } : floatingStyles}
      className={cls}
      data-editor-keep-selection
      {...getFloatingProps()}
    >
      {children}
    </div>
  )

  return (
    <FloatingPortal>
      {focus
        ? <FloatingFocusManager context={context} modal={modal}>{node}</FloatingFocusManager>
        : node}
    </FloatingPortal>
  )
}

export default PopoverPanel
