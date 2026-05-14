import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Line, OrbitControls, TransformControls } from '@react-three/drei'
import { Matrix4, Euler, Color, NoToneMapping, SphereGeometry, CylinderGeometry, BufferGeometry, BufferAttribute, TextureLoader, SRGBColorSpace } from 'three'
import { useScene } from '../../scene/store.js'
import { buildMesh } from '../../math/shape.js'
import { setCsgDragSuspended } from '../../math/csg.js'
import { boxEdges, floorGridLines } from '../../composition/sceneFrame.js'
import { fovDegFromFocal } from './viewport.js'

/**
 * One-shot camera initializer — places the r3f camera at the store's
 * camera on first mount, then leaves it alone so OrbitControls owns it.
 * The 3D view's camera is independent of the SVG view's perspective for
 * editing freedom (orbit / pan / zoom around to position lights, drag
 * shapes, etc).
 */
/**
 * Mirror the topmost visible solid-mode background layer onto Three's
 * `scene.background`. Image backgrounds skip for now (would need a Texture
 * loader); the SVG view still paints them. Cleared when no solid layer is
 * present so the canvas stays transparent (parent .kol-editor-canvas tone).
 */
function SceneBackground() {
  const { scene } = useThree()
  // Topmost-wins: pick the last visible background layer. Same semantic as
  // SvgView's render order (later array index = on top).
  const bg = useScene((s) => s.cuboids.findLast((c) => !c.hidden && c.kind === 'background'))
  useEffect(() => {
    if (!bg) {
      // eslint-disable-next-line react-hooks/immutability
      scene.background = null
      return
    }
    const p = bg.params || {}
    if (p.mode === 'image' && p.url) {
      let cancelled = false
      const tex = new TextureLoader().load(p.url, () => {
        if (cancelled) {
          tex.dispose()
          return
        }
        // Color textures are sRGB-encoded. Without this they read as
        // linear and the canvas tone goes washed-out / muted on dark
        // images. Tone mapping is disabled (NoToneMapping) so we want
        // the raw sRGB values.
        tex.colorSpace = SRGBColorSpace
        scene.background = tex
      })
      return () => {
        cancelled = true
        if (scene.background === tex) {
          scene.background = null
        }
        tex.dispose()
      }
    }
    // Solid (default).
    scene.background = new Color(p.solidColor ?? '#000')
  }, [bg, scene])
  return null
}

/**
 * Sync the r3f camera with the store's perspective camera. Re-aims on
 * preset (`mode`) change AND on intra-mode knob updates — slider drags,
 * horizon-line drags, VP drags in SVG all flow back into the 3D view.
 *
 * OrbitControls is non-conflicting: orbiting in 3D writes to the camera /
 * controls directly, never to the store, so this effect doesn't refire
 * during 3D-side input. SVG-side input updates the store's knobs, fires
 * this effect, and the controls' internal angles re-derive on the next
 * `controls.update()`.
 *
 * FOV is sourced from `fovDegFromFocal` so the 3D view frames the world
 * the same way the SVG view does for a given focal length.
 */
function CameraInit() {
  const { camera, controls } = useThree()
  const mode = useScene((s) => s.mode)
  const knobs = useScene((s) => s.knobs)
  const cam = useScene((s) => s.camera)
  useEffect(() => {
    camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    camera.up.set(cam.up[0], cam.up[1], cam.up[2])
    if (controls && controls.target && typeof controls.target.set === 'function') {
      // OrbitControls owns the camera matrix once mounted — setting target
      // + calling update() lets it recompute its internal angles from the
      // new camera position. Plain camera.lookAt would be overwritten on
      // the next OrbitControls tick.
      controls.target.set(knobs.pivot[0], knobs.pivot[1], knobs.pivot[2])
      if (typeof controls.update === 'function') controls.update()
    } else {
      camera.lookAt(knobs.pivot[0], knobs.pivot[1], knobs.pivot[2])
    }
    if ('fov' in camera) {
      // Three's PerspectiveCamera fov is a plain number prop; only
      // updateProjectionMatrix() commits the change. Standard r3f imperative
      // pattern — the lint rule doesn't model Three's mutable-by-design API.
      // eslint-disable-next-line react-hooks/immutability
      camera.fov = fovDegFromFocal(cam.focal)
      camera.updateProjectionMatrix()
    }
  }, [camera, controls, mode, knobs, cam])
  return null
}


const matrixToEuler = (m) => {
  if (!m) return [0, 0, 0]
  const m4 = new Matrix4().set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1,
  )
  const e = new Euler().setFromRotationMatrix(m4)
  return [e.x, e.y, e.z]
}

/** Ellipsoid geometry with correct vertex normals. Built from a unit sphere
 *  scaled non-uniformly via BufferGeometry.scale(), which applies the
 *  inverse-transpose to normals. JSX-level mesh.scale would skew normals
 *  and produce banding / wrong specular hot-spots on non-uniform shapes.
 */
