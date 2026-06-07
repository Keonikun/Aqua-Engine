import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { bakeRuntimeLighting } from './RuntimeLightBaker.js'

export const DEFAULT_MAP_URL = '/assets/maps/demo_map/demo.glb'
export const DEFAULT_LIGHTING_MODE = 'sidecar'

const hiddenCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false })
const collisionBrushDebugMaterial = new THREE.MeshBasicMaterial({
  color: '#75d3c8',
  wireframe: true,
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
})
const fallbackPlayerStart = new THREE.Vector3(0, 0.1, 4)
const DEFAULT_PLANE_LIGHTMAP_RESOLUTION = 1
const MAX_PLANE_LIGHTMAP_SEGMENTS = 48

export async function loadBrushMap({
  url = DEFAULT_MAP_URL,
  materials,
  lightingUrl = inferLightingUrl(url),
  fetchJson = fetch,
  lightingMode = DEFAULT_LIGHTING_MODE,
  runtimeBakeSettings = {},
  onProgress = () => {},
} = {}) {
  const normalizedLightingMode = normalizeLightingMode(lightingMode)
  const loader = new GLTFLoader()
  const shouldLoadSidecar = normalizedLightingMode === 'sidecar'

  reportProgress(onProgress, {
    stage: 'map:load',
    label: 'Loading map geometry',
    progress: 0,
  })

  const [gltf, sidecarLighting] = await Promise.all([
    loader.loadAsync(url),
    shouldLoadSidecar ? loadBakedLighting(lightingUrl, fetchJson) : Promise.resolve(null),
  ])
  const renderGroup = new THREE.Group()
  const collisionGroup = new THREE.Group()
  const collisionDebugGroup = new THREE.Group()
  const propRefs = []
  const bakeTargets = []
  const playerStart = fallbackPlayerStart.clone()
  let bakedLighting = sidecarLighting

  renderGroup.name = 'BrushMapRender'
  collisionGroup.name = 'BrushMapCollision'
  collisionDebugGroup.name = 'BrushMapCollisionDebug'
  gltf.scene.updateMatrixWorld(true)

  reportProgress(onProgress, {
    stage: 'map:build',
    label: 'Building world brushes',
    progress: 0.32,
  })

  gltf.scene.traverse((source) => {
    const entityClass = getString(source.userData, 'aqua_entity', 'aquaEntity')

    if (entityClass === 'info_player_start' || source.name === 'info_player_start') {
      source.getWorldPosition(playerStart)
      return
    }

    const propAsset = getString(
      source.userData,
      'aqua_prop_asset',
      'aquaPropAsset',
      'aqua_asset',
      'aquaAsset'
    )

    if (propAsset) {
      propRefs.push(createPropRef(source, propAsset, url))
      return
    }

    const brushType = getString(source.userData, 'aqua_brush_type', 'aquaBrushType')

    if (!brushType) {
      return
    }

    const brushMesh = createBrushMesh({ source, brushType, materials })

    if (!brushMesh) {
      return
    }

    bakeTargets.push(brushMesh)

    if (isDebugCollisionBrush(brushType)) {
      collisionDebugGroup.add(createCollisionDebugMesh(brushMesh))
    } else {
      renderGroup.add(brushMesh)
    }

    if (brushMesh.userData.collisionKind !== 'none') {
      collisionGroup.add(createCollisionMesh(brushMesh))
    }
  })

  if (normalizedLightingMode === 'runtime') {
    bakedLighting = await bakeRuntimeLighting({
      meshes: bakeTargets,
      sourceScene: gltf.scene,
      settings: runtimeBakeSettings,
      onProgress: (event) => {
        reportProgress(onProgress, {
          ...event,
          progress: 0.42 + (event.progress ?? 0) * 0.5,
        })
      },
    })
  }

  if (normalizedLightingMode === 'off') {
    reportProgress(onProgress, {
      stage: 'lighting:off',
      label: 'Baked lighting disabled',
      progress: 0.92,
    })
  } else if (bakedLighting) {
    reportProgress(onProgress, {
      stage: 'lighting:apply',
      label: 'Applying baked lighting',
      progress: 0.94,
      detail: `${Object.keys(bakedLighting.meshes || {}).length} surface(s)`,
    })

    for (const mesh of bakeTargets) {
      applyBakedLighting(mesh, bakedLighting, materials)
    }
  } else {
    reportProgress(onProgress, {
      stage: 'lighting:missing',
      label: 'No baked lighting found',
      progress: 0.94,
    })
  }

  reportProgress(onProgress, {
    stage: 'map:ready',
    label: 'Map ready',
    progress: 1,
  })

  return {
    renderGroup,
    collisionGroup,
    collisionDebugGroup,
    playerStart,
    propRefs,
    source: gltf.scene,
  }
}

