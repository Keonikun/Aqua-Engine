#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

const COMPONENT_TYPES = {
  5120: { size: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { size: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { size: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { size: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { size: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { size: 4, read: (view, offset) => view.getFloat32(offset, true) },
}

const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

const DEFAULT_SETTINGS = {
  ambientColor: '#8aa7bd',
  ambientIntensity: 0.22,
  sunColor: '#fff2d0',
  sunIntensity: 1.15,
  sunDirection: [-0.55, 0.82, 0.35],
  bounces: 1,
  bounceStrength: 0.42,
  exposure: 1,
  minLight: 0.035,
  maxLight: 2.4,
  normalBias: 0.025,
  shadowDistance: 96,
  patchDistance: 18,
}

const DEFAULT_PLANE_LIGHTMAP_RESOLUTION = 1
const MAX_PLANE_LIGHTMAP_SEGMENTS = 48

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  const cli = parseArgs(process.argv.slice(2))

  if (cli.help) {
    printHelp()
    return
  }

  const inputPath = path.resolve(cli.input || path.join(__dirname, '..', '..', 'public', 'assets', 'maps', 'demo_map', 'demo.glb'))
  const outputPath = path.resolve(cli.output || defaultOutputPath(inputPath))
  const settings = {
    ...DEFAULT_SETTINGS,
    ...cli.settings,
  }

  const document = await loadGltfDocument(inputPath)
  const nodes = collectNodes(document)
  const surfaces = collectBakeSurfaces(document, nodes)
  const lights = collectLights(document, nodes, settings, cli.useDefaultLights)

  if (surfaces.length === 0) {
    throw new Error(`No Aqua brush surfaces found in ${inputPath}`)
  }

  const triangles = buildTriangles(surfaces)
  computeDirectLighting(surfaces, lights, triangles, settings)
  computeBounceLighting(surfaces, triangles, settings)

  const output = createLightingOutput({
    inputPath,
    outputPath,
    settings,
    lights,
    surfaces,
    triangles,
  })

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  console.log(`Baked ${surfaces.length} surface(s), ${triangles.length} patch triangle(s), ${lights.length} light(s).`)
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`)
}

function parseArgs(args) {
  const positional = []
  const settings = {}
  let output = null
  let help = false
  let useDefaultLights = true

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const next = () => {
      i += 1
      return args[i]
    }

    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '-o' || arg === '--output') {
      output = next()
    } else if (arg === '--bounces') {
      settings.bounces = readNumber(next(), arg)
    } else if (arg === '--bounce-strength') {
      settings.bounceStrength = readNumber(next(), arg)
    } else if (arg === '--ambient') {
      settings.ambientIntensity = readNumber(next(), arg)
    } else if (arg === '--sun') {
      settings.sunIntensity = readNumber(next(), arg)
    } else if (arg === '--exposure') {
      settings.exposure = readNumber(next(), arg)
    } else if (arg === '--min-light') {
      settings.minLight = readNumber(next(), arg)
    } else if (arg === '--max-light') {
      settings.maxLight = readNumber(next(), arg)
    } else if (arg === '--patch-distance') {
      settings.patchDistance = readNumber(next(), arg)
    } else if (arg === '--shadow-distance') {
      settings.shadowDistance = readNumber(next(), arg)
    } else if (arg === '--no-default-lights') {
      useDefaultLights = false
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  return {
    input: positional[0] || null,
    output: output || positional[1] || null,
    settings,
    help,
    useDefaultLights,
  }
}

function printHelp() {
  console.log(`Usage: node tools/mapcompiler/bakeLighting.js [map.glb|map.gltf] [output.light.json]

Options:
  -o, --output <path>        Write baked lighting JSON to a custom path.
  --bounces <count>          Number of radiosity bounce passes. Default: ${DEFAULT_SETTINGS.bounces}
  --bounce-strength <value>  Indirect light multiplier. Default: ${DEFAULT_SETTINGS.bounceStrength}
  --ambient <value>          Default ambient intensity. Default: ${DEFAULT_SETTINGS.ambientIntensity}
  --sun <value>              Default sun intensity. Default: ${DEFAULT_SETTINGS.sunIntensity}
  --exposure <value>         Final light multiplier. Default: ${DEFAULT_SETTINGS.exposure}
  --min-light <value>        Minimum final light value. Default: ${DEFAULT_SETTINGS.minLight}
  --max-light <value>        Clamp final light value. Default: ${DEFAULT_SETTINGS.maxLight}
  --patch-distance <value>   Max distance for bounce patches. Default: ${DEFAULT_SETTINGS.patchDistance}
  --shadow-distance <value>  Max directional shadow ray distance. Default: ${DEFAULT_SETTINGS.shadowDistance}
  --no-default-lights        Use only authored Aqua/KHR lights from the map.
`)
}

function readNumber(value, option) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${option} expects a number`)
  }

  return number
}

function defaultOutputPath(inputPath) {
  const extension = path.extname(inputPath)
  return `${inputPath.slice(0, inputPath.length - extension.length)}.light.json`
}

async function loadGltfDocument(inputPath) {
  const extension = path.extname(inputPath).toLowerCase()

  if (extension === '.glb') {
    return loadGlbDocument(inputPath)
  }

  if (extension === '.gltf') {
    return loadJsonGltfDocument(inputPath)
  }

  throw new Error(`Unsupported map format "${extension}". Expected .glb or .gltf.`)
}

async function loadGlbDocument(inputPath) {
  const data = await fs.readFile(inputPath)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error(`${inputPath} is not a GLB file.`)
  }

  const version = view.getUint32(4, true)

  if (version !== 2) {
    throw new Error(`Only GLB v2 is supported. Found v${version}.`)
  }

  const length = view.getUint32(8, true)
  let offset = 12
  let json = null
  let binaryChunk = null

  while (offset < length) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    const chunk = data.subarray(chunkStart, chunkStart + chunkLength)

    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunk))
    } else if (chunkType === 0x004e4942) {
      binaryChunk = chunk
    }

    offset = chunkStart + chunkLength
  }

  if (!json) {
    throw new Error(`${inputPath} does not contain a JSON chunk.`)
  }

  return {
    inputPath,
    baseDir: path.dirname(inputPath),
    json,
    buffers: [binaryChunk],
  }
}

