import * as THREE from 'three'

export const DEFAULT_MATERIAL_MANIFEST_URL = '/assets/textures/materials.json'

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

const TEXTURE_QUALITY_SIZE_FOLDERS = {
  very_low: '128x128',
  low: '256x256',
  medium: '512x512',
  high: '1024x1024',
}

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
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const lightmappedVertexShader = `
  attribute vec2 uv2;

  varying vec2 vUv;
  varying vec2 vLightMapUv;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vUv = uv;
    vLightMapUv = uv2;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const lightmappedFragmentShader = `
  uniform vec3 uBaseColor;
  uniform sampler2D uBaseMap;
  uniform sampler2D uLightMap;
  uniform vec2 uBaseMapRepeat;
  uniform vec3 uFogColor;
  uniform float uHasBaseMap;
  uniform float uLightMapIntensity;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogStrength;

  varying vec2 vUv;
  varying vec2 vLightMapUv;
  varying vec3 vWorldPosition;

  void main() {
    vec3 baseColor = uBaseColor;

    if (uHasBaseMap > 0.5) {
      baseColor *= texture2D(uBaseMap, vUv * uBaseMapRepeat).rgb;
    }

    vec3 bakedLight = texture2D(uLightMap, vLightMapUv).rgb * uLightMapIntensity;
    vec3 color = baseColor * bakedLight;
    float fogAmount = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPosition)) * uFogStrength;
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const sunlitVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const sunlitFragmentShader = `
  uniform vec3 uBaseColor;
  uniform sampler2D uBaseMap;
  uniform vec2 uBaseMapRepeat;
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uFogColor;
  uniform float uHasBaseMap;
  uniform float uAmbientIntensity;
  uniform float uSunIntensity;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogStrength;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec3 baseColor = uBaseColor;

    if (uHasBaseMap > 0.5) {
      baseColor *= texture2D(uBaseMap, vUv * uBaseMapRepeat).rgb;
    }

    vec3 normal = normalize(vWorldNormal);
    float sun = max(dot(normal, normalize(uSunDirection)), 0.0) * uSunIntensity;
    vec3 lighting = uAmbientColor * uAmbientIntensity + uSunColor * sun;
    vec3 color = baseColor * lighting;
    float fogAmount = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPosition)) * uFogStrength;
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export class WorldMaterialSystem {
  constructor({
    manifestUrl = DEFAULT_MATERIAL_MANIFEST_URL,
    graphicsQuality = 'medium',
    textureQuality = 'medium',
    qualityPresets = {},
    textureQualityPresets = {},
    textureQualitySizeFolders = {},
    fogColor = '#151922',
    lightDirection = [-0.55, 0.82, 0.35],
    fallbackMaterialColor = '#7f8a8f',
    worldShader = {},
  } = {}) {
    this.qualityPresets = mergeQualityPresets(qualityPresets)
    this.textureQualityPresets = mergeTextureQualityPresets(textureQualityPresets)
    this.textureQualitySizeFolders = {
      ...TEXTURE_QUALITY_SIZE_FOLDERS,
      ...textureQualitySizeFolders,
    }
    this.quality = this.qualityPresets[graphicsQuality] ? graphicsQuality : 'medium'
    this.textureQuality = this.textureQualityPresets[textureQuality] ? textureQuality : 'medium'
    this.maxTextureAnisotropy = 1
    this.materials = new Set()
    this.textures = new Set()
    this.materialDefinitions = new Map()
    this.materialCache = new Map()
    this.solidMaterialCache = new Map()
    this.bakedMaterialCache = new Map()
    this.unlitMaterialCache = new Map()
    this.sunlitMaterialCache = new Map()
    this.lightmappedMaterialCache = new Map()
    this.lightmappedMaterialEntries = new Set()
    this.textureCache = new Map()
    this.manifestUrl = manifestUrl
    this.fogColor = new THREE.Color(fogColor)
    this.lightDirection = createDirectionVector(lightDirection, new THREE.Vector3(-0.55, 0.82, 0.35))
    this.fallbackMaterialColor = fallbackMaterialColor
    this.worldShader = {
      ambientColor: worldShader.ambientColor || '#d8f3ff',
      lightColor: worldShader.lightColor || '#fff2d0',
      fogNear: readNumber(worldShader.fogNear, 22),
      fogFar: readNumber(worldShader.fogFar, 55),
    }
    this.errorMaterial = null
    this.whiteTexture = null
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
    const cacheKey = normalizeColorKey(color)

    if (this.solidMaterialCache.has(cacheKey)) {
      return this.solidMaterialCache.get(cacheKey)
    }

    const preset = this.qualityPresets[this.quality] || this.qualityPresets.medium
    const material = new THREE.ShaderMaterial({
      name: 'AquaWorldMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        uBaseColor: { value: new THREE.Color(color) },
        uAmbientColor: { value: new THREE.Color(this.worldShader.ambientColor) },
        uLightColor: { value: new THREE.Color(this.worldShader.lightColor) },
        uLightDirection: { value: this.lightDirection.clone() },
        uFogColor: { value: this.fogColor.clone() },
        uShadeSteps: { value: preset.shadeSteps },
        uAmbientStrength: { value: preset.ambientStrength },
        uLightStrength: { value: preset.lightStrength },
        uFogNear: { value: this.worldShader.fogNear },
        uFogFar: { value: this.worldShader.fogFar },
        uFogStrength: { value: preset.fogStrength },
        uDitherStrength: { value: preset.ditherStrength },
      },
    })

    this.solidMaterialCache.set(cacheKey, material)
    this.materials.add(material)
    return material
  }

  getMaterialByName(name, options = {}) {
    const materialName = this.resolveMaterialName(name)

    if (!materialName) {
      return this.getErrorMaterial(name)
    }

    // TODO(render-cache): This cache is keyed by material name only; future per-brush options such as repeat would be ignored here.
    // Current map and prop call sites request shared named materials without per-use overrides.
    if (this.materialCache.has(materialName)) {
      return this.materialCache.get(materialName)
    }

    const definition = this.materialDefinitions.get(materialName)
    const material = this.createTextureMaterial(definition, options)

    this.materialCache.set(materialName, material)
    this.materials.add(material)

    return material
  }

  resolveMaterialName(name) {
    if (!name || typeof name !== 'string') {
      return null
    }

    if (this.materialDefinitions.has(name)) {
      return name
    }

    const normalizedName = stripBlenderDuplicateSuffix(stripExportPlaceholderSuffix(name))

    return this.materialDefinitions.has(normalizedName) ? normalizedName : null
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

  createUnlitMaterial(material) {
    if (Array.isArray(material)) {
      return material.map((entry) => this.createUnlitMaterial(entry))
    }

    if (!material) {
      return material
    }

    if (this.unlitMaterialCache.has(material)) {
      return this.unlitMaterialCache.get(material)
    }

    const unlitMaterial = new THREE.MeshBasicMaterial({
      name: `${material.name || 'AquaWorldMaterial'}_unlit`,
      color: getMaterialBaseColor(material),
      map: material.map || null,
      alphaMap: material.alphaMap || null,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      fog: true,
    })

    unlitMaterial.userData.aquaUnlitSourceMaterial = material
    this.unlitMaterialCache.set(material, unlitMaterial)
    this.materials.add(unlitMaterial)

    return unlitMaterial
  }

  createSunlitMaterial(material, lighting = {}) {
    if (Array.isArray(material)) {
      return material.map((entry) => this.createSunlitMaterial(entry, lighting))
    }

    if (!material) {
      return material
    }

    let perSourceCache = this.sunlitMaterialCache.get(material)

    if (!perSourceCache) {
      perSourceCache = new Map()
      this.sunlitMaterialCache.set(material, perSourceCache)
    }

    const cacheKey = createSunlitMaterialCacheKey(lighting)

    if (perSourceCache.has(cacheKey)) {
      return perSourceCache.get(cacheKey)
    }

    const preset = this.qualityPresets[this.quality] || this.qualityPresets.medium
    const baseMap = material.map || this.getWhiteTexture()
    const sunlitMaterial = new THREE.ShaderMaterial({
      name: `${material.name || 'AquaWorldMaterial'}_sunlit`,
      vertexShader: sunlitVertexShader,
      fragmentShader: sunlitFragmentShader,
      uniforms: {
        uBaseColor: { value: getMaterialBaseColor(material) },
        uBaseMap: { value: baseMap },
        uBaseMapRepeat: { value: getTextureRepeat(baseMap) },
        uAmbientColor: { value: colorFromArray(lighting.ambientColor, '#ffffff') },
        uSunColor: { value: colorFromArray(lighting.sunColor, '#ffffff') },
        uSunDirection: { value: vectorFromArray(lighting.sunDirection, this.lightDirection) },
        uFogColor: { value: this.fogColor.clone() },
        uHasBaseMap: { value: material.map ? 1 : 0 },
        uAmbientIntensity: { value: Number(lighting.ambientIntensity) || 0 },
        uSunIntensity: { value: Number(lighting.sunIntensity) || 1 },
        uFogNear: { value: this.worldShader.fogNear },
        uFogFar: { value: this.worldShader.fogFar },
        uFogStrength: { value: preset.fogStrength },
      },
      fog: false,
      transparent: material.transparent,
      side: material.side,
    })

    sunlitMaterial.userData.aquaSunlitSourceMaterial = material
    perSourceCache.set(cacheKey, sunlitMaterial)
    this.materials.add(sunlitMaterial)

    return sunlitMaterial
  }

  createLightmappedMaterial(material, lightMap, { intensity = 1 } = {}) {
    if (Array.isArray(material)) {
      return material.map((entry) => this.createLightmappedMaterial(entry, lightMap, { intensity }))
    }

    if (!material || !lightMap?.isTexture) {
      return material
    }

    let perSourceCache = this.lightmappedMaterialCache.get(material)

    if (!perSourceCache) {
      perSourceCache = new Map()
      this.lightmappedMaterialCache.set(material, perSourceCache)
    }

    const cacheKey = `${lightMap.uuid}|${Number(intensity) || 1}`

    if (perSourceCache.has(cacheKey)) {
      return perSourceCache.get(cacheKey)
    }

    const preset = this.qualityPresets[this.quality] || this.qualityPresets.medium
    const baseMap = material.map || this.getWhiteTexture()
    const lightmappedMaterial = new THREE.ShaderMaterial({
      name: `${material.name || 'AquaWorldMaterial'}_lightmapped`,
      vertexShader: lightmappedVertexShader,
      fragmentShader: lightmappedFragmentShader,
      uniforms: {
        uBaseColor: { value: getMaterialBaseColor(material) },
        uBaseMap: { value: baseMap },
        uLightMap: { value: lightMap },
        uBaseMapRepeat: { value: getTextureRepeat(baseMap) },
        uFogColor: { value: this.fogColor.clone() },
        uHasBaseMap: { value: material.map ? 1 : 0 },
        uLightMapIntensity: { value: Number(intensity) || 1 },
        uFogNear: { value: this.worldShader.fogNear },
        uFogFar: { value: this.worldShader.fogFar },
        uFogStrength: { value: preset.fogStrength },
      },
      fog: false,
      transparent: material.transparent,
      side: material.side,
    })

    lightmappedMaterial.userData.aquaLightmappedSourceMaterial = material
    lightmappedMaterial.userData.aquaLightMap = lightMap
    perSourceCache.set(cacheKey, lightmappedMaterial)
    this.lightmappedMaterialEntries.add({
      sourceMaterial: material,
      material: lightmappedMaterial,
    })
    this.materials.add(lightmappedMaterial)

    return lightmappedMaterial
  }

  loadTexture(source, { color = false, repeat = [1, 1] } = {}) {
    const url = resolveTextureUrl(source, this.textureQuality, this.textureQualitySizeFolders)
    const cacheKey = createTextureCacheKey(url, color, repeat)

    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)
    }

    const texture = new THREE.TextureLoader().load(url)

    texture.name = url
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    applyTextureRepeat(texture, repeat)
    this.applyTextureQualitySettings(texture)
    this.textureCache.set(cacheKey, texture)
    this.textures.add(texture)

    return texture
  }

  loadLightmapTexture(source) {
    const url = typeof source === 'string' ? source : ''
    const cacheKey = `lightmap:${url}`

    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)
    }

    const texture = new THREE.TextureLoader().load(url)

    texture.name = url
    texture.colorSpace = THREE.NoColorSpace
    texture.flipY = false
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    this.applyTextureQualitySettings(texture)
    this.textureCache.set(cacheKey, texture)
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
    if (!this.qualityPresets[quality]) {
      return
    }

    this.quality = quality
    const preset = this.qualityPresets[quality]

    for (const material of this.materials) {
      if (!material.uniforms) {
        continue
      }

      setUniformValue(material, 'uShadeSteps', preset.shadeSteps)
      setUniformValue(material, 'uAmbientStrength', preset.ambientStrength)
      setUniformValue(material, 'uLightStrength', preset.lightStrength)
      setUniformValue(material, 'uFogStrength', preset.fogStrength)
      setUniformValue(material, 'uDitherStrength', preset.ditherStrength)
    }

    for (const entry of this.lightmappedMaterialEntries) {
      setUniformValue(entry.material, 'uFogStrength', preset.fogStrength)
    }

    for (const perSourceCache of this.sunlitMaterialCache.values()) {
      for (const material of perSourceCache.values()) {
        setUniformValue(material, 'uFogStrength', preset.fogStrength)
      }
    }
  }

  setTextureQuality(quality) {
    if (!this.textureQualityPresets[quality]) {
      return
    }

    this.textureQuality = quality
    this.refreshMaterialTextureSlots()
    this.syncBakedMaterialTextures()
    this.syncLightmappedMaterialTextures()
    this.pruneUnusedTextureCache()
    this.applyTextureQualityToLoadedTextures()
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

    for (const [sourceMaterial, unlitMaterial] of this.unlitMaterialCache) {
      if (!sourceMaterial || !unlitMaterial) {
        continue
      }

      unlitMaterial.color.copy(getMaterialBaseColor(sourceMaterial))
      unlitMaterial.map = sourceMaterial.map || null
      unlitMaterial.alphaMap = sourceMaterial.alphaMap || null
      unlitMaterial.needsUpdate = true
    }

    for (const [sourceMaterial, perSourceCache] of this.sunlitMaterialCache) {
      for (const sunlitMaterial of perSourceCache.values()) {
        if (!sourceMaterial || !sunlitMaterial?.uniforms) {
          continue
        }

        const baseMap = sourceMaterial.map || this.getWhiteTexture()

        sunlitMaterial.uniforms.uBaseColor.value = getMaterialBaseColor(sourceMaterial)
        sunlitMaterial.uniforms.uBaseMap.value = baseMap
        sunlitMaterial.uniforms.uBaseMapRepeat.value = getTextureRepeat(baseMap)
        sunlitMaterial.uniforms.uHasBaseMap.value = sourceMaterial.map ? 1 : 0
        sunlitMaterial.needsUpdate = true
      }
    }
  }

  syncLightmappedMaterialTextures() {
    for (const entry of this.lightmappedMaterialEntries) {
      const sourceMaterial = entry.sourceMaterial
      const material = entry.material

      if (!sourceMaterial || !material?.uniforms) {
        continue
      }

      const baseMap = sourceMaterial.map || this.getWhiteTexture()

      material.uniforms.uBaseColor.value = getMaterialBaseColor(sourceMaterial)
      material.uniforms.uBaseMap.value = baseMap
      material.uniforms.uBaseMapRepeat.value = getTextureRepeat(baseMap)
      material.uniforms.uHasBaseMap.value = sourceMaterial.map ? 1 : 0
      material.needsUpdate = true
    }
  }

  pruneUnusedTextureCache() {
    const referencedTextures = this.collectReferencedTextures()

    for (const [cacheKey, texture] of this.textureCache) {
      if (referencedTextures.has(texture)) {
        continue
      }

      texture.dispose()
      this.textureCache.delete(cacheKey)
      this.textures.delete(texture)
    }
  }

  collectReferencedTextures() {
    const textures = new Set()

    for (const material of this.materials) {
      collectMaterialTextures(material, textures)
    }

    return textures
  }

  applyTextureQualityToLoadedTextures() {
    for (const texture of this.textures) {
      this.applyTextureQualitySettings(texture)
    }
  }

  applyTextureQualitySettings(texture) {
    const preset = this.textureQualityPresets[this.textureQuality] || this.textureQualityPresets.medium

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
    this.solidMaterialCache.clear()
    this.bakedMaterialCache.clear()
    this.unlitMaterialCache.clear()
    this.sunlitMaterialCache.clear()
    this.lightmappedMaterialCache.clear()
    this.lightmappedMaterialEntries.clear()
    this.textureCache.clear()
    this.whiteTexture = null
  }

  getWhiteTexture() {
    if (this.whiteTexture) {
      return this.whiteTexture
    }

    const data = new Uint8Array([255, 255, 255, 255])
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)

    texture.name = 'AquaWhiteTexture'
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    this.whiteTexture = texture
    this.textures.add(texture)

    return texture
  }
}

const TEXTURE_FILTERS = {
  NearestFilter: THREE.NearestFilter,
  NearestMipmapNearestFilter: THREE.NearestMipmapNearestFilter,
  NearestMipmapLinearFilter: THREE.NearestMipmapLinearFilter,
  LinearFilter: THREE.LinearFilter,
  LinearMipmapNearestFilter: THREE.LinearMipmapNearestFilter,
  LinearMipmapLinearFilter: THREE.LinearMipmapLinearFilter,
}

function mergeQualityPresets(overrides = {}) {
  const merged = {}
  const keys = new Set([...Object.keys(QUALITY_PRESETS), ...Object.keys(overrides || {})])

  for (const key of keys) {
    const fallback = QUALITY_PRESETS[key] || QUALITY_PRESETS.medium
    const override = isPlainObject(overrides?.[key]) ? overrides[key] : {}

    merged[key] = {
      shadeSteps: readNumber(override.shadeSteps, fallback.shadeSteps),
      ambientStrength: readNumber(override.ambientStrength, fallback.ambientStrength),
      lightStrength: readNumber(override.lightStrength, fallback.lightStrength),
      fogStrength: readNumber(override.fogStrength, fallback.fogStrength),
      ditherStrength: readNumber(override.ditherStrength, fallback.ditherStrength),
    }
  }

  return merged
}

function mergeTextureQualityPresets(overrides = {}) {
  const merged = {}
  const keys = new Set([...Object.keys(TEXTURE_QUALITY_PRESETS), ...Object.keys(overrides || {})])

  for (const key of keys) {
    const fallback = TEXTURE_QUALITY_PRESETS[key] || TEXTURE_QUALITY_PRESETS.medium
    const override = isPlainObject(overrides?.[key]) ? overrides[key] : {}

    merged[key] = {
      anisotropy: Math.max(1, Math.floor(readNumber(override.anisotropy, fallback.anisotropy))),
      minFilter: readTextureFilter(override.minFilter, fallback.minFilter),
      magFilter: readTextureFilter(override.magFilter, fallback.magFilter),
      generateMipmaps: readBoolean(override.generateMipmaps, fallback.generateMipmaps),
    }
  }

  return merged
}

function readTextureFilter(value, fallback) {
  if (typeof value === 'string' && TEXTURE_FILTERS[value]) {
    return TEXTURE_FILTERS[value]
  }

  if (Number.isFinite(value)) {
    return value
  }

  return fallback
}

function createDirectionVector(value, fallback) {
  return vectorFromArray(value, fallback).normalize()
}

function setUniformValue(material, uniformName, value) {
  if (material?.uniforms?.[uniformName]) {
    material.uniforms[uniformName].value = value
  }
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function readBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }

  return fallback
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function stripBlenderDuplicateSuffix(name) {
  return String(name).replace(/([._])\d{3}$/, '')
}

function stripExportPlaceholderSuffix(name) {
  return String(name).replace(/_p$/, '')
}

function normalizeColorKey(color) {
  return new THREE.Color(color || '#ffffff').getHexString()
}

function resolveTextureUrl(source, textureQuality, sizeFolders) {
  if (typeof source === 'string') {
    return getTextureVariantUrl(source, textureQuality, sizeFolders)
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

function createTextureCacheKey(url, color, repeat) {
  const repeatX = Number(repeat?.[0]) || 1
  const repeatY = Number(repeat?.[1]) || 1

  return `${url}|color:${color ? 1 : 0}|repeat:${repeatX},${repeatY}`
}

function getTextureVariantUrl(url, textureQuality, sizeFolders) {
  const sizeFolderUrl = getTextureSizeFolderUrl(url, textureQuality, sizeFolders)

  if (sizeFolderUrl) {
    return sizeFolderUrl
  }

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

function getTextureSizeFolderUrl(url, textureQuality, sizeFolders) {
  const targetFolder = sizeFolders?.[textureQuality]

  if (!targetFolder) {
    return null
  }

  const queryIndex = url.search(/[?#]/)
  const pathPart = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : url.slice(queryIndex)
  const nextPathPart = pathPart.replace(
    /\/assets\/textures\/(?:1024x1024|512x512|256x256|128x128)\//,
    `/assets/textures/${targetFolder}/`,
  )

  return nextPathPart === pathPart ? null : `${nextPathPart}${queryPart}`
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

function getTextureRepeat(texture) {
  if (!texture?.repeat) {
    return new THREE.Vector2(1, 1)
  }

  return texture.repeat.clone()
}

function createSunlitMaterialCacheKey(lighting) {
  return [
    vectorKey(lighting.sunDirection),
    vectorKey(lighting.sunColor),
    Number(lighting.sunIntensity) || 1,
    vectorKey(lighting.ambientColor),
    Number(lighting.ambientIntensity) || 0,
  ].join('|')
}

function vectorKey(value) {
  if (!Array.isArray(value)) {
    return ''
  }

  return value.slice(0, 3).map((entry) => Number(entry) || 0).join(',')
}

function colorFromArray(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Color(
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0,
    )
  }

  return new THREE.Color(fallback)
}

function vectorFromArray(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    const vector = new THREE.Vector3(
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0,
    )

    if (vector.lengthSq() > 0.000001) {
      return vector.normalize()
    }
  }

  return fallback.clone().normalize()
}

function collectMaterialTextures(material, target) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      collectMaterialTextures(entry, target)
    }

    return
  }

  if (!material) {
    return
  }

  for (const property of MATERIAL_TEXTURE_PROPERTIES) {
    const texture = material[property]

    if (texture?.isTexture) {
      target.add(texture)
    }
  }

  if (material.uniforms) {
    for (const uniform of Object.values(material.uniforms)) {
      const texture = uniform?.value

      if (texture?.isTexture) {
        target.add(texture)
      }
    }
  }
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
