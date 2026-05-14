/* eslint-disable react-hooks/refs --
 * Disabled file-wide: floating-ui's `usePopover` returns callback-ref
 * setters that the rule mis-classifies as ref-current accesses. See
 * Popover.jsx for the full explanation.
 */
import { memo, useMemo, useState } from 'react'
import { TabsRow } from '../editor-panels/PanelTabs'
import Icon from '../loaders/icons/Icon'
import Button from '../atoms/Button'
import { PopoverPanel } from '../molecules/Popover'
import { usePopover } from '../molecules/usePopover'
import { MenuDropdownItem, MenuDropdownNest } from '../molecules/MenuItem'
import { useScene } from '../../scene/store.js'
import {
  PRIMITIVE_PRESETS,
  ORGANIC_PRESETS,
  LIGHT_PRESETS,
  BACKGROUND_PRESETS,
  SCENE_PRESETS,
} from '../../scene/presets.js'
import { CameraBody } from './ControlsPanel'

const KIND_ICON = {
  box:        'shape-cube',
  pyramid:    'shape-tetra',
  prism:      'shape-tetra',
  cylinder:   'shape-cyl',
  sphere:     'shape-sphere',
  arc:        'shape-sphere',
  polyline:   'shape-sphere',
  csg:        'shape-csg',
  mesh:       'shape-cube',
  light:      'shape-sphere',
  background: 'layout',
}

/** ─── Layers list (LayerStack-style rows + drag reorder) ───────────── */