function EllipsoidGeometry({ sx, sy, sz, slices = 16, stacks = 12 }) {
  const geom = useMemo(() => {
    const g = new SphereGeometry(1, slices, stacks)
    g.scale(sx / 2, sy / 2, sz / 2)
    return g
  }, [sx, sy, sz, slices, stacks])
  useEffect(() => () => geom.dispose(), [geom])
  return <primitive object={geom} attach="geometry" />
}

/** Cylinder with separate x and z radii (elliptical cross-section). The
 *  inline `<cylinderGeometry args={[sx/2, sz/2, sy, segments]} />` was
 *  mapping the two args to `[radiusTop, radiusBottom]` of a frustum — for
 *  any non-square footprint that produced a cone, not an oval cylinder.
 *  Build a unit cylinder (radius 1, height 2) then scale x/y/z separately;
 *  BufferGeometry.scale() applies the inverse-transpose to vertex normals
 *  so shading stays correct.
 */
function EllipticalCylinderGeometry({ sx, sy, sz, segments = 16 }) {
  const geom = useMemo(() => {
    const g = new CylinderGeometry(1, 1, 2, segments)
    g.scale(sx / 2, sy / 2, sz / 2)
    return g
  }, [sx, sy, sz, segments])
  useEffect(() => () => geom.dispose(), [geom])
  return <primitive object={geom} attach="geometry" />
}

/** Build a non-indexed BufferGeometry from a flat list of triangles (each
 *  triangle = 3 Vec3 in outward-CCW order). Per-vertex normals are computed
 *  per triangle so faces stay flat — no normal averaging across shared
 *  vertices, which is the correct look for hard-edged primitives.
 */
const trianglesToGeometry = (triangles) => {
  const positions = new Float32Array(triangles.length * 9)
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i]
    const o = i * 9
    positions[o + 0] = a[0]; positions[o + 1] = a[1]; positions[o + 2] = a[2]
    positions[o + 3] = b[0]; positions[o + 4] = b[1]; positions[o + 5] = b[2]
    positions[o + 6] = c[0]; positions[o + 7] = c[1]; positions[o + 8] = c[2]
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

/** Rectangular-base pyramid (4 triangular sides + rectangular base, 6
 *  triangles total). Apex at (0, +sy/2, 0); base at y = -sy/2 with extents
 *  ±sx/2 × ±sz/2. Matches the SVG side's `buildPyramid` convention.
 *
 *  Three's `coneGeometry` with `radialSegments: 4` was wrong here — it
 *  produces a square-cross-section cone with diagonal-aligned base, not a
 *  rectangular pyramid; non-square sx vs sz ratios degenerated to a
 *  rotational cone instead of a true rectangular pyramid.
 */
function PyramidGeometry({ sx, sy, sz }) {
  const geom = useMemo(() => {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2
    const BL = [-hx, -hy, -hz]
    const BR = [ hx, -hy, -hz]
    const FR = [ hx, -hy,  hz]
    const FL = [-hx, -hy,  hz]
    const A  = [  0,  hy,   0]
    return trianglesToGeometry([
      // base — outward-CCW viewed from below (normal -y)
      [FL, BL, BR],
      [FL, BR, FR],
      // 4 sides — each (a, b, apex) with (a, b) traversed CCW from below
      [BL, FL, A], // -x face
      [FL, FR, A], // +z face
      [FR, BR, A], // +x face
      [BR, BL, A], // -z face
    ])
  }, [sx, sy, sz])
  useEffect(() => () => geom.dispose(), [geom])
  return <primitive object={geom} attach="geometry" />
}

/** Triangular prism — equilateral-ish triangle cross-section in the XY
 *  plane (apex at +y, two corners at -y / ±x), extruded along Z. 8
 *  triangles: 2 triangular ends + 3 rectangular sides (2 tris each).
 *  Matches the SVG side's `buildPrism` convention.
 *
 *  Three's `coneGeometry` with `radialSegments: 3` was wrong — produced a
 *  triangular pyramid (pointed top), not an extruded prism.
 */
function PrismGeometry({ sx, sy, sz }) {
  const geom = useMemo(() => {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2
    const TopB = [  0,  hy, -hz]
    const BL_B = [-hx, -hy, -hz]
    const BR_B = [ hx, -hy, -hz]
    const TopF = [  0,  hy,  hz]
    const BL_F = [-hx, -hy,  hz]
    const BR_F = [ hx, -hy,  hz]
    return trianglesToGeometry([
      // back triangle (normal -z)
      [TopB, BR_B, BL_B],
      // front triangle (normal +z)
      [TopF, BL_F, BR_F],
      // bottom rect (normal -y), 2 tris
      [BL_B, BR_B, BR_F],
      [BL_B, BR_F, BL_F],
      // -x slant face, 2 tris
      [TopB, BL_B, BL_F],
      [TopB, BL_F, TopF],
      // +x slant face, 2 tris
      [BR_B, TopB, TopF],
      [BR_B, TopF, BR_F],
    ])
  }, [sx, sy, sz])
  useEffect(() => () => geom.dispose(), [geom])
  return <primitive object={geom} attach="geometry" />
}

