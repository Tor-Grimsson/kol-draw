import { useEffect, useState } from 'react'
import Icon from '../loaders/icons/Icon'
import ThemeToggle from './ThemeToggle'
import { useScene } from '../../scene/store.js'
import { exportSvg } from '../../scene/exportSvg.js'
import { PRIMITIVE_PRESETS, ORGANIC_PRESETS, LIGHT_PRESETS, BACKGROUND_PRESETS, SCENE_PRESETS } from '../../scene/presets.js'

const ACTIVE_HOP_KEY = 'kol-draw-active-hop'

const ARMATURE_OPTIONS = [
  { value: 'none',      label: 'None' },
  { value: 'thirds',    label: 'Thirds' },
  { value: 'phi',       label: 'Phi (φ)' },
  { value: 'sqrt2',     label: '√2' },
  { value: 'sqrt3',     label: '√3' },
  { value: 'sqrt5',     label: '√5' },
  { value: 'diagonals', label: 'Diagonals' },
]

/**
 * NAV_TREE (kol-draw flavor): top-level hops are studio categories. Each
 * hop's children are groups of action / toggle links. Mirrors the
 * kol-framework SideNav pattern (HOME / STYLEGUIDE / GALLERY / …) where
 * one hop is "active" at a time and its children render below it.
 *
 * Sliders / fine-tuning live in the right rail (ControlsPanel) — this rail
 * only handles discrete picks (mode, preset, toggle, action).
 */
