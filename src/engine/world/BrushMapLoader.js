import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { ResourceOwner, disposeObject3DResources } from '../assets/ResourceOwner.js'
import { EngineConsole } from '../config/EngineConsole.js'
import {
  createCollisionDebugMesh,
  createCollisionMesh,
  createTriggerDebugMesh,
  createTriggerVolumeMesh,
} from '../render/DebugRenderMeshes.js'
import { applyBakedLighting, getBakedLightingEntries } from '../render/LightmapApplier.js'
import { createBrushMesh } from '../render/MapGeometryBuilder.js'

export const DEFAULT_MAP_URL = '/assets/maps/demo_map/demo.glb'
export const DEFAULT_LIGHTING_MODE = 'sidecar'

const fallbackPlayerStart = new THREE.Vector3(0, 0.1, 4)

export async function loadBrushMap({
  url = DEFAULT_MAP_URL,
  materials,
  propAssetLoader = null,
  lightingUrl = inferLightingUrl(url),
  fetchJson = (...args) => fetch(...args),
  lightingMode = DEFAULT_LIGHTING_MODE,
  runtimeBakeSettings = {},
  propBaseUrl = '/assets/props',
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
  EngineConsole.info('Map GLTF loaded', {
    url,
    lightingUrl,
    lightingMode: normalizedLightingMode,
    sidecarLighting: Boolean(sidecarLighting),
  })
  const resources = new ResourceOwner(`map:${url}`)
  const renderGroup = resources.trackObject(new THREE.Group())
  const collisionGroup = resources.trackObject(new THREE.Group())
  const collisionDebugGroup = resources.trackObject(new THREE.Group())
  const triggerGroup = resources.trackObject(new THREE.Group())
  const triggerDebugGroup = resources.trackObject(new THREE.Group())
  const propRefs = []
  const audioRefs = []
  const bakeTargets = []
  const shadowTargets = []
  const playerStart = fallbackPlayerStart.clone()
  let propRenderGroup = null
  let skybox = findSkyboxRefFromGltf(gltf)
  let bakedLighting = sidecarLighting

  resources.trackDisposable({
    dispose: () => disposeObject3DResources(gltf.scene),
  })
  renderGroup.name = 'BrushMapRender'
  collisionGroup.name = 'BrushMapCollision'
  collisionDebugGroup.name = 'BrushMapCollisionDebug'
  triggerGroup.name = 'BrushMapTriggers'
  triggerDebugGroup.name = 'BrushMapTriggerDebug'
  gltf.scene.updateMatrixWorld(true)
  if (skybox) {
    EngineConsole.info('Map skybox metadata found', { skybox })
  }

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

    if (isSkyboxMarker(source)) {
      skybox = createSkyboxRef(source) || skybox
      return
    }

    if (isPositionalAudioSource(source)) {
      const audioRef = createAudioRef(source, url)

      if (audioRef) {
        audioRefs.push(audioRef)
      }

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
      propRefs.push(createPropRef(source, propAsset, url, propBaseUrl))
      return
    }

    const brushType = getString(source.userData, 'aqua_brush_type', 'aquaBrushType')

    if (!brushType) {
      return
    }

    const material = createBrushMaterial(source, materials)
    const userData = createBrushUserData(source.userData, brushType, url)
    const brushMesh = createBrushMesh({ source, brushType, material, userData, resources })

    if (!brushMesh) {
      return
    }

    if (isTriggerBrush(source, brushType)) {
      triggerGroup.add(createTriggerVolumeMesh(brushMesh, resources))
      triggerDebugGroup.add(createTriggerDebugMesh(brushMesh, resources))
      return
    }

    bakeTargets.push(brushMesh)
    shadowTargets.push(brushMesh)

    if (isDebugCollisionBrush(brushType)) {
      collisionDebugGroup.add(createCollisionDebugMesh(brushMesh, resources))
    } else {
      renderGroup.add(brushMesh)
    }

    if (brushMesh.userData.collisionKind !== 'none') {
      collisionGroup.add(createCollisionMesh(brushMesh, resources))
    }
  })

  if (propRefs.length > 0 && propAssetLoader) {
    reportProgress(onProgress, {
      stage: 'props:load',
      label: 'Loading prop shadow casters',
      progress: 0.38,
      detail: `${propRefs.length} prop(s)`,
    })

    EngineConsole.info('Loading map prop references', { count: propRefs.length, propRefs })
    const props = await propAssetLoader.loadInstances(propRefs)

    propRenderGroup = props.renderGroup
    renderGroup.add(props.renderGroup)
    collisionGroup.add(props.collisionGroup)
    resources.trackOwner(props.resources)
    collectShadowMeshes(props.renderGroup, shadowTargets)
    propRefs.length = 0
  }

  if (normalizedLightingMode === 'runtime') {
    const { bakeRuntimeLighting } = await import('./RuntimeLightBaker.js')

    bakedLighting = await bakeRuntimeLighting({
      meshes: bakeTargets,
      shadowMeshes: shadowTargets,
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
      detail: `${Object.keys(getBakedLightingEntries(bakedLighting) || {}).length} surface(s)`,
    })

    for (const mesh of bakeTargets) {
      applyBakedLighting(mesh, bakedLighting, materials, resources)
    }

    applyPropSunlitMaterials(propRenderGroup, materials, bakedLighting)
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
    triggerGroup,
    triggerDebugGroup,
    playerStart,
    propRefs,
    audioRefs,
    skybox,
    source: gltf.scene,
    resources,
  }
}