/** Custom geometry built from the shape's actual mesh — used when
 *  `vertexOffsets` are present (node-mode deformation) so the 3D view
 *  reflects the deformed shape instead of the original axis-aligned
 *  primitive. Builds in LOCAL space (zero center, identity rotation —
 *  the parent `<mesh>` applies world position + rotation). Triangulated
 *  non-indexed for flat shading: each face triangle gets its own three
 *  vertices, so `computeVertexNormals` produces hard edges between
 *  faces (boxes / pyramids / etc. read as faceted, not smoothed). */
function DeformedGeometry({ shape }) {
  const geom = useMemo(() => {
    const localShape = { ...shape, center: [0, 0, 0], rotation: undefined }
    const mesh = buildMesh(localShape)
    const positions = []
    for (const f of mesh.faces) {
      const idx = f.vertexIndices
      // Fan-triangulate the face from vertex 0. Each triangle adds 3
      // distinct vertex copies for flat shading.
      for (let i = 1; i < idx.length - 1; i++) {
        const v0 = mesh.vertices[idx[0]]
        const va = mesh.vertices[idx[i]]
        const vb = mesh.vertices[idx[i + 1]]
        positions.push(v0[0], v0[1], v0[2], va[0], va[1], va[2], vb[0], vb[1], vb[2])
      }
    }
    const arr = new Float32Array(positions)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(arr, 3))
    g.computeVertexNormals()
    return g
  // The mesh depends on size/params/offsets but NOT on center/rotation
  // (those are applied at the parent <mesh> level). Narrowing deps means
  // a translate-drag of the deformed shape doesn't rebuild the geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape.kind, shape.size, shape.params, shape.vertexOffsets])
  useEffect(() => () => geom.dispose(), [geom])
  return <primitive object={geom} attach="geometry" />
}

function Geometry({ shape }) {
  const kind = shape.kind || 'box'
  const [sx, sy, sz] = shape.size
  // Frozen-mesh shapes (flattened CSGs) carry the actual vertex/face data
  // in `params` — DeformedGeometry consumes buildMesh output.
  if (kind === 'mesh') return <DeformedGeometry shape={shape} />
  // Deformed shapes (node-mode vertex edits) need a custom geometry
  // sourced from the actual mesh vertices — the primitive geometries
  // below only know about size, not vertexOffsets.
  if (shape.vertexOffsets && kind !== 'arc' && kind !== 'polyline') {
    return <DeformedGeometry shape={shape} />
  }
  if (kind === 'pyramid') return <PyramidGeometry sx={sx} sy={sy} sz={sz} />
  if (kind === 'cylinder') return (
    <EllipticalCylinderGeometry
      sx={sx} sy={sy} sz={sz}
      segments={shape.params?.segments}
    />
  )
  if (kind === 'sphere') {
    return (
      <EllipsoidGeometry
        sx={sx} sy={sy} sz={sz}
        slices={shape.params?.slices}
        stacks={shape.params?.stacks}
      />
    )
  }
  if (kind === 'prism') return <PrismGeometry sx={sx} sy={sy} sz={sz} />
  return <boxGeometry args={[sx, sy, sz]} />
}

/** Directional light whose aim follows its parent group's rotation. Three's
 *  `directionalLight` shines from its position toward `target.position`,
 *  which defaults to world origin and ignores parent transforms. We attach
 *  a target Object3D one unit along the group's local -Z so the rotation
 *  determines the aim direction.
 */
function DirectionalLightWithTarget({ color, intensity }) {
  const lightRef = useRef()
  const targetRef = useRef()
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [])
  return (
    <>
      <directionalLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        // Orthographic shadow camera frustum sized for the default scene
        // frame (~10 world units half-extent). Tight bounds keep shadow
        // map resolution usable; tune via scene-frame size when authoring
        // larger scenes.
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
      />
      <group ref={targetRef} position={[0, 0, -1]} />
    </>
  )
}

