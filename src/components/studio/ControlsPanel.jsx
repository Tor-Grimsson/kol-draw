import { useState } from 'react'
import { TabsRow } from '../editor-panels/PanelTabs'
import Slider from '../atoms/Slider'
import ViewToggle from '../molecules/ViewToggle'
import LabeledControl from '../molecules/LabeledControl'
import { useScene } from '../../scene/store.js'

const PINHOLE_MODES = [
  { value: '1pt', label: '1' },
  { value: '2pt', label: '2' },
  { value: '3pt', label: '3' },
  { value: '4pt', label: '4' },
  { value: '5pt', label: '5' },
]
const EXTREME_MODES = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'equi',   label: 'Equi' },
  { value: 'ortho',  label: 'Ortho' },
]

function Body({ children }) {
  return <div className="flex flex-col gap-3 px-4 py-4">{children}</div>
}

export function CameraBody() {
  const mode = useScene((s) => s.mode)
  const setMode = useScene((s) => s.setMode)
  const knobs = useScene((s) => s.knobs)
  const setKnobs = useScene((s) => s.setKnobs)
  return (
    <Body>
      <ViewToggle options={PINHOLE_MODES} viewMode={mode} onViewChange={setMode} />
      <ViewToggle options={EXTREME_MODES} viewMode={mode} onViewChange={setMode} />
      <LabeledControl label="Distance" hint={knobs.distance.toFixed(1)}>
        <Slider min={-60} max={60} step={0.1} value={knobs.distance} onChange={(v) => setKnobs({ distance: v })} />
      </LabeledControl>
      <LabeledControl label="Focal" hint={knobs.focal.toFixed(2)}>
        <Slider min={-8} max={8} step={0.05} value={knobs.focal} onChange={(v) => setKnobs({ focal: v })} />
      </LabeledControl>
      <LabeledControl label="Yaw" hint={`${knobs.yawDeg.toFixed(0)}°`}>
        <Slider min={-360} max={360} step={1} value={knobs.yawDeg} onChange={(v) => setKnobs({ yawDeg: v })} />
      </LabeledControl>
      <LabeledControl label="Pitch" hint={`${knobs.pitchDeg.toFixed(0)}°`}>
        <Slider min={-180} max={180} step={1} value={knobs.pitchDeg} onChange={(v) => setKnobs({ pitchDeg: v })} />
      </LabeledControl>
    </Body>
  )
}

export function SceneBody() {
  const scene = useScene((s) => s.scene)
  const setScene = useScene((s) => s.setScene)
  return (
    <Body>
      <LabeledControl label="Divisions" hint={String(scene.divisions)}>
        <Slider min={1} max={32} step={1} value={scene.divisions} onChange={(v) => setScene({ divisions: v })} />
      </LabeledControl>
      <LabeledControl label="Width" hint={scene.size[0].toFixed(1)}>
        <Slider min={1} max={40} step={0.5} value={scene.size[0]} onChange={(v) => setScene({ size: [v, scene.size[1], scene.size[2]] })} />
      </LabeledControl>
      <LabeledControl label="Height" hint={scene.size[1].toFixed(1)}>
        <Slider min={0} max={20} step={0.5} value={scene.size[1]} onChange={(v) => setScene({ size: [scene.size[0], v, scene.size[2]] })} />
      </LabeledControl>
      <LabeledControl label="Depth" hint={scene.size[2].toFixed(1)}>
        <Slider min={1} max={40} step={0.5} value={scene.size[2]} onChange={(v) => setScene({ size: [scene.size[0], scene.size[1], v] })} />
      </LabeledControl>
    </Body>
  )
}

export function ArmatureBody() {
  const armature = useScene((s) => s.armature)
  const setArmature = useScene((s) => s.setArmature)
  return (
    <Body>
      <LabeledControl label="Snap radius" hint={`${armature.snapRadiusPx}px`}>
        <Slider min={4} max={60} step={1} value={armature.snapRadiusPx} onChange={(v) => setArmature({ snapRadiusPx: v })} />
      </LabeledControl>
    </Body>
  )
}

export function OverlayBody() {
  const overlay = useScene((s) => s.overlay)
  const setOverlay = useScene((s) => s.setOverlay)
  return (
    <Body>
      <LabeledControl label="Grid extent" hint={String(overlay.gridExtent)}>
        <Slider min={2} max={50} step={1} value={overlay.gridExtent} onChange={(v) => setOverlay({ gridExtent: v })} />
      </LabeledControl>
      <LabeledControl label="Grid step" hint={overlay.gridStep.toFixed(2)}>
        <Slider min={0.25} max={5} step={0.25} value={overlay.gridStep} onChange={(v) => setOverlay({ gridStep: v })} />
      </LabeledControl>
    </Body>
  )
}

const BODIES = {
  Camera:   CameraBody,
  Scene:    SceneBody,
  Armature: ArmatureBody,
  Overlay:  OverlayBody,
}

export function ControlsPanel({ tabs }) {
  const [tab, setTab] = useState(tabs[0])
  const ActiveBody = BODIES[tab]
  return (
    <div className="flex flex-col flex-1 min-h-0 border-b border-fg-08">
      <div className="border-b border-fg-08">
        <TabsRow tabs={tabs} active={tab} onChange={setTab} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {ActiveBody && <ActiveBody />}
      </div>
    </div>
  )
}