const LayerRow = memo(function LayerRow({
  layer, active,
  onSelect, onToggleVisibility, onRemove,
  draggedId, dropTargetId, dropPosition,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  collapseToggle,
}) {
  const isDragging  = draggedId === layer.id
  const isDropAbove = dropTargetId === layer.id && dropPosition === 'above'
  const isDropBelow = dropTargetId === layer.id && dropPosition === 'below'
  const kind = layer.kind || 'box'

  return (
    <div className="kol-compose-layer-line group">
      {collapseToggle ? (
        <button
          type="button"
          onClick={collapseToggle.onToggle}
          aria-expanded={!collapseToggle.collapsed}
          title={collapseToggle.collapsed ? 'Expand operands' : 'Collapse operands'}
          className="kol-compose-layer-collapse"
        >
          <Icon
            name="chevron-down"
            size={10}
            style={{ transform: collapseToggle.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
          />
        </button>
      ) : (
        <span aria-hidden="true" className="kol-compose-layer-collapse" />
      )}
      <div
        draggable
        onDragStart={(e) => onDragStart(e, layer.id)}
        onDragOver={(e) => onDragOver(e, layer.id)}
        onDragLeave={(e) => onDragLeave(e, layer.id)}
        onDrop={(e) => onDrop(e, layer.id)}
        onDragEnd={onDragEnd}
        data-layer-id={layer.id}
        className={
          'kol-compose-layer-row' +
          (active ? ' is-active' : '') +
          (layer.hidden ? ' is-hidden' : '') +
          (isDragging ? ' is-dragging' : '') +
          (isDropAbove ? ' is-drop-above' : '') +
          (isDropBelow ? ' is-drop-below' : '')
        }
      >
        <button type="button" onClick={onSelect} className="kol-compose-layer-main">
          <span className="kol-compose-layer-btn-icon" aria-hidden="true">
            <Icon name={KIND_ICON[kind] ?? 'shape'} size={14} />
          </span>
          <span className="kol-helper-12 truncate flex-1 text-left">{kind} · {layer.id.slice(2, 8)}</span>
        </button>
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-pressed={!!layer.hidden}
          title={layer.hidden ? 'Show' : 'Hide'}
          className={`absolute inset-y-0 right-7 w-7 inline-flex items-center justify-center rounded text-meta hover:text-emphasis hover:bg-fg-08 transition-opacity ${layer.hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Icon name={layer.hidden ? 'eye-off' : 'eye-on'} size={12} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Delete"
          className="absolute inset-y-0 right-0 w-7 inline-flex items-center justify-center rounded text-meta hover:text-emphasis hover:bg-fg-08 transition-opacity opacity-0 group-hover:opacity-100"
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
    </div>
  )
}, (prev, next) => {
  // Custom equality: ignore callback identity (parent recreates them each
  // render but their captured-closure behavior is stable for our use). This
  // lets non-affected rows skip re-render during a translate-drag of some
  // other cuboid — the dragged cuboid's row gets a new `layer` ref and
  // re-renders; the rest see the same `layer` ref and bail.
  return (
    prev.layer === next.layer &&
    prev.active === next.active &&
    prev.draggedId === next.draggedId &&
    prev.dropTargetId === next.dropTargetId &&
    prev.dropPosition === next.dropPosition &&
    prev.collapseToggle?.collapsed === next.collapseToggle?.collapsed &&
    !!prev.collapseToggle === !!next.collapseToggle
  )
})

function SceneRow({ collapsed, onToggleCollapse }) {
  return (
    <div className="kol-compose-layer-line group">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand scene' : 'Collapse scene'}
        className="kol-compose-layer-collapse"
      >
        <Icon
          name="chevron-down"
          size={10}
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
        />
      </button>
      <div className="kol-compose-layer-row">
        <div className="kol-compose-layer-main">
          <span className="kol-compose-layer-btn-icon" aria-hidden="true">
            <Icon name="layout" size={14} />
          </span>
          <span className="kol-helper-12 truncate flex-1 text-left">Scene</span>
        </div>
      </div>
    </div>
  )
}

const INSERT_MENU_WIDTH = 220

function InsertMenu() {
  const [open, setOpen] = useState(false)
  const popover = usePopover({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    offset: 4,
    role: 'menu',
  })
  const addShapePreset = useScene((s) => s.addShapePreset)
  const loadScenePreset = useScene((s) => s.loadScenePreset)
  const click = (fn, id) => () => { fn(id); setOpen(false) }

  return (
    <>
      <span
        ref={popover.setReference}
        {...popover.getReferenceProps()}
        className="inline-flex"
      >
        <Button
          variant="primary"
          size="sm"
          animateIcon
          quiet
          iconOnly="plus"
          iconSize={12}
          aria-label="Insert layer"
          title="Insert layer"
          style={{ padding: 6 }}
        />
      </span>
      <PopoverPanel popover={popover} className="py-1" style={{ width: INSERT_MENU_WIDTH }}>
        <MenuDropdownNest label="Primitive">
          {PRIMITIVE_PRESETS.map((p) => (
            <MenuDropdownItem key={p.id} onClick={click(addShapePreset, p.id)}>{p.label}</MenuDropdownItem>
          ))}
        </MenuDropdownNest>
        <MenuDropdownNest label="Organic">
          {ORGANIC_PRESETS.map((p) => (
            <MenuDropdownItem key={p.id} onClick={click(addShapePreset, p.id)}>{p.label}</MenuDropdownItem>
          ))}
        </MenuDropdownNest>
        <MenuDropdownNest label="Light">
          {LIGHT_PRESETS.map((p) => (
            <MenuDropdownItem key={p.id} onClick={click(addShapePreset, p.id)}>{p.label}</MenuDropdownItem>
          ))}
        </MenuDropdownNest>
        <MenuDropdownNest label="Background">
          {BACKGROUND_PRESETS.map((p) => (
            <MenuDropdownItem key={p.id} onClick={click(addShapePreset, p.id)}>{p.label}</MenuDropdownItem>
          ))}
        </MenuDropdownNest>
        <MenuDropdownNest label="Scene">
          {SCENE_PRESETS.map((p) => (
            <MenuDropdownItem key={p.id} onClick={click(loadScenePreset, p.id)}>{p.label}</MenuDropdownItem>
          ))}
        </MenuDropdownNest>
      </PopoverPanel>
    </>
  )
}

function LayersBody() {
  const cuboids = useScene((s) => s.cuboids)
  const selectedIds = useScene((s) => s.selectedIds)
  const setSelectedCuboid = useScene((s) => s.setSelectedCuboid)
  const toggleSelection = useScene((s) => s.toggleSelection)
  const toggleVisibility = useScene((s) => s.toggleCuboidVisibility)
  const removeCuboid = useScene((s) => s.removeCuboid)
  const reorderCuboid = useScene((s) => s.reorderCuboid)
  const clearCuboids = useScene((s) => s.clearCuboids)

  const [sceneCollapsed, setSceneCollapsed] = useState(false)
  const [draggedId, setDraggedId]       = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)
  const [dropPosition, setDropPosition] = useState(null)
  // Per-csg collapse: { csgId: boolean }. Default expanded so users see
  // their operands. State persists for the session, not across reloads
  // (parsist.partialize would need a key — not worth it for a UI toggle).
  const [csgCollapsed, setCsgCollapsed] = useState({})

  // Operand → parent-csg lookup, and parent-csg → ordered operands. Built
  // once per cuboids change. Operands appear nested under their first
  // referencing csg only — multi-parented operands are an edge case, the
  // first wins.
  const { operandsByCsg, parentOfOperand } = useMemo(() => {
    const byCsg = new Map()
    const parentOf = new Map()
    for (const c of cuboids) {
      if (c.kind !== 'csg') continue
      const ops = (c.params?.operandIds ?? [])
        .map((id) => cuboids.find((cc) => cc.id === id))
        .filter(Boolean)
      byCsg.set(c.id, ops)
      for (const op of ops) {
        if (!parentOf.has(op.id)) parentOf.set(op.id, c.id)
      }
    }
    return { operandsByCsg: byCsg, parentOfOperand: parentOf }
  }, [cuboids])

  const onDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    setDraggedId(id)
  }
  const onDragOver = (e, targetId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!draggedId || draggedId === targetId) {
      setDropTargetId(null); setDropPosition(null); return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const isUpper = (e.clientY - rect.top) < rect.height / 2
    setDropTargetId(targetId)
    setDropPosition(isUpper ? 'above' : 'below')
  }
  const onDragLeave = (_e, targetId) => setDropTargetId((cur) => (cur === targetId ? null : cur))
  const onDrop = (e, targetId) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) { clearDrag(); return }
    const fromIndex   = cuboids.findIndex((l) => l.id === draggedId)
    const targetIndex = cuboids.findIndex((l) => l.id === targetId)
    if (fromIndex < 0 || targetIndex < 0) { clearDrag(); return }
    const targetAfterRemoval = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
    const finalIndex = dropPosition === 'above' ? targetAfterRemoval + 1 : targetAfterRemoval
    reorderCuboid(fromIndex, finalIndex)
    clearDrag()
  }
  const clearDrag = () => { setDraggedId(null); setDropTargetId(null); setDropPosition(null) }

  return (
    <>
      <ul className="flex flex-col px-4 pb-3 pt-3">
        <li>
          <SceneRow collapsed={sceneCollapsed} onToggleCollapse={() => setSceneCollapsed((v) => !v)} />
        </li>
        {!sceneCollapsed && (
          cuboids.length === 0 ? (
            <li className="kol-compose-layer-nest kol-helper-10 text-meta px-2 py-2">Empty — drop a primitive from Insert.</li>
          ) : (
            [...cuboids]
              .reverse()
              // Operands of a csg are rendered under their parent (below),
              // not as their own top-level row.
              .filter((layer) => !parentOfOperand.has(layer.id))
              .map((layer) => {
                const onSelectLayer = (e) => {
                  if (e?.shiftKey) toggleSelection(layer.id)
                  else setSelectedCuboid(selectedIds.length === 1 && selectedIds[0] === layer.id ? null : layer.id)
                }
                const isCsg = layer.kind === 'csg'
                const operands = isCsg ? operandsByCsg.get(layer.id) ?? [] : []
                const collapsed = !!csgCollapsed[layer.id]
                return (
                  <li key={layer.id} className="kol-compose-layer-nest">
                    <LayerRow
                      layer={layer}
                      active={selectedIds.includes(layer.id)}
                      onSelect={onSelectLayer}
                      onToggleVisibility={() => toggleVisibility(layer.id)}
                      onRemove={() => removeCuboid(layer.id)}
                      draggedId={draggedId}
                      dropTargetId={dropTargetId}
                      dropPosition={dropPosition}
                      onDragStart={onDragStart}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                      onDragEnd={clearDrag}
                      collapseToggle={isCsg && operands.length > 0 ? {
                        collapsed,
                        onToggle: () => setCsgCollapsed((s) => ({ ...s, [layer.id]: !s[layer.id] })),
                      } : undefined}
                    />
                    {isCsg && !collapsed && operands.length > 0 && (
                      <ul className="pl-4">
                        {operands.map((op) => (
                          <li key={op.id} className="kol-compose-layer-nest">
                            <LayerRow
                              layer={op}
                              active={selectedIds.includes(op.id)}
                              onSelect={(e) => {
                                if (e?.shiftKey) toggleSelection(op.id)
                                else setSelectedCuboid(selectedIds.length === 1 && selectedIds[0] === op.id ? null : op.id)
                              }}
                              onToggleVisibility={() => toggleVisibility(op.id)}
                              onRemove={() => removeCuboid(op.id)}
                              draggedId={draggedId}
                              dropTargetId={dropTargetId}
                              dropPosition={dropPosition}
                              onDragStart={onDragStart}
                              onDragOver={onDragOver}
                              onDragLeave={onDragLeave}
                              onDrop={onDrop}
                              onDragEnd={clearDrag}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })
          )
        )}
      </ul>
      <div className="mt-auto flex items-center gap-2 px-3 h-10 border-t border-fg-08">
        <div className="ml-auto flex items-center gap-2">
          <InsertMenu />
          <Button
            variant="primary"
            size="sm"
            animateIcon
            quiet
            iconOnly="trash"
            iconSize={12}
            aria-label="Clear all"
            title="Clear all"
            disabled={cuboids.length === 0}
            onClick={clearCuboids}
            style={{ padding: 6 }}
          />
        </div>
      </div>
    </>
  )
}

export default function LayersPanel() {
  const [tab, setTab] = useState('Layers')
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="border-b border-fg-08">
        <TabsRow tabs={['Layers', 'Camera']} active={tab} onChange={setTab} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {tab === 'Layers' && <LayersBody />}
        {tab === 'Camera' && <CameraBody />}
      </div>
    </div>
  )
}
