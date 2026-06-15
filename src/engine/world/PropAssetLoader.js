import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { ResourceOwner, disposeObject3DResources } from '../assets/ResourceOwner.js'
import { EngineConsole } from '../config/EngineConsole.js'

const hiddenCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false })

export class PropAssetLoader {
  constructor({ gltfLoader = new GLTFLoader(), fetchJson = (...args) => fetch(...args), materials = null } = {}) {
    this.gltfLoader = gltfLoader
    this.fetchJson = fetchJson
    this.materials = materials
    this.cache = new Map()
    this.cachedAssets = new Set()
  }

  async loadAsset(assetUrl) {
    const resolvedAssetUrl = resolveUrl(assetUrl)

    if (this.cache.has(resolvedAssetUrl)) {
      return this.cache.get(resolvedAssetUrl)
    }

    EngineConsole.info('Loading prop asset metadata', { assetUrl: resolvedAssetUrl })
    const assetPromise = this.fetchJson(resolvedAssetUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load prop metadata "${resolvedAssetUrl}": ${response.status}`)
        }

        const contentType = response.headers?.get?.('content-type') || ''

        if (!contentType.includes('json')) {
          throw new Error(`Failed to load prop metadata "${resolvedAssetUrl}": expected JSON, got ${contentType || 'unknown content type'}`)
        }

        return response.json()
      })
      .then(async (metadata) => {
        if (metadata?.schema !== 'aqua.prop.v1') {
          throw new Error(`Invalid Aqua prop metadata "${resolvedAssetUrl}"`)
        }

        const modelUrl = resolveUrl(resolvePropModel(metadata.model, resolvedAssetUrl), resolvedAssetUrl)
        EngineConsole.info('Loading prop model', {
          assetUrl: resolvedAssetUrl,
          modelUrl,
          metadata,
        })
        const gltf = await this.gltfLoader.loadAsync(modelUrl)

        gltf.scene.updateMatrixWorld(true)

        const asset = {
          metadata,
          assetUrl: resolvedAssetUrl,
          modelUrl,
          materials: this.materials,
          source: gltf.scene,
        }

        this.cachedAssets.add(asset)

        return asset
      })
      .catch((error) => {
        EngineConsole.error('Failed to load prop asset', error, { assetUrl: resolvedAssetUrl })
        throw error
      })

    this.cache.set(resolvedAssetUrl, assetPromise)

    return assetPromise
  }

  async loadInstances(propRefs) {
    const resources = new ResourceOwner('props:instances')
    const renderGroup = resources.trackObject(new THREE.Group())
    const collisionGroup = resources.trackObject(new THREE.Group())

    renderGroup.name = 'PropRender'
    collisionGroup.name = 'PropCollision'

    for (const propRef of propRefs) {
      let asset = null

      try {
        asset = await this.loadAsset(propRef.asset)
      } catch (error) {
        EngineConsole.error('Skipping prop reference because asset failed to load', error, { propRef })
        continue
      }

      const renderInstance = createPropInstance(asset, propRef, resources)
      const collisionInstance = createPropCollisionInstance(asset, propRef, resources)

      renderGroup.add(renderInstance)

      if (collisionInstance) {
        collisionGroup.add(collisionInstance)
      }
    }

    return {
      renderGroup,
      collisionGroup,
      resources,
    }
  }

  dispose() {
    for (const asset of this.cachedAssets) {
      disposeObject3DResources(asset.source)
    }

    this.cachedAssets.clear()
    this.cache.clear()
  }
}

function createPropInstance(asset, propRef, resources) {
  const instance = asset.source.clone(true)
  const propRefUserData = cloneUserData(propRef.userData)
  const doorMetadata = getDoorMetadata(propRefUserData)

  instance.name = propRef.name || asset.metadata.name || 'aqua_prop'
  instance.userData = {
    ...cloneUserData(instance.userData),
    aquaProp: {
      asset: asset.assetUrl,
      model: asset.modelUrl,
      metadata: asset.metadata,
      ref: propRefUserData,
    },
    ...(doorMetadata ? { aquaDoor: doorMetadata } : {}),
  }

  normalizePropSource(instance, asset.metadata)
  applyPropMaterials(instance, asset)
  applyPropRefTransform(instance, propRef)
  removeCollisionHelperMeshes(instance)
  instance.updateMatrixWorld(true)
  resources?.trackObject(instance)

  return instance
}

function getDoorMetadata(userData) {
  const propType = getString(userData, 'aqua_prop_type', 'aquaPropType', 'propType')
  const isDoor = readBoolean(userData?.aqua_door) || readBoolean(userData?.aquaDoor) || propType === 'door'

  if (!isDoor) {
    return null
  }

  return {
    type: 'door',
    openAudio: getString(userData, 'aqua_door_open_audio', 'aquaDoorOpenAudio', 'doorOpenAudio') || null,
    closeAudio: getString(userData, 'aqua_door_close_audio', 'aquaDoorCloseAudio', 'doorCloseAudio') || null,
  }
}

function createPropCollisionInstance(asset, propRef, resources) {
  const collisionType = asset.metadata?.collision?.type || 'authored'

  if (collisionType === 'none') {
    return null
  }

  const sourceInstance = asset.source.clone(true)
  const collisionInstance = resources?.trackObject(new THREE.Group()) || new THREE.Group()
  const collisionMeshes = []

  collisionInstance.name = `${propRef.name || asset.metadata.name || 'aqua_prop'}_collision`
  normalizePropSource(sourceInstance, asset.metadata)
  applyPropRefTransform(sourceInstance, propRef)
  sourceInstance.updateMatrixWorld(true)
  sourceInstance.traverse((child) => {
    if (!child.isMesh) {
      return
    }

    const collisionMetadata = getCollisionHelperMetadata(child)

    if (!collisionMetadata) {
      return
    }

    const collisionMesh = child.clone(false)

    collisionMesh.material = hiddenCollisionMaterial
    collisionMesh.matrix.copy(child.matrixWorld)
    collisionMesh.matrix.decompose(collisionMesh.position, collisionMesh.quaternion, collisionMesh.scale)
    collisionMesh.userData = {
      ...cloneUserData(child.userData),
      aquaCollisionHelper: collisionMetadata,
      brushType: collisionMetadata.brushType,
      collisionKind: collisionMetadata.collisionKind,
      attachedTo: collisionMetadata.attachedTo,
    }
    resources?.trackObject(collisionMesh)
    collisionMeshes.push(collisionMesh)
    collisionInstance.add(collisionMesh)
  })

  collisionInstance.updateMatrixWorld(true)

  return collisionMeshes.length > 0 ? collisionInstance : null
}

function normalizePropSource(instance, metadata) {
  const pivot = getPropPivot(metadata)

  if (!pivot) {
    return
  }

  for (const child of instance.children) {
    child.position.sub(pivot)
  }
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

function applyPropMaterials(instance, asset) {
  const materials = asset.materials

  if (!materials?.getMaterialByName) {
    return
  }

  instance.traverse((child) => {
    if (!child.isMesh || isCollisionHelperMesh(child)) {
      return
    }

    child.material = replaceMaterial(child.material, materials)
  })
}

function replaceMaterial(material, materials) {
  if (Array.isArray(material)) {
    return material.map((entry) => replaceMaterial(entry, materials))
  }

  if (!material?.name) {
    return material
  }

  return materials.getMaterialByName(material.name)
}

function applyPropRefTransform(instance, propRef) {
  if (!propRef.matrix) {
    return
  }

  instance.matrix.fromArray(propRef.matrix)
  instance.matrix.decompose(instance.position, instance.quaternion, instance.scale)
}

function removeCollisionHelperMeshes(object) {
  removeMeshesWhere(object, (child) => child.isMesh && isCollisionHelperMesh(child))
}

function removeMeshesWhere(object, predicate) {
  const meshes = []

  object.traverse((child) => {
    if (predicate(child)) {
      meshes.push(child)
    }
  })

  for (const mesh of meshes) {
    mesh.parent?.remove(mesh)
  }
}

function getCollisionHelperMetadata(object) {
  const brushType = getBrushType(object)
  const collisionKind = getCollisionKind(object, brushType)

  if (!collisionKind) {
    return null
  }

  if (!isCollisionBrushType(brushType) && !isCollisionKind(collisionKind)) {
    return null
  }

  return {
    brushType,
    collisionKind,
    attachedTo: getString(object.userData, 'aqua_attached_to', 'aquaAttachedTo') || null,
  }
}

function isCollisionHelperMesh(object) {
  const collisionMetadata = getCollisionHelperMetadata(object)

  return Boolean(collisionMetadata && isCollisionBrushType(collisionMetadata.brushType))
}

function getBrushType(object) {
  const brushType = getString(object.userData, 'brushType', 'aqua_brush_type', 'aquaBrushType')

  if (brushType === 'box' || brushType === 'plane' || brushType === 'ramp') {
    return brushType
  }

  return null
}

function getCollisionKind(object, brushType = getBrushType(object)) {
  const kind = getString(object.userData, 'collisionKind', 'aqua_collision_kind', 'aquaCollisionKind')

  if (!kind || kind === 'none') {
    return null
  }

  if (kind === 'terrain_mesh') {
    return 'triangle'
  }

  if (kind === 'brush' || kind === 'slope' || kind === 'convex' || kind === 'triangle') {
    return kind
  }

  if (brushType === 'ramp') {
    return 'slope'
  }

  if (brushType === 'box' || brushType === 'plane') {
    return 'brush'
  }

  return null
}

function isCollisionBrushType(brushType) {
  return brushType === 'box' || brushType === 'plane' || brushType === 'ramp'
}

function isCollisionKind(collisionKind) {
  return collisionKind === 'brush' ||
    collisionKind === 'slope' ||
    collisionKind === 'convex' ||
    collisionKind === 'triangle'
}

function resolvePropModel(model, assetUrl) {
  const modelPath = typeof model === 'string' ? model.trim() : ''

  if (!modelPath) {
    return `${getUrlStem(assetUrl)}.glb`
  }

  const pathname = getUrlPathname(modelPath)
  const filename = pathname.split('/').pop() || ''

  if (filename.includes('.')) {
    return modelPath
  }

  return `${modelPath}.glb`
}

function getUrlStem(url) {
  const pathname = getUrlPathname(url)
  const filename = pathname.split('/').pop() || ''

  return filename.replace(/\.aqua_prop\.json$/i, '').replace(/\.[^/.]+$/, '') || 'aqua_prop'
}

function getUrlPathname(url) {
  try {
    return new URL(url, window.location.href).pathname
  } catch {
    return String(url || '').split(/[?#]/)[0]
  }
}

function getString(userData, ...keys) {
  for (const key of keys) {
    if (typeof userData?.[key] === 'string') {
      return userData[key]
    }
  }

  return null
}

function readBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }

  return false
}

function resolveUrl(url, baseUrl = window.location.href) {
  return new URL(url, new URL(baseUrl || window.location.href, window.location.href)).toString()
}

function cloneUserData(userData) {
  return JSON.parse(JSON.stringify(userData || {}))
}