/** Per-light wrapper, memoized so unrelated drag-ticks skip its render. */
const LightInstance = memo(function LightInstance({ light, isSelected, registerRef, onSelect, clean }) {
  const refCb = useCallback((el) => registerRef(light.id, el), [registerRef, light.id])
  const eulerRot = useMemo(() => matrixToEuler(light.rotation), [light.rotation])
  const onClick = useCallback((e) => { e.stopPropagation(); onSelect(light.id) }, [onSelect, light.id])
  const p = light.params || {}
  const color = p.color ?? '#ffffff'
  const intensity = p.intensity ?? 1
  return (
    <group ref={refCb} position={light.center} rotation={eulerRot} onClick={onClick}>
      {p.type === 'point' ? (
        // Three r155+ removed the `physicallyCorrectLights` flag; PBR is
        // always-on. decay=2 (inverse-square) is the only physical choice;
        // intensity is in candela.
        <pointLight
          color={color}
          intensity={intensity * 20}
          distance={p.distance ?? 12}
          decay={2}
          castShadow
          shadow-mapSize-width={512}
          shadow-mapSize-height={512}
        />
      ) : (
        <DirectionalLightWithTarget color={color} intensity={intensity} />
      )}
      {!clean && (p.type === 'point' ? (
        <mesh>
          <sphereGeometry args={[0.25, 14, 10]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={isSelected ? 1 : 0.7} />
        </mesh>
      ) : (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh position={[0, -0.45, 0]}>
            <coneGeometry args={[0.22, 0.55, 14, 1, true]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={isSelected ? 1 : 0.75} />
          </mesh>
        </group>
      ))}
    </group>
  )
})

function Lights({ registerRef, selectedId, clean = false }) {
  const cuboids = useScene((s) => s.cuboids)
  const setSelectedCuboid = useScene((s) => s.setSelectedCuboid)
  const lights = cuboids.filter((c) => !c.hidden && c.kind === 'light')
  if (lights.length === 0) {
    // Default rig: low ambient + 3 directionals, sized for ACES tone mapping
    // disabled (linear sRGB output). Tune if you re-enable tone mapping.
    return (
      <>
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[6, 8, 8]}
          intensity={1.4}
          color="#fff5e1"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
          shadow-camera-near={0.5}
          shadow-camera-far={50}
        />
        <directionalLight position={[-7, 4, 6]}   intensity={0.7} color="#dde9ff" />
        <directionalLight position={[0, 10, -10]} intensity={0.9} color="#cfd8ec" />
      </>
    )
  }
  return (
    <>
      <ambientLight intensity={0.3} />
      {lights.map((lt) => (
        <LightInstance
          key={lt.id}
          light={lt}
          isSelected={selectedId === lt.id}
          registerRef={registerRef}
          onSelect={setSelectedCuboid}
          clean={clean}
        />
      ))}
    </>
  )
}

/** Per-csg mesh — buildMesh returns world-space verts (operands eval
 *  in world space inside csg.js), so this renders at world origin with
 *  no parent transform. The geometry is a flat-shaded BufferGeometry
 *  triangulated from the boolean result, matching DeformedGeometry's
 *  pattern. The csg cache short-circuits when nothing operand-related
 *  changed; the useMemo dep `[cuboid, shapesById]` lets the cache do
 *  its job.
 */
const CsgMesh = memo(function CsgMesh({ cuboid, isSelected, registerRef, onSelect, shapesById }) {
  const refCb = useCallback((el) => registerRef(cuboid.id, el), [registerRef, cuboid.id])
  const onClick = useCallback((e) => { e.stopPropagation(); onSelect(cuboid.id) }, [onSelect, cuboid.id])
  const geom = useMemo(() => {
    const mesh = buildMesh(cuboid, shapesById)
    if (!mesh.faces || mesh.faces.length === 0) return null
    const positions = []
    for (const f of mesh.faces) {
      const idxs = f.vertexIndices
      for (let i = 1; i < idxs.length - 1; i++) {
        const v0 = mesh.vertices[idxs[0]]
        const va = mesh.vertices[idxs[i]]
        const vb = mesh.vertices[idxs[i + 1]]
        positions.push(v0[0], v0[1], v0[2], va[0], va[1], va[2], vb[0], vb[1], vb[2])
      }
    }
    if (positions.length === 0) return null
    const arr = new Float32Array(positions)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(arr, 3))
    g.computeVertexNormals()
    return g
  }, [cuboid, shapesById])
  useEffect(() => () => { if (geom) geom.dispose() }, [geom])
  if (!geom) return null
  return (
    <mesh ref={refCb} onClick={onClick} castShadow receiveShadow>
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial
        color={cuboid.style?.fill ?? '#f4f3ec'}
        emissive={isSelected ? '#aa3bff' : '#000'}
        emissiveIntensity={isSelected ? 0.15 : 0}
        transparent={cuboid.style?.opacity != null && cuboid.style.opacity < 1}
        opacity={cuboid.style?.opacity ?? 1}
      />
    </mesh>
  )
})

/** Wireframe overlay companion for csg shapes — feature edges from the
 *  boolean result, drawn at world origin with `depthTest:false` so back
 *  edges are visible. Mirrors `CuboidWireframe`'s structure but skips
 *  the local-space rebuild (csg verts are already world-space). */
