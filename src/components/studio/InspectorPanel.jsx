import { useMemo, useState } from 'react'
import { TabsRow } from '../editor-panels/PanelTabs'
import Slider from '../atoms/Slider'
import LabeledControl from '../molecules/LabeledControl'
import PropertyInput from '../molecules/PropertyInput'
import Icon from '../loaders/icons/Icon'
import { useScene } from '../../scene/store.js'
import { validateVarName } from '../../scene/expr.js'
import { OverlayBody } from './ControlsPanel'

/** Anchor list editor for polyline (bezier-capable) shapes. Each row is
 *  the anchor's `point` X/Y/Z + delete. Tangents (in/out) are edited
 *  visually via drag handles in the SVG canvas — kept out of this panel
 *  to avoid 9 fields per vertex.
 *
 *  Add a vertex → append a corner anchor (no tangents) staggered +1X so
 *  it doesn't pile on the last. Remove a vertex → splice out by index;
 *  disabled below 2 anchors. */
function PolylineFields({ cuboid, setParam }) {
  const anchors = cuboid.params?.anchors ?? []
  const closed = !!cuboid.params?.closed
  const setPoint = (i, axis, v) => {
    const next = anchors.map((a, idx) => {
      if (idx !== i) return a
      const np = [...a.point]
      np[axis] = Number(v)
      return { ...a, point: np }
    })
    setParam('anchors', next)
  }
  const addVertex = () => {
    const last = anchors[anchors.length - 1]?.point ?? [0, 0, 0]
    setParam('anchors', [...anchors, { point: [last[0] + 1, last[1], last[2]] }])
  }
  const removeVertex = (i) => setParam('anchors', anchors.filter((_, idx) => idx !== i))
  return (
    <>
      <div className="kol-helper-10 uppercase text-meta mt-3 flex items-center justify-between">
        <span>Anchors ({anchors.length})</span>
        <label className="flex items-center gap-1 normal-case kol-helper-10 text-body cursor-pointer">
          <input type="checkbox" checked={closed} onChange={(e) => setParam('closed', e.target.checked)} />
          <span className="text-meta">Closed</span>
        </label>
      </div>
      <div className="flex flex-col gap-1">
        {anchors.map((a, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-1.5 kol-helper-10 text-body">
            <span className="text-meta w-4 text-right tabular-nums">{i}</span>
            <PropertyInput type="number" value={a.point[0]} step={0.1} onChange={(v) => setPoint(i, 0, v)} />
            <PropertyInput type="number" value={a.point[1]} step={0.1} onChange={(v) => setPoint(i, 1, v)} />
            <PropertyInput type="number" value={a.point[2]} step={0.1} onChange={(v) => setPoint(i, 2, v)} />
            <button
              type="button"
              onClick={() => removeVertex(i)}
              disabled={anchors.length <= 2}
              className="w-6 h-6 inline-flex items-center justify-center text-meta hover:text-emphasis disabled:opacity-30 disabled:cursor-not-allowed"
              title="Remove anchor"
            >
              <Icon name="cross" size={10} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addVertex}
        className="px-2 h-7 kol-helper-12 text-meta hover:text-emphasis border border-fg-08 rounded inline-flex items-center gap-1.5 self-start"
        title="Add anchor"
      >
        <Icon name="plus" size={10} />
        <span>Add anchor</span>
      </button>
    </>
  )
}

/** Banner shown above the per-shape inspector when exactly two shapes
 *  are selected. Three buttons (Union / Subtract / Intersect) trigger
 *  `combineSelection` which builds a `kind: 'csg'` shape with the
 *  selection as operands and hides the originals. Non-solid kinds
 *  (linework / lights / backgrounds) can't be operands — show a hint
 *  rather than disabled buttons so the user knows why. */
const CSG_OPERANDS = ['box', 'pyramid', 'prism', 'cylinder', 'sphere', 'csg']

function CombineBanner() {
  const selectedIds = useScene((s) => s.selectedIds)
  const cuboids = useScene((s) => s.cuboids)
  const combineSelection = useScene((s) => s.combineSelection)
  if (selectedIds.length !== 2) return null
  const picks = selectedIds.map((id) => cuboids.find((c) => c.id === id)).filter(Boolean)
  const eligible = picks.length === 2 && picks.every((c) => CSG_OPERANDS.includes(c.kind || 'box'))
  return (
    <div className="px-4 py-3 border-b border-fg-08 flex flex-col gap-1.5">
      <div className="kol-helper-10 uppercase text-meta">2 shapes — boolean</div>
      {eligible ? (
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => combineSelection('union')}     className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">Union</button>
          <button type="button" onClick={() => combineSelection('subtract')}  className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">Subtract</button>
          <button type="button" onClick={() => combineSelection('intersect')} className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">Intersect</button>
        </div>
      ) : (
        <div className="kol-helper-10 text-meta">Solid shapes only — linework / lights / backgrounds can't be combined.</div>
      )}
    </div>
  )
}

/** Boolean-operation Inspector for csg shapes — operator dropdown plus two
 *  operand pickers (filtered to solid kinds, excluding self). The csg
 *  shape itself has an inert center / rotation / size; the visible
 *  geometry comes from `csg.js` evaluating the operands in world space.
 *  Position / size / rotation editors are intentionally absent — move
 *  the result by editing the operands. Style picks (fill / stroke /
 *  opacity) apply to the boolean result, seeded from operand A on
 *  combine. Unlink deletes the csg and restores operand visibility. */
function CsgFields({ cuboid }) {
  const cuboids = useScene((s) => s.cuboids)
  const updateCuboid = useScene((s) => s.updateCuboid)
  const removeCuboid = useScene((s) => s.removeCuboid)
  const operator = cuboid.params?.operator ?? 'union'
  const operandIds = cuboid.params?.operandIds ?? []
  const [idA, idB] = operandIds
  const eligible = cuboids.filter(
    (c) => c.id !== cuboid.id && CSG_OPERANDS.includes(c.kind || 'box'),
  )
  const setParam = (k, v) =>
    updateCuboid(cuboid.id, { params: { ...(cuboid.params || {}), [k]: v } })
  const setOperand = (slot, val) => {
    const next = [idA ?? null, idB ?? null]
    next[slot] = val || null
    setParam('operandIds', next)
  }
  const setStyle = (key, v) =>
    updateCuboid(cuboid.id, { style: { ...(cuboid.style || {}), [key]: v } })
  return (
    <>
      <div className="kol-helper-10 uppercase text-meta mt-2">Boolean</div>
      <label className="kol-helper-10 text-body flex flex-col gap-1">
        <span className="text-meta">Operator</span>
        <select
          value={operator}
          onChange={(e) => setParam('operator', e.target.value)}
          className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
        >
          <option value="union">Union</option>
          <option value="subtract">Subtract</option>
          <option value="intersect">Intersect</option>
        </select>
      </label>
      <label className="kol-helper-10 text-body flex flex-col gap-1">
        <span className="text-meta">Operand A</span>
        <select
          value={idA ?? ''}
          onChange={(e) => setOperand(0, e.target.value)}
          className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
        >
          <option value="">— none —</option>
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>{c.kind} · {c.id.slice(2, 8)}</option>
          ))}
        </select>
      </label>
      <label className="kol-helper-10 text-body flex flex-col gap-1">
        <span className="text-meta">Operand B</span>
        <select
          value={idB ?? ''}
          onChange={(e) => setOperand(1, e.target.value)}
          className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
        >
          <option value="">— none —</option>
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>{c.kind} · {c.id.slice(2, 8)}</option>
          ))}
        </select>
      </label>

      <div className="kol-helper-10 uppercase text-meta mt-3">Style</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="kol-helper-10 text-body flex flex-col gap-1">
          <span className="text-meta">Stroke</span>
          <input
            type="color"
            value={cuboid.style?.stroke ?? '#000000'}
            onChange={(e) => setStyle('stroke', e.target.value)}
            className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
          />
        </label>
        <label className="kol-helper-10 text-body flex flex-col gap-1">
          <span className="text-meta">Fill</span>
          <input
            type="color"
            value={cuboid.style?.fill ?? '#f4f3ec'}
            onChange={(e) => setStyle('fill', e.target.value)}
            className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
          />
        </label>
      </div>
      <LabeledControl label="Opacity" hint={(cuboid.style?.opacity ?? 1).toFixed(2)}>
        <Slider
          min={0.05}
          max={1}
          step={0.05}
          value={cuboid.style?.opacity ?? 1}
          onChange={(v) => setStyle('opacity', v)}
        />
      </LabeledControl>

      <button
        type="button"
        onClick={() => removeCuboid(cuboid.id)}
        className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis self-start mt-3"
        title="Delete this csg, restore operand visibility"
      >
        Unlink
      </button>
    </>
  )
}