function createPropRef(source, propAsset, mapUrl) {
  source.updateWorldMatrix(true, false)

  return {
    name: source.name || 'aqua_prop',
    asset: resolveUrl(propAsset, mapUrl),
    matrix: source.matrixWorld.toArray(),
    userData: cloneUserData(source.userData),
  }
}

function createBrushMesh({ source, brushType, materials }) {
  const material = createBrushMaterial(source, materials)
  let mesh = null

  if (brushType === 'terrain') {
    mesh = createTerrainBrush(source, material)
  } else if (brushType === 'ramp') {
    mesh = createRampBrush(source, material)
  } else if (brushType === 'plane') {
    mesh = createPlaneBrush(source, material)
  } else if (source.isMesh && source.geometry?.getAttribute('position')) {
    mesh = new THREE.Mesh(createRenderableMeshGeometry(source), material)
    mesh.geometry.computeVertexNormals()
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  }

  if (!mesh) {
    return null
  }

  mesh.name = source.name || `aqua_${brushType}`
  ensureAoUv(mesh.geometry)
  copyWorldTransform(source, mesh)
  mesh.userData = createBrushUserData(source.userData, brushType)

  return mesh
}

function normalizeLightingMode(lightingMode) {
  const mode = String(lightingMode || DEFAULT_LIGHTING_MODE).toLowerCase()

  if (mode === 'off' || mode === 'false' || mode === 'none' || mode === 'disabled') {
    return 'off'
  }

  if (mode === 'runtime' || mode === 'bake' || mode === 'browser') {
    return 'runtime'
  }

  return 'sidecar'
}

function reportProgress(onProgress, event) {
  onProgress({
    detail: '',
    ...event,
    progress: THREE.MathUtils.clamp(event.progress ?? 0, 0, 1),
  })
}

function createRampBrush(source, material) {
  return new THREE.Mesh(createRampGeometry(), material)
}

function createPlaneBrush(source, material) {
  return new THREE.Mesh(createPlaneBrushGeometry(source), material)
}

function createPlaneBrushGeometry(source) {
  const scale = getSourceWorldScale(source)
  const resolution = getNumber(source.userData, 'aqua_lightmap_resolution', 'aquaLightmapResolution') ||
    DEFAULT_PLANE_LIGHTMAP_RESOLUTION
  const segmentsX = getLightmapSegments(scale.x, resolution)
  const segmentsY = getLightmapSegments(scale.y, resolution)
  const segmentsZ = getLightmapSegments(scale.z, resolution)
  const geometry = new THREE.BoxGeometry(1, 1, 1, segmentsX, segmentsY, segmentsZ)

  geometry.computeVertexNormals()

  return geometry
}

function createRenderableMeshGeometry(source) {
  const geometry = createSubdividedFlatGeometry({
    geometry: source.geometry,
    userData: source.userData,
    worldMatrix: source.matrixWorld,
  })

  return geometry || source.geometry.clone()
}

function createSubdividedFlatGeometry({ geometry, userData, worldMatrix }) {
  const position = geometry?.getAttribute('position')

  if (!position || position.count > 6) {
    return null
  }

  const bounds = getLocalBounds(position)
  const axes = getFlatGeometryAxes(bounds)

  if (!axes) {
    return null
  }

  const scale = getMatrixWorldScale(worldMatrix)
  const resolution = getNumber(userData, 'aqua_lightmap_resolution', 'aquaLightmapResolution') ||
    DEFAULT_PLANE_LIGHTMAP_RESOLUTION
  const segmentsU = getLightmapSegments(bounds.size[axes.u] * scale.getComponent(axes.u), resolution)
  const segmentsV = getLightmapSegments(bounds.size[axes.v] * scale.getComponent(axes.v), resolution)

  if (segmentsU <= 1 && segmentsV <= 1) {
    return null
  }

  return createFlatGridGeometry({ bounds, axes, segmentsU, segmentsV, normal: getAverageNormal(geometry, axes.flat) })
}

