/* eslint-disable react-hooks/refs --
 * Disabled file-wide: this file consumes `usePopover` from
 * @floating-ui/react. The hook returns callback-ref setters
 * (`setReference`, `setFloating`) that are intended to be passed as
 * `ref={...}`. The lint rule's `.refs.X` heuristic flags any property
 * traversal of the popover object as a ref-current access, even when it's
 * a setter-function read or a plain object pass-through. The pattern is
 * floating-ui's documented API, not a stale-closure violation.
 */
import { useState } from 'react'
import Icon from '../loaders/icons/Icon'
import { PopoverPanel } from './Popover'
import { usePopover } from './usePopover'

/**
 * MenuItem — top-level menu entry. Trigger button + popover panel.
 *
 *   <MenuItem label="File">
 *     <MenuDropdownItem onClick={…}>Save</MenuDropdownItem>
 *     <MenuDropdownItem onClick={…}>Export…</MenuDropdownItem>
 *   </MenuItem>
 *
 * Built on `usePopover` (`@floating-ui/react`): portal-rendered panel
 * (escapes overflow), auto-flip + viewport shift, click-outside / Escape
 * dismiss, focus management. `align="end"` switches the placement to
 * `bottom-end` for right-aligned panels (Templates menu).
 *
 * For value-list selection (pick one of N with active state) use the
 * `Dropdown` molecule instead — MenuItem is for action menus / popovers
 * that hold arbitrary children.
 */
export function MenuItem({
  label,
  children,
  align = 'start',
  panelClassName = '',
  panelStyle,
  buttonClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const popover = usePopover({
    open,
    onOpenChange: setOpen,
    placement: align === 'end' ? 'bottom-end' : 'bottom-start',
    offset: 4,
    role: 'menu',
  })

  const close = () => setOpen(false)

  return (
    <>
      <button
        ref={popover.setReference}
        {...popover.getReferenceProps()}
        type="button"
        className={`kol-helper-12 px-3 h-8 inline-flex items-center gap-2 rounded text-body hover:text-emphasis transition-colors ${buttonClassName}`}
      >
        <span>{label}</span>
        <Icon
          name="chevron-down"
          size={10}
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}
        />
      </button>
      <PopoverPanel
        popover={popover}
        panel={false}
        focus={false}
        className={`bg-surface-secondary rounded ${panelClassName}`}
        style={panelStyle}
      >
        <div
          onClick={(e) => {
            /* close on item click — items inside fire their handler then bubble. */
            if (e.target.closest('[data-menu-item]')) close()
          }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      </PopoverPanel>
    </>
  )
}

/**
 * MenuDropdownItem — action row inside a MenuItem's dropdown panel.
 * Renders as a button so it picks up disabled, focus, and keyboard
 * activation. The parent MenuItem closes automatically on click via a
 * delegated handler that matches the `data-menu-item` attr.
 *
 * Slots:
 *   - prefix    — leading content of arbitrary width (e.g. palette swatch
 *                 strip). Use for visuals wider than a single icon.
 *   - iconLeft  — leading icon, fixed 16px width column (rows align).
 *   - children  — main label, flex-1.
 *   - shortcut  — trailing content (text shortcut hint, ✓ marker, or icon).
 */
export function MenuDropdownItem({ onClick, disabled, prefix, iconLeft, shortcut, children }) {
  return (
    <button
      type="button"
      data-menu-item
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      className="w-full kol-helper-12 px-3 h-8 inline-flex items-center gap-2 text-body hover:text-emphasis disabled:opacity-40 disabled:cursor-not-allowed text-left"
    >
      {prefix && <span className="shrink-0 inline-flex items-center">{prefix}</span>}
      {iconLeft && <span className="shrink-0 w-4 inline-flex items-center justify-center">{iconLeft}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="kol-helper-10 text-emphasis shrink-0 inline-flex items-center">{shortcut}</span>}
    </button>
  )
}

export function MenuDropdownDivider() {
  return <div className="border-t border-fg-08 my-1" />
}

/**
 * MenuDropdownNest — accordion-style row inside a dropdown panel. Click
 * the row to expand/collapse its children inline (below the row, in the
 * same panel). The trailing chevron rotates 90° to indicate state.
 *
 * Same visual shape as MenuDropdownItem at rest. Clicking a leaf
 * MenuDropdownItem inside an open nest still closes the entire menu via
 * the standard data-menu-item bubble. Clicking the nest row itself only
 * toggles its own expansion.
 */
export function MenuDropdownNest({ prefix, iconLeft, label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full kol-helper-12 px-3 h-8 inline-flex items-center gap-2 text-body hover:text-emphasis text-left"
      >
        {prefix && <span className="shrink-0 inline-flex items-center">{prefix}</span>}
        {iconLeft && <span className="shrink-0 w-4 inline-flex items-center justify-center">{iconLeft}</span>}
        <span className="flex-1 truncate">{label}</span>
        <Icon
          name="chevron-down"
          size={10}
          className="text-emphasis shrink-0"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 200ms' }}
        />
      </button>
      {open && (
        <div className="ml-3 border-l border-fg-08">
          {children}
        </div>
      )}
    </>
  )
}
