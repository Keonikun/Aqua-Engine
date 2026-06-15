import { EngineConsole } from './EngineConsole.js'

export const PROJECT_CONFIG_SCHEMA = 'aqua.project_config.v1'
export const DEFAULT_PROJECT_CONFIG_URL = '/config/aqua.project.json'

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  schema: PROJECT_CONFIG_SCHEMA,
  startup: {
    mapUrl: '/assets/maps/demo_map/demo.glb',
    skybox: null,
    lightingMode: 'sidecar',
    runtimeBake: {
      bounces: 0,
      batchSize: 96,
    },
  },
  assets: {
    materialsManifestUrl: '/assets/textures/materials.json',
    audioManifestUrl: '/assets/audio/audio.json',
    skyboxBaseUrl: '/assets/skyboxes',
    propBaseUrl: '/assets/props',
  },
  scene: {
    backgroundColor: '#151922',
    fog: {
      enabled: true,
      color: '#151922',
      near: 22,
      far: 55,
    },
  },
  renderer: {
    antialias: true,
    powerPreference: 'high-performance',
    clearColor: '#151922',
    resolutionScale: 1,
    maxPixelRatio: 2,
    postProcessing: {
      enabled: true,
      grain: {
        enabled: true,
        intensity: 0.035,
        size: 1.25,
        speed: 18,
      },
      fishEye: {
        enabled: true,
        strength: 0.08,
        overscan: 1.18,
      },
      vignette: {
        enabled: true,
        offset: 0.35,
        darkness: 0.42,
      },
      chromaticAberration: {
        enabled: true,
        offset: 1.15,
        radialModulation: true,
      },
    },
  },
  camera: {
    fov: 70,
    near: 0.05,
    far: 120,
  },
  renderLoop: {
    fpsCap: 60,
    maxDeltaTime: 0.1,
    maxWallDeltaTime: 0.5,
    displayFrameSmoothing: 0.08,
  },
  input: {
    baseMouseSensitivity: 0.0022,
    mouseSensitivityScale: 1,
    maxPitchRadians: Math.PI / 2 - 0.01,
  },
  player: {
    fixedTimeStep: 1 / 60,
    maxSubSteps: 5,
    capsuleRadius: 0.35,
    capsuleHeight: 1.8,
    eyeHeight: 1.62,
    stepHeight: 0.35,
    slopeLimitDegrees: 44,
    gravity: 22,
    jumpImpulse: 6.5,
    maxGroundSpeed: 3.5,
    maxAirSpeed: 2.5,
    noclipSpeed: 15,
    groundAcceleration: 55,
    airAcceleration: 8,
    friction: 14,
    groundProbeDistance: 0.08,
    groundLiftDistance: 0.04,
    groundSnapEpsilon: 0.003,
    groundContactSlop: 0.006,
    traceEpsilon: 0.001,
    nonJumpVelocity: 2.7,
    maxClipBumps: 4,
    maxClipPlanes: 5,
    headbobEnabled: true,
    headbobMinSpeed: 0.2,
    headbobFrequency: 1.3,
    headbobVerticalAmplitude: 0.035,
    headbobLateralAmplitude: -0.03,
    headbobSmoothing: 12,
  },
  collision: {
    traceIterations: 6,
    maxTraceStepLength: 0.04,
    contactSlop: 0.02,
    stuckTestEpsilon: 0.002,
  },
  materials: {
    manifestUrl: '/assets/textures/materials.json',
    graphicsQuality: 'medium',
    textureQuality: 'medium',
    fogColor: '#151922',
    lightDirection: [-0.55, 0.82, 0.35],
    fallbackMaterialColor: '#7f8a8f',
    worldShader: {
      ambientColor: '#d8f3ff',
      lightColor: '#fff2d0',
      fogNear: 22,
      fogFar: 55,
    },
  },
  audio: {
    manifestUrl: '/assets/audio/audio.json',
    masterVolume: 1,
    ambient: {
      volume: 1,
      fadeIn: 1.25,
      fadeOut: 1.25,
      priority: 0,
    },
    positional: {
      volume: 1,
      range: 14,
      refDistance: 1.5,
      rolloff: 1,
      distanceModel: 'linear',
    },
    footsteps: {
      enabled: true,
      set: 'outdoor',
      volume: 0.62,
      minSpeed: 0.8,
      referenceSpeed: 7,
      stepDistance: 1.45,
      startDistance: 0.45,
      pan: 0.32,
      panJitter: 0.04,
      volumeJitter: 0.12,
      playbackRateJitter: 0.05,
    },
  },
  settingsMenu: {
    defaults: {
      debugVisible: false,
      collisionBrushesVisible: false,
      noclipEnabled: false,
    },
    fpsOptions: [0, 30, 45, 60, 90, 120],
    graphicsOptions: ['low', 'medium', 'high'],
    textureOptions: ['very_low', 'low', 'medium', 'high'],
    resolutionScale: {
      min: 0.35,
      max: 1,
      step: 0.05,
    },
    mouseSensitivityScale: {
      min: 0.5,
      max: 2.5,
      step: 0.1,
    },
    postProcessing: {
      grainIntensity: {
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      fishEyeStrength: {
        min: -0.4,
        max: 0.6,
        step: 0.01,
      },
      vignetteDarkness: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      chromaticAberrationOffset: {
        min: 0,
        max: 6,
        step: 0.1,
      },
    },
  },
})