function createFlatGridGeometry({ bounds, axes, segmentsU, segmentsV, normal }) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const flipWinding = shouldFlipFlatGridWinding(axes, normal)

  for (let row = 0; row <= segmentsV; row += 1) {
    const vRatio = row / segmentsV

    for (let column = 0; column <= segmentsU; column += 1) {
      const uRatio = column / segmentsU
      const point = [bounds.center[0], bounds.center[1], bounds.center[2]]

      point[axes.u] = THREE.MathUtils.lerp(bounds.min[axes.u], bounds.max[axes.u], uRatio)
      point[axes.v] = THREE.MathUtils.lerp(bounds.min[axes.v], bounds.max[axes.v], vRatio)
      point[axes.flat] = bounds.center[axes.flat]

      positions.push(point[0], point[1], point[2])
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(uRatio, vRatio)
    }
  }

  const columns = segmentsU + 1

  for (let row = 0; row < segmentsV; row += 1) {
    for (let column = 0; column < segmentsU; column += 1) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1

      if (flipWinding) {
        indices.push(a, b, c, b, d, c)
      } else {
        indices.push(a, c, b, b, c, d)
      }
    }
  }

  const grid = new THREE.BufferGeometry()

  grid.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  grid.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  grid.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  grid.setIndex(indices)

  return grid
}

function shouldFlipFlatGridWinding(axes, normal) {
  const uAxis = new THREE.Vector3()
  const vAxis = new THREE.Vector3()

  uAxis.setComponent(axes.u, 1)
  vAxis.setComponent(axes.v, 1)

  const defaultWindingNormal = new THREE.Vector3().crossVectors(vAxis, uAxis)

  return defaultWindingNormal.dot(normal) < 0
}

