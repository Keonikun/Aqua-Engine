import * as THREE from 'three'
import { EngineConsole } from '../config/EngineConsole.js'

export const DEFAULT_AUDIO_MANIFEST_URL = '/assets/audio/audio.json'

const AUDIO_SCHEMA = 'aqua.audio_manifest.v1'
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus', '.webm'])

export class AudioAssetLoader {
  constructor({
    audioLoader = new THREE.AudioLoader(),
    fetchJson = (...args) => fetch(...args),
    manifestUrl = DEFAULT_AUDIO_MANIFEST_URL,
  } = {}) {
    this.audioLoader = audioLoader
    this.fetchJson = fetchJson
    this.manifestUrl = manifestUrl
    this.manifestPromise = null
    this.bufferCache = new Map()
  }

  async loadManifest() {
    if (this.manifestPromise) {
      return this.manifestPromise
    }

    const resolvedManifestUrl = resolveUrl(this.manifestUrl)

    this.manifestPromise = this.fetchJson(resolvedManifestUrl)
      .then(async (response) => {
        if (response.status === 404) {
          EngineConsole.warn('Audio manifest not found; direct audio URLs will still work', {
            manifestUrl: resolvedManifestUrl,
          })
          return createEmptyManifest(resolvedManifestUrl)
        }

        if (!response.ok) {
          throw new Error(`Failed to load audio manifest "${resolvedManifestUrl}": ${response.status}`)
        }

        const manifest = await response.json()

        if (manifest?.schema !== AUDIO_SCHEMA) {
          throw new Error(`Invalid Aqua audio manifest "${resolvedManifestUrl}"`)
        }

        manifest.url = resolvedManifestUrl
        manifest.audio = manifest.audio || {}
        manifest.footstepSets = manifest.footstepSets || {}
        return manifest
      })
      .catch((error) => {
        EngineConsole.error('Failed to load audio manifest', error, { manifestUrl: resolvedManifestUrl })
        return createEmptyManifest(resolvedManifestUrl)
      })

    return this.manifestPromise
  }

  async resolveAsset(assetRef, baseUrl = window.location.href) {
    const ref = normalizeAssetRef(assetRef)

    if (!ref) {
      return null
    }

    if (isAudioPath(ref) || isUrlLike(ref)) {
      const src = resolveUrl(ref, baseUrl)

      return {
        id: getUrlStem(src),
        displayName: getUrlStem(src),
        src,
        loop: true,
        volume: 1,
        tags: [],
      }
    }

    const manifest = await this.loadManifest()
    const entry = manifest.audio?.[ref]

    if (!entry?.src) {
      throw new Error(`Audio asset "${ref}" is not defined in ${this.manifestUrl}`)
    }

    return {
      id: ref,
      displayName: entry.displayName || entry.name || ref,
      src: resolveUrl(entry.src, manifest.url || this.manifestUrl),
      loop: entry.loop !== false,
      volume: readNumber(entry.volume, 1),
      tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
      metadata: { ...entry },
    }
  }

  async loadBuffer(assetRef, baseUrl = window.location.href) {
    const asset = await this.resolveAsset(assetRef, baseUrl)

    if (!asset) {
      return null
    }

    if (!this.bufferCache.has(asset.src)) {
      EngineConsole.info('Loading audio asset', {
        asset: asset.id,
        src: asset.src,
      })
      this.bufferCache.set(asset.src, this.audioLoader.loadAsync(asset.src))
    }

    return {
      asset,
      buffer: await this.bufferCache.get(asset.src),
    }
  }

  async resolveFootstepSet(setRef, baseUrl = window.location.href) {
    const ref = normalizeAssetRef(setRef)

    if (!ref) {
      return null
    }

    const manifest = await this.loadManifest()
    const entry = manifest.footstepSets?.[ref]

    if (!entry) {
      throw new Error(`Footstep set "${ref}" is not defined in ${this.manifestUrl}`)
    }

    const clips = Array.isArray(entry.clips) ? entry.clips : []

    if (clips.length === 0) {
      throw new Error(`Footstep set "${ref}" has no clips`)
    }

    return {
      id: ref,
      displayName: entry.displayName || entry.name || ref,
      clips: clips.map((clip) => resolveUrl(clip, manifest.url || baseUrl)),
      volume: readNumber(entry.volume, 1),
      tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
      metadata: { ...entry },
    }
  }

  async loadFootstepSet(setRef, baseUrl = window.location.href) {
    const set = await this.resolveFootstepSet(setRef, baseUrl)

    if (!set) {
      return null
    }

    const clips = await Promise.all(set.clips.map(async (src) => {
      if (!this.bufferCache.has(src)) {
        EngineConsole.info('Loading footstep audio clip', {
          set: set.id,
          src,
        })
        this.bufferCache.set(src, this.audioLoader.loadAsync(src))
      }

      return {
        src,
        buffer: await this.bufferCache.get(src),
      }
    }))

    return {
      set,
      clips: clips.filter((clip) => clip?.buffer),
    }
  }
}

function createEmptyManifest(url) {
  return {
    schema: AUDIO_SCHEMA,
    url,
    audio: {},
    footstepSets: {},
  }
}

function normalizeAssetRef(assetRef) {
  if (typeof assetRef !== 'string') {
    return ''
  }

  return assetRef.trim()
}

function isUrlLike(value) {
  return /^https?:\/\//i.test(value) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
}

function isAudioPath(value) {
  const pathname = getUrlPathname(value).toLowerCase()
  const dotIndex = pathname.lastIndexOf('.')

  if (dotIndex === -1) {
    return false
  }

  return AUDIO_EXTENSIONS.has(pathname.slice(dotIndex))
}

function getUrlStem(url) {
  const pathname = getUrlPathname(url)
  const filename = pathname.split('/').pop() || ''

  return filename.replace(/\.[^/.]+$/, '') || 'audio'
}

function getUrlPathname(url) {
  try {
    return new URL(url, window.location.href).pathname
  } catch {
    return String(url || '').split(/[?#]/)[0]
  }
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function resolveUrl(url, baseUrl = window.location.href) {
  return new URL(url, new URL(baseUrl || window.location.href, window.location.href)).toString()
}