const CsgWireframe = memo(function CsgWireframe({ cuboid, shapesById }) {
  const positions = useMemo(() => {
    const mesh = buildMesh(cuboid, shapesById)
    if (!mesh.edges || mesh.edges.length === 0) return new Float32Array(0)
    const arr = new Float32Array(mesh.edges.length * 6)
    mesh.edges.forEach(([a, b], i) => {
      const va = mesh.vertices[a]
      const vb = mesh.vertices[b]
      arr[i * 6 + 0] = va[0]; arr[i * 6 + 1] = va[1]; arr[i * 6 + 2] = va[2]
      arr[i * 6 + 3] = vb[0]; arr[i * 6 + 4] = vb[1]; arr[i * 6 + 5] = vb[2]
    })
    return arr
  }, [cuboid, shapesById])
  if (positions.length === 0) return null
  return (
    <lineSegments key={`csg-wf-${positions.length}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
    </lineSegments>
  )
})

/** Per-cuboid mesh, memoized so non-edited cuboids skip re-render entirely
 *  when another cuboid is being dragged. Drag-tick cost stays O(1) instead
 *  of O(N).
 */
const CuboidMesh = memo(function CuboidMesh({ cuboid, isSelected, registerRef, onSelect }) {
  const refCb = useCallback((el) => registerRef(cuboid.id, el), [registerRef, cuboid.id])
  const eulerRot = useMemo(() => matrixToEuler(cuboid.rotation), [cuboid.rotation])
  const onClick = useCallback((e) => { e.stopPropagation(); onSelect(cuboid.id) }, [onSelect, cuboid.id])
  return (
    <mesh
      ref={refCb}
      position={[cuboid.center[0], cuboid.center[1], cuboid.center[2]]}
      rotation={eulerRot}
      onClick={onClick}
      castShadow
      receiveShadow
    >
      <Geometry shape={cuboid} />
      <meshStandardMaterial
        color={cuboid.style?.fill ?? '#f4f3ec'}
        emissive={isSelected ? '#aa3bff' : '#000'}
        emissiveIntensity={isSelected ? 0.15 : 0}
        transparent={cuboid.style?.opacity != null && cuboid.style.opacity < 1}
        opacity={cuboid.style?.opacity ?? 1}
      />
    </mesh>
  )
})

/** Local-space arc points sampled from the shape's size + params. World
 *  position / rotation are applied via the parent group's transform — this
 *  keeps TransformControls drag-translate working without re-baking the
 *  geometry per drag tick. */
const arcLocalPoints = (shape) => {
  const segments = Math.max(2, shape.params?.segments ?? 48)
  const startDeg = shape.params?.startAngle ?? 0
  const endDeg = shape.params?.endAngle ?? 360
  const start = (startDeg * Math.PI) / 180
  const end = (endDeg * Math.PI) / 180
  const rx = shape.size[0] / 2
  const rz = shape.size[2] / 2
  const out = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = start + t * (end - start)
    out.push([Math.cos(a) * rx, 0, Math.sin(a) * rz])
  }
  return out
}

/** Resolve a linework shape's local-space points. Arc samples the
 *  parametric ellipse; polyline samples cubic bezier per segment when
 *  tangents are present (mirrors `buildPolyline` in shape.js). Closing
 *  segment added when `params.closed` is true. */
const lineworkLocalPoints = (shape) => {
  if (shape.kind === 'polyline') {
    const anchors = shape.params?.anchors ?? []
    const closed = !!shape.params?.closed
    const segmentsPerCurve = Math.max(1, shape.params?.segments ?? 16)
    if (anchors.length === 0) return []
    const out = [anchors[0].point]
    const pushSegment = (a, b) => {
      if (!a.out && !b.in) {
        out.push(b.point)
        return
      }
      const p0 = a.point
      const p1 = a.out ? [a.point[0]+a.out[0], a.point[1]+a.out[1], a.point[2]+a.out[2]] : a.point
      const p2 = b.in  ? [b.point[0]+b.in[0],  b.point[1]+b.in[1],  b.point[2]+b.in[2]]  : b.point
      const p3 = b.point
      for (let i = 1; i <= segmentsPerCurve; i++) {
        const t = i / segmentsPerCurve
        const u = 1 - t
        const u2 = u * u, t2 = t * t
        const u3 = u2 * u, t3 = t2 * t
        out.push([
          u3 * p0[0] + 3 * u2 * t * p1[0] + 3 * u * t2 * p2[0] + t3 * p3[0],
          u3 * p0[1] + 3 * u2 * t * p1[1] + 3 * u * t2 * p2[1] + t3 * p3[1],
          u3 * p0[2] + 3 * u2 * t * p1[2] + 3 * u * t2 * p2[2] + t3 * p3[2],
        ])
      }
    }
    for (let i = 0; i < anchors.length - 1; i++) pushSegment(anchors[i], anchors[i + 1])
    if (closed && anchors.length > 2) pushSegment(anchors[anchors.length - 1], anchors[0])
    return out
  }
  // arc
  return arcLocalPoints(shape)
}

/** Single linework primitive — covers arcs and polylines via
 *  `lineworkLocalPoints`. Drei's `<Line>` renders as a `Line2` (thick
 *  screen-space lines), giving a reasonable click target. The parent
 *  group is what TransformControls attaches to — keeps translate /
 *  rotate / scale working uniformly across both kinds. */
const LineworkMesh = memo(function LineworkMesh({ cuboid, isSelected, registerRef, onSelect }) {
  const refCb = useCallback((el) => registerRef(cuboid.id, el), [registerRef, cuboid.id])
  const eulerRot = useMemo(() => matrixToEuler(cuboid.rotation), [cuboid.rotation])
  const onClick = useCallback((e) => { e.stopPropagation(); onSelect(cuboid.id) }, [onSelect, cuboid.id])
  // Recompute when size, params, or kind change. The exhaustive-deps rule
  // wants the whole `cuboid` ref, but `cuboid` changes on every drag tick
  // (including translate, which doesn't affect local points) — narrowing
  // keeps the memo from busting on translate-drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const points = useMemo(() => lineworkLocalPoints(cuboid), [cuboid.kind, cuboid.size, cuboid.params])
  if (points.length < 2) return null
  return (
    <group
      ref={refCb}
      position={[cuboid.center[0], cuboid.center[1], cuboid.center[2]]}
      rotation={eulerRot}
      onClick={onClick}
    >
      <Line
        points={points}
        color={isSelected ? '#aa3bff' : (cuboid.style?.stroke ?? '#444')}
        lineWidth={isSelected ? 2.5 : 1.5}
      />
    </group>
  )
})

/** Renders the scene-frame: optional box wireframe + optional floor grid +
 *  optional centre crosshair. Mirrors what SvgView paints, so toggling any
 *  of `scene.showBox`, `scene.showFloor`, `scene.showAnchor`, or
 *  `scene.divisions` updates both views identically.
 *
 *  Subscribes to `scene` (whole object) — small object, all fields used here.
 *  Memoizes the Float32 line buffers so geometry only rebuilds when the
 *  frame's geometry actually changes.
 */
function SceneFrame() {
  const frame = useScene((s) => s.scene)
  const boxBuf = useMemo(() => {
    if (!frame.show || !frame.showBox) return null
    const segs = boxEdges(frame)
    const arr = new Float32Array(segs.length * 6)
    segs.forEach(([a, b], i) => {
      arr[i * 6 + 0] = a[0]; arr[i * 6 + 1] = a[1]; arr[i * 6 + 2] = a[2]
      arr[i * 6 + 3] = b[0]; arr[i * 6 + 4] = b[1]; arr[i * 6 + 5] = b[2]
    })
    return arr
  }, [frame])
  const floorBuf = useMemo(() => {
    if (!frame.show || !frame.showFloor) return null
    const segs = floorGridLines(frame)
    const arr = new Float32Array(segs.length * 6)
    segs.forEach(([a, b], i) => {
      arr[i * 6 + 0] = a[0]; arr[i * 6 + 1] = a[1]; arr[i * 6 + 2] = a[2]
      arr[i * 6 + 3] = b[0]; arr[i * 6 + 4] = b[1]; arr[i * 6 + 5] = b[2]
    })
    return arr
  }, [frame])
  if (!frame.show) return null
  return (
    <>
      {boxBuf && (
        <lineSegments key={`box-${boxBuf.length}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[boxBuf, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#aa3bff" transparent opacity={0.5} />
        </lineSegments>
      )}
      {floorBuf && (
        <lineSegments key={`floor-${floorBuf.length}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[floorBuf, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#888" transparent opacity={0.35} />
        </lineSegments>
      )}
      {frame.showAnchor && (
        <mesh position={frame.center}>
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshBasicMaterial color="#aa3bff" />
        </mesh>
      )}
      {/* Shadow catcher — invisible plane at the scene-frame floor that
        * receives shadows but renders no surface. Sized 1.6× the frame's
        * x/z extents so shadows have margin to fall onto. Always present
        * when the frame is shown; doesn't depend on the floor-grid
        * toggle (shadows shouldn't disappear because the visible grid
        * was hidden). */}
      <mesh
        position={[frame.center[0], frame.center[1] - frame.size[1] / 2, frame.center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[frame.size[0] * 1.6, frame.size[2] * 1.6]} />
        <shadowMaterial transparent opacity={0.35} />
      </mesh>
    </>
  )
}

/** Wireframe edges for one solid cuboid — uses the same edge index
 *  list as the SVG view (`buildMesh(s).edges`), built in local space so
 *  the parent group's position + rotation places it in world. With
 *  `vertexOffsets`, the deformation flows through `buildMesh` so the
 *  wireframe tracks node-mode edits.
 *
 *  `depthTest: false` on the line material draws edges through occluding
 *  faces — both front + back edges visible, matching Blender's "Solid +
 *  wireframe" overlay. */
const CuboidWireframe = memo(function CuboidWireframe({ cuboid }) {
  const positions = useMemo(() => {
    const localShape = { ...cuboid, center: [0, 0, 0], rotation: undefined }
    const mesh = buildMesh(localShape)
    if (!mesh.edges || mesh.edges.length === 0) return new Float32Array(0)
    const arr = new Float32Array(mesh.edges.length * 6)
    mesh.edges.forEach(([a, b], i) => {
      const va = mesh.vertices[a]
      const vb = mesh.vertices[b]
      arr[i * 6 + 0] = va[0]; arr[i * 6 + 1] = va[1]; arr[i * 6 + 2] = va[2]
      arr[i * 6 + 3] = vb[0]; arr[i * 6 + 4] = vb[1]; arr[i * 6 + 5] = vb[2]
    })
    return arr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuboid.kind, cuboid.size, cuboid.params, cuboid.vertexOffsets])
  const eulerRot = useMemo(() => matrixToEuler(cuboid.rotation), [cuboid.rotation])
  if (positions.length === 0) return null
  return (
    <group
      position={[cuboid.center[0], cuboid.center[1], cuboid.center[2]]}
      rotation={eulerRot}
    >
      <lineSegments key={`wf-${positions.length}`}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
      </lineSegments>
    </group>
  )
})

/** Wireframe overlay — renders edge lines on top of every solid cuboid in
 *  the scene. Linework shapes (arcs, polylines) already render as lines
 *  via LineworkMesh, so they're skipped here. Lights and backgrounds
 *  also skipped. csg shapes use `CsgWireframe` (world-space edges from
 *  the boolean result) instead of CuboidWireframe (local-space rebuild). */
function WireframeOverlay() {
  const cuboids = useScene((s) => s.cuboids)
  const shapesById = useMemo(() => {
    const m = new Map()
    for (const c of cuboids) m.set(c.id, c)
    return m
  }, [cuboids])
  return cuboids
    .filter((c) => !c.hidden && c.kind !== 'light' && c.kind !== 'background' && c.kind !== 'arc' && c.kind !== 'polyline')
    .map((c) =>
      c.kind === 'csg'
        ? <CsgWireframe key={c.id} cuboid={c} shapesById={shapesById} />
        : <CuboidWireframe key={c.id} cuboid={c} />,
    )
}

function Cuboids({ registerRef, selectedId }) {
  const cuboids = useScene((s) => s.cuboids)
  const setSelectedCuboid = useScene((s) => s.setSelectedCuboid)
  const shapesById = useMemo(() => {
    const m = new Map()
    for (const c of cuboids) m.set(c.id, c)
    return m
  }, [cuboids])
  return cuboids
    .filter((c) => !c.hidden && c.kind !== 'light' && c.kind !== 'background')
    .map((c) => {
      if (c.kind === 'csg') {
        return (
          <CsgMesh
            key={c.id}
            cuboid={c}
            isSelected={selectedId === c.id}
            registerRef={registerRef}
            onSelect={setSelectedCuboid}
            shapesById={shapesById}
          />
        )
      }
      // Linework shapes (arcs, polylines, future splines) need a Line
      // renderer, not a meshStandardMaterial mesh. Dispatch by kind.
      const isLinework = c.kind === 'arc' || c.kind === 'polyline'
      const Component = isLinework ? LineworkMesh : CuboidMesh
      return (
        <Component
          key={c.id}
          cuboid={c}
          isSelected={selectedId === c.id}
          registerRef={registerRef}
          onSelect={setSelectedCuboid}
        />
      )
    })
}

/** TransformControls bound to whichever Object3D corresponds to the
 *  currently-selected shape. Writes back position / rotation / scale on
 *  every drag tick so the SVG view follows live.
 *
 *  Resolution timing: refs commit after parent render, so on the first
 *  render where a new shape is selected, `targets.current.get(id)` may be
 *  undefined. The `useLayoutEffect` re-checks after commit and triggers a
 *  state update so the gizmo attaches one tick later. Subscribing to
 *  `cuboids` ensures the lookup re-runs whenever shapes mount/unmount
 *  (visibility toggle, scene-preset load). */
function Transformer({ targetsRef, mode }) {
  const selectedId = useScene((s) => s.selectedCuboidId)
  const selectedIds = useScene((s) => s.selectedIds)
  const cuboids = useScene((s) => s.cuboids)
  const updateCuboid = useScene((s) => s.updateCuboid)
  const [target, setTarget] = useState(null)
  const baselineRef = useRef(null)

  useLayoutEffect(() => {
    setTarget(selectedId ? targetsRef.current.get(selectedId) ?? null : null)
  }, [selectedId, cuboids, targetsRef])

  if (!target) return null
  const selected = cuboids.find((c) => c.id === selectedId)
  if (!selected || selected.hidden) return null
  // csg shapes have an inert center / rotation / size; the gizmo would
  // dangle at world origin and have nothing to write back to. Operands
  // are what actually move the result — select an operand to transform it.
  if (selected.kind === 'csg') return null

  return (
    <TransformControls
      object={target}
      mode={mode}
      onMouseDown={() => {
        // Capture all selected shapes' baseline centers so a multi-shape
        // translate can propagate the same world-delta to each. Single
        // selection still uses just the primary baseline.
        const centersById = new Map()
        for (const sid of selectedIds.length > 1 ? selectedIds : [selectedId]) {
          const s = cuboids.find((c) => c.id === sid)
          if (s) centersById.set(sid, [...s.center])
        }
        baselineRef.current = {
          size: selected.size,
          meshScale: [target.scale.x, target.scale.y, target.scale.z],
          centersById,
        }
        setCsgDragSuspended(true)
      }}
      onObjectChange={() => {
        if (mode === 'translate') {
          const newCenter = [target.position.x, target.position.y, target.position.z]
          if (selectedIds.length > 1 && baselineRef.current?.centersById) {
            // Multi-shape translate: world-delta = newCenter - primary's
            // baseline; apply that delta to every selected shape's
            // baseline so the whole group moves rigidly.
            const base = baselineRef.current.centersById.get(selectedId)
            if (base) {
              const dx = newCenter[0] - base[0]
              const dy = newCenter[1] - base[1]
              const dz = newCenter[2] - base[2]
              for (const sid of selectedIds) {
                const start = baselineRef.current.centersById.get(sid)
                if (!start) continue
                updateCuboid(sid, { center: [start[0] + dx, start[1] + dy, start[2] + dz] })
              }
              return
            }
          }
          updateCuboid(selectedId, { center: newCenter })
        } else if (mode === 'rotate') {
          // Three's Matrix4.elements is column-major; we store rotation as a
          // row-major 3×3 [m00, m01, m02, m10, m11, m12, m20, m21, m22].
          // Rotate / scale only affect the primary selection on multi —
          // applying a rotation to the entire group around the primary's
          // pivot is a future refinement.
          const m = new Matrix4().makeRotationFromQuaternion(target.quaternion)
          const e = m.elements
          const rot = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
          updateCuboid(selectedId, { rotation: rot })
        } else if (mode === 'scale' && baselineRef.current) {
          const { size: base, meshScale: ms } = baselineRef.current
          const rx = target.scale.x / ms[0]
          const ry = target.scale.y / ms[1]
          const rz = target.scale.z / ms[2]
          updateCuboid(selectedId, {
            size: [base[0] * rx, base[1] * ry, base[2] * rz],
          })
        }
      }}
      onMouseUp={() => {
        // After scale commits to `size`, the next render re-creates the
        // geometry at that size with mesh.scale = baseline. Reset the live
        // mesh.scale so the gizmo re-anchors at 1× for the next drag.
        if (mode === 'scale' && baselineRef.current) {
          const ms = baselineRef.current.meshScale
          target.scale.set(ms[0], ms[1], ms[2])
        }
        baselineRef.current = null
        setCsgDragSuspended(false)
      }}
    />
  )
}

function ThreeView({ clean = false }) {
  // Map shapeId → THREE.Object3D, populated by ref callbacks on each mesh.
  const targets = useRef(new Map())
  const selectedId = useScene((s) => s.selectedCuboidId)

  // Stable ref callback — same identity across renders, so React doesn't
  // double-fire (null then el) on every parent render. Population is
  // observed via the Transformer's useLayoutEffect, not via forced renders.
  const registerRef = useCallback((id, el) => {
    if (el) targets.current.set(id, el)
    else targets.current.delete(id)
  }, [])

  const [tMode, setTMode] = useState('translate')

  // T / R / E keyboard shortcuts to switch the gizmo mode (Maya/Blender style).
  // Capture phase + stopImmediatePropagation so the global `r` (perspective
  // reset) doesn't also fire while ThreeView is mounted.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const tag = (t && t.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 't') {
        setTMode('translate')
      } else if (e.key === 'r') {
        setTMode('rotate')
        e.stopImmediatePropagation()
      } else if (e.key === 'e') {
        setTMode('scale')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <Canvas
      className="block w-full h-full"
      // toneMapping disabled so material colors render as authored sRGB —
      // ACES (the r3f default) bakes a film curve onto every pixel. The
      // rest of the KOL surface is literal sRGB; the 3D view should match.
      gl={{ antialias: true, alpha: true, toneMapping: NoToneMapping }}
      dpr={[1, 2]}
      // PCF soft shadows; meshes cast/receive on a per-mesh basis. With
      // frameloop="demand" the shadow map only re-bakes when state or
      // OrbitControls invalidates — no continuous render cost.
      shadows
      // demand frameloop: only renders on prop change or invalidate(). With
      // OrbitControls damping we still get smooth spin-down because drei's
      // controls call invalidate() per damp tick.
      frameloop="demand"
    >
      <CameraInit />
      <SceneBackground />
      <Environment preset="city" background={false} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      <Lights registerRef={registerRef} selectedId={selectedId} clean={clean} />
      <Cuboids registerRef={registerRef} selectedId={selectedId} />
      <SceneFrame />
      {/* Wireframe edge overlay — Blender's "Solid + wireframe" mode.
        * Renders the same edge data the SVG view uses on top of the
        * shaded meshes so the user can see geometry topology while
        * editing in 3D. depthTest=false makes edges show through
        * occluding faces — without it, the back edges are hidden. */}
      {!clean && <WireframeOverlay />}
      {!clean && <Transformer targetsRef={targets} mode={tMode} />}
      {!clean && <axesHelper args={[2]} />}
    </Canvas>
  )
}

export default ThreeView
