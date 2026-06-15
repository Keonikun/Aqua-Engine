import * as THREE from 'three'
import { EngineConsole } from '../config/EngineConsole.js'

export function applyBakedLighting(mesh, bakedLighting, materials, resources) {
  const entry = findBakedLightingEntry(mesh, bakedLighting)

  if (!entry || !mesh.geometry) {
    return
  }

  if (bakedLighting.schema === 'aqua.lightmap.v2') {
    applyTextureLightmap(mesh, entry, bakedLighting, materials, resources)
    return
  }

  applyVertexBakedLighting(mesh, entry, bakedLighting, materials)
}

export function getBakedLightingEntries(bakedLighting) {
  return bakedLighting?.surfaces || bakedLighting?.meshes || null
}

function applyTextureLightmap(mesh, entry, bakedLighting, materials, resources) {
  const lightmap = entry.lightmap

  if (!lightmap?.image || !Array.isArray(lightmap.uv2)) {
    return
  }

  if (mesh.geometry.index) {
    mesh.geometry = mesh.geometry.toNonIndexed()
    resources?.trackGeometry(mesh.geometry)
  }

  ensureUv(mesh.geometry)

  const position = mesh.geometry.getAttribute('position')

  if (!position || lightmap.uv2.length !== position.count * 2) {
    EngineConsole.warn(
      `Skipping texture lightmap for "${mesh.name}": expected ${position ? position.count * 2 : 0} uv values, got ${lightmap.uv2.length}.`
    )
    return
  }

  mesh.geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(lightmap.uv2, 2))
  mesh.userData.bakedLighting = {
    source: bakedLighting.source || null,
    schema: bakedLighting.schema,
    image: lightmap.image,
  }

  if (materials?.createLightmappedMaterial && materials?.loadLightmapTexture) {
    const lightmapUrl = resolveUrl(lightmap.image, bakedLighting.url || bakedLighting.sourceUrl || window.location.href)
    const lightmapTexture = materials.loadLightmapTexture(lightmapUrl)

    mesh.material = materials.createLightmappedMaterial(mesh.material, lightmapTexture, {
      intensity: lightmap.intensity ?? 1,
    })
  }
}

function applyVertexBakedLighting(mesh, entry, bakedLighting, materials) {
  if (!entry?.colors || !mesh.geometry) {
    return
  }

  const position = mesh.geometry.getAttribute('position')

  if (!position || entry.colors.length !== position.count * 3) {
      EngineConsole.warn(
        `Skipping baked lighting for "${mesh.name}": expected ${position ? position.count * 3 : 0} color values, got ${entry.colors.length}.`
      )
    return
  }

  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(entry.colors, 3))
  mesh.userData.bakedLighting = {
    source: bakedLighting.source || null,
    schema: bakedLighting.schema,
  }

  if (materials?.createBakedMaterial) {
    mesh.material = materials.createBakedMaterial(mesh.material)
  }
}

function findBakedLightingEntry(mesh, bakedLighting) {
  const meshes = getBakedLightingEntries(bakedLighting)

  if (!meshes) {
    return null
  }

  for (const key of getBakedLightingKeys(mesh)) {
    if (meshes[key]) {
      return meshes[key]
    }
  }

  for (const entry of Object.values(meshes)) {
    if (!Array.isArray(entry.aliases)) {
      continue
    }

    if (entry.aliases.some((alias) => getBakedLightingKeys(mesh).includes(alias))) {
      return entry
    }
  }

  return null
}

function getBakedLightingKeys(mesh) {
  const keys = new Set()
  const bakeId = getString(mesh.userData, 'aqua_bake_id', 'aquaBakeId')

  if (bakeId) {
    keys.add(bakeId)
    keys.add(sanitizeRuntimeName(bakeId))
  }

  if (mesh.name) {
    keys.add(mesh.name)
    keys.add(restoreBlenderSuffixName(mesh.name))
    keys.add(sanitizeRuntimeName(mesh.name))
  }

  return [...keys].filter(Boolean)
}

function sanitizeRuntimeName(name) {
  return String(name).replace(/\s/g, '_').replace(/[\[\]\.:/]/g, '')
}

function restoreBlenderSuffixName(name) {
  return String(name)
    .replace(/_(\d{3})$/, '.$1')
    .replace(/([^\d])(\d{3})$/, '$1.$2')
}

function ensureUv(geometry) {
  if (!geometry || geometry.attributes?.uv) {
    return
  }

  const position = geometry.getAttribute('position')

  if (!position) {
    return
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2))
}

function getString(userData, ...keys) {
  for (const key of keys) {
    if (typeof userData?.[key] === 'string') {
      return userData[key]
    }
  }

  return null
}

function resolveUrl(url, baseUrl = window.location.href) {
  return new URL(url, new URL(baseUrl || window.location.href, window.location.href)).toString()
}
