#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
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
  ambientColor: '#fcf6e7',
  ambientIntensity: 1.22,
  sunColor: '#fff2d0',
  sunIntensity: 1.15,
  sunDirection: [-0.55, 0.82, 0.35],
  authoredLightScale: 0.01,
  bounces: 1,
  bounceStrength: 0.42,
  exposure: 1,
  minLight: 0.035,
  maxLight: 2.4,
  normalBias: 0.025,
  shadowDistance: 96,
  patchDistance: 18,
  lightmapTexelSize: 0.5,
  lightmapMaxSize: 1024,
  lightmapPadding: 2,
  lightmapBleed: 4,
}

const DEFAULT_PLANE_LIGHTMAP_RESOLUTION = 1
const MAX_PLANE_LIGHTMAP_SEGMENTS = 48
const LIGHTMAP_SCHEMA = 'aqua.lightmap.v2'

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
  const shadowSurfaces = await collectPropShadowSurfaces(document, nodes, inputPath)
  const lights = collectLights(document, nodes, settings, cli.useDefaultLights)

  if (surfaces.length === 0) {
    throw new Error(`No Aqua brush surfaces found in ${inputPath}`)
  }

  const triangles = buildTriangles([...surfaces, ...shadowSurfaces])
  computeDirectLighting(surfaces, lights, triangles, settings)
  computeBounceLighting(surfaces, triangles, settings)

  const output = await createLightingOutput({
    inputPath,
    outputPath,
    settings,
    lights,
    surfaces,
    triangles,
  })

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  console.log(`Baked ${surfaces.length} surface(s), ${shadowSurfaces.length} prop shadow caster(s), ${triangles.length} patch triangle(s), ${lights.length} light(s).`)
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
    } else if (arg === '--light-scale' || arg === '--authored-light-scale') {
      settings.authoredLightScale = readNumber(next(), arg)
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
    } else if (arg === '--texel-size' || arg === '--lightmap-texel-size') {
      settings.lightmapTexelSize = readNumber(next(), arg)
    } else if (arg === '--lightmap-size' || arg === '--max-lightmap-size') {
      settings.lightmapMaxSize = readInteger(next(), arg)
    } else if (arg === '--lightmap-padding') {
      settings.lightmapPadding = readInteger(next(), arg)
    } else if (arg === '--lightmap-bleed') {
      settings.lightmapBleed = readInteger(next(), arg)
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
  --light-scale <value>      Multiplier for authored non-ambient light intensities. Default: ${DEFAULT_SETTINGS.authoredLightScale}
  --exposure <value>         Final light multiplier. Default: ${DEFAULT_SETTINGS.exposure}
  --min-light <value>        Minimum final light value. Default: ${DEFAULT_SETTINGS.minLight}
  --max-light <value>        Clamp final light value. Default: ${DEFAULT_SETTINGS.maxLight}
  --patch-distance <value>   Max distance for bounce patches. Default: ${DEFAULT_SETTINGS.patchDistance}
  --shadow-distance <value>  Max directional shadow ray distance. Default: ${DEFAULT_SETTINGS.shadowDistance}
  --texel-size <value>       World units per lightmap texel. Default: ${DEFAULT_SETTINGS.lightmapTexelSize}
  --lightmap-size <pixels>   Max generated lightmap texture size. Default: ${DEFAULT_SETTINGS.lightmapMaxSize}
  --lightmap-padding <px>    Empty pixels around packed charts. Default: ${DEFAULT_SETTINGS.lightmapPadding}
  --lightmap-bleed <px>      Dilation passes for chart edge padding. Default: ${DEFAULT_SETTINGS.lightmapBleed}
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

function readInteger(value, option) {
  const number = Math.floor(Number(value))

  if (!Number.isFinite(number)) {
    throw new Error(`${option} expects an integer`)
  }

  return number
}

function defaultOutputPath(inputPath) {
  const extension = path.extname(inputPath)
  return `${inputPath.slice(0, inputPath.length - extension.length)}.light.json`
}

function resolveExternalPath(assetPath, basePath) {
  if (assetPath.startsWith('file://')) {
    return fileURLToPath(assetPath)
  }

  if (assetPath.startsWith('/')) {
    return path.resolve(__dirname, '..', '..', 'public', decodeURIComponent(assetPath.slice(1)))
  }

  if (path.isAbsolute(assetPath)) {
    return assetPath
  }

  return path.resolve(path.dirname(basePath), decodeURIComponent(assetPath))
}

function resolvePropAssetPath(propAsset, propName, basePath) {
  if (propName && isGenericPropLibraryAsset(propAsset)) {
    return resolveExternalPath(`/assets/props/${cleanAssetName(propName)}.aqua_prop.json`, basePath)
  }

  return resolveExternalPath(propAsset, basePath)
}

function isGenericPropLibraryAsset(propAsset) {
  return /(?:^|[/\\])Aqua-Engine_Props\.aqua_prop\.json$/i.test(String(propAsset || ''))
}

function cleanAssetName(name) {
  return String(name || 'aqua_prop')
    .trim()
    .replace(/_aqua_prop_ref$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'aqua_prop'
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

    const geometry = createBakeGeometry(createRuntimeGeometry(document, entry, brushType))

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

function createBakeGeometry(geometry) {
  if (!geometry) {
    return null
  }

  const bakeGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone()

  if (!bakeGeometry.getAttribute('normal')) {
    bakeGeometry.computeVertexNormals()
  }

  return bakeGeometry
}

async function collectPropShadowSurfaces(document, nodes, inputPath) {
  const surfaces = []

  for (const entry of nodes) {
    const propAsset = getString(
      entry.extras,
      'aqua_prop_asset',
      'aquaPropAsset',
      'aqua_asset',
      'aquaAsset'
    )

    if (!propAsset) {
      continue
    }

    const propName = getPropName(entry)
    const metadataPath = resolvePropAssetPath(propAsset, propName, inputPath)
    let metadata = null

    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
    } catch (error) {
      console.warn(`Skipping prop shadow caster "${entry.rawName}": failed to read ${metadataPath}. ${error.message}`)
      continue
    }

    if (metadata?.lighting?.castsShadows === false || metadata?.castsShadows === false) {
      continue
    }

    if (!metadata?.model) {
      console.warn(`Skipping prop shadow caster "${entry.rawName}": ${metadataPath} has no model path.`)
      continue
    }

    const modelPath = resolveExternalPath(metadata.model, metadataPath)

    try {
      const propDocument = await loadGltfDocument(modelPath)
      const propNodes = collectNodes(propDocument)
      const pivot = getPropPivot(metadata)
      const pivotMatrix = pivot
        ? new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
        : new THREE.Matrix4()

      for (const propEntry of propNodes) {
        if (!Number.isInteger(propEntry.node.mesh)) {
          continue
        }

        if (isCollisionHelperEntry(propEntry)) {
          continue
        }

        const geometry = createGeometryFromMesh(propDocument, propEntry.node.mesh)

        if (!geometry?.getAttribute('position')) {
          continue
        }

        surfaces.push(createBakeSurface({
          name: `${entry.name}_${propEntry.name}_shadow`,
          aliases: [],
          path: `${entry.path}/${propEntry.path}`,
          brushType: 'prop_shadow',
          extras: propEntry.extras,
          geometry,
          worldMatrix: entry.worldMatrix.clone().multiply(pivotMatrix).multiply(propEntry.worldMatrix),
          albedo: getSurfaceAlbedo(propDocument, propEntry.node, propEntry.extras),
        }))
      }
    } catch (error) {
      console.warn(`Skipping prop shadow caster "${entry.rawName}": failed to read ${modelPath}. ${error.message}`)
    }
  }

  return surfaces
}

function getPropName(entry) {
  return getString(entry.extras, 'aqua_prop_name', 'aquaPropName') ||
    cleanAssetName(entry.rawName || entry.name)
}

function getPropPivot(metadata) {
  const pivot = vectorFromArray(metadata?.pivot?.engine)

  if (pivot && !isZeroVector(pivot)) {
    return pivot
  }

  const renderSource = metadata?.sourceObjects?.find((source) =>
    source?.type === 'MESH' && !String(source.name || '').startsWith('brush_')
  )

  return vectorFromArray(renderSource?.location?.engine)
}

function vectorFromArray(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return null
  }

  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }

  return new THREE.Vector3(x, y, z)
}

