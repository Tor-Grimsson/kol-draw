import { MenuItem, MenuDropdownItem, MenuDropdownDivider, MenuDropdownNest } from '../molecules/MenuItem'
import Icon from '../loaders/icons/Icon'
import { useScene } from '../../scene/store.js'
import { exportSvg } from '../../scene/exportSvg.js'
import { PRIMITIVE_PRESETS, ORGANIC_PRESETS, LIGHT_PRESETS, BACKGROUND_PRESETS, SCENE_PRESETS } from '../../scene/presets.js'

const VIEW_MODES = [
  { id: 'svg',   label: 'SVG' },
  { id: 'three', label: '3D' },
  { id: 'split', label: 'Split' },
]

const ARMATURE_OPTIONS = [
  { value: 'none',      label: 'None' },
  { value: 'thirds',    label: 'Thirds' },
  { value: 'phi',       label: 'Phi (φ)' },
  { value: 'sqrt2',     label: '√2' },
  { value: 'sqrt3',     label: '√3' },
  { value: 'sqrt5',     label: '√5' },
  { value: 'diagonals', label: 'Diagonals' },
]

const PERSPECTIVE_MODES = [
  { id: '1pt',    label: '1pt' },
  { id: '2pt',    label: '2pt' },
  { id: '3pt',    label: '3pt' },
  { id: '4pt',    label: '4pt cylindrical' },
  { id: '5pt',    label: '5pt fisheye' },
  { id: 'stereo', label: 'Stereographic' },
  { id: 'equi',   label: 'Equirectangular' },
  { id: 'ortho',  label: 'Orthographic' },
]

const check = (on) => (on ? <Icon name="check" size={11} /> : undefined)

export default function TopBar() {
  const mode = useScene((s) => s.mode)
  const setMode = useScene((s) => s.setMode)
  const viewMode = useScene((s) => s.viewMode)
  const setViewMode = useScene((s) => s.setViewMode)
  const armature = useScene((s) => s.armature)
  const setArmature = useScene((s) => s.setArmature)
  const overlay = useScene((s) => s.overlay)
  const setOverlay = useScene((s) => s.setOverlay)
  const scene = useScene((s) => s.scene)
  const setScene = useScene((s) => s.setScene)
  const cuboidCount = useScene((s) => s.cuboids.length)
  const addCuboidAtCamera = useScene((s) => s.addCuboidAtCamera)
  const clearCuboids = useScene((s) => s.clearCuboids)
  const addShapePreset = useScene((s) => s.addShapePreset)
  const loadScenePreset = useScene((s) => s.loadScenePreset)
  const snapshots = useScene((s) => s.snapshots)
  const clearSnapshots = useScene((s) => s.clearSnapshots)

  return (
    <div className="kol-editor-topbar flex items-center gap-3 px-4 h-12 border-b border-fg-08">
      <span className="kol-helper-12 text-emphasis truncate">Untitled</span>

      <div className="flex items-center gap-1 ml-auto">
        <MenuItem label="View">
          <div className="py-1 w-[200px]">
            {VIEW_MODES.map((v) => (
              <MenuDropdownItem
                key={v.id}
                onClick={() => setViewMode(v.id)}
                shortcut={check(viewMode === v.id)}
              >
                {v.label}
              </MenuDropdownItem>
            ))}
          </div>
        </MenuItem>

        <MenuItem label="Camera">
          <div className="py-1 w-[240px]">
            <MenuDropdownNest label="Perspective">
              {PERSPECTIVE_MODES.map((m) => (
                <MenuDropdownItem
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  shortcut={check(mode === m.id)}
                >
                  {m.label}
                </MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownItem onClick={() => setMode(mode)}>Reset to preset</MenuDropdownItem>
          </div>
        </MenuItem>

        <MenuItem label="Grid">
          <div className="py-1 w-[220px]">
            <MenuDropdownNest label="Armature">
              {ARMATURE_OPTIONS.map((o) => (
                <MenuDropdownItem
                  key={o.value}
                  onClick={() => setArmature({ system: o.value })}
                  shortcut={check(armature.system === o.value)}
                >
                  {o.label}
                </MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownDivider />
            <MenuDropdownItem onClick={() => setArmature({ showLines: !armature.showLines })} shortcut={check(armature.showLines)}>Lines</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setArmature({ showNodes: !armature.showNodes })} shortcut={check(armature.showNodes)}>Nodes</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setArmature({ snap: !armature.snap })} shortcut={check(armature.snap)}>Snap</MenuDropdownItem>
            <MenuDropdownDivider />
            <MenuDropdownItem onClick={() => setOverlay({ groundGrid: !overlay.groundGrid })} shortcut={check(overlay.groundGrid)}>World ground grid</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setOverlay({ vps: !overlay.vps })} shortcut={check(overlay.vps)}>Vanishing points</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setOverlay({ construction: !overlay.construction })} shortcut={check(overlay.construction)}>Construction lines</MenuDropdownItem>
          </div>
        </MenuItem>

        <MenuItem label="Scene">
          <div className="py-1 w-[220px]">
            <MenuDropdownItem onClick={() => setScene({ show: !scene.show })} shortcut={check(scene.show)}>Show frame</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setScene({ showFloor: !scene.showFloor })} shortcut={check(scene.showFloor)}>Floor grid</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setScene({ showBox: !scene.showBox })} shortcut={check(scene.showBox)}>Box wireframe</MenuDropdownItem>
            <MenuDropdownItem onClick={() => setScene({ showAnchor: !scene.showAnchor })} shortcut={check(scene.showAnchor)}>Anchor handle</MenuDropdownItem>
            <MenuDropdownDivider />
            <MenuDropdownItem onClick={addCuboidAtCamera}>Add box</MenuDropdownItem>
            <MenuDropdownItem onClick={clearCuboids} disabled={cuboidCount === 0}>Clear all boxes</MenuDropdownItem>
          </div>
        </MenuItem>

        <MenuItem label="Insert">
          <div className="py-1 w-[240px]">
            <MenuDropdownNest label="Primitive">
              {PRIMITIVE_PRESETS.map((p) => (
                <MenuDropdownItem key={p.id} onClick={() => addShapePreset(p.id)}>{p.label}</MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownNest label="Organic">
              {ORGANIC_PRESETS.map((p) => (
                <MenuDropdownItem key={p.id} onClick={() => addShapePreset(p.id)}>{p.label}</MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownNest label="Light">
              {LIGHT_PRESETS.map((p) => (
                <MenuDropdownItem key={p.id} onClick={() => addShapePreset(p.id)}>{p.label}</MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownNest label="Background">
              {BACKGROUND_PRESETS.map((p) => (
                <MenuDropdownItem key={p.id} onClick={() => addShapePreset(p.id)}>{p.label}</MenuDropdownItem>
              ))}
            </MenuDropdownNest>
            <MenuDropdownNest label="Scene">
              {SCENE_PRESETS.map((p) => (
                <MenuDropdownItem key={p.id} onClick={() => loadScenePreset(p.id)}>{p.label}</MenuDropdownItem>
              ))}
            </MenuDropdownNest>
          </div>
        </MenuItem>

        <MenuItem label="File">
          <div className="py-1 w-[220px]">
            <MenuDropdownItem onClick={exportSvg} disabled={viewMode === 'three'}>Export SVG</MenuDropdownItem>
            <MenuDropdownDivider />
            <MenuDropdownItem onClick={clearSnapshots} disabled={snapshots.length === 0}>
              Clear snapshots ({snapshots.length})
            </MenuDropdownItem>
          </div>
        </MenuItem>
      </div>
    </div>
  )
}