async function loadJsonGltfDocument(inputPath) {
  const baseDir = path.dirname(inputPath)
  const json = JSON.parse(await fs.readFile(inputPath, 'utf8'))
  const buffers = []

  for (const buffer of json.buffers || []) {
    if (!buffer.uri) {
      buffers.push(null)
      continue
    }

    if (buffer.uri.startsWith('data:')) {
      buffers.push(readDataUri(buffer.uri))
    } else {
      buffers.push(await fs.readFile(path.resolve(baseDir, decodeURIComponent(buffer.uri))))
    }
  }

  return {
    inputPath,
    baseDir,
    json,
    buffers,
  }
}

function readDataUri(uri) {
  const comma = uri.indexOf(',')

  if (comma === -1) {
    throw new Error('Invalid GLTF data URI.')
  }

  const metadata = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)

  if (metadata.endsWith(';base64')) {
    return Buffer.from(payload, 'base64')
  }

  return Buffer.from(decodeURIComponent(payload), 'utf8')
}

function collectNodes(document) {
  const sceneIndex = document.json.scene || 0
  const scene = document.json.scenes?.[sceneIndex]
  const roots = scene?.nodes || []
  const nodes = []

  for (const nodeIndex of roots) {
    walkNode(document, nodeIndex, new THREE.Matrix4(), [], nodes)
  }

  return nodes
}

