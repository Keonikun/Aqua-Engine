import * as THREE from 'three'
import { EngineConsole } from '../config/EngineConsole.js'
import { AudioAssetLoader } from './AudioAssetLoader.js'

const DEFAULT_AMBIENT_FADE_IN = 1.25
const DEFAULT_AMBIENT_FADE_OUT = 1.25
const DEFAULT_POSITIONAL_RANGE = 14
const DEFAULT_POSITIONAL_REF_DISTANCE = 1.5
const DEFAULT_POSITIONAL_ROLLOFF = 1
const DEFAULT_FOOTSTEP_SET = 'outdoor'
const DEFAULT_FOOTSTEP_STEP_DISTANCE = 1.45
const DEFAULT_FOOTSTEP_START_DISTANCE = 0.45
const DEFAULT_FOOTSTEP_MIN_SPEED = 0.8
const DEFAULT_FOOTSTEP_PAN = 0.32
const DEFAULT_FOOTSTEP_PAN_JITTER = 0.04
const DEFAULT_FOOTSTEP_VOLUME_JITTER = 0.12
const DEFAULT_FOOTSTEP_RATE_JITTER = 0.05

const scratchMatrix = new THREE.Matrix4()

export class AudioSystem {
  constructor({
    camera,
    canvas = null,
    assetLoader = null,
    config = {},
  } = {}) {
    this.config = normalizeAudioConfig(config)
    this.camera = camera
    this.canvas = canvas
    this.assetLoader = assetLoader || new AudioAssetLoader({
      manifestUrl: this.config.manifestUrl,
    })
    this.listener = new THREE.AudioListener()
    this.group = new THREE.Group()
    this.group.name = 'WorldAudio'
    this.positionalSources = []
    this.ambientChannels = new Map()
    this.activeAmbientTriggers = new Map()
    this.activeFootstepNodes = new Set()
    this.footstepState = {
      loadPromise: null,
      setId: null,
      set: null,
      clips: [],
      distance: 0,
      moving: false,
      nextFoot: -1,
      lastClipIndex: -1,
    }
    this.currentAmbientKey = null
    this.pendingStarts = new Set()
    this.enterSequence = 0
    this.masterVolume = this.config.masterVolume
    this.disposed = false

    this.onUnlockInput = () => this.resumeContext()

    if (this.camera?.add) {
      this.camera.add(this.listener)
    }

    this.installUnlockHandlers()
    this.preloadFootsteps()
  }

  async loadMapAudio(audioRefs = []) {
    this.clearPositionalSources()

    const positionalRefs = audioRefs.filter((ref) => ref?.type === 'positional' && ref.asset)

    if (positionalRefs.length === 0) {
      return { positionalSources: 0 }
    }

    const sources = await Promise.all(positionalRefs.map((ref) => this.createPositionalSource(ref)))

    for (const source of sources) {
      if (!source) {
        continue
      }

      this.positionalSources.push(source)
      this.group.add(source)
    }

    EngineConsole.info('Loaded map audio sources', {
      positionalSources: this.positionalSources.length,
    })

    return { positionalSources: this.positionalSources.length }
  }

  update(deltaTime, { triggerEvents = [], playerState = null } = {}) {
    this.processTriggerEvents(triggerEvents)
    this.updateAmbientSelection()
    this.updateChannelFades(deltaTime)
    this.updateFootsteps(deltaTime, playerState)
  }

  getDebugState() {
    return {
      positionalSources: this.positionalSources.length,
      activeAmbientTriggers: this.activeAmbientTriggers.size,
      ambientChannels: this.ambientChannels.size,
      currentAmbient: this.currentAmbientKey,
      footstepSet: this.footstepState.setId,
      footstepClips: this.footstepState.clips.length,
      activeFootsteps: this.activeFootstepNodes.size,
      contextState: this.listener?.context?.state || 'unknown',
    }
  }

