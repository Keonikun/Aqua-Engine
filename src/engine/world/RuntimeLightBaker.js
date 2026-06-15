import * as THREE from 'three'

const DEFAULT_SETTINGS = {
  ambientColor: '#8aa7bd',
  ambientIntensity: 0.22,
  sunColor: '#fff2d0',
  sunIntensity: 1.15,
  sunDirection: [-0.55, 0.82, 0.35],
  bounces: 0,
  bounceStrength: 0.42,
  exposure: 1,
  minLight: 0.035,
  maxLight: 2.4,
  normalBias: 0.025,
  shadowDistance: 96,
  patchDistance: 18,
  batchSize: 96,
  useDefaultLights: true,
}

export async function bakeRuntimeLighting({
  meshes,
  shadowMeshes,
  sourceScene,
  settings: overrides = {},
  onProgress = () => {},
} = {}) {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...overrides })
  const bakeMeshes = (meshes || []).filter((mesh) => mesh?.isMesh && mesh.geometry?.getAttribute('position'))
  const bakeMeshSet = new Set(bakeMeshes)
  const shadowSourceMeshes = Array.isArray(shadowMeshes) && shadowMeshes.length > 0 ? shadowMeshes : bakeMeshes
  const shadowOnlyMeshes = shadowSourceMeshes.filter((mesh) =>
    mesh?.isMesh &&
    mesh.geometry?.getAttribute('position') &&
    !bakeMeshSet.has(mesh)
  )

  onProgress({
    stage: 'lighting:collect',
    label: 'Collecting bake samples',
    progress: 0,
    detail: `${bakeMeshes.length} receiver(s), ${shadowOnlyMeshes.length} shadow caster(s)`,
  })

  const surfaces = bakeMeshes.map((mesh) => createBakeSurface(mesh))
  const shadowSurfaces = shadowOnlyMeshes.map((mesh) => createBakeSurface(mesh))
  const triangles = buildTriangles([...surfaces, ...shadowSurfaces])
  const lights = collectRuntimeLights(sourceScene, settings)
  const sampleCount = surfaces.reduce((sum, surface) => sum + surface.worldPositions.length, 0)

  await yieldToBrowser()
  await computeDirectLighting({ surfaces, lights, triangles, settings, onProgress, sampleCount })
  await computeBounceLighting({ surfaces, triangles, settings, onProgress, sampleCount })

  onProgress({
    stage: 'lighting:finalize',
    label: 'Finalizing baked colors',
    progress: 0.98,
    detail: `${sampleCount} sample(s)`,
  })

  await yieldToBrowser()

  const output = createLightingOutput({
    settings,
    lights,
    surfaces,
    triangles,
  })

  onProgress({
    stage: 'lighting:done',
    label: 'Baked lighting ready',
    progress: 1,
    detail: `${sampleCount} sample(s)`,
  })

  return output
}

function normalizeSettings(settings) {
  return {
    ...settings,
    bounces: Math.max(0, Math.floor(Number(settings.bounces) || 0)),
    batchSize: Math.max(16, Math.floor(Number(settings.batchSize) || DEFAULT_SETTINGS.batchSize)),
    bounceStrength: Math.max(0, Number(settings.bounceStrength) || 0),
    exposure: Math.max(0, Number(settings.exposure) || 0),
    minLight: Math.max(0, Number(settings.minLight) || 0),
    maxLight: Math.max(Number(settings.maxLight) || DEFAULT_SETTINGS.maxLight, Number(settings.minLight) || 0),
    normalBias: Math.max(0.0001, Number(settings.normalBias) || DEFAULT_SETTINGS.normalBias),
    shadowDistance: Math.max(0.1, Number(settings.shadowDistance) || DEFAULT_SETTINGS.shadowDistance),
    patchDistance: Math.max(0.1, Number(settings.patchDistance) || DEFAULT_SETTINGS.patchDistance),
  }
}

function createBakeSurface(mesh) {
  mesh.updateWorldMatrix(true, false)

  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  let normal = geometry.getAttribute('normal')

  if (!normal) {
    geometry.computeVertexNormals()
    normal = geometry.getAttribute('normal')
  }

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const worldPositions = []
  const worldNormals = []

  for (let i = 0; i < position.count; i += 1) {
    worldPositions.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    worldNormals.push(new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize())
  }

  const aliases = getBakeAliases(mesh)

  return {
    name: aliases[0] || mesh.name || 'aqua_surface',
    aliases,
    brushType: getString(mesh.userData, 'aqua_brush_type', 'aquaBrushType') || mesh.userData?.brushType || 'mesh',
    extras: mesh.userData || {},
    geometry,
    albedo: getMaterialAlbedo(mesh.material, mesh.userData),
    worldPositions,
    worldNormals,
    direct: createVectorArray(position.count),
    indirect: createVectorArray(position.count),
  }
}