function walkNode(document, nodeIndex, parentMatrix, pathParts, nodes) {
  const node = document.json.nodes?.[nodeIndex]

  if (!node) {
    return
  }

  const localMatrix = getNodeLocalMatrix(node)
  const worldMatrix = parentMatrix.clone().multiply(localMatrix)
  const rawName = node.name || `node_${nodeIndex}`
  const name = sanitizeRuntimeName(rawName)
  const nodePath = [...pathParts, rawName]

  nodes.push({
    index: nodeIndex,
    name,
    rawName,
    path: nodePath.join('/'),
    node,
    extras: node.extras || {},
    worldMatrix,
  })

  for (const childIndex of node.children || []) {
    walkNode(document, childIndex, worldMatrix, nodePath, nodes)
  }
}

function getNodeLocalMatrix(node) {
  if (node.matrix) {
    return new THREE.Matrix4().fromArray(node.matrix)
  }

  const position = new THREE.Vector3().fromArray(node.translation || [0, 0, 0])
  const quaternion = new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1])
  const scale = new THREE.Vector3().fromArray(node.scale || [1, 1, 1])

  return new THREE.Matrix4().compose(position, quaternion, scale)
}

function collectBakeSurfaces(document, nodes) {
  const surfaces = []

  for (const entry of nodes) {
    const brushType = getString(entry.extras, 'aqua_brush_type', 'aquaBrushType')

    if (!brushType) {
      continue
    }

    const geometry = createRuntimeGeometry(document, entry, brushType)

    if (!geometry?.getAttribute('position')) {
      continue
    }

    const surface = createBakeSurface({
      name: getBakeSurfaceName(entry),
      aliases: getBakeSurfaceAliases(entry),
      path: entry.path,
      brushType,
      extras: entry.extras,
      geometry,
      worldMatrix: entry.worldMatrix,
      albedo: getSurfaceAlbedo(document, entry.node, entry.extras),
    })

    surfaces.push(surface)
  }

  return surfaces
}

function createRuntimeGeometry(document, entry, brushType) {
  const { node } = entry

  if (brushType === 'terrain') {
    if (Number.isInteger(node.mesh)) {
      return createGeometryFromMesh(document, node.mesh)
    }

    return createTerrainGeometry({
      segmentsX: getNumber(node.extras, 'aqua_segments_x', 'aquaSegmentsX') || 12,
      segmentsZ: getNumber(node.extras, 'aqua_segments_z', 'aquaSegmentsZ') || 10,
      heightMode: getString(node.extras, 'aqua_height_mode', 'aquaHeightMode') || 'demo_wave',
    })
  }

  if (brushType === 'ramp') {
    return createRampGeometry()
  }

  if (brushType === 'plane') {
    return createPlaneBrushGeometry(entry)
  }

  if (Number.isInteger(node.mesh)) {
    const geometry = createGeometryFromMesh(document, node.mesh)
    return createRenderableMeshGeometry(geometry, entry)
  }

  return new THREE.BoxGeometry(1, 1, 1)
}

function createGeometryFromMesh(document, meshIndex) {
  const mesh = document.json.meshes?.[meshIndex]
  const primitive = mesh?.primitives?.[0]

  if (!primitive) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  const positions = readAccessor(document, primitive.attributes?.POSITION)
  const normals = readAccessor(document, primitive.attributes?.NORMAL)
  const indices = Number.isInteger(primitive.indices) ? readAccessor(document, primitive.indices) : null

  if (!positions) {
    return null
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.array, positions.itemSize))

  if (normals) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals.array, normals.itemSize))
  }

  if (indices) {
    geometry.setIndex(Array.from(indices.array))
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals()
  }

  return geometry
}