function applyPropSunlitMaterials(propRenderGroup, materials, bakedLighting) {
  const lighting = getPropSunLighting(bakedLighting)

  if (!propRenderGroup || !materials?.createSunlitMaterial || !lighting) {
    return
  }

  propRenderGroup.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return
    }

    child.material = materials.createSunlitMaterial(child.material, lighting)
  })
}

function getPropSunLighting(bakedLighting) {
  const lights = Array.isArray(bakedLighting?.lights) ? bakedLighting.lights : []
  const sun = lights.find((light) =>
    ['directional', 'sun'].includes(String(light?.type || '').toLowerCase()) &&
    Array.isArray(light.direction)
  )

  if (!sun) {
    return null
  }

  const authoredAmbient = lights.find((light) => isAmbientLight(light) && !isDefaultLight(light))
  const defaultAmbient = lights.find((light) => isAmbientLight(light) && isDefaultLight(light))
  const ambient = authoredAmbient || defaultAmbient
  const maxLight = Number(bakedLighting?.settings?.maxLight)
  const fallbackAmbientIntensity = Number(bakedLighting?.settings?.ambientIntensity)

  return {
    sunDirection: sun.direction,
    sunColor: sun.color,
    sunIntensity: clampLightIntensity(sun.intensity, maxLight),
    ambientColor: ambient?.color,
    ambientIntensity: ambient
      ? clampLightIntensity(ambient.intensity, maxLight)
      : clampLightIntensity(fallbackAmbientIntensity, maxLight),
  }
}

function isAmbientLight(light) {
  return String(light?.type || '').toLowerCase() === 'ambient'
}

function isDefaultLight(light) {
  return String(light?.name || '').toLowerCase().startsWith('default_')
}

function clampLightIntensity(intensity, maxLight) {
  const value = Number(intensity)

  if (!Number.isFinite(value)) {
    return 0
  }

  return Number.isFinite(maxLight) ? Math.min(value, maxLight) : value
}

function createAudioRef(source, mapUrl) {
  const asset = getString(source.userData, 'aqua_audio_asset', 'aquaAudioAsset', 'audioAsset')

  if (!asset) {
    EngineConsole.warn('Skipping positional audio marker without aqua_audio_asset', {
      name: source.name,
      userData: source.userData,
    })
    return null
  }

  source.updateWorldMatrix(true, false)

  return {
    type: 'positional',
    name: source.name || 'audio_source',
    asset,
    mapUrl,
    matrix: source.matrixWorld.toArray(),
    volume: getNumber(source.userData, 'aqua_audio_volume', 'aquaAudioVolume', 'audioVolume'),
    range: getNumber(source.userData, 'aqua_audio_range', 'aquaAudioRange', 'audioRange'),
    refDistance: getNumber(source.userData, 'aqua_audio_ref_distance', 'aquaAudioRefDistance', 'audioRefDistance'),
    rolloff: getNumber(source.userData, 'aqua_audio_rolloff', 'aquaAudioRolloff', 'audioRolloff'),
    distanceModel: getString(source.userData, 'aqua_audio_distance_model', 'aquaAudioDistanceModel', 'audioDistanceModel') || 'linear',
    loop: getOptionalBoolean(source.userData, 'aqua_audio_loop', 'aquaAudioLoop', 'audioLoop'),
    userData: cloneUserData(source.userData),
  }
}