function isZeroVector(vector) {
  return Math.abs(vector.x) < 0.000001 &&
    Math.abs(vector.y) < 0.000001 &&
    Math.abs(vector.z) < 0.000001
}

function isCollisionHelperEntry(entry) {
  const brushType = getString(entry.extras, 'aqua_brush_type', 'aquaBrushType')
  const collisionKind = getCollisionKind(entry.extras)

  if (!collisionKind) {
    return false
  }

  return brushType === 'box' ||
    brushType === 'plane' ||
    brushType === 'ramp' ||
    collisionKind === 'brush' ||
    collisionKind === 'slope' ||
    collisionKind === 'convex'
}

function getCollisionKind(userData) {
  const kind = getString(userData, 'collisionKind', 'aqua_collision_kind', 'aquaCollisionKind')

  if (!kind || kind === 'none') {
    return null
  }

  if (kind === 'terrain_mesh') {
    return 'triangle'
  }

  return kind
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
    const extrasType = getString(entry.extras, 'aqua_light_type', 'aquaLightType')?.toLowerCase()

    if (extrasType === 'ambient') {
      const extraLight = createLightFromExtras(entry)

      if (extraLight) {
        lights.push(extraLight)
      }

      continue
    }

    const punctualLight = createLightFromPunctualExtension(document, entry)

    if (punctualLight) {
      scaleAuthoredLight(punctualLight, settings)
      lights.push(punctualLight)
      continue
    }

    const extraLight = createLightFromExtras(entry)

    if (extraLight) {
      scaleAuthoredLight(extraLight, settings)
      lights.push(extraLight)
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

function scaleAuthoredLight(light, settings) {
  if (!light || light.type === 'ambient') {
    return light
  }

  light.intensity *= settings.authoredLightScale ?? 1

  return light
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
    const sourceValues = source === 'direct' ? triangle.surface.direct : source.get(triangle.surface)

    if (!sourceValues) {
      triangle.emit.set(0, 0, 0)
      continue
    }

    const values = triangle.indices.map((index) => sourceValues[index])
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

async function createLightingOutput({ inputPath, outputPath, settings, lights, surfaces, triangles }) {
  const outputDir = path.dirname(outputPath)
  const lightmapDirName = getLightmapDirectoryName(outputPath)
  const lightmapDir = path.join(outputDir, lightmapDirName)
  const outputSurfaces = {}
  let texelCount = 0

  await fs.mkdir(lightmapDir, { recursive: true })

  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    const surface = surfaces[surfaceIndex]
    const lightmap = createSurfaceLightmap({
      surface,
      lights,
      triangles,
      settings,
    })
    const fileName = `${String(surfaceIndex).padStart(3, '0')}_${sanitizeFileName(surface.name)}.png`
    const relativeImagePath = toPortablePath(path.join(lightmapDirName, fileName))

    await fs.writeFile(path.join(lightmapDir, fileName), encodePngRgba(lightmap.width, lightmap.height, lightmap.data))
    texelCount += lightmap.width * lightmap.height

    outputSurfaces[surface.name] = {
      vertexCount: surface.geometry.getAttribute('position').count,
      aliases: surface.aliases.filter((alias) => alias !== surface.name),
      average: vectorToRoundedArray(lightmap.average),
      min: vectorToRoundedArray(lightmap.min),
      max: vectorToRoundedArray(lightmap.max),
      lightmap: {
        image: relativeImagePath,
        width: lightmap.width,
        height: lightmap.height,
        texelSize: round(lightmap.texelSize),
        intensity: round(lightmap.intensity),
        uv2: Array.from(lightmap.uv2, round),
      },
    }
  }

  return {
    schema: LIGHTMAP_SCHEMA,
    source: toPortablePath(path.relative(outputDir, inputPath)),
    generatedAt: new Date().toISOString(),
    settings: serializeSettings(settings),
    stats: {
      surfaces: surfaces.length,
      triangles: triangles.length,
      lights: lights.length,
      lightmapImages: surfaces.length,
      lightmapTexels: texelCount,
    },
    lights: lights.map(serializeLight),
    surfaces: outputSurfaces,
  }
}

function getLightmapDirectoryName(outputPath) {
  const fileName = path.basename(outputPath)
  const baseName = fileName.replace(/\.light\.json$/i, '').replace(/\.json$/i, '')

  return `${baseName}.lightmaps`
}

function createSurfaceLightmap({ surface, lights, triangles, settings }) {
  const maxSize = Math.max(16, nextPowerOfTwo(settings.lightmapMaxSize || DEFAULT_SETTINGS.lightmapMaxSize))
  const padding = Math.max(0, Math.floor(settings.lightmapPadding ?? DEFAULT_SETTINGS.lightmapPadding))
  const bleed = Math.max(0, Math.floor(settings.lightmapBleed ?? DEFAULT_SETTINGS.lightmapBleed))
  let texelSize = getSurfaceLightmapTexelSize(surface, settings)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const charts = createLightmapCharts(surface, texelSize, padding, maxSize)
    const packed = packLightmapCharts(charts, maxSize)

    if (packed) {
      return renderSurfaceLightmap({
        surface,
        lights,
        triangles,
        settings,
        charts,
        width: packed.width,
        height: packed.height,
        texelSize,
        padding,
        bleed,
      })
    }

    texelSize *= 1.5
  }

  throw new Error(`Failed to pack lightmap charts for "${surface.name}" within ${maxSize}px.`)
}

function getSurfaceLightmapTexelSize(surface, settings) {
  const value = getNumber(
    surface.extras,
    'aqua_lightmap_texel_size',
    'aquaLightmapTexelSize',
    'aqua_lightmap_resolution',
    'aquaLightmapResolution'
  )

  return Math.max(value || settings.lightmapTexelSize || DEFAULT_SETTINGS.lightmapTexelSize, 0.01)
}

function createLightmapCharts(surface, texelSize, padding, maxSize) {
  const charts = []
  const position = surface.geometry.getAttribute('position')
  const innerMaxSize = Math.max(1, maxSize - padding * 2)

  for (let triangleOffset = 0; triangleOffset < position.count; triangleOffset += 3) {
    const a = surface.worldPositions[triangleOffset]
    const b = surface.worldPositions[triangleOffset + 1]
    const c = surface.worldPositions[triangleOffset + 2]
    const edgeA = new THREE.Vector3().subVectors(b, a)
    const edgeB = new THREE.Vector3().subVectors(c, a)

    if (edgeA.lengthSq() <= 1e-10 || edgeB.lengthSq() <= 1e-10) {
      continue
    }

    const normal = new THREE.Vector3().crossVectors(edgeA, edgeB)

    if (normal.lengthSq() <= 1e-10) {
      continue
    }

    normal.normalize()

    const uAxis = edgeA.clone().normalize()
    const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize()
    const p0 = { x: 0, y: 0 }
    const p1 = { x: edgeA.length(), y: 0 }
    const p2 = { x: edgeB.dot(uAxis), y: edgeB.dot(vAxis) }
    const minX = Math.min(p0.x, p1.x, p2.x)
    const maxX = Math.max(p0.x, p1.x, p2.x)
    const minY = Math.min(p0.y, p1.y, p2.y)
    const maxY = Math.max(p0.y, p1.y, p2.y)
    const worldWidth = Math.max(maxX - minX, texelSize)
    const worldHeight = Math.max(maxY - minY, texelSize)
    const innerWidth = Math.min(Math.max(Math.ceil(worldWidth / texelSize), 1), innerMaxSize)
    const innerHeight = Math.min(Math.max(Math.ceil(worldHeight / texelSize), 1), innerMaxSize)

    charts.push({
      triangleOffset,
      points: [p0, p1, p2],
      minX,
      minY,
      worldWidth,
      worldHeight,
      innerWidth,
      innerHeight,
      width: innerWidth + padding * 2,
      height: innerHeight + padding * 2,
      x: 0,
      y: 0,
    })
  }

  return charts
}

function packLightmapCharts(charts, maxSize) {
  const sorted = [...charts].sort((a, b) => b.height - a.height)
  let x = 0
  let y = 0
  let shelfHeight = 0
  let usedWidth = 0
  let usedHeight = 0

  for (const chart of sorted) {
    if (chart.width > maxSize || chart.height > maxSize) {
      return null
    }

    if (x + chart.width > maxSize) {
      x = 0
      y += shelfHeight
      shelfHeight = 0
    }

    if (y + chart.height > maxSize) {
      return null
    }

    chart.x = x
    chart.y = y
    x += chart.width
    shelfHeight = Math.max(shelfHeight, chart.height)
    usedWidth = Math.max(usedWidth, chart.x + chart.width)
    usedHeight = Math.max(usedHeight, chart.y + chart.height)
  }

  return {
    width: Math.max(1, nextPowerOfTwo(usedWidth)),
    height: Math.max(1, nextPowerOfTwo(usedHeight)),
  }
}

function renderSurfaceLightmap({ surface, lights, triangles, settings, charts, width, height, texelSize, padding, bleed }) {
  const data = new Uint8Array(width * height * 4)
  const mask = new Uint8Array(width * height)
  const uv2 = new Float32Array(surface.geometry.getAttribute('position').count * 2)
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  const average = new THREE.Vector3()
  const intensity = Math.max(settings.maxLight || 1, 1)
  let sampleCount = 0

  for (const chart of charts) {
    writeChartUvs(chart, uv2, width, height, padding)

    const xStart = chart.x + padding
    const yStart = chart.y + padding
    const xEnd = xStart + chart.innerWidth
    const yEnd = yStart + chart.innerHeight

    for (let y = yStart; y < yEnd; y += 1) {
      for (let x = xStart; x < xEnd; x += 1) {
        const localX = chart.minX + ((x - xStart + 0.5) / chart.innerWidth) * chart.worldWidth
        const localY = chart.minY + ((y - yStart + 0.5) / chart.innerHeight) * chart.worldHeight
        const bary = getBarycentric2D(localX, localY, chart.points[0], chart.points[1], chart.points[2])

        if (!bary || bary.a < -0.002 || bary.b < -0.002 || bary.c < -0.002) {
          continue
        }

        const color = sampleLightmapTexel({
          surface,
          triangleOffset: chart.triangleOffset,
          bary,
          lights,
          triangles,
          settings,
        })

        writeEncodedPixel(data, mask, width, x, y, color, intensity)
        min.min(color)
        max.max(color)
        average.add(color)
        sampleCount += 1
      }
    }
  }

  if (sampleCount === 0) {
    min.set(settings.minLight, settings.minLight, settings.minLight)
    max.copy(min)
    average.copy(min)
  } else {
    average.multiplyScalar(1 / sampleCount)
  }

  dilateLightmap(data, mask, width, height, bleed)
  fillUnwrittenPixels(data, mask, width, height, average, intensity)

  return {
    data,
    uv2,
    width,
    height,
    texelSize,
    intensity,
    min,
    max,
    average,
  }
}

function writeChartUvs(chart, uv2, width, height, padding) {
  const xStart = chart.x + padding
  const yStart = chart.y + padding

  for (let vertex = 0; vertex < 3; vertex += 1) {
    const point = chart.points[vertex]
    const pixelX = xStart + ((point.x - chart.minX) / chart.worldWidth) * chart.innerWidth
    const pixelY = yStart + ((point.y - chart.minY) / chart.worldHeight) * chart.innerHeight
    const index = chart.triangleOffset + vertex

    uv2[index * 2] = pixelX / width
    uv2[index * 2 + 1] = pixelY / height
  }
}

function getBarycentric2D(x, y, a, b, c) {
  const v0x = b.x - a.x
  const v0y = b.y - a.y
  const v1x = c.x - a.x
  const v1y = c.y - a.y
  const v2x = x - a.x
  const v2y = y - a.y
  const den = v0x * v1y - v1x * v0y

  if (Math.abs(den) <= 1e-8) {
    return null
  }

  const bWeight = (v2x * v1y - v1x * v2y) / den
  const cWeight = (v0x * v2y - v2x * v0y) / den

  return {
    a: 1 - bWeight - cWeight,
    b: bWeight,
    c: cWeight,
  }
}

function sampleLightmapTexel({ surface, triangleOffset, bary, lights, triangles, settings }) {
  const a = surface.worldPositions[triangleOffset]
  const b = surface.worldPositions[triangleOffset + 1]
  const c = surface.worldPositions[triangleOffset + 2]
  const normalA = surface.worldNormals[triangleOffset]
  const normalB = surface.worldNormals[triangleOffset + 1]
  const normalC = surface.worldNormals[triangleOffset + 2]
  const position = new THREE.Vector3()
    .addScaledVector(a, bary.a)
    .addScaledVector(b, bary.b)
    .addScaledVector(c, bary.c)
  const normal = new THREE.Vector3()
    .addScaledVector(normalA, bary.a)
    .addScaledVector(normalB, bary.b)
    .addScaledVector(normalC, bary.c)
    .normalize()
  const color = sampleDirectLighting({
    position,
    normal,
    surface,
    lights,
    triangles,
    settings,
  })

  color.addScaledVector(surface.indirect[triangleOffset], bary.a)
  color.addScaledVector(surface.indirect[triangleOffset + 1], bary.b)
  color.addScaledVector(surface.indirect[triangleOffset + 2], bary.c)
  color.multiplyScalar(settings.exposure)
  color.x = clampLight(color.x, settings)
  color.y = clampLight(color.y, settings)
  color.z = clampLight(color.z, settings)

  return color
}

function writeEncodedPixel(data, mask, width, x, y, color, intensity) {
  const pixel = y * width + x
  const offset = pixel * 4

  data[offset] = encodeLightChannel(color.x, intensity)
  data[offset + 1] = encodeLightChannel(color.y, intensity)
  data[offset + 2] = encodeLightChannel(color.z, intensity)
  data[offset + 3] = 255
  mask[pixel] = 1
}

function encodeLightChannel(value, intensity) {
  return Math.round(THREE.MathUtils.clamp(value / intensity, 0, 1) * 255)
}

function dilateLightmap(data, mask, width, height, passes) {
  for (let pass = 0; pass < passes; pass += 1) {
    const nextData = new Uint8Array(data)
    const nextMask = new Uint8Array(mask)
    let changed = false

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x

        if (mask[pixel]) {
          continue
        }

        const neighbor = findWrittenNeighbor(mask, width, height, x, y)

        if (neighbor === -1) {
          continue
        }

        const targetOffset = pixel * 4
        const sourceOffset = neighbor * 4

        nextData[targetOffset] = data[sourceOffset]
        nextData[targetOffset + 1] = data[sourceOffset + 1]
        nextData[targetOffset + 2] = data[sourceOffset + 2]
        nextData[targetOffset + 3] = 255
        nextMask[pixel] = 1
        changed = true
      }
    }

    data.set(nextData)
    mask.set(nextMask)

    if (!changed) {
      return
    }
  }
}