function readAccessor(document, accessorIndex) {
  if (!Number.isInteger(accessorIndex)) {
    return null
  }

  const accessor = document.json.accessors?.[accessorIndex]

  if (!accessor) {
    return null
  }

  if (accessor.sparse) {
    throw new Error(`Sparse accessors are not supported yet. Accessor: ${accessorIndex}`)
  }

  const itemSize = ACCESSOR_COMPONENTS[accessor.type]
  const component = COMPONENT_TYPES[accessor.componentType]

  if (!itemSize || !component) {
    throw new Error(`Unsupported accessor ${accessorIndex} type/component.`)
  }

  const count = accessor.count || 0
  const array = new Float32Array(count * itemSize)

  if (!Number.isInteger(accessor.bufferView)) {
    return { array, itemSize }
  }

  const bufferView = document.json.bufferViews?.[accessor.bufferView]
  const buffer = document.buffers?.[bufferView?.buffer || 0]

  if (!bufferView || !buffer) {
    throw new Error(`Accessor ${accessorIndex} references a missing buffer.`)
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)
  const stride = bufferView.byteStride || component.size * itemSize

  for (let i = 0; i < count; i += 1) {
    const elementOffset = start + i * stride

    for (let c = 0; c < itemSize; c += 1) {
      const value = component.read(view, elementOffset + c * component.size)
      array[i * itemSize + c] = normalizeAccessorValue(value, accessor.componentType, accessor.normalized)
    }
  }

  return { array, itemSize }
}

function normalizeAccessorValue(value, componentType, normalized) {
  if (!normalized) {
    return value
  }

  switch (componentType) {
    case 5120:
      return Math.max(value / 127, -1)
    case 5121:
      return value / 255
    case 5122:
      return Math.max(value / 32767, -1)
    case 5123:
      return value / 65535
    case 5125:
      return value / 4294967295
    default:
      return value
  }
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

function createPlaneBrushGeometry(entry) {
  const scale = getMatrixWorldScale(entry.worldMatrix)
  const resolution = getNumber(entry.extras, 'aqua_lightmap_resolution', 'aquaLightmapResolution') ||
    DEFAULT_PLANE_LIGHTMAP_RESOLUTION
  const segmentsX = getLightmapSegments(scale.x, resolution)
  const segmentsY = getLightmapSegments(scale.y, resolution)
  const segmentsZ = getLightmapSegments(scale.z, resolution)
  const geometry = new THREE.BoxGeometry(1, 1, 1, segmentsX, segmentsY, segmentsZ)

  geometry.computeVertexNormals()

  return geometry
}

function createRenderableMeshGeometry(geometry, entry) {
  return createSubdividedFlatGeometry({
    geometry,
    userData: entry.extras,
    worldMatrix: entry.worldMatrix,
  }) || geometry
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

function getBakeSurfaceName(entry) {
  const bakeId = getString(entry.extras, 'aqua_bake_id', 'aquaBakeId')

  return bakeId || entry.name
}

function getBakeSurfaceAliases(entry) {
  const aliases = new Set([
    entry.rawName,
    entry.name,
    getString(entry.extras, 'aqua_bake_id', 'aquaBakeId'),
  ])

  return [...aliases].filter(Boolean)
}

function createBakeSurface({ name, aliases, path: nodePath, brushType, extras, geometry, worldMatrix, albedo }) {
  const position = geometry.getAttribute('position')
  let normal = geometry.getAttribute('normal')

  if (!normal) {
    geometry.computeVertexNormals()
    normal = geometry.getAttribute('normal')
  }

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix)
  const worldPositions = []
  const worldNormals = []

  for (let i = 0; i < position.count; i += 1) {
    worldPositions.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(worldMatrix))
    worldNormals.push(new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize())
  }

  return {
    name,
    aliases,
    path: nodePath,
    brushType,
    extras,
    geometry,
    albedo,
    worldPositions,
    worldNormals,
    direct: createVectorArray(position.count),
    indirect: createVectorArray(position.count),
  }
}

function createVectorArray(count) {
  return Array.from({ length: count }, () => new THREE.Vector3())
}

function buildTriangles(surfaces) {
  const triangles = []

  for (const surface of surfaces) {
    const position = surface.geometry.getAttribute('position')
    const index = surface.geometry.index
    const indexCount = index ? index.count : position.count

    for (let i = 0; i < indexCount; i += 3) {
      const ia = index ? index.getX(i) : i
      const ib = index ? index.getX(i + 1) : i + 1
      const ic = index ? index.getX(i + 2) : i + 2
      const a = surface.worldPositions[ia]
      const b = surface.worldPositions[ib]
      const c = surface.worldPositions[ic]
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
      const doubleArea = normal.length()

      if (doubleArea <= 1e-8) {
        continue
      }

      normal.normalize()

      triangles.push({
        surface,
        indices: [ia, ib, ic],
        a,
        b,
        c,
        center: new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3),
        normal,
        area: doubleArea * 0.5,
        emit: new THREE.Vector3(),
      })
    }
  }

  return triangles
}