const buildTree = (api) => [
  {
    id: 'view', label: 'View', icon: 'layout',
    groups: [
      { label: 'Mode', items: [
        { id: 'v-svg',   label: 'SVG',   isActive: api.viewMode === 'svg',   onClick: () => api.setViewMode('svg') },
        { id: 'v-three', label: '3D',    isActive: api.viewMode === 'three', onClick: () => api.setViewMode('three') },
        { id: 'v-split', label: 'Split', isActive: api.viewMode === 'split', onClick: () => api.setViewMode('split') },
      ]},
    ],
  },
  {
    id: 'presets', label: 'Insert', icon: 'shape-cube',
    groups: [
      { label: 'Primitives', items: PRIMITIVE_PRESETS.map((p) => ({
        id: `s-${p.id}`, label: p.label, onClick: () => api.addShapePreset(p.id),
      })) },
      { label: 'Organics', items: ORGANIC_PRESETS.map((p) => ({
        id: `o-${p.id}`, label: p.label, onClick: () => api.addShapePreset(p.id),
      })) },
      { label: 'Lights', items: LIGHT_PRESETS.map((p) => ({
        id: `l-${p.id}`, label: p.label, onClick: () => api.addShapePreset(p.id),
      })) },
      { label: 'Background', items: BACKGROUND_PRESETS.map((p) => ({
        id: `bg-${p.id}`, label: p.label, onClick: () => api.addShapePreset(p.id),
      })) },
      { label: 'Scenes', items: SCENE_PRESETS.map((p) => ({
        id: `sc-${p.id}`, label: p.label, onClick: () => api.loadScenePreset(p.id),
      })) },
    ],
  },
  {
    id: 'camera', label: 'Camera', icon: 'camera',
    groups: [
      { label: 'Pinhole', items: ['1pt', '2pt', '3pt'].map((m) => ({
        id: `m-${m}`, label: m, isActive: api.mode === m, onClick: () => api.setMode(m),
      })) },
      { label: 'Curved / extreme', items: [
        { id: 'm-4pt',    label: '4pt cylindrical',  isActive: api.mode === '4pt',    onClick: () => api.setMode('4pt') },
        { id: 'm-5pt',    label: '5pt fisheye',      isActive: api.mode === '5pt',    onClick: () => api.setMode('5pt') },
        { id: 'm-stereo', label: 'Stereographic',    isActive: api.mode === 'stereo', onClick: () => api.setMode('stereo') },
        { id: 'm-equi',   label: 'Equirectangular',  isActive: api.mode === 'equi',   onClick: () => api.setMode('equi') },
        { id: 'm-ortho',  label: 'Orthographic',     isActive: api.mode === 'ortho',  onClick: () => api.setMode('ortho') },
      ]},
      { label: 'Reset', items: [
        { id: 'cam-reset', label: 'Reset to preset', onClick: () => api.setMode(api.mode) },
      ]},
    ],
  },
  {
    id: 'grid', label: 'Grid', icon: 'grid',
    groups: [
      { label: 'Armature', items: ARMATURE_OPTIONS.map((o) => ({
        id: `arm-${o.value}`, label: o.label,
        isActive: api.armature.system === o.value,
        onClick: () => api.setArmature({ system: o.value }),
      })) },
      { label: 'Toggles', items: [
        { id: 'arm-lines', label: 'Lines', isActive: api.armature.showLines, onClick: () => api.setArmature({ showLines: !api.armature.showLines }) },
        { id: 'arm-nodes', label: 'Nodes', isActive: api.armature.showNodes, onClick: () => api.setArmature({ showNodes: !api.armature.showNodes }) },
        { id: 'arm-snap',  label: 'Snap',  isActive: api.armature.snap,      onClick: () => api.setArmature({ snap: !api.armature.snap }) },
      ]},
    ],
  },
  {
    id: 'scene', label: 'Scene', icon: 'layout-02',
    groups: [
      { label: 'Frame', items: [
        { id: 'sc-show',   label: 'Show frame',    isActive: api.scene.show,        onClick: () => api.setScene({ show: !api.scene.show }) },
        { id: 'sc-floor',  label: 'Floor grid',    isActive: api.scene.showFloor,   onClick: () => api.setScene({ showFloor: !api.scene.showFloor }) },
        { id: 'sc-box',    label: 'Box wireframe', isActive: api.scene.showBox,     onClick: () => api.setScene({ showBox: !api.scene.showBox }) },
        { id: 'sc-anchor', label: 'Anchor handle', isActive: api.scene.showAnchor,  onClick: () => api.setScene({ showAnchor: !api.scene.showAnchor }) },
      ]},
      { label: 'Shapes', items: [
        { id: 'sh-add',   label: 'Add box',  onClick: api.addCuboidAtCamera },
        { id: 'sh-clear', label: 'Clear all', disabled: api.cuboidCount === 0, onClick: api.clearCuboids },
      ]},
    ],
  },
  {
    id: 'snapshots', label: 'Snapshots', icon: 'eye-on',
    groups: [
      { label: `Stack (${api.snapshotCount})`, items: [
        { id: 'snap-clear', label: 'Clear all', disabled: api.snapshotCount === 0, onClick: api.clearSnapshots },
      ]},
      { label: 'Hint', items: [
        { id: 'snap-hint-take',  label: 'Press s to capture' },
        { id: 'snap-hint-clear', label: 'Press shift+s to clear' },
      ]},
    ],
  },
  {
    id: 'overlay', label: 'Overlay', icon: 'eye-on',
    groups: [
      { label: 'Show', items: [
        { id: 'o-ground', label: 'World ground grid', isActive: api.overlay.groundGrid,   onClick: () => api.setOverlay({ groundGrid: !api.overlay.groundGrid }) },
        { id: 'o-vps',    label: 'Vanishing points',  isActive: api.overlay.vps,           onClick: () => api.setOverlay({ vps: !api.overlay.vps }) },
        { id: 'o-cons',   label: 'Construction lines', isActive: api.overlay.construction, onClick: () => api.setOverlay({ construction: !api.overlay.construction }) },
      ]},
    ],
  },
  {
    id: 'export', label: 'Export', icon: 'download',
    groups: [
      { label: 'Format', items: [
        { id: 'e-svg', label: 'SVG', disabled: api.viewMode === 'three', onClick: exportSvg },
      ]},
    ],
  },
]

const linkBase =
  'kol-sidenav-link kol-helper-10 block w-full text-left bg-transparent border-0 relative py-[4px] no-underline transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

function Leaf({ leaf, indent }) {
  const cls = leaf.isActive ? `${linkBase} is-active` : `${linkBase} text-body hover:text-emphasis`
  return (
    <li>
      <button
        type="button"
        onClick={leaf.onClick}
        disabled={leaf.disabled}
        className={cls}
        style={{ paddingLeft: indent, '--kol-sidenav-dot-left': `${indent - 14}px` }}
      >
        {leaf.label}
      </button>
    </li>
  )
}

function Group({ group, indent }) {
  return (
    <li>
      <div className="kol-sidenav-group kol-helper-10 uppercase text-subtle" style={{ paddingLeft: indent }}>
        {group.label}
      </div>
      <ul className="kol-sidenav-list">
        {group.items.map((item) => <Leaf key={item.id} leaf={item} indent={indent + 12} />)}
      </ul>
    </li>
  )
}

