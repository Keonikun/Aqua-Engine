import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'

const hiddenCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false })

export class PropAssetLoader {
  constructor({ gltfLoader = new GLTFLoader(), fetchJson = fetch } = {}) {
    this.gltfLoader = gltfLoader
    this.fetchJson = fetchJson
    this.cache = new Map()
  }

  async loadAsset(assetUrl) {
    const resolvedAssetUrl = resolveUrl(assetUrl)

    if (this.cache.has(resolvedAssetUrl)) {
      return this.cache.get(resolvedAssetUrl)
    }

    const assetPromise = this.fetchJson(resolvedAssetUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load prop metadata "${resolvedAssetUrl}": ${response.status}`)
        }

        return response.json()
      })
      .then(async (metadata) => {
        const modelUrl = resolveUrl(metadata.model, resolvedAssetUrl)
        const gltf = await this.gltfLoader.loadAsync(modelUrl)

        gltf.scene.updateMatrixWorld(true)

        return {
          metadata,
          assetUrl: resolvedAssetUrl,
          modelUrl,
          source: gltf.scene,
        }
      })

    this.cache.set(resolvedAssetUrl, assetPromise)

    return assetPromise
  }

  async loadInstances(propRefs) {
    const renderGroup = new THREE.Group()
    const collisionGroup = new THREE.Group()

    renderGroup.name = 'PropRender'
    collisionGroup.name = 'PropCollision'

    for (const propRef of propRefs) {
      const asset = await this.loadAsset(propRef.asset)
      const renderInstance = createPropInstance(asset, propRef)
      const collisionInstance = createPropCollisionInstance(renderInstance, asset.metadata)

      renderGroup.add(renderInstance)

      if (collisionInstance) {
        collisionGroup.add(collisionInstance)
      }
    }

    return {
      renderGroup,
      collisionGroup,
    }
  }
}

function createPropInstance(asset, propRef) {
  const instance = asset.source.clone(true)

  instance.name = propRef.name || asset.metadata.name || 'aqua_prop'
  instance.userData = {
    ...cloneUserData(instance.userData),
    aquaProp: {
      asset: asset.assetUrl,
      model: asset.modelUrl,
      metadata: asset.metadata,
    },
  }

  if (propRef.matrix) {
    instance.matrix.fromArray(propRef.matrix)
    instance.matrix.decompose(instance.position, instance.quaternion, instance.scale)
  }

  instance.updateMatrixWorld(true)

  return instance
}

function createPropCollisionInstance(renderInstance, metadata) {
  const collisionType = metadata?.collision?.type || 'render_mesh'

  if (collisionType === 'none') {
    return null
  }

  const collisionInstance = renderInstance.clone(true)

  collisionInstance.name = `${renderInstance.name}_collision`
  collisionInstance.traverse((child) => {
    if (!child.isMesh) {
      return
    }

    child.material = hiddenCollisionMaterial
    child.userData = {
      ...cloneUserData(child.userData),
      collisionKind: collisionType === 'convex' ? 'convex' : 'triangle',
    }
  })

  collisionInstance.updateMatrixWorld(true)

  return collisionInstance
}

function resolveUrl(url, baseUrl = window.location.href) {
  return new URL(url, baseUrl).toString()
}

function cloneUserData(userData) {
  return JSON.parse(JSON.stringify(userData || {}))
}