function collectLights(document, nodes, settings, useDefaultLights) {
  const lights = []

  for (const entry of nodes) {
    const extraLight = createLightFromExtras(entry)

    if (extraLight) {
      lights.push(extraLight)
    }

    const punctualLight = createLightFromPunctualExtension(document, entry)

    if (punctualLight) {
      lights.push(punctualLight)
    }
  }

  if (useDefaultLights) {
    const hasAmbient = lights.some((light) => light.type === 'ambient')
    const hasDirectLight = lights.some((light) => light.type !== 'ambient')

    if (!hasAmbient) {
      lights.push({
        name: 'default_ambient',
        type: 'ambient',
        color: colorFrom(settings.ambientColor),
        intensity: settings.ambientIntensity,
      })
    }

    if (!hasDirectLight) {
      lights.push({
        name: 'default_sun',
        type: 'directional',
        color: colorFrom(settings.sunColor),
        intensity: settings.sunIntensity,
        direction: new THREE.Vector3().fromArray(settings.sunDirection).normalize(),
      })
    }
  }

  return lights
}

function createLightFromExtras(entry) {
  const type = getString(entry.extras, 'aqua_light_type', 'aquaLightType')

  if (!type) {
    return null
  }

  const lightType = type.toLowerCase()
  const color = colorFrom(getValue(entry.extras, 'aqua_light_color', 'aquaLightColor') || '#ffffff')
  const intensity = getNumber(entry.extras, 'aqua_light_intensity', 'aquaLightIntensity') ?? 1
  const position = new THREE.Vector3().setFromMatrixPosition(entry.worldMatrix)

  if (lightType === 'ambient') {
    return {
      name: entry.name,
      type: 'ambient',
      color,
      intensity,
    }
  }

  if (lightType === 'sun' || lightType === 'directional') {
    return {
      name: entry.name,
      type: 'directional',
      color,
      intensity,
      direction: directionFromExtras(entry.extras, entry.worldMatrix),
    }
  }

  if (lightType === 'point') {
    return {
      name: entry.name,
      type: 'point',
      color,
      intensity,
      position,
      range: getNumber(entry.extras, 'aqua_light_range', 'aquaLightRange') || 10,
    }
  }

  if (lightType === 'spot') {
    return {
      name: entry.name,
      type: 'spot',
      color,
      intensity,
      position,
      range: getNumber(entry.extras, 'aqua_light_range', 'aquaLightRange') || 10,
      emissionDirection: new THREE.Vector3(0, 0, -1).transformDirection(entry.worldMatrix).normalize(),
      innerCone: getNumber(entry.extras, 'aqua_light_inner_cone', 'aquaLightInnerCone') ?? Math.PI / 8,
      outerCone: getNumber(entry.extras, 'aqua_light_outer_cone', 'aquaLightOuterCone') ?? Math.PI / 4,
    }
  }

  return null
}

function createLightFromPunctualExtension(document, entry) {
  const extension = entry.node.extensions?.KHR_lights_punctual
  const lightIndex = extension?.light

  if (!Number.isInteger(lightIndex)) {
    return null
  }

  const source = document.json.extensions?.KHR_lights_punctual?.lights?.[lightIndex]

  if (!source) {
    return null
  }

  const color = colorFrom(source.color || [1, 1, 1])
  const intensity = source.intensity ?? 1
  const position = new THREE.Vector3().setFromMatrixPosition(entry.worldMatrix)

  if (source.type === 'directional') {
    return {
      name: source.name || entry.name,
      type: 'directional',
      color,
      intensity,
      direction: new THREE.Vector3(0, 0, 1).transformDirection(entry.worldMatrix).normalize(),
    }
  }

  if (source.type === 'point') {
    return {
      name: source.name || entry.name,
      type: 'point',
      color,
      intensity,
      position,
      range: source.range || 10,
    }
  }

  if (source.type === 'spot') {
    return {
      name: source.name || entry.name,
      type: 'spot',
      color,
      intensity,
      position,
      range: source.range || 10,
      emissionDirection: new THREE.Vector3(0, 0, -1).transformDirection(entry.worldMatrix).normalize(),
      innerCone: source.spot?.innerConeAngle ?? 0,
      outerCone: source.spot?.outerConeAngle ?? Math.PI / 4,
    }
  }

  return null
}