  dispose() {
    this.disposed = true
    this.removeUnlockHandlers()
    this.clearPositionalSources()

    for (const channel of this.ambientChannels.values()) {
      stopAudio(channel.sound)
    }

    this.ambientChannels.clear()
    this.activeAmbientTriggers.clear()
    this.stopActiveFootsteps()
    this.currentAmbientKey = null

    if (this.camera?.remove) {
      this.camera.remove(this.listener)
    }
  }

  async createPositionalSource(ref) {
    let loaded = null

    try {
      loaded = await this.assetLoader.loadBuffer(ref.asset, ref.mapUrl)
    } catch (error) {
      EngineConsole.error('Skipping positional audio source because asset failed to load', error, { ref })
      return null
    }

    if (!loaded?.buffer) {
      return null
    }

    const sound = new THREE.PositionalAudio(this.listener)
    const positionalDefaults = this.config.positional
    const assetVolume = readNumber(loaded.asset.volume, positionalDefaults.volume)
    const volume = clamp01(readNumber(ref.volume, assetVolume))
    const range = Math.max(readNumber(ref.range, positionalDefaults.range), 0.01)
    const refDistance = Math.max(readNumber(ref.refDistance, positionalDefaults.refDistance), 0.01)

    sound.name = ref.name || loaded.asset.id || 'audio_source'
    sound.setBuffer(loaded.buffer)
    sound.setLoop(readBoolean(ref.loop, loaded.asset.loop !== false))
    sound.setVolume(volume * this.masterVolume)
    sound.setRefDistance(refDistance)
    sound.setRolloffFactor(Math.max(readNumber(ref.rolloff, positionalDefaults.rolloff), 0))
    sound.setDistanceModel(ref.distanceModel || positionalDefaults.distanceModel)
    sound.setMaxDistance(range)
    applyMatrix(sound, ref.matrix)
    sound.userData = {
      audio: {
        type: 'positional',
        asset: loaded.asset,
        range,
        refDistance,
        volume,
      },
      source: cloneUserData(ref.userData),
    }
    this.startOrQueue(sound)
    return sound
  }

  processTriggerEvents(triggerEvents) {
    for (const event of triggerEvents) {
      const settings = readAmbientTriggerSettings(event, this.config.ambient)

      if (!settings) {
        continue
      }

      if (event.phase === 'exit') {
        this.activeAmbientTriggers.delete(event.id)
        continue
      }

      const existing = this.activeAmbientTriggers.get(event.id)

      this.activeAmbientTriggers.set(event.id, {
        ...settings,
        id: event.id,
        name: event.name,
        enteredAt: existing?.enteredAt ?? ++this.enterSequence,
      })
    }
  }

  updateAmbientSelection() {
    const next = selectAmbientTrigger(this.activeAmbientTriggers)
    const nextKey = next ? ambientChannelKey(next.asset) : null

    if (nextKey === this.currentAmbientKey) {
      if (next && this.ambientChannels.has(nextKey)) {
        this.fadeAmbientChannel(nextKey, next.volume, next.fadeIn, false)
      }
      return
    }

    if (this.currentAmbientKey) {
      const current = this.ambientChannels.get(this.currentAmbientKey)
      const fadeOut = current?.fadeOut ?? this.config.ambient.fadeOut

      this.fadeAmbientChannel(this.currentAmbientKey, 0, fadeOut, true)
    }

    this.currentAmbientKey = nextKey

    if (!next) {
      return
    }

    this.ensureAmbientChannel(next)
      .then((channel) => {
        if (!channel || this.currentAmbientKey !== nextKey || this.disposed) {
          return
        }

        channel.fadeOut = next.fadeOut
        this.fadeAmbientChannel(nextKey, next.volume, next.fadeIn, false)
      })
      .catch((error) => {
        EngineConsole.error('Failed to activate ambient audio trigger', error, { trigger: next })
      })
  }