export async function loadProjectConfig({
  url = DEFAULT_PROJECT_CONFIG_URL,
  fetchJson = (...args) => fetch(...args),
} = {}) {
  const resolvedUrl = resolveConfigUrl(url)

  try {
    const response = await fetchJson(resolvedUrl)

    if (response.status === 404) {
      EngineConsole.warn('Project config not found; using built-in defaults', {
        configUrl: resolvedUrl,
      })
      return mergeProjectConfig({ url: resolvedUrl })
    }

    if (!response.ok) {
      throw new Error(`Failed to load project config "${resolvedUrl}": ${response.status}`)
    }

    const config = await response.json()

    if (config?.schema && config.schema !== PROJECT_CONFIG_SCHEMA) {
      EngineConsole.warn('Project config schema is not recognized; attempting to use it anyway', {
        configUrl: resolvedUrl,
        schema: config.schema,
      })
    }

    return mergeProjectConfig({
      ...config,
      url: resolvedUrl,
    })
  } catch (error) {
    EngineConsole.error('Failed to load project config; using built-in defaults', error, {
      configUrl: resolvedUrl,
    })
    return mergeProjectConfig({ url: resolvedUrl })
  }
}

export function mergeProjectConfig(config = {}) {
  const merged = mergeDeep(DEFAULT_PROJECT_CONFIG, isPlainObject(config) ? config : {})

  if (!merged.url) {
    merged.url = DEFAULT_PROJECT_CONFIG_URL
  }

  if (merged.assets?.materialsManifestUrl && !merged.materials?.manifestUrl) {
    merged.materials = {
      ...merged.materials,
      manifestUrl: merged.assets.materialsManifestUrl,
    }
  }

  if (merged.assets?.audioManifestUrl && !merged.audio?.manifestUrl) {
    merged.audio = {
      ...merged.audio,
      manifestUrl: merged.assets.audioManifestUrl,
    }
  }

  return merged
}

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? cloneValue(override) : cloneValue(base)
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override !== undefined ? cloneValue(override) : cloneValue(base)
  }

  const merged = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(override)])

  for (const key of keys) {
    merged[key] = mergeDeep(base[key], override[key])
  }

  return merged
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry))
  }

  if (isPlainObject(value)) {
    const clone = {}

    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneValue(entry)
    }

    return clone
  }

  return value
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveConfigUrl(url) {
  const configUrl = typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_PROJECT_CONFIG_URL

  return new URL(configUrl, window.location.href).toString()
}
