import {
  useFloating,
  autoUpdate,
  offset as offsetMw,
  flip as flipMw,
  shift as shiftMw,
  size as sizeMw,
  useClick,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
} from '@floating-ui/react'

/**
 * `usePopover({ open, onOpenChange, ... })` — anchored-popover hook built on
 * `@floating-ui/react`. Returns a flat object combining floating data, the
 * `getReferenceProps` / `getFloatingProps` builders, and surfaced callback-
 * refs (`setReference`, `setFloating`).
 *
 *   const popover = usePopover({ open, onOpenChange })
 *   <button ref={popover.setReference} {...popover.getReferenceProps()} />
 *   <PopoverPanel popover={popover}>...</PopoverPanel>
 *
 * Lives in its own file so Vite Fast Refresh stays effective —
 * react-refresh wants component files to only export components.
 */
export function usePopover({
  open,
  onOpenChange,
  placement = 'bottom-start',
  offset = 6,
  flip = true,
  flipPadding = 8,
  shiftPadding = 8,
  matchReferenceWidth = false,
  click = true,
  hover = false,
  hoverDelay = { open: 400, close: 100 },
  focus = false,
  dismiss = true,
  role = 'dialog',
  referenceElement = null,
} = {}) {
  const middleware = [offsetMw(offset)]
  if (flip) middleware.push(flipMw({ padding: flipPadding }))
  middleware.push(shiftMw({ padding: shiftPadding }))
  if (matchReferenceWidth) {
    middleware.push(
      sizeMw({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
          })
        },
      })
    )
  }

  /* `elements.reference` lets the consumer anchor the popover to an
   * external DOM node (e.g. a parent container ref) instead of wiring
   * `setReference` onto the trigger. */
  const data = useFloating({
    open,
    onOpenChange,
    placement,
    middleware,
    whileElementsMounted: autoUpdate,
    elements: referenceElement ? { reference: referenceElement } : undefined,
  })

  const interactions = useInteractions([
    useClick(data.context, { enabled: click }),
    useHover(data.context, { enabled: hover, delay: hoverDelay, move: false }),
    useFocus(data.context, { enabled: focus }),
    useDismiss(data.context, { enabled: dismiss }),
    useRole(data.context, { role }),
  ])

  // Surface the callback-refs flat so consumers don't traverse `.refs.X`,
  // which the `react-hooks/refs` lint rule misclassifies as ref-current
  // access. The values are setter functions, not ref-current reads.
  return {
    ...data,
    ...interactions,
    setReference: data.refs.setReference,
    setFloating: data.refs.setFloating,
    open,
  }
}