  async ensureAmbientChannel(settings) {
    const key = ambientChannelKey(settings.asset)
    const existing = this.ambientChannels.get(key)

    if (existing) {
      return existing
    }

    const loaded = await this.assetLoader.loadBuffer(settings.asset, settings.mapUrl)

    if (!loaded?.buffer || this.disposed) {
      return null
    }

    const sound = new THREE.Audio(this.listener)
    const channel = {
      key,
      sound,
      asset: loaded.asset,
      volume: 0,
      targetVolume: 0,
      fadeStartVolume: 0,
      fadeElapsed: 0,
      fadeDuration: 0,
      fadeOut: settings.fadeOut,
      stopWhenSilent: true,
    }

    sound.name = `ambient_${loaded.asset.id || key}`
    sound.setBuffer(loaded.buffer)
    sound.setLoop(settings.loop ?? loaded.asset.loop !== false)
    sound.setVolume(0)
    sound.userData = {
      audio: {
        type: 'ambient',
        asset: loaded.asset,
      },
    }
    this.ambientChannels.set(key, channel)
    this.startOrQueue(sound)
    return channel
  }

  fadeAmbientChannel(key, targetVolume, duration, stopWhenSilent) {
    const channel = this.ambientChannels.get(key)

    if (!channel) {
      return
    }

    channel.fadeStartVolume = channel.volume
    channel.targetVolume = clamp01(targetVolume)
    channel.fadeDuration = Math.max(readNumber(duration, channel.fadeDuration), 0)
    channel.fadeElapsed = 0
    channel.stopWhenSilent = Boolean(stopWhenSilent)

    if (channel.targetVolume > 0) {
      this.startOrQueue(channel.sound)
    }
  }

  updateChannelFades(deltaTime) {
    const fadeDelta = Math.max(deltaTime || 0, 0)

    for (const channel of this.ambientChannels.values()) {
      if (channel.fadeDuration <= 0) {
        channel.volume = channel.targetVolume
      } else if (channel.volume !== channel.targetVolume) {
        channel.fadeElapsed = Math.min(channel.fadeElapsed + fadeDelta, channel.fadeDuration)
        const ratio = channel.fadeDuration > 0 ? channel.fadeElapsed / channel.fadeDuration : 1
        channel.volume = THREE.MathUtils.lerp(
          channel.fadeStartVolume,
          channel.targetVolume,
          smoothstep(ratio)
        )
      }

      channel.sound.setVolume(channel.volume * this.masterVolume)

      if (channel.targetVolume > 0) {
        this.startOrQueue(channel.sound)
      } else if (channel.stopWhenSilent && channel.volume <= 0.0001) {
        stopAudio(channel.sound)
      }
    }
  }

  preloadFootsteps() {
    if (!this.config.footsteps.enabled || !this.config.footsteps.set) {
      return
    }

    this.ensureFootstepSet().catch((error) => {
      EngineConsole.warn('Failed to preload footstep set', {
        set: this.config.footsteps.set,
        reason: error?.message || String(error),
      })
    })
  }

  async ensureFootstepSet() {
    const setId = this.config.footsteps.set

    if (!setId) {
      return null
    }

    if (this.footstepState.setId === setId && this.footstepState.clips.length > 0) {
      return this.footstepState
    }

    if (!this.footstepState.loadPromise || this.footstepState.setId !== setId) {
      this.footstepState.setId = setId
      this.footstepState.loadPromise = this.assetLoader.loadFootstepSet(setId)
    }

    const loaded = await this.footstepState.loadPromise

    if (!loaded?.clips?.length || this.disposed) {
      return null
    }

    this.footstepState.set = loaded.set
    this.footstepState.clips = loaded.clips

    return this.footstepState
  }

