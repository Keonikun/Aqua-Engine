import * as THREE from 'three'

export const DEFAULT_MATERIAL_MANIFEST_URL = '/assets/materials/materials.json'

const QUALITY_PRESETS = {
  low: {
    shadeSteps: 3,
    ambientStrength: 0.64,
    lightStrength: 0.76,
    fogStrength: 0.85,
    ditherStrength: 0.02,
  },
  medium: {
    shadeSteps: 5,
    ambientStrength: 0.54,
    lightStrength: 0.9,
    fogStrength: 1,
    ditherStrength: 0.01,
  },
  high: {
    shadeSteps: 0,
    ambientStrength: 0.48,
    lightStrength: 1,
    fogStrength: 1,
    ditherStrength: 0,
  },
}

const TEXTURE_QUALITY_PRESETS = {
  very_low: {
    anisotropy: 1,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  },
  low: {
    anisotropy: 1,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  },
  medium: {
    anisotropy: 4,
    minFilter: THREE.LinearMipmapNearestFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  },
  high: {
    anisotropy: 16,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  },
}

const vertexShader = `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fragmentShader = `
  uniform vec3 uBaseColor;
  uniform vec3 uAmbientColor;
  uniform vec3 uLightColor;
  uniform vec3 uLightDirection;
  uniform vec3 uFogColor;
  uniform float uShadeSteps;
  uniform float uAmbientStrength;
  uniform float uLightStrength;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogStrength;
  uniform float uDitherStrength;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    float lambert = max(dot(normal, normalize(uLightDirection)), 0.0);
    float shade = uAmbientStrength + lambert * uLightStrength;

    if (uShadeSteps > 0.5) {
      shade = floor(shade * uShadeSteps) / uShadeSteps;
    }

    float dither = (hash(gl_FragCoord.xy) - 0.5) * uDitherStrength;
    vec3 color = uBaseColor * (uAmbientColor * uAmbientStrength + uLightColor * max(shade + dither, 0.0));

    float fogAmount = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPosition)) * uFogStrength;
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`

export class WorldMaterialSystem {
  constructor({ manifestUrl = DEFAULT_MATERIAL_MANIFEST_URL } = {}) {
    this.quality = 'medium'
    this.textureQuality = 'medium'
    this.maxTextureAnisotropy = 1
    this.materials = new Set()
    this.textures = new Set()
    this.materialDefinitions = new Map()
    this.materialCache = new Map()
    this.bakedMaterialCache = new Map()
    this.textureCache = new Map()
    this.manifestUrl = manifestUrl
    this.fogColor = new THREE.Color('#151922')
    this.lightDirection = new THREE.Vector3(-0.55, 0.82, 0.35).normalize()
    this.errorMaterial = null
  }

  async loadManifest(url = this.manifestUrl) {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to load material manifest "${url}": ${response.status}`)
    }

    const manifest = await response.json()
    const definitions = manifest.materials || {}

    this.materialDefinitions.clear()

    for (const [name, definition] of Object.entries(definitions)) {
      this.materialDefinitions.set(name, {
        name,
        ...definition,
      })
    }

    return this
  }

  createMaterial({ color }) {
    const preset = QUALITY_PRESETS[this.quality]
    const material = new THREE.ShaderMaterial({
      name: 'AquaWorldMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        uBaseColor: { value: new THREE.Color(color) },
        uAmbientColor: { value: new THREE.Color('#d8f3ff') },
        uLightColor: { value: new THREE.Color('#fff2d0') },
        uLightDirection: { value: this.lightDirection.clone() },
        uFogColor: { value: this.fogColor.clone() },
        uShadeSteps: { value: preset.shadeSteps },
        uAmbientStrength: { value: preset.ambientStrength },
        uLightStrength: { value: preset.lightStrength },
        uFogNear: { value: 22 },
        uFogFar: { value: 55 },
        uFogStrength: { value: preset.fogStrength },
        uDitherStrength: { value: preset.ditherStrength },
      },
    })

    this.materials.add(material)
    return material
  }

  getMaterialByName(name, options = {}) {
    if (!name || !this.materialDefinitions.has(name)) {
      return this.getErrorMaterial(name)
    }

    if (this.materialCache.has(name)) {
      return this.materialCache.get(name)
    }

    const definition = this.materialDefinitions.get(name)
    const material = this.createTextureMaterial(definition, options)

    this.materialCache.set(name, material)
    this.materials.add(material)

    return material
  }

  createTextureMaterial(definition, options) {
    const repeat = definition.repeat || options.repeat || [1, 1]
    const material = new THREE.MeshStandardMaterial({
      name: definition.name,
      roughness: definition.roughness ?? 1,
      metalness: definition.metalness ?? 0,
    })

    material.userData.aquaTextureSlots = createTextureSlots(definition, repeat)
    this.applyMaterialTextureSlots(material)

    return material
  }

  createBakedMaterial(material) {
    if (Array.isArray(material)) {
      return material.map((entry) => this.createBakedMaterial(entry))
    }

    if (!material) {
      return material
    }

    if (this.bakedMaterialCache.has(material)) {
      return this.bakedMaterialCache.get(material)
    }

    const bakedMaterial = new THREE.MeshBasicMaterial({
      name: `${material.name || 'AquaWorldMaterial'}_baked`,
      color: getMaterialBaseColor(material),
      map: material.map || null,
      alphaMap: material.alphaMap || null,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      fog: true,
      vertexColors: true,
    })

    bakedMaterial.userData.aquaBakedSourceMaterial = material
    this.bakedMaterialCache.set(material, bakedMaterial)
    this.materials.add(bakedMaterial)

    return bakedMaterial
  }

  loadTexture(source, { color = false, repeat = [1, 1] } = {}) {
    const url = resolveTextureUrl(source, this.textureQuality)

    if (this.textureCache.has(url)) {
      const cachedTexture = this.textureCache.get(url)

      applyTextureRepeat(cachedTexture, repeat)
      return cachedTexture
    }

    const texture = new THREE.TextureLoader().load(url)

    texture.name = url
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    applyTextureRepeat(texture, repeat)
    this.applyTextureQualitySettings(texture)
    this.textureCache.set(url, texture)
    this.textures.add(texture)

    return texture
  }

  getErrorMaterial(name = 'missing') {
    if (this.errorMaterial) {
      return this.errorMaterial
    }

    const texture = createErrorTexture()

    this.textures.add(texture)
    this.applyTextureQualitySettings(texture)
    this.errorMaterial = new THREE.MeshBasicMaterial({
      name: `missing_material_${name || 'unnamed'}`,
      map: texture,
    })
    this.materials.add(this.errorMaterial)

    return this.errorMaterial
  }

  setQuality(quality) {
    if (!QUALITY_PRESETS[quality]) {
      return
    }

    this.quality = quality
    const preset = QUALITY_PRESETS[quality]

    for (const material of this.materials) {
      if (!material.uniforms) {
        continue
      }

      material.uniforms.uShadeSteps.value = preset.shadeSteps
      material.uniforms.uAmbientStrength.value = preset.ambientStrength
      material.uniforms.uLightStrength.value = preset.lightStrength
      material.uniforms.uFogStrength.value = preset.fogStrength
      material.uniforms.uDitherStrength.value = preset.ditherStrength
    }
  }

  setTextureQuality(quality) {
    if (!TEXTURE_QUALITY_PRESETS[quality]) {
      return
    }

    this.textureQuality = quality
    this.refreshMaterialTextureSlots()
    this.applyTextureQualityToLoadedTextures()
    this.syncBakedMaterialTextures()
  }

  setTextureAnisotropyLimit(maxAnisotropy) {
    const nextLimit = Math.max(1, Math.floor(Number(maxAnisotropy) || 1))

    if (nextLimit === this.maxTextureAnisotropy) {
      return
    }

    this.maxTextureAnisotropy = nextLimit
    this.applyTextureQualityToLoadedTextures()
  }

  refreshMaterialTextureSlots() {
    for (const material of this.materials) {
      if (material.userData?.aquaTextureSlots) {
        this.applyMaterialTextureSlots(material)
      }
    }
  }

  applyMaterialTextureSlots(material) {
    const slots = material.userData?.aquaTextureSlots

    if (!Array.isArray(slots)) {
      return
    }

    for (const slot of slots) {
      material[slot.property] = this.loadTexture(slot.source, {
        color: slot.color,
        repeat: slot.repeat,
      })
    }

    material.needsUpdate = true
  }

  syncBakedMaterialTextures() {
    for (const [sourceMaterial, bakedMaterial] of this.bakedMaterialCache) {
      if (!sourceMaterial || !bakedMaterial) {
        continue
      }

      bakedMaterial.map = sourceMaterial.map || null
      bakedMaterial.alphaMap = sourceMaterial.alphaMap || null
      bakedMaterial.needsUpdate = true
    }
  }

  applyTextureQualityToLoadedTextures() {
    for (const texture of this.textures) {
      this.applyTextureQualitySettings(texture)
    }
  }

  applyTextureQualitySettings(texture) {
    const preset = TEXTURE_QUALITY_PRESETS[this.textureQuality] || TEXTURE_QUALITY_PRESETS.medium

    texture.minFilter = preset.minFilter
    texture.magFilter = preset.magFilter
    texture.generateMipmaps = preset.generateMipmaps
    texture.anisotropy = Math.min(preset.anisotropy, this.maxTextureAnisotropy)
    texture.needsUpdate = true
  }

  dispose() {
    for (const material of this.materials) {
      material.dispose()
    }

    for (const texture of this.textures) {
      texture.dispose()
    }

    this.materials.clear()
    this.textures.clear()
    this.materialDefinitions.clear()
    this.materialCache.clear()
    this.bakedMaterialCache.clear()
    this.textureCache.clear()
  }
}

