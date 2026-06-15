const MATERIAL_TEXTURE_PROPERTIES = [
  'map',
  'alphaMap',
  'aoMap',
  'roughnessMap',
  'metalnessMap',
  'normalMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
]

export class ResourceOwner {
  constructor(name = 'resources') {
    this.name = name
    this.objects = []
    this.disposables = []
    this.disposed = false
  }

  trackObject(object) {
    if (object) {
      this.objects.push(object)
    }

    return object
  }

  trackDisposable(resource) {
    if (resource?.dispose) {
      this.disposables.push(resource)
    }

    return resource
  }

  trackGeometry(geometry) {
    return this.trackDisposable(geometry)
  }

  trackOwner(owner) {
    return this.trackDisposable(owner)
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true

    for (const object of this.objects) {
      object.parent?.remove(object)
    }

    const disposed = new Set()

    for (let index = this.disposables.length - 1; index >= 0; index -= 1) {
      const resource = this.disposables[index]

      if (!resource || disposed.has(resource)) {
        continue
      }

      resource.dispose()
      disposed.add(resource)
    }

    this.objects.length = 0
    this.disposables.length = 0
  }
}

export function disposeObject3DResources(root) {
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()

  root?.traverse?.((object) => {
    if (object.geometry) {
      geometries.add(object.geometry)
    }

    collectMaterials(object.material, materials)
  })

  for (const material of materials) {
    collectMaterialTextures(material, textures)
  }

  for (const geometry of geometries) {
    geometry.dispose()
  }

  for (const texture of textures) {
    texture.dispose()
  }

  for (const material of materials) {
    material.dispose()
  }
}

function collectMaterials(material, target) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      collectMaterials(entry, target)
    }
    return
  }

  if (material) {
    target.add(material)
  }
}

function collectMaterialTextures(material, target) {
  for (const property of MATERIAL_TEXTURE_PROPERTIES) {
    const texture = material[property]

    if (texture?.isTexture) {
      target.add(texture)
    }
  }

  if (!material.uniforms) {
    return
  }

  for (const uniform of Object.values(material.uniforms)) {
    const value = uniform?.value

    if (value?.isTexture) {
      target.add(value)
    }
  }
}