function getBakeAliases(mesh) {
  const aliases = new Set()
  const bakeId = getString(mesh.userData, 'aqua_bake_id', 'aquaBakeId')

  if (bakeId) {
    aliases.add(bakeId)
    aliases.add(sanitizeRuntimeName(bakeId))
  }

  if (mesh.name) {
    aliases.add(mesh.name)
    aliases.add(restoreBlenderSuffixName(mesh.name))
    aliases.add(sanitizeRuntimeName(mesh.name))
  }

  return [...aliases].filter(Boolean)
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
      const edge1 = new THREE.Vector3().subVectors(b, a)
      const edge2 = new THREE.Vector3().subVectors(c, a)
      const normal = new THREE.Vector3().crossVectors(edge1, edge2)
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
        edge1,
        edge2,
        center: new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3),
        normal,
        area: doubleArea * 0.5,
        emit: new THREE.Vector3(),
      })
    }
  }

  return triangles
}

function collectRuntimeLights(sourceScene, settings) {
  const lights = []

  sourceScene?.updateMatrixWorld(true)
  sourceScene?.traverse((object) => {
    const extrasType = getString(object.userData, 'aqua_light_type', 'aquaLightType')?.toLowerCase()

    if (extrasType === 'ambient') {
      const extrasLight = createLightFromExtras(object)

      if (extrasLight) {
        lights.push(extrasLight)
      }

      return
    }

    const objectLight = createLightFromThreeObject(object)

    if (objectLight) {
      lights.push(objectLight)
      return
    }

    const extrasLight = createLightFromExtras(object)

    if (extrasLight) {
      lights.push(extrasLight)
    }
  })

  if (settings.useDefaultLights) {
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

function createLightFromExtras(object) {
  const type = getString(object.userData, 'aqua_light_type', 'aquaLightType')

  if (!type) {
    return null
  }

  const lightType = type.toLowerCase()
  const color = colorFrom(getValue(object.userData, 'aqua_light_color', 'aquaLightColor') || '#ffffff')
  const intensity = getNumber(object.userData, 'aqua_light_intensity', 'aquaLightIntensity') ?? 1
  const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)

  if (lightType === 'ambient') {
    return {
      name: object.name || 'aqua_ambient',
      type: 'ambient',
      color,
      intensity,
    }
  }

  if (lightType === 'sun' || lightType === 'directional') {
    return {
      name: object.name || 'aqua_sun',
      type: 'directional',
      color,
      intensity,
      direction: directionFromExtras(object.userData, object.matrixWorld),
    }
  }

  if (lightType === 'point') {
    return {
      name: object.name || 'aqua_point',
      type: 'point',
      color,
      intensity,
      position,
      range: getNumber(object.userData, 'aqua_light_range', 'aquaLightRange') || 10,
    }
  }

  if (lightType === 'spot') {
    return {
      name: object.name || 'aqua_spot',
      type: 'spot',
      color,
      intensity,
      position,
      range: getNumber(object.userData, 'aqua_light_range', 'aquaLightRange') || 10,
      emissionDirection: new THREE.Vector3(0, 0, -1).transformDirection(object.matrixWorld).normalize(),
      innerCone: getNumber(object.userData, 'aqua_light_inner_cone', 'aquaLightInnerCone') ?? Math.PI / 8,
      outerCone: getNumber(object.userData, 'aqua_light_outer_cone', 'aquaLightOuterCone') ?? Math.PI / 4,
    }
  }

  return null
}

function createLightFromThreeObject(object) {
  if (!object?.isLight) {
    return null
  }

  const color = colorFrom(object.color || '#ffffff')
  const intensity = object.intensity ?? 1
  const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)

  if (object.isAmbientLight || object.isHemisphereLight) {
    return {
      name: object.name || 'runtime_ambient',
      type: 'ambient',
      color,
      intensity,
    }
  }

  if (object.isDirectionalLight) {
    return {
      name: object.name || 'runtime_directional',
      type: 'directional',
      color,
      intensity,
      direction: new THREE.Vector3(0, 0, 1).transformDirection(object.matrixWorld).normalize(),
    }
  }

  if (object.isSpotLight) {
    return {
      name: object.name || 'runtime_spot',
      type: 'spot',
      color,
      intensity,
      position,
      range: object.distance || 10,
      emissionDirection: new THREE.Vector3(0, 0, -1).transformDirection(object.matrixWorld).normalize(),
      innerCone: object.penumbra ? object.angle * Math.max(1 - object.penumbra, 0) : 0,
      outerCone: object.angle || Math.PI / 4,
    }
  }

  if (object.isPointLight) {
    return {
      name: object.name || 'runtime_point',
      type: 'point',
      color,
      intensity,
      position,
      range: object.distance || 10,
    }
  }

  return null
}