function directionFromExtras(extras, worldMatrix) {
  const direction = getValue(extras, 'aqua_light_direction', 'aquaLightDirection')

  if (Array.isArray(direction) && direction.length >= 3) {
    return new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
  }

  return new THREE.Vector3(0, 0, 1).transformDirection(worldMatrix).normalize()
}

function computeDirectLighting(surfaces, lights, triangles, settings) {
  for (const surface of surfaces) {
    for (let i = 0; i < surface.worldPositions.length; i += 1) {
      surface.direct[i].copy(sampleDirectLighting({
        position: surface.worldPositions[i],
        normal: surface.worldNormals[i],
        surface,
        lights,
        triangles,
        settings,
      }))
    }
  }
}

function sampleDirectLighting({ position, normal, surface, lights, triangles, settings }) {
  const result = new THREE.Vector3()
  const origin = offsetSample(position, normal, settings.normalBias)

  for (const light of lights) {
    if (light.type === 'ambient') {
      result.addScaledVector(light.color, light.intensity)
      continue
    }

    if (light.type === 'directional') {
      const ndl = Math.max(normal.dot(light.direction), 0)

      if (ndl <= 0) {
        continue
      }

      if (isOccluded(origin, light.direction, settings.shadowDistance, triangles, surface, settings)) {
        continue
      }

      result.addScaledVector(light.color, light.intensity * ndl)
      continue
    }

    const toLight = new THREE.Vector3().subVectors(light.position, origin)
    const distance = toLight.length()

    if (distance <= 1e-5 || distance > light.range) {
      continue
    }

    const direction = toLight.multiplyScalar(1 / distance)
    const ndl = Math.max(normal.dot(direction), 0)

    if (ndl <= 0) {
      continue
    }

    if (light.type === 'spot') {
      const lightToSample = direction.clone().multiplyScalar(-1)
      const cone = light.emissionDirection.dot(lightToSample)
      const inner = Math.cos(light.innerCone)
      const outer = Math.cos(light.outerCone)
      const spotScale = THREE.MathUtils.smoothstep(cone, outer, inner)

      if (spotScale <= 0) {
        continue
      }

      const attenuation = smoothDistanceAttenuation(distance, light.range) * spotScale

      if (!isOccluded(origin, direction, distance - settings.normalBias, triangles, surface, settings)) {
        result.addScaledVector(light.color, light.intensity * ndl * attenuation)
      }

      continue
    }

    const attenuation = smoothDistanceAttenuation(distance, light.range)

    if (!isOccluded(origin, direction, distance - settings.normalBias, triangles, surface, settings)) {
      result.addScaledVector(light.color, light.intensity * ndl * attenuation)
    }
  }

  return result
}

function smoothDistanceAttenuation(distance, range) {
  const falloff = Math.max(1 - distance / Math.max(range, 1e-5), 0)
  return falloff * falloff
}

function computeBounceLighting(surfaces, triangles, settings) {
  if (settings.bounces <= 0 || settings.bounceStrength <= 0) {
    return
  }

  seedPatchEmission(triangles, 'direct', settings)

  for (let bounce = 0; bounce < settings.bounces; bounce += 1) {
    const received = new Map()

    for (const surface of surfaces) {
      received.set(surface, createVectorArray(surface.worldPositions.length))
    }

    for (const surface of surfaces) {
      const surfaceReceived = received.get(surface)

      for (let i = 0; i < surface.worldPositions.length; i += 1) {
        const bounced = gatherPatchLighting({
          position: surface.worldPositions[i],
          normal: surface.worldNormals[i],
          surface,
          triangles,
          settings,
        })

        surfaceReceived[i].copy(bounced)
        surface.indirect[i].add(bounced)
      }
    }

    seedPatchEmission(triangles, received, settings)
  }
}

