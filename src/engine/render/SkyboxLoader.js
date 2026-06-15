import * as THREE from 'three'

export const DEFAULT_SKYBOX_BASE_URL = '/assets/skyboxes'

const SKYBOX_SCHEMA = 'aqua.skybox.v1'
const CUBE_FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
const DEFAULT_FACE_EXTENSION = 'png'

export class SkyboxLoader {
  constructor({ baseUrl = DEFAULT_SKYBOX_BASE_URL, fetchJson = (...args) => fetch(...args) } = {}) {
    this.baseUrl = baseUrl
    this.fetchJson = fetchJson
    this.loader = new THREE.CubeTextureLoader()
    this.cache = new Map()
  }

  async load(skyboxRef) {
    const normalized = normalizeSkyboxRef(skyboxRef)

    if (!normalized) {
      return null
    }

    const baseUrl = resolveSkyboxBaseUrl(normalized, this.baseUrl)

    if (this.cache.has(baseUrl)) {
      return this.cache.get(baseUrl)
    }

    const texturePromise = this.loadTexture(baseUrl, normalized).catch((error) => {
      this.cache.delete(baseUrl)
      throw error
    })
    this.cache.set(baseUrl, texturePromise)
    return texturePromise
  }

  async loadTexture(baseUrl, skyboxRef) {
    const urls = await this.resolveFaceUrls(baseUrl, skyboxRef)
    const texture = await new Promise((resolve, reject) => {
      this.loader.load(urls, resolve, undefined, reject)
    })

    texture.name = `skybox:${skyboxRef}`
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.CubeReflectionMapping
    texture.userData = {
      skybox: skyboxRef,
      urls,
    }

    return texture
  }

  async resolveFaceUrls(baseUrl) {
    const manifest = await this.loadManifest(`${baseUrl}/skybox.json`)

    if (manifest?.schema === SKYBOX_SCHEMA && manifest.faces) {
      return CUBE_FACE_ORDER.map((face) => resolveSkyboxFaceUrl(manifest.faces[face], baseUrl, face))
    }

    return CUBE_FACE_ORDER.map((face) => `${baseUrl}/${face}.${DEFAULT_FACE_EXTENSION}`)
  }

  async loadManifest(url) {
    try {
      const response = await this.fetchJson(url)

      if (!response.ok) {
        return null
      }

      return response.json()
    } catch (_error) {
      return null
    }
  }

  dispose() {
    for (const textureOrPromise of this.cache.values()) {
      Promise.resolve(textureOrPromise)
        .then((texture) => texture?.dispose?.())
        .catch(() => {})
    }

    this.cache.clear()
  }
}

function normalizeSkyboxRef(skyboxRef) {
  if (typeof skyboxRef === 'string') {
    return skyboxRef.trim()
  }

  if (skyboxRef?.name) {
    return String(skyboxRef.name).trim()
  }

  if (skyboxRef?.asset) {
    return String(skyboxRef.asset).trim()
  }

  return ''
}

function resolveSkyboxBaseUrl(skyboxRef, baseUrl) {
  const normalized = String(skyboxRef || '').replace(/\\/g, '/').replace(/\/+$/, '')

  if (normalized.startsWith('/') || /^[a-z]+:\/\//i.test(normalized)) {
    return normalized
  }

  return `${baseUrl.replace(/\/+$/, '')}/${cleanAssetName(normalized)}`
}

function resolveSkyboxFaceUrl(facePath, baseUrl, face) {
  const path = typeof facePath === 'string' && facePath.trim() ? facePath.trim() : `${face}.${DEFAULT_FACE_EXTENSION}`

  if (path.startsWith('/') || /^[a-z]+:\/\//i.test(path)) {
    return path
  }

  return `${baseUrl}/${path}`
}

function cleanAssetName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