  updateFootsteps(deltaTime, playerState) {
    if (!this.config.footsteps.enabled || !playerState || playerState.noclip || !playerState.grounded) {
      this.resetFootstepMovement()
      return
    }

    const horizontalSpeed = Math.hypot(playerState.velocity?.x || 0, playerState.velocity?.z || 0)

    if (horizontalSpeed < this.config.footsteps.minSpeed) {
      this.resetFootstepMovement()
      return
    }

    if (!this.footstepState.moving) {
      this.footstepState.moving = true
      this.footstepState.distance = Math.max(
        this.config.footsteps.stepDistance - this.config.footsteps.startDistance,
        0
      )
    }

    this.footstepState.distance += horizontalSpeed * Math.max(deltaTime || 0, 0)

    while (this.footstepState.distance >= this.config.footsteps.stepDistance) {
      this.footstepState.distance -= this.config.footsteps.stepDistance
      this.playFootstep(horizontalSpeed)
    }
  }

  resetFootstepMovement() {
    this.footstepState.distance = 0
    this.footstepState.moving = false
  }

  playFootstep(horizontalSpeed) {
    if (!this.isContextRunning()) {
      this.resumeContext()
      return
    }

    if (this.footstepState.clips.length === 0) {
      this.ensureFootstepSet().catch((error) => {
        EngineConsole.warn('Failed to load footstep set', {
          set: this.config.footsteps.set,
          reason: error?.message || String(error),
        })
      })
      return
    }

    const context = this.listener?.context
    const input = this.listener?.getInput?.()
    const clip = this.pickFootstepClip()

    if (!context || !input || !clip?.buffer) {
      return
    }

    const source = context.createBufferSource()
    const gain = context.createGain()
    const panner = typeof context.createStereoPanner === 'function'
      ? context.createStereoPanner()
      : null
    const now = context.currentTime
    const footSide = this.footstepState.nextFoot
    const panJitter = randomSigned(this.config.footsteps.panJitter)
    const volumeJitter = 1 + randomSigned(this.config.footsteps.volumeJitter)
    const rateJitter = 1 + randomSigned(this.config.footsteps.playbackRateJitter)
    const speedRatio = THREE.MathUtils.clamp(horizontalSpeed / Math.max(this.config.footsteps.referenceSpeed, 0.01), 0.65, 1.25)
    const setVolume = readNumber(this.footstepState.set?.volume, 1)
    const volume = clamp01(this.config.footsteps.volume * setVolume * speedRatio * volumeJitter) * this.masterVolume

    this.footstepState.nextFoot *= -1
    source.buffer = clip.buffer
    source.playbackRate.setValueAtTime(THREE.MathUtils.clamp(rateJitter, 0.75, 1.25), now)
    gain.gain.setValueAtTime(volume, now)

    if (panner) {
      panner.pan.setValueAtTime(THREE.MathUtils.clamp(footSide * this.config.footsteps.pan + panJitter, -1, 1), now)
      source.connect(gain)
      gain.connect(panner)
      panner.connect(input)
    } else {
      source.connect(gain)
      gain.connect(input)
    }

    const activeNode = { source, gain, panner }

    this.activeFootstepNodes.add(activeNode)
    source.onended = () => this.disposeFootstepNode(activeNode)

    try {
      source.start(now)
    } catch (error) {
      this.disposeFootstepNode(activeNode)
      EngineConsole.warn('Footstep playback failed', {
        reason: error?.message || String(error),
      })
    }
  }

  pickFootstepClip() {
    const clips = this.footstepState.clips

    if (clips.length === 0) {
      return null
    }

    if (clips.length === 1) {
      this.footstepState.lastClipIndex = 0
      return clips[0]
    }

    let index = Math.floor(Math.random() * clips.length)

    if (index === this.footstepState.lastClipIndex) {
      index = (index + 1) % clips.length
    }

    this.footstepState.lastClipIndex = index
    return clips[index]
  }

  disposeFootstepNode(node) {
    if (!node) {
      return
    }

    node.source.onended = null

    for (const audioNode of [node.source, node.gain, node.panner]) {
      try {
        audioNode?.disconnect?.()
      } catch {
        // Nodes may already be disconnected by the browser after playback ends.
      }
    }

    this.activeFootstepNodes.delete(node)
  }