function createTextureSlots(definition, repeat) {
  const slots = []

  if (definition.diffuse) {
    slots.push({ property: 'map', source: definition.diffuse, color: true, repeat })
  }

  if (definition.arm) {
    slots.push({ property: 'aoMap', source: definition.arm, color: false, repeat })
    slots.push({ property: 'roughnessMap', source: definition.arm, color: false, repeat })
    slots.push({ property: 'metalnessMap', source: definition.arm, color: false, repeat })
  }

  if (definition.normal) {
    slots.push({ property: 'normalMap', source: definition.normal, color: false, repeat })
  }

  return slots
}

function resolveTextureUrl(source, textureQuality) {
  if (typeof source === 'string') {
    return getTextureVariantUrl(source, textureQuality)
  }

  if (!source || typeof source !== 'object') {
    return ''
  }

  return source[textureQuality] ||
    source.high ||
    source.medium ||
    source.low ||
    source.very_low ||
    source.veryLow ||
    source.url ||
    source.default ||
    ''
}

function getTextureVariantUrl(url, textureQuality) {
  if (textureQuality === 'high') {
    return url
  }

  const suffix = getTextureVariantSuffix(textureQuality)

  if (!suffix) {
    return url
  }

  const queryIndex = url.search(/[?#]/)
  const pathPart = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : url.slice(queryIndex)
  const dotIndex = pathPart.lastIndexOf('.')

  if (dotIndex === -1) {
    return `${pathPart}_${suffix}${queryPart}`
  }

  return `${pathPart.slice(0, dotIndex)}_${suffix}${pathPart.slice(dotIndex)}${queryPart}`
}

function getTextureVariantSuffix(textureQuality) {
  if (textureQuality === 'medium') {
    return 'medium'
  }

  if (textureQuality === 'low') {
    return 'low'
  }

  if (textureQuality === 'very_low') {
    return 'very_low'
  }

  return null
}

function applyTextureRepeat(texture, repeat) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat[0] || 1, repeat[1] || 1)
}

function getMaterialBaseColor(material) {
  if (material.color?.isColor) {
    return material.color.clone()
  }

  const uniformColor = material.uniforms?.uBaseColor?.value

  if (uniformColor?.isColor) {
    return uniformColor.clone()
  }

  return new THREE.Color('#ffffff')
}

function createErrorTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const magenta = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0

      data[index] = magenta ? 255 : 0
      data[index + 1] = 0
      data[index + 2] = magenta ? 255 : 0
      data[index + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)

  texture.name = 'AquaMissingMaterialTexture'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  texture.needsUpdate = true

  return texture
}