function findWrittenNeighbor(mask, width, height, x, y) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const nextY = y + offsetY

    if (nextY < 0 || nextY >= height) {
      continue
    }

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue
      }

      const nextX = x + offsetX

      if (nextX < 0 || nextX >= width) {
        continue
      }

      const pixel = nextY * width + nextX

      if (mask[pixel]) {
        return pixel
      }
    }
  }

  return -1
}

function fillUnwrittenPixels(data, mask, width, height, color, intensity) {
  const r = encodeLightChannel(color.x, intensity)
  const g = encodeLightChannel(color.y, intensity)
  const b = encodeLightChannel(color.z, intensity)

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel]) {
      continue
    }

    const offset = pixel * 4

    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = 255
  }
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)))
}

function sanitizeFileName(name) {
  return String(name || 'surface')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface'
}

function clampLight(value, settings) {
  return Math.min(Math.max(value, settings.minLight), settings.maxLight)
}

function serializeSettings(settings) {
  return {
    ambientIntensity: settings.ambientIntensity,
    sunIntensity: settings.sunIntensity,
    authoredLightScale: settings.authoredLightScale,
    bounces: settings.bounces,
    bounceStrength: settings.bounceStrength,
    exposure: settings.exposure,
    minLight: settings.minLight,
    maxLight: settings.maxLight,
    normalBias: settings.normalBias,
    shadowDistance: settings.shadowDistance,
    patchDistance: settings.patchDistance,
    lightmapTexelSize: settings.lightmapTexelSize,
    lightmapMaxSize: settings.lightmapMaxSize,
    lightmapPadding: settings.lightmapPadding,
    lightmapBleed: settings.lightmapBleed,
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

function encodePngRgba(width, height, rgba) {
  const rowLength = width * 4
  const raw = Buffer.alloc((rowLength + 1) * height)

  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowLength + 1)
    const sourceOffset = y * rowLength

    raw[rawOffset] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + sourceOffset, rowLength).copy(raw, rawOffset + 1)
  }

  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk('IHDR', header),
    createPngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    createPngChunk('IEND', Buffer.alloc(0)),
  ])
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)

  length.writeUInt32BE(data.length, 0)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let i = 0; i < 256; i += 1) {
    let value = i

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    table[i] = value >>> 0
  }

  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff

  for (const value of buffer) {
    crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