/** Banner shown when N>1 shapes are selected (and not in 2-shape combine
 *  mode — that's covered by CombineBanner). Tells the user that edits to
 *  the inspector below apply to the whole selection. */
function MultiSelectBanner({ count }) {
  return (
    <div className="kol-helper-10 text-meta px-4 py-2 border-b border-fg-08">
      {count} shapes selected — Position / Size / Param edits apply to all.
    </div>
  )
}

function InspectorBody() {
  const id = useScene((s) => s.selectedCuboidId)
  const cuboid = useScene((s) => s.cuboids.find((c) => c.id === id))
  const selectedIds = useScene((s) => s.selectedIds)
  const cuboids = useScene((s) => s.cuboids)
  const updateCuboid = useScene((s) => s.updateCuboid)

  const showCombine = selectedIds.length === 2
  const isMulti = selectedIds.length > 1

  // All selected shapes — used so Position / Size / Param edits write to
  // the entire selection, not just the first. Stable Map lookup against
  // the current cuboids list so refs are correct.
  const allSelected = useMemo(() => {
    if (selectedIds.length <= 1) return cuboid ? [cuboid] : []
    return selectedIds
      .map((sid) => cuboids.find((c) => c.id === sid))
      .filter(Boolean)
  }, [selectedIds, cuboids, cuboid])

  if (!cuboid) {
    return (
      <>
        {showCombine && <CombineBanner />}
        <div className="kol-helper-10 text-meta px-4 py-4">No selection — click a layer to inspect.</div>
      </>
    )
  }

  const kind = cuboid.kind || 'box'
  // Multi-aware setters: iterate `allSelected` when N>1, single otherwise.
  // Field display still reads from `cuboid` (first selected) — varying-
  // value indeterminate ("—") rendering is a future enhancement.
  const setCenter = (axis, v) => {
    for (const c of allSelected) {
      const next = [...c.center]
      next[axis] = v
      updateCuboid(c.id, { center: next })
    }
  }
  const setSize = (axis, v) => {
    for (const c of allSelected) {
      const next = [...c.size]
      next[axis] = v
      updateCuboid(c.id, { size: next })
    }
  }
  const setParam = (key, v) => {
    for (const c of allSelected) {
      updateCuboid(c.id, { params: { ...(c.params || {}), [key]: v } })
    }
  }

  return (
    <>
      {showCombine && <CombineBanner />}
      {isMulti && !showCombine && <MultiSelectBanner count={selectedIds.length} />}
      <div className="flex flex-col gap-3 px-4 py-4">
      <div className="kol-helper-10 uppercase text-subtle">{kind} · {cuboid.id.slice(2, 8)}</div>

      {kind === 'csg' ? (
        <CsgFields cuboid={cuboid} />
      ) : kind === 'background' ? (
        <>
          <div className="kol-helper-10 uppercase text-meta mt-2">Background</div>
          <label className="kol-helper-10 text-body flex flex-col gap-1">
            <span className="text-meta">Mode</span>
            <select
              value={cuboid.params?.mode ?? 'image'}
              onChange={(e) => setParam('mode', e.target.value)}
              className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
            >
              <option value="image">Image</option>
              <option value="solid">Solid color</option>
            </select>
          </label>
          {(cuboid.params?.mode ?? 'image') === 'solid' ? (
            <label className="kol-helper-10 text-body flex flex-col gap-1">
              <span className="text-meta">Color</span>
              <input
                type="color"
                value={cuboid.params?.solidColor ?? '#1a1a1f'}
                onChange={(e) => setParam('solidColor', e.target.value)}
                className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
              />
            </label>
          ) : (
            <>
              <label className="kol-helper-10 text-body flex flex-col gap-1">
                <span className="text-meta">URL or data URL</span>
                <input
                  type="text"
                  value={cuboid.params?.url ?? ''}
                  onChange={(e) => setParam('url', e.target.value)}
                  className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
                  placeholder="https://… or data:image/…"
                />
              </label>
              <label className="kol-helper-10 text-body flex flex-col gap-1">
                <span className="text-meta">File</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const reader = new FileReader()
                    reader.onload = () => setParam('url', reader.result)
                    reader.readAsDataURL(f)
                  }}
                  className="kol-helper-10 text-meta"
                />
              </label>
              <label className="kol-helper-10 text-body flex flex-col gap-1">
                <span className="text-meta">Fit</span>
                <select
                  value={cuboid.params?.fit ?? 'cover'}
                  onChange={(e) => setParam('fit', e.target.value)}
                  className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
                >
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                </select>
              </label>
            </>
          )}
          <LabeledControl label="Opacity" hint={(cuboid.params?.opacity ?? 0.5).toFixed(2)}>
            <Slider min={0} max={1} step={0.05} value={cuboid.params?.opacity ?? 0.5} onChange={(v) => setParam('opacity', v)} />
          </LabeledControl>
        </>
      ) : (
        <>
          <div className="kol-helper-10 uppercase text-meta mt-2">Position</div>
          <div className="grid grid-cols-3 gap-3">
            <PropertyInput type="number" label="X" value={cuboid.center[0]} step={0.05} onChange={(v) => setCenter(0, Number(v))} />
            <PropertyInput type="number" label="Y" value={cuboid.center[1]} step={0.05} onChange={(v) => setCenter(1, Number(v))} />
            <PropertyInput type="number" label="Z" value={cuboid.center[2]} step={0.05} onChange={(v) => setCenter(2, Number(v))} />
          </div>

          {kind === 'light' ? (
            <>
              <div className="kol-helper-10 uppercase text-meta mt-3">Light</div>
              <LabeledControl label="Intensity" hint={(cuboid.params?.intensity ?? 1).toFixed(2)}>
                <Slider min={0} max={5} step={0.05} value={cuboid.params?.intensity ?? 1} onChange={(v) => setParam('intensity', v)} />
              </LabeledControl>
              <label className="kol-helper-10 text-body flex flex-col gap-1">
                <span className="text-meta">Color</span>
                <input
                  type="color"
                  value={cuboid.params?.color ?? '#ffffff'}
                  onChange={(e) => setParam('color', e.target.value)}
                  className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
                />
              </label>
              <label className="kol-helper-10 text-body flex flex-col gap-1">
                <span className="text-meta">Type</span>
                <select
                  value={cuboid.params?.type ?? 'directional'}
                  onChange={(e) => setParam('type', e.target.value)}
                  className="px-2 py-1 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
                >
                  <option value="directional">Directional</option>
                  <option value="point">Point</option>
                </select>
              </label>
            </>
          ) : kind === 'arc' ? (
            <>
              {/* Arc has no Y extent — `size[1]` is reserved for future tube
                * thickness. W/D represent the local-XZ ellipse radii × 2. */}
              <div className="kol-helper-10 uppercase text-meta mt-3">Radii</div>
              <div className="grid grid-cols-2 gap-3">
                <PropertyInput type="number" label="W" value={cuboid.size[0]} min={0.05} step={0.05} onChange={(v) => setSize(0, Number(v))} />
                <PropertyInput type="number" label="D" value={cuboid.size[2]} min={0.05} step={0.05} onChange={(v) => setSize(2, Number(v))} />
              </div>
              <div className="kol-helper-10 uppercase text-meta mt-3">Arc</div>
              <div className="grid grid-cols-2 gap-3">
                <PropertyInput type="number" label="Start°" value={cuboid.params?.startAngle ?? 0} step={5} onChange={(v) => setParam('startAngle', Number(v))} />
                <PropertyInput type="number" label="End°" value={cuboid.params?.endAngle ?? 360} step={5} onChange={(v) => setParam('endAngle', Number(v))} />
              </div>
              <PropertyInput type="number" label="Segments" value={cuboid.params?.segments ?? 48} min={2} step={1} onChange={(v) => setParam('segments', Math.max(2, Math.round(Number(v))))} />
            </>
          ) : kind === 'polyline' ? (
            <PolylineFields cuboid={cuboid} setParam={setParam} />
          ) : (
            <>
              <div className="kol-helper-10 uppercase text-meta mt-3">Size</div>
              <div className="grid grid-cols-3 gap-3">
                <PropertyInput type="number" label="W" value={cuboid.size[0]} min={0.05} step={0.05} onChange={(v) => setSize(0, Number(v))} />
                <PropertyInput type="number" label="H" value={cuboid.size[1]} min={0.05} step={0.05} onChange={(v) => setSize(1, Number(v))} />
                <PropertyInput type="number" label="D" value={cuboid.size[2]} min={0.05} step={0.05} onChange={(v) => setSize(2, Number(v))} />
              </div>
            </>
          )}

          {kind !== 'light' && <ScaleAndStyle cuboid={cuboid} />}
        </>
      )}
      </div>
    </>
  )
}