function createSkyboxRef(source) {
  const skyboxRef = getString(
    source.userData,
    'aqua_skybox',
    'aquaSkybox',
    'aqua_skybox_asset',
    'aquaSkyboxAsset',
    'skybox'
  )

  if (!skyboxRef) {
    EngineConsole.warn('Skipping skybox marker without aqua_skybox metadata', {
      name: source.name,
      userData: source.userData,
    })
    return null
  }

  return skyboxRef
}

function findSkyboxRefFromGltf(gltf) {
  const nodes = gltf?.parser?.json?.nodes

  if (!Array.isArray(nodes)) {
    return null
  }

  for (const node of nodes) {
    const extras = node?.extras

    if (!isSkyboxNodeMetadata(node, extras)) {
      continue
    }

    const skyboxRef = getString(
      extras,
      'aqua_skybox',
      'aquaSkybox',
      'aqua_skybox_asset',
      'aquaSkyboxAsset',
      'skybox'
    )

    if (skyboxRef) {
      return skyboxRef
    }
  }

  return null
}

function isSkyboxNodeMetadata(node, extras) {
  const entityClass = getString(extras, 'aqua_entity', 'aquaEntity')

  return entityClass === 'skybox' ||
    String(node?.name || '').toLowerCase() === 'skybox' ||
    Boolean(getString(extras, 'aqua_skybox', 'aquaSkybox', 'aqua_skybox_asset', 'aquaSkyboxAsset'))
}

function createPropRef(source, propAsset, mapUrl, propBaseUrl) {
  source.updateWorldMatrix(true, false)

  const propName = getString(
    source.userData,
    'aqua_prop_id',
    'aquaPropId',
    'aqua_prop_name',
    'aquaPropName'
  )

  return {
    name: source.name || 'aqua_prop',
    asset: resolvePropAssetUrl(propAsset, propName, mapUrl, propBaseUrl),
    matrix: source.matrixWorld.toArray(),
    userData: cloneUserData(source.userData),
  }
}

function resolvePropAssetUrl(propAsset, propName, mapUrl, propBaseUrl) {
  if (propName && isGenericPropLibraryAsset(propAsset)) {
    return resolveUrl(`${String(propBaseUrl || '/assets/props').replace(/\/+$/, '')}/${cleanAssetName(propName)}.aqua_prop.json`, mapUrl)
  }

  return resolveUrl(propAsset, mapUrl)
}

function isGenericPropLibraryAsset(propAsset) {
  return /\/Aqua-Engine_Props\.aqua_prop\.json$/i.test(String(propAsset || ''))
}

function cleanAssetName(name) {
  return String(name || 'aqua_prop')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'aqua_prop'
}

function collectShadowMeshes(object, target) {
  object?.updateMatrixWorld(true)
  object?.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute('position')) {
      return
    }

    target.push(child)
  })
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

