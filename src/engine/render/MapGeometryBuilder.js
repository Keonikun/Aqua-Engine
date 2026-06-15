import * as THREE from 'three'

const DEFAULT_PLANE_LIGHTMAP_RESOLUTION = 1
const MAX_PLANE_LIGHTMAP_SEGMENTS = 48

export function createBrushMesh({ source, brushType, material, userData, resources }) {
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

  resources?.trackObject(mesh)
  resources?.trackGeometry(mesh.geometry)
  mesh.name = source.name || `aqua_${brushType}`
  ensureAoUv(mesh.geometry)
  copyWorldTransform(source, mesh)
  mesh.userData = userData || {}

  return mesh
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