/** Scale + Style block — applies to every non-light shape. Scale buttons
 *  call the store's `scaleShape` for uniform scaling around the shape's
 *  own center; works for boxes, organics, polylines, arcs, deformed
 *  shapes alike. Style fields override the theme defaults for stroke /
 *  fill / opacity. */
function ScaleAndStyle({ cuboid }) {
  const updateCuboid = useScene((s) => s.updateCuboid)
  const scaleShape = useScene((s) => s.scaleShape)
  const pushHistory = useScene((s) => s.pushHistory)
  const applyScale = (factor) => {
    pushHistory()
    scaleShape(cuboid.id, factor)
  }
  const setStyle = (key, v) => {
    updateCuboid(cuboid.id, { style: { ...(cuboid.style || {}), [key]: v } })
  }
  return (
    <>
      <div className="kol-helper-10 uppercase text-meta mt-3">Scale</div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => applyScale(0.5)}  title="×0.5"  className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">½</button>
        <button type="button" onClick={() => applyScale(0.9)}  title="×0.9"  className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">−</button>
        <button type="button" onClick={() => applyScale(1.1)}  title="×1.1"  className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">+</button>
        <button type="button" onClick={() => applyScale(2.0)}  title="×2"    className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis">×2</button>
      </div>

      <div className="kol-helper-10 uppercase text-meta mt-3">Style</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="kol-helper-10 text-body flex flex-col gap-1">
          <span className="text-meta">Stroke</span>
          <input
            type="color"
            value={cuboid.style?.stroke ?? '#000000'}
            onChange={(e) => setStyle('stroke', e.target.value)}
            className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
          />
        </label>
        <label className="kol-helper-10 text-body flex flex-col gap-1">
          <span className="text-meta">Fill</span>
          <input
            type="color"
            value={cuboid.style?.fill ?? '#f4f3ec'}
            onChange={(e) => setStyle('fill', e.target.value)}
            className="h-7 w-full bg-surface-secondary border border-fg-08 rounded"
          />
        </label>
      </div>
      <LabeledControl label="Opacity" hint={(cuboid.style?.opacity ?? 1).toFixed(2)}>
        <Slider min={0.05} max={1} step={0.05} value={cuboid.style?.opacity ?? 1} onChange={(v) => setStyle('opacity', v)} />
      </LabeledControl>
    </>
  )
}