async function computeDirectLighting({ surfaces, lights, triangles, settings, onProgress, sampleCount }) {
  let completed = 0
  const scratch = createLightingScratch()

  for (const surface of surfaces) {
    for (let i = 0; i < surface.worldPositions.length; i += 1) {
      surface.direct[i].copy(sampleDirectLighting({
        position: surface.worldPositions[i],
        normal: surface.worldNormals[i],
        surface,
        lights,
        triangles,
        settings,
        scratch,
      }))

      completed += 1

      if (completed % settings.batchSize === 0) {
        onProgress({
          stage: 'lighting:direct',
          label: 'Baking direct light',
          progress: sampleCount > 0 ? completed / sampleCount : 1,
          detail: `${completed}/${sampleCount} sample(s)`,
        })
        await yieldToBrowser()
      }
    }
  }

  onProgress({
    stage: 'lighting:direct',
    label: 'Baking direct light',
    progress: 1,
    detail: `${sampleCount}/${sampleCount} sample(s)`,
  })
}

function sampleDirectLighting({ position, normal, surface, lights, triangles, settings, scratch }) {
  const result = scratch.result.set(0, 0, 0)
  const origin = scratch.origin.copy(position).addScaledVector(normal, settings.normalBias)

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

      if (isOccluded(origin, light.direction, settings.shadowDistance, triangles, surface, settings, scratch)) {
        continue
      }

      result.addScaledVector(light.color, light.intensity * ndl)
      continue
    }

    const toLight = scratch.toLight.subVectors(light.position, origin)
    const distance = toLight.length()

    if (distance <= 1e-5 || distance > light.range) {
      continue
    }

    const direction = scratch.direction.copy(toLight).multiplyScalar(1 / distance)
    const ndl = Math.max(normal.dot(direction), 0)

    if (ndl <= 0) {
      continue
    }

    let attenuation = smoothDistanceAttenuation(distance, light.range)

    if (light.type === 'spot') {
      const cone = light.emissionDirection.dot(scratch.reverseDirection.copy(direction).multiplyScalar(-1))
      const inner = Math.cos(light.innerCone)
      const outer = Math.cos(light.outerCone)
      const spotScale = THREE.MathUtils.smoothstep(cone, outer, inner)

      if (spotScale <= 0) {
        continue
      }

      attenuation *= spotScale
    }

    if (!isOccluded(origin, direction, distance - settings.normalBias, triangles, surface, settings, scratch)) {
      result.addScaledVector(light.color, light.intensity * ndl * attenuation)
    }
  }

  return scratch.output.copy(result)
}

function smoothDistanceAttenuation(distance, range) {
  const falloff = Math.max(1 - distance / Math.max(range, 1e-5), 0)

  return falloff * falloff
}

async function computeBounceLighting({ surfaces, triangles, settings, onProgress, sampleCount }) {
  if (settings.bounces <= 0 || settings.bounceStrength <= 0) {
    return
  }

  seedPatchEmission(triangles, 'direct', settings)

  for (let bounce = 0; bounce < settings.bounces; bounce += 1) {
    const received = new Map()
    let completed = 0
    const scratch = createLightingScratch()

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
          scratch,
        })

        surfaceReceived[i].copy(bounced)
        surface.indirect[i].add(bounced)
        completed += 1

        if (completed % settings.batchSize === 0) {
          onProgress({
            stage: 'lighting:bounce',
            label: `Baking bounce ${bounce + 1}`,
            progress: sampleCount > 0 ? (bounce + completed / sampleCount) / settings.bounces : 1,
            detail: `${completed}/${sampleCount} sample(s)`,
          })
          await yieldToBrowser()
        }
      }
    }

    seedPatchEmission(triangles, received, settings)
    onProgress({
      stage: 'lighting:bounce',
      label: `Baking bounce ${bounce + 1}`,
      progress: (bounce + 1) / settings.bounces,
      detail: `${sampleCount}/${sampleCount} sample(s)`,
    })
    await yieldToBrowser()
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