export default function SideRail() {
  const mode = useScene((s) => s.mode)
  const setMode = useScene((s) => s.setMode)
  const viewMode = useScene((s) => s.viewMode)
  const setViewMode = useScene((s) => s.setViewMode)
  const armature = useScene((s) => s.armature)
  const setArmature = useScene((s) => s.setArmature)
  const scene = useScene((s) => s.scene)
  const setScene = useScene((s) => s.setScene)
  const overlay = useScene((s) => s.overlay)
  const setOverlay = useScene((s) => s.setOverlay)
  const cuboidCount = useScene((s) => s.cuboids.length)
  const addCuboidAtCamera = useScene((s) => s.addCuboidAtCamera)
  const clearCuboids = useScene((s) => s.clearCuboids)
  const addShapePreset = useScene((s) => s.addShapePreset)
  const loadScenePreset = useScene((s) => s.loadScenePreset)
  const snapshots = useScene((s) => s.snapshots)
  const clearSnapshots = useScene((s) => s.clearSnapshots)

  // Brand SideRail is always-collapsed in kol-draw — it sits as the outer
  // icon-only nav rail next to the editor shell, matching the editor's
  // BrandLayout behavior on /editor routes (collapsed nav + editor's own
  // left rail with the layers panel).
  const collapsed = true
  const setCollapsed = () => {} // no-op; collapse state is fixed
  const [activeHop, setActiveHop] = useState(() => {
    if (typeof window === 'undefined') return 'presets'
    return localStorage.getItem(ACTIVE_HOP_KEY) ?? 'presets'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-sidenav', 'collapsed')
  }, [])

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_HOP_KEY, activeHop) } catch { /* storage blocked */ }
  }, [activeHop])

  const tree = buildTree({
    mode, setMode,
    viewMode, setViewMode,
    armature, setArmature,
    scene, setScene,
    overlay, setOverlay,
    cuboidCount, addCuboidAtCamera, clearCuboids,
    addShapePreset, loadScenePreset,
    snapshotCount: snapshots.length, clearSnapshots,
  })

  return (
    <aside className={`kol-sidenav sticky top-0 self-start h-dvh flex flex-col border-r border-fg-08 z-20 bg-surface-primary${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="kol-sidenav-toggle absolute top-5 right-[-12px] z-[2] w-6 h-6 inline-flex items-center justify-center bg-[var(--kol-surface-primary)] border border-[var(--kol-border-default)] rounded-full p-0 cursor-pointer text-[14px] leading-none transition-colors duration-150 text-meta hover:text-emphasis hover:border-fg-24"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
        onClick={() => setCollapsed((v) => !v)}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={12} />
      </button>

      <div className="kol-sidenav-scroll flex-1 flex flex-col justify-between overflow-y-auto pt-4 pb-4 [scrollbar-width:thin]">
        <ul className="kol-sidenav-tree flex flex-col gap-[2px]">
          {tree.map((page) => {
            const isActivePage = activeHop === page.id
            return (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => setActiveHop(isActivePage ? '' : page.id)}
                  className={`kol-sidenav-hop kol-helper-12 relative flex items-center gap-3 py-2 pr-10 pl-6 no-underline w-full text-left bg-transparent border-0 cursor-pointer${isActivePage ? ' is-active' : ''}`}
                >
                  <span className="kol-sidenav-hop-icon inline-flex items-center justify-center w-5 h-5 shrink-0" aria-hidden="true">
                    <Icon name={page.icon} size={16} />
                  </span>
                  <span className="kol-sidenav-hop-label flex-1 min-w-0">{page.label}</span>
                </button>

                {isActivePage && page.groups && (
                  <ul className="kol-sidenav-list kol-sidenav-body mb-2 flex flex-col gap-2">
                    {page.groups.map((g, i) => (
                      <Group key={`${page.id}-g-${i}`} group={g} indent={56} />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex flex-col">
          <ThemeToggle variant="hop-bare" />
        </div>
      </div>

      <div className="kol-sidenav-footer flex items-center pl-6 pr-4 h-14 min-w-0">
        <a
          href="https://kolkrabbi.io"
          target="_blank"
          rel="noopener"
          className="kol-helper-10 !font-normal no-underline group whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
        >
          <span className="text-body group-hover:text-emphasis">Kolkrabbi Vinnustofa</span>
          <span className="text-meta group-hover:text-emphasis"> · {new Date().getFullYear()}</span>
        </a>
      </div>
    </aside>
  )
}