function seedPatchEmission(triangles, source, settings) {
  for (const triangle of triangles) {
    const values = source === 'direct'
      ? triangle.indices.map((index) => triangle.surface.direct[index])
      : triangle.indices.map((index) => source.get(triangle.surface)[index])
    const average = new THREE.Vector3()

    for (const value of values) {
      average.add(value)
    }

    average.multiplyScalar(1 / values.length)
    average.multiply(triangle.surface.albedo)
    average.multiplyScalar(settings.bounceStrength)
    triangle.emit.copy(average)
  }
}

function gatherPatchLighting({ position, normal, surface, triangles, settings }) {
  const result = new THREE.Vector3()
  const origin = offsetSample(position, normal, settings.normalBias)
  const maxDistanceSq = settings.patchDistance * settings.patchDistance

  for (const patch of triangles) {
    if (patch.emit.lengthSq() <= 1e-8) {
      continue
    }

    const toPatch = new THREE.Vector3().subVectors(patch.center, origin)
    const distanceSq = toPatch.lengthSq()

    if (distanceSq <= settings.normalBias * settings.normalBias || distanceSq > maxDistanceSq) {
      continue
    }

    const distance = Math.sqrt(distanceSq)
    const direction = toPatch.multiplyScalar(1 / distance)
    const receiverTerm = Math.max(normal.dot(direction), 0)

    if (receiverTerm <= 0) {
      continue
    }

    const emitterTerm = Math.max(patch.normal.dot(direction.clone().multiplyScalar(-1)), 0)

    if (emitterTerm <= 0) {
      continue
    }

    if (isOccluded(origin, direction, distance - settings.normalBias, triangles, surface, settings)) {
      continue
    }

    const formFactor = receiverTerm * emitterTerm * patch.area / (Math.PI * distanceSq)
    result.addScaledVector(patch.emit, formFactor)
  }

  return result
}

function isOccluded(origin, direction, maxDistance, triangles, sourceSurface, settings) {
  if (maxDistance <= settings.normalBias) {
    return false
  }

  for (const triangle of triangles) {
    const hit = intersectRayTriangle(origin, direction, triangle)

    if (!Number.isFinite(hit)) {
      continue
    }

    if (triangle.surface === sourceSurface && hit < settings.normalBias * 3) {
      continue
    }

    if (hit > settings.normalBias && hit < maxDistance) {
      return true
    }
  }

  return false
}

function intersectRayTriangle(origin, direction, triangle) {
  const edge1 = new THREE.Vector3().subVectors(triangle.b, triangle.a)
  const edge2 = new THREE.Vector3().subVectors(triangle.c, triangle.a)
  const pvec = new THREE.Vector3().crossVectors(direction, edge2)
  const det = edge1.dot(pvec)

  if (Math.abs(det) < 1e-8) {
    return Number.NaN
  }

  const invDet = 1 / det
  const tvec = new THREE.Vector3().subVectors(origin, triangle.a)
  const u = tvec.dot(pvec) * invDet

  if (u < 0 || u > 1) {
    return Number.NaN
  }

  const qvec = new THREE.Vector3().crossVectors(tvec, edge1)
  const v = direction.dot(qvec) * invDet

  if (v < 0 || u + v > 1) {
    return Number.NaN
  }

  const distance = edge2.dot(qvec) * invDet

  return distance > 0 ? distance : Number.NaN
}