function createBrushUserData(sourceUserData, brushType, mapUrl = window.location.href) {
  const userData = cloneUserData(sourceUserData)

  if (isTriggerUserData(sourceUserData, brushType)) {
    userData.collisionKind = 'none'
    userData.trigger = true
    userData.triggerId = getString(sourceUserData, 'aqua_trigger_id', 'aquaTriggerId') || null
    userData.triggerType = getString(sourceUserData, 'aqua_trigger_type', 'aquaTriggerType') || 'generic'
    userData.triggerEvent = getString(sourceUserData, 'aqua_trigger_event', 'aquaTriggerEvent') || 'trigger'
    userData.triggerPayload = getString(sourceUserData, 'aqua_trigger_payload', 'aquaTriggerPayload') || null

    if (getString(sourceUserData, 'aqua_audio_asset', 'aquaAudioAsset', 'audioAsset')) {
      userData.aqua_audio_base_url = mapUrl
    }
  } else if (brushType === 'terrain') {
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
    userData.collisionKind = normalizeCollisionKind(
      getString(sourceUserData, 'aqua_collision_kind', 'aquaCollisionKind') || 'none'
    )
  } else if (brushType === 'ramp' || brushType === 'box' || brushType === 'plane') {
    userData.collisionKind = brushType === 'ramp' ? 'slope' : 'brush'
  }

  return userData
}

function normalizeCollisionKind(kind) {
  if (kind === 'terrain_mesh') {
    return 'triangle'
  }

  return kind || 'none'
}

function isDebugCollisionBrush(brushType) {
  return brushType === 'box' || brushType === 'plane' || brushType === 'ramp'
}

function isTriggerBrush(source, brushType) {
  return isTriggerUserData(source.userData, brushType)
}

function isPositionalAudioSource(source) {
  const audioType = getString(source.userData, 'aqua_audio_type', 'aquaAudioType', 'audioType')
  const entityClass = getString(source.userData, 'aqua_entity', 'aquaEntity')

  return audioType === 'positional' || entityClass === 'audio_source'
}

function isSkyboxMarker(source) {
  const entityClass = getString(source.userData, 'aqua_entity', 'aquaEntity')

  return entityClass === 'skybox' ||
    String(source.name || '').toLowerCase() === 'skybox' ||
    Boolean(getString(source.userData, 'aqua_skybox', 'aquaSkybox', 'aqua_skybox_asset', 'aquaSkyboxAsset'))
}

function isTriggerUserData(userData, brushType) {
  return brushType === 'trigger' ||
    getBoolean(userData, 'aqua_trigger', 'aquaTrigger') ||
    Boolean(getString(userData, 'aqua_trigger_event', 'aquaTriggerEvent'))
}

function createBrushMaterial(source, materials) {
  const sourceMaterials = getSourceMaterials(source)

  if (sourceMaterials.length > 0) {
    const resolvedMaterials = sourceMaterials.map((material) => materials.getMaterialByName(material.name))

    return resolvedMaterials.length === 1 ? resolvedMaterials[0] : resolvedMaterials
  }

  return materials.createMaterial({
    color: getString(source.userData, 'aqua_color', 'aquaColor') || materials.fallbackMaterialColor || '#7f8a8f',
  })
}

function getSourceMaterials(source) {
  if (!source.isMesh || !source.material) {
    return []
  }

  const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material]

  return sourceMaterials.filter((material) => material?.name)
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

function getBoolean(userData, ...keys) {
  for (const key of keys) {
    const value = userData?.[key]

    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
  }

  return false
}

function getOptionalBoolean(userData, ...keys) {
  for (const key of keys) {
    const value = userData?.[key]

    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
  }

  return undefined
}

function isGridTerrain(userData) {
  return Number.isInteger(getNumber(userData, 'aqua_segments_x', 'aquaSegmentsX')) &&
    Number.isInteger(getNumber(userData, 'aqua_segments_z', 'aquaSegmentsZ'))
}

async function loadBakedLighting(url, fetchJson) {
  if (!url) {
    return null
  }

  try {
    const response = await fetchJson(url)

    if (!response.ok) {
      if (response.status !== 404) {
          EngineConsole.warn(`Failed to load baked lighting "${url}": ${response.status}`)
      }

      return null
    }

    const lighting = await response.json()

    if (lighting?.schema === 'aqua.baked_lighting.v1' || lighting?.schema === 'aqua.lightmap.v2') {
      lighting.url = url
      lighting.sourceUrl = url
      return lighting
    }

    return null
  } catch (error) {
    EngineConsole.error(`Failed to load baked lighting "${url}"`, error)
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
  return new URL(url, new URL(baseUrl || window.location.href, window.location.href)).toString()
}