function createRampGeometry() {
  const positions = [
    -0.5, -0.5, 0.5,
    0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5,
    0.5, -0.5, -0.5,
    -0.5, 0.5, -0.5,
    0.5, 0.5, -0.5,
  ]
  const indices = [
    0, 2, 1, 1, 2, 3,
    2, 4, 3, 3, 4, 5,
    0, 1, 4, 1, 5, 4,
    0, 4, 2,
    1, 3, 5,
  ]
  const geometry = new THREE.BufferGeometry()

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

function createTerrainBrush(source, material) {
  const segmentsX = getNumber(source.userData, 'aqua_segments_x', 'aquaSegmentsX') || 12
  const segmentsZ = getNumber(source.userData, 'aqua_segments_z', 'aquaSegmentsZ') || 10
  const heightMode = getString(source.userData, 'aqua_height_mode', 'aquaHeightMode') || 'demo_wave'

  if (source.isMesh && source.geometry?.getAttribute('position')) {
    const mesh = new THREE.Mesh(source.geometry.clone(), material)

    mesh.geometry.computeVertexNormals()

    if (isGridTerrain(source.userData)) {
      mesh.userData.terrain = {
        segmentsX,
        segmentsZ,
        maxSnapDepth: getNumber(source.userData, 'aqua_max_snap_depth', 'aquaMaxSnapDepth') || 0.65,
      }
    }

    return mesh
  }

  const geometry = createTerrainGeometry({ segmentsX, segmentsZ, heightMode })
  const mesh = new THREE.Mesh(geometry, material)

  mesh.userData.terrain = {
    segmentsX,
    segmentsZ,
    maxSnapDepth: getNumber(source.userData, 'aqua_max_snap_depth', 'aquaMaxSnapDepth') || 0.65,
  }

  return mesh
}

function createTerrainGeometry({ segmentsX, segmentsZ, heightMode }) {
  const columns = segmentsX + 1
  const rows = segmentsZ + 1
  const positions = []
  const indices = []

  for (let row = 0; row < rows; row += 1) {
    const zRatio = row / segmentsZ
    const z = zRatio - 0.5

    for (let column = 0; column < columns; column += 1) {
      const xRatio = column / segmentsX
      const x = xRatio - 0.5
      positions.push(x, getTerrainHeight(xRatio, zRatio, heightMode), z)
    }
  }

  for (let row = 0; row < segmentsZ; row += 1) {
    for (let column = 0; column < segmentsX; column += 1) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1

      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

function getTerrainHeight(xRatio, zRatio, heightMode) {
  if (heightMode !== 'demo_wave') {
    return 0
  }

  return Math.sin(xRatio * Math.PI * 2.25) * 0.12 +
    Math.cos(zRatio * Math.PI * 2) * 0.08 +
    Math.sin((xRatio + zRatio) * Math.PI * 1.5) * 0.05
}

function createCollisionMesh(renderMesh) {
  const collisionMesh = renderMesh.clone()

  collisionMesh.geometry = renderMesh.geometry
  collisionMesh.material = hiddenCollisionMaterial
  collisionMesh.name = `${renderMesh.name}_collision`
  collisionMesh.userData = cloneUserData(renderMesh.userData)

  return collisionMesh
}

function createCollisionDebugMesh(renderMesh) {
  const debugMesh = renderMesh.clone()

  debugMesh.geometry = renderMesh.geometry
  debugMesh.material = collisionBrushDebugMaterial
  debugMesh.name = `${renderMesh.name}_debug`
  debugMesh.userData = cloneUserData(renderMesh.userData)
  debugMesh.renderOrder = 10

  return debugMesh
}

function createBrushUserData(sourceUserData, brushType) {
  const userData = cloneUserData(sourceUserData)

  if (brushType === 'terrain') {
    if (isGridTerrain(sourceUserData)) {
      userData.collisionKind = 'terrain'
      userData.terrain = userData.terrain || {
        segmentsX: getNumber(sourceUserData, 'aqua_segments_x', 'aquaSegmentsX'),
        segmentsZ: getNumber(sourceUserData, 'aqua_segments_z', 'aquaSegmentsZ'),
        maxSnapDepth: getNumber(sourceUserData, 'aqua_max_snap_depth', 'aquaMaxSnapDepth') || 0.65,
      }
    } else {
      userData.collisionKind = 'triangle'
      userData.terrainMesh = true
    }
  } else if (brushType === 'mesh') {
    userData.collisionKind = 'none'
  } else if (brushType === 'ramp' || brushType === 'box' || brushType === 'plane') {
    userData.collisionKind = brushType === 'ramp' ? 'slope' : 'brush'
  }

  return userData
}

function isDebugCollisionBrush(brushType) {
  return brushType === 'box' || brushType === 'plane' || brushType === 'ramp'
}

function createBrushMaterial(source, materials) {
  const sourceMaterials = getSourceMaterials(source)

  if (sourceMaterials.length > 0) {
    const resolvedMaterials = sourceMaterials.map((material) => materials.getMaterialByName(material.name))

    return resolvedMaterials.length === 1 ? resolvedMaterials[0] : resolvedMaterials
  }

  return materials.createMaterial({
    color: getString(source.userData, 'aqua_color', 'aquaColor') || '#7f8a8f',
  })
}

function applyBakedLighting(mesh, bakedLighting, materials) {
  const entry = findBakedLightingEntry(mesh, bakedLighting)

  if (!entry?.colors || !mesh.geometry) {
    return
  }

  const position = mesh.geometry.getAttribute('position')

  if (!position || entry.colors.length !== position.count * 3) {
    console.warn(
      `Skipping baked lighting for "${mesh.name}": expected ${position ? position.count * 3 : 0} color values, got ${entry.colors.length}.`
    )
    return
  }

  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(entry.colors, 3))
  mesh.userData.bakedLighting = {
    source: bakedLighting.source || null,
    schema: bakedLighting.schema,
  }

  if (materials?.createBakedMaterial) {
    mesh.material = materials.createBakedMaterial(mesh.material)
  }
}

function findBakedLightingEntry(mesh, bakedLighting) {
  const meshes = bakedLighting?.meshes

  if (!meshes) {
    return null
  }

  for (const key of getBakedLightingKeys(mesh)) {
    if (meshes[key]) {
      return meshes[key]
    }
  }

  for (const entry of Object.values(meshes)) {
    if (!Array.isArray(entry.aliases)) {
      continue
    }

    if (entry.aliases.some((alias) => getBakedLightingKeys(mesh).includes(alias))) {
      return entry
    }
  }

  return null
}

function getBakedLightingKeys(mesh) {
  const keys = new Set()
  const bakeId = getString(mesh.userData, 'aqua_bake_id', 'aquaBakeId')

  if (bakeId) {
    keys.add(bakeId)
    keys.add(sanitizeRuntimeName(bakeId))
  }

  if (mesh.name) {
    keys.add(mesh.name)
    keys.add(restoreBlenderSuffixName(mesh.name))
    keys.add(sanitizeRuntimeName(mesh.name))
  }

  return [...keys].filter(Boolean)
}

function sanitizeRuntimeName(name) {
  return String(name).replace(/\s/g, '_').replace(/[\[\]\.:/]/g, '')
}

function restoreBlenderSuffixName(name) {
  return String(name)
    .replace(/_(\d{3})$/, '.$1')
    .replace(/([^\d])(\d{3})$/, '$1.$2')
}

function getSourceMaterials(source) {
  if (!source.isMesh || !source.material) {
    return []
  }

  const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material]

  return sourceMaterials.filter((material) => material?.name)
}

function ensureAoUv(geometry) {
  if (!geometry?.attributes?.uv || geometry.attributes.uv2) {
    return
  }

  geometry.setAttribute('uv2', geometry.attributes.uv.clone())
}

function copyWorldTransform(source, target) {
  source.updateWorldMatrix(true, false)
  source.matrixWorld.decompose(target.position, target.quaternion, target.scale)
}

function cloneUserData(userData) {
  return JSON.parse(JSON.stringify(userData || {}))
}

function getString(userData, ...keys) {
  for (const key of keys) {
    if (typeof userData?.[key] === 'string') {
      return userData[key]
    }
  }

  return null
}

function getNumber(userData, ...keys) {
  for (const key of keys) {
    const value = Number(userData?.[key])

    if (Number.isFinite(value)) {
      return value
    }
  }

  return null
}

function isGridTerrain(userData) {
  return Number.isInteger(getNumber(userData, 'aqua_segments_x', 'aquaSegmentsX')) &&
    Number.isInteger(getNumber(userData, 'aqua_segments_z', 'aquaSegmentsZ'))
}

function getSourceWorldScale(source) {
  source.updateWorldMatrix(true, false)
  return getMatrixWorldScale(source.matrixWorld)
}

function getMatrixWorldScale(matrix) {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)

  matrix.decompose(position, quaternion, scale)

  return scale
}