function createLightingOutput({ inputPath, outputPath, settings, lights, surfaces, triangles }) {
  const meshes = {}

  for (const surface of surfaces) {
    const position = surface.geometry.getAttribute('position')
    const colors = []
    const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
    const average = new THREE.Vector3()

    for (let i = 0; i < position.count; i += 1) {
      const color = new THREE.Vector3()
        .addVectors(surface.direct[i], surface.indirect[i])
        .multiplyScalar(settings.exposure)

      color.x = clampLight(color.x, settings)
      color.y = clampLight(color.y, settings)
      color.z = clampLight(color.z, settings)

      min.min(color)
      max.max(color)
      average.add(color)
      colors.push(round(color.x), round(color.y), round(color.z))
    }

    average.multiplyScalar(1 / position.count)

    meshes[surface.name] = {
      vertexCount: position.count,
      aliases: surface.aliases.filter((alias) => alias !== surface.name),
      colors,
      average: vectorToRoundedArray(average),
      min: vectorToRoundedArray(min),
      max: vectorToRoundedArray(max),
    }
  }

  return {
    schema: 'aqua.baked_lighting.v1',
    source: toPortablePath(path.relative(path.dirname(outputPath), inputPath)),
    generatedAt: new Date().toISOString(),
    settings: serializeSettings(settings),
    stats: {
      surfaces: surfaces.length,
      triangles: triangles.length,
      lights: lights.length,
    },
    lights: lights.map(serializeLight),
    meshes,
  }
}

function clampLight(value, settings) {
  return Math.min(Math.max(value, settings.minLight), settings.maxLight)
}

function serializeSettings(settings) {
  return {
    ambientIntensity: settings.ambientIntensity,
    sunIntensity: settings.sunIntensity,
    bounces: settings.bounces,
    bounceStrength: settings.bounceStrength,
    exposure: settings.exposure,
    minLight: settings.minLight,
    maxLight: settings.maxLight,
    normalBias: settings.normalBias,
    shadowDistance: settings.shadowDistance,
    patchDistance: settings.patchDistance,
  }
}

function serializeLight(light) {
  const serialized = {
    name: light.name,
    type: light.type,
    color: vectorToRoundedArray(light.color),
    intensity: light.intensity,
  }

  if (light.position) {
    serialized.position = vectorToRoundedArray(light.position)
  }

  if (light.direction) {
    serialized.direction = vectorToRoundedArray(light.direction)
  }

  if (light.range) {
    serialized.range = light.range
  }

  return serialized
}

function getSurfaceAlbedo(document, node, extras) {
  const color = getValue(extras, 'aqua_color', 'aquaColor')

  if (color) {
    return colorFrom(color)
  }

  const primitive = Number.isInteger(node.mesh)
    ? document.json.meshes?.[node.mesh]?.primitives?.[0]
    : null
  const material = Number.isInteger(primitive?.material)
    ? document.json.materials?.[primitive.material]
    : null
  const factor = material?.pbrMetallicRoughness?.baseColorFactor

  if (Array.isArray(factor) && factor.length >= 3) {
    return colorFrom(factor)
  }

  return new THREE.Vector3(0.78, 0.78, 0.78)
}

function colorFrom(value) {
  if (value?.isVector3) {
    return value.clone()
  }

  if (Array.isArray(value)) {
    return new THREE.Vector3(value[0] ?? 1, value[1] ?? 1, value[2] ?? 1)
  }

  if (typeof value === 'string') {
    const color = new THREE.Color(value)
    return new THREE.Vector3(color.r, color.g, color.b)
  }

  return new THREE.Vector3(1, 1, 1)
}

function offsetSample(position, normal, bias) {
  return position.clone().addScaledVector(normal, bias)
}

function getString(userData, ...keys) {
  for (const key of keys) {
    if (typeof userData?.[key] === 'string') {
      return userData[key]
    }
  }

  return null
}

function sanitizeRuntimeName(name) {
  return String(name).replace(/\s/g, '_').replace(/[\[\]\.:/]/g, '')
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

function getValue(userData, ...keys) {
  for (const key of keys) {
    if (userData?.[key] !== undefined) {
      return userData[key]
    }
  }

  return null
}

function round(value) {
  return Number(value.toFixed(5))
}

function vectorToRoundedArray(vector) {
  return [round(vector.x), round(vector.y), round(vector.z)]
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join('/')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