  stopActiveFootsteps() {
    for (const node of this.activeFootstepNodes) {
      try {
        node.source?.stop?.()
      } catch {
        // One-shot sources may have already ended.
      }

      this.disposeFootstepNode(node)
    }

    this.activeFootstepNodes.clear()
  }

  startOrQueue(sound) {
    if (!sound?.buffer) {
      return
    }

    if (this.isContextRunning()) {
      playAudio(sound)
      this.pendingStarts.delete(sound)
      return
    }

    this.pendingStarts.add(sound)
  }

  resumeContext() {
    const context = this.listener?.context

    if (!context || context.state === 'running') {
      this.flushPendingStarts()
      return
    }

    context.resume()
      .then(() => this.flushPendingStarts())
      .catch((error) => {
        EngineConsole.warn('Audio context resume failed', {
          reason: error?.message || String(error),
        })
      })
  }

  flushPendingStarts() {
    if (!this.isContextRunning()) {
      return
    }

    for (const sound of this.pendingStarts) {
      playAudio(sound)
    }

    this.pendingStarts.clear()
  }

  isContextRunning() {
    return this.listener?.context?.state === 'running'
  }

  clearPositionalSources() {
    for (const source of this.positionalSources) {
      stopAudio(source)
      source.parent?.remove(source)
    }

    this.positionalSources.length = 0
  }

  installUnlockHandlers() {
    window.addEventListener('keydown', this.onUnlockInput, { passive: true })
    window.addEventListener('pointerdown', this.onUnlockInput, { passive: true })
    this.canvas?.addEventListener?.('click', this.onUnlockInput, { passive: true })
  }

  removeUnlockHandlers() {
    window.removeEventListener('keydown', this.onUnlockInput)
    window.removeEventListener('pointerdown', this.onUnlockInput)
    this.canvas?.removeEventListener?.('click', this.onUnlockInput)
  }
}

function readAmbientTriggerSettings(event, defaults) {
  const userData = event?.userData || {}
  const asset = getString(userData, 'audioAsset', 'aqua_audio_asset', 'aquaAudioAsset')

  if (!asset) {
    return null
  }

  const audioType = getString(userData, 'audioType', 'aqua_audio_type', 'aquaAudioType')

  if (audioType && audioType !== 'ambient' && audioType !== 'soundscape') {
    return null
  }

  return {
    asset,
    mapUrl: getString(userData, 'aqua_audio_base_url', 'aquaAudioBaseUrl') || window.location.href,
    volume: clamp01(getNumber(userData, 'audioVolume', 'aqua_audio_volume', 'aquaAudioVolume') ?? defaults.volume),
    fadeIn: Math.max(getNumber(userData, 'audioFadeIn', 'aqua_audio_fade_in', 'aquaAudioFadeIn') ?? defaults.fadeIn, 0),
    fadeOut: Math.max(getNumber(userData, 'audioFadeOut', 'aqua_audio_fade_out', 'aquaAudioFadeOut') ?? defaults.fadeOut, 0),
    priority: getNumber(userData, 'audioPriority', 'aqua_audio_priority', 'aquaAudioPriority') ?? defaults.priority,
    loop: getBoolean(userData, 'audioLoop', 'aqua_audio_loop', 'aquaAudioLoop'),
  }
}