function getLocalBounds(position) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]

  for (let i = 0; i < position.count; i += 1) {
    const values = [position.getX(i), position.getY(i), position.getZ(i)]

    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[axis])
      max[axis] = Math.max(max[axis], values[axis])
    }
  }

  const size = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ]
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ]

  return { min, max, size, center }
}

function getFlatGeometryAxes(bounds) {
  const orderedAxes = [0, 1, 2].sort((a, b) => bounds.size[a] - bounds.size[b])
  const flat = orderedAxes[0]
  const u = orderedAxes[2]
  const v = orderedAxes[1]
  const largestSize = bounds.size[u]

  if (largestSize <= 0.0001 || bounds.size[v] <= 0.0001) {
    return null
  }

  if (bounds.size[flat] > Math.max(0.001, largestSize * 0.02)) {
    return null
  }

  return { flat, u, v }
}

function getAverageNormal(geometry, flatAxis) {
  const normal = geometry.getAttribute('normal')
  const average = new THREE.Vector3()

  if (normal) {
    for (let i = 0; i < normal.count; i += 1) {
      average.x += normal.getX(i)
      average.y += normal.getY(i)
      average.z += normal.getZ(i)
    }

    if (average.lengthSq() > 0.000001) {
      return average.normalize()
    }
  }

  average.set(0, 0, 0)
  average.setComponent(flatAxis, 1)

  return average
}

function getLightmapSegments(size, resolution) {
  if (!Number.isFinite(size) || !Number.isFinite(resolution) || resolution <= 0) {
    return 1
  }

  return Math.min(Math.max(Math.ceil(Math.abs(size) / resolution), 1), MAX_PLANE_LIGHTMAP_SEGMENTS)
}

async function loadBakedLighting(url, fetchJson) {
  if (!url) {
    return null
  }

  try {
    const response = await fetchJson(url)

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`Failed to load baked lighting "${url}": ${response.status}`)
      }

      return null
    }

    const lighting = await response.json()

    return lighting?.schema === 'aqua.baked_lighting.v1' ? lighting : null
  } catch (error) {
    console.warn(`Failed to load baked lighting "${url}".`, error)
    return null
  }
}

function inferLightingUrl(url) {
  const resolvedUrl = new URL(url, window.location.href)
  const dotIndex = resolvedUrl.pathname.lastIndexOf('.')

  if (dotIndex === -1) {
    resolvedUrl.pathname = `${resolvedUrl.pathname}.light.json`
  } else {
    resolvedUrl.pathname = `${resolvedUrl.pathname.slice(0, dotIndex)}.light.json`
  }

  return resolvedUrl.toString()
}

function resolveUrl(url, baseUrl = window.location.href) {
  return new URL(url, baseUrl).toString()
}