function gatherPatchLighting({ position, normal, surface, triangles, settings, scratch }) {
  const result = scratch.result.set(0, 0, 0)
  const origin = scratch.origin.copy(position).addScaledVector(normal, settings.normalBias)
  const maxDistanceSq = settings.patchDistance * settings.patchDistance

  for (const patch of triangles) {
    if (patch.emit.lengthSq() <= 1e-8) {
      continue
    }

    const toPatch = scratch.toLight.subVectors(patch.center, origin)
    const distanceSq = toPatch.lengthSq()

    if (distanceSq <= settings.normalBias * settings.normalBias || distanceSq > maxDistanceSq) {
      continue
    }

    const distance = Math.sqrt(distanceSq)
    const direction = scratch.direction.copy(toPatch).multiplyScalar(1 / distance)
    const receiverTerm = Math.max(normal.dot(direction), 0)

    if (receiverTerm <= 0) {
      continue
    }

    const emitterTerm = Math.max(patch.normal.dot(scratch.reverseDirection.copy(direction).multiplyScalar(-1)), 0)

    if (emitterTerm <= 0) {
      continue
    }

    if (isOccluded(origin, direction, distance - settings.normalBias, triangles, surface, settings, scratch)) {
      continue
    }

    const formFactor = receiverTerm * emitterTerm * patch.area / (Math.PI * distanceSq)
    result.addScaledVector(patch.emit, formFactor)
  }

  return scratch.output.copy(result)
}

function isOccluded(origin, direction, maxDistance, triangles, sourceSurface, settings, scratch) {
  if (maxDistance <= settings.normalBias) {
    return false
  }

  for (const triangle of triangles) {
    const hit = intersectRayTriangle(origin, direction, triangle, scratch)

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

function intersectRayTriangle(origin, direction, triangle, scratch) {
  const pvec = scratch.pvec.crossVectors(direction, triangle.edge2)
  const det = triangle.edge1.dot(pvec)

  if (Math.abs(det) < 1e-8) {
    return Number.NaN
  }

  const invDet = 1 / det
  const tvec = scratch.tvec.subVectors(origin, triangle.a)
  const u = tvec.dot(pvec) * invDet

  if (u < 0 || u > 1) {
    return Number.NaN
  }

  const qvec = scratch.qvec.crossVectors(tvec, triangle.edge1)
  const v = direction.dot(qvec) * invDet

  if (v < 0 || u + v > 1) {
    return Number.NaN
  }

  const distance = triangle.edge2.dot(qvec) * invDet

  return distance > 0 ? distance : Number.NaN
}

function createLightingOutput({ settings, lights, surfaces, triangles }) {
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
    source: 'runtime',
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
    intensity: round(light.intensity),
  }

  if (light.position) {
    serialized.position = vectorToRoundedArray(light.position)
  }

  if (light.direction) {
    serialized.direction = vectorToRoundedArray(light.direction)
  }

  if (light.range) {
    serialized.range = round(light.range)
  }

  return serialized
}

function vectorToRoundedArray(vector) {
  return [round(vector.x), round(vector.y), round(vector.z)]
}

function round(value) {
  return Math.round(value * 10000) / 10000
}

function getMaterialAlbedo(material, userData) {
  const color = getValue(userData, 'aqua_color', 'aquaColor')

  if (color) {
    return colorFrom(color)
  }

  if (Array.isArray(material)) {
    const albedo = new THREE.Vector3()
    const entries = material.filter(Boolean)

    for (const entry of entries) {
      albedo.add(getMaterialAlbedo(entry, null))
    }

    return entries.length > 0 ? albedo.multiplyScalar(1 / entries.length) : new THREE.Vector3(0.78, 0.78, 0.78)
  }

  if (material?.color?.isColor) {
    return colorFrom(material.color)
  }

  const uniformColor = material?.uniforms?.uBaseColor?.value

  if (uniformColor?.isColor) {
    return colorFrom(uniformColor)
  }

  return new THREE.Vector3(0.78, 0.78, 0.78)
}

function colorFrom(value) {
  if (value?.isVector3) {
    return value.clone()
  }

  if (value?.isColor) {
    return new THREE.Vector3(value.r, value.g, value.b)
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

function directionFromExtras(extras, worldMatrix) {
  const direction = getValue(extras, 'aqua_light_direction', 'aquaLightDirection')

  if (Array.isArray(direction) && direction.length >= 3) {
    return new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
  }

  return new THREE.Vector3(0, 0, 1).transformDirection(worldMatrix).normalize()
}

function createLightingScratch() {
  return {
    result: new THREE.Vector3(),
    output: new THREE.Vector3(),
    origin: new THREE.Vector3(),
    toLight: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    reverseDirection: new THREE.Vector3(),
    pvec: new THREE.Vector3(),
    tvec: new THREE.Vector3(),
    qvec: new THREE.Vector3(),
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
    if (userData && userData[key] !== undefined) {
      return userData[key]
    }
  }

  return null
}

function sanitizeRuntimeName(name) {
  return String(name).replace(/\s/g, '_').replace(/[\[\]\.:/]/g, '')
}

function restoreBlenderSuffixName(name) {
  return String(name)
    .replace(/_(\d{3})$/, '.$1')
    .replace(/([^\d])(\d{3})$/, '$1.$2')
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}