/** Variables tab — manage named numeric slots that expression-enabled
 *  Inspector fields can reference. v1 surface: list each variable with a
 *  rename input + numeric editor + delete; "Add" button at the bottom.
 *  Per-field expression wiring is a follow-on; this tab establishes the
 *  store + UI foundation. */
function VariablesBody() {
  const variables = useScene((s) => s.variables)
  const addVariable = useScene((s) => s.addVariable)
  const setVariable = useScene((s) => s.setVariable)
  const renameVariable = useScene((s) => s.renameVariable)
  const removeVariable = useScene((s) => s.removeVariable)
  const [newName, setNewName] = useState('')
  const names = Object.keys(variables)
  const onAdd = () => {
    if (!newName) return
    if (validateVarName(newName) !== null) return
    if (variables[newName] !== undefined) return
    addVariable(newName, 1)
    setNewName('')
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="kol-helper-10 uppercase text-meta">Variables ({names.length})</div>
      {names.length === 0 ? (
        <div className="kol-helper-10 text-meta">
          No variables yet. Add one below — referenced from expression-enabled fields.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {names.map((n) => (
            <div key={n} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
              <input
                type="text"
                defaultValue={n}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next && next !== n) renameVariable(n, next)
                }}
                className="px-2 h-7 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
                title="Variable name"
              />
              <input
                type="number"
                value={variables[n]}
                step={0.1}
                onChange={(e) => setVariable(n, e.target.value)}
                className="px-2 h-7 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis"
                title="Value"
              />
              <button
                type="button"
                onClick={() => removeVariable(n)}
                className="w-6 h-6 inline-flex items-center justify-center text-meta hover:text-emphasis"
                title="Remove variable"
              >
                <Icon name="cross" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-1.5 mt-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd() }}
          placeholder="new_variable"
          className="px-2 h-7 bg-surface-secondary border border-fg-08 rounded kol-helper-12 text-emphasis placeholder:text-meta"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!newName || validateVarName(newName) !== null || variables[newName] !== undefined}
          className="kol-helper-12 px-2 h-7 rounded border border-fg-08 text-meta hover:text-emphasis disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          <Icon name="plus" size={10} />
          Add
        </button>
      </div>
      <div className="kol-helper-10 text-meta mt-3">
        Expression-enabled fields are a follow-on — variables defined here are stored and ready to be referenced.
      </div>
    </div>
  )
}

export default function InspectorPanel() {
  const [tab, setTab] = useState('Inspector')
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="border-b border-fg-08">
        <TabsRow tabs={['Inspector', 'Variables', 'Overlay']} active={tab} onChange={setTab} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'Inspector' && <InspectorBody />}
        {tab === 'Variables' && <VariablesBody />}
        {tab === 'Overlay' && <OverlayBody />}
      </div>
    </div>
  )
}