function normalizeAudioConfig(config) {
  const ambient = config?.ambient || {}
  const positional = config?.positional || {}
  const footsteps = config?.footsteps || {}

  return {
    manifestUrl: config?.manifestUrl || undefined,
    masterVolume: clamp01(readNumber(config?.masterVolume, 1)),
    ambient: {
      volume: clamp01(readNumber(ambient.volume, 1)),
      fadeIn: Math.max(readNumber(ambient.fadeIn, DEFAULT_AMBIENT_FADE_IN), 0),
      fadeOut: Math.max(readNumber(ambient.fadeOut, DEFAULT_AMBIENT_FADE_OUT), 0),
      priority: readNumber(ambient.priority, 0),
    },
    positional: {
      volume: clamp01(readNumber(positional.volume, 1)),
      range: Math.max(readNumber(positional.range, DEFAULT_POSITIONAL_RANGE), 0.01),
      refDistance: Math.max(readNumber(positional.refDistance, DEFAULT_POSITIONAL_REF_DISTANCE), 0.01),
      rolloff: Math.max(readNumber(positional.rolloff, DEFAULT_POSITIONAL_ROLLOFF), 0),
      distanceModel: positional.distanceModel || 'linear',
    },
    footsteps: {
      enabled: readBoolean(footsteps.enabled, true),
      set: getString(footsteps, 'set') || DEFAULT_FOOTSTEP_SET,
      volume: clamp01(readNumber(footsteps.volume, 0.62)),
      minSpeed: Math.max(readNumber(footsteps.minSpeed, DEFAULT_FOOTSTEP_MIN_SPEED), 0),
      referenceSpeed: Math.max(readNumber(footsteps.referenceSpeed, 7), 0.01),
      stepDistance: Math.max(readNumber(footsteps.stepDistance, DEFAULT_FOOTSTEP_STEP_DISTANCE), 0.01),
      startDistance: Math.max(readNumber(footsteps.startDistance, DEFAULT_FOOTSTEP_START_DISTANCE), 0),
      pan: THREE.MathUtils.clamp(readNumber(footsteps.pan, DEFAULT_FOOTSTEP_PAN), 0, 1),
      panJitter: THREE.MathUtils.clamp(readNumber(footsteps.panJitter, DEFAULT_FOOTSTEP_PAN_JITTER), 0, 1),
      volumeJitter: THREE.MathUtils.clamp(readNumber(footsteps.volumeJitter, DEFAULT_FOOTSTEP_VOLUME_JITTER), 0, 1),
      playbackRateJitter: THREE.MathUtils.clamp(
        readNumber(footsteps.playbackRateJitter, DEFAULT_FOOTSTEP_RATE_JITTER),
        0,
        0.5
      ),
    },
  }
}

function selectAmbientTrigger(activeTriggers) {
  let selected = null

  for (const trigger of activeTriggers.values()) {
    if (!selected) {
      selected = trigger
      continue
    }

    if (trigger.priority > selected.priority) {
      selected = trigger
      continue
    }

    if (trigger.priority === selected.priority && trigger.enteredAt > selected.enteredAt) {
      selected = trigger
    }
  }

  return selected
}

function ambientChannelKey(asset) {
  return String(asset || '').trim()
}

function applyMatrix(object, matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 16) {
    return
  }

  scratchMatrix.fromArray(matrix)
  scratchMatrix.decompose(object.position, object.quaternion, object.scale)
}

function playAudio(sound) {
  if (!sound || sound.isPlaying) {
    return
  }

  try {
    sound.play()
  } catch (error) {
    EngineConsole.warn('Audio playback failed', {
      sound: sound.name,
      reason: error?.message || String(error),
    })
  }
}

function stopAudio(sound) {
  if (!sound?.isPlaying) {
    return
  }

  try {
    sound.stop()
  } catch {
    // Stopping can throw if the underlying source has already ended.
  }
}

function smoothstep(value) {
  const x = THREE.MathUtils.clamp(value, 0, 1)

  return x * x * (3 - 2 * x)
}

function clamp01(value) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
}

function randomSigned(amount) {
  return (Math.random() * 2 - 1) * Math.max(Number(amount) || 0, 0)
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

function getString(userData, ...keys) {
  for (const key of keys) {
    if (typeof userData?.[key] === 'string' && userData[key].trim()) {
      return userData[key].trim()
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

  return undefined
}

function cloneUserData(userData) {
  return JSON.parse(JSON.stringify(userData || {}))
}
