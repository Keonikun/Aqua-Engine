import * as THREE from 'three'
import { AudioSystem } from '../world/AudioSystem.js'
import { StaticWorldCollider } from '../world/StaticWorldCollider.js'
import { mergeProjectConfig } from '../config/ProjectConfig.js'
import { DebugPanel } from '../config/DebugPanel.js'
import { EngineConsole } from '../config/EngineConsole.js'
import { PlayerDebugView } from '../config/PlayerDebugView.js'
import { PerformanceRecorder } from '../config/PerformanceRecorder.js'
import { SettingsMenu } from '../config/SettingsMenu.js'
import { InputManager } from '../player/InputManager.js'
import { EngineCamera } from '../render/EngineCamera.js'
import { EngineRenderer } from '../render/EngineRenderer.js'
import { SkyboxLoader } from '../render/SkyboxLoader.js'
import { DEFAULT_LIGHTING_MODE, DEFAULT_MAP_URL, loadBrushMap } from '../world/BrushMapLoader.js'
import { PropAssetLoader } from '../world/PropAssetLoader.js'
import { TriggerVolumeSystem } from '../world/TriggerVolumeSystem.js'
import { WorldMaterialSystem } from '../world/WorldMaterialSystem.js'
import { FirstPersonPlayer } from '../player/FirstPersonPlayer.js'
import { MovementConfig } from '../player/MovementConfig.js'
import { FixedStepper } from './FixedStepper.js'
import { RenderLoop } from './RenderLoop.js'

export class Engine {
  constructor({
    canvas,
    debugElement,
    settingsElement,
    mapUrl = DEFAULT_MAP_URL,
    skybox = null,
    lightingMode = DEFAULT_LIGHTING_MODE,
    runtimeBakeSettings = {},
    projectConfig = {},
    onLoadingProgress = () => {},
  }) {
    this.canvas = canvas
    this.settingsElement = settingsElement
    this.projectConfig = mergeProjectConfig(projectConfig)
    this.assetOptions = this.projectConfig.assets || {}
    this.sceneOptions = this.projectConfig.scene || {}
    this.movementConfig = {
      ...MovementConfig,
      ...(this.projectConfig.player || {}),
    }
    this.mapUrl = mapUrl
    this.skyboxOverride = typeof skybox === 'string' && skybox.trim() ? skybox.trim() : null
    this.lightingMode = lightingMode
    this.runtimeBakeSettings = runtimeBakeSettings
    this.onLoadingProgress = typeof onLoadingProgress === 'function' ? onLoadingProgress : () => {}
    this.scene = new THREE.Scene()
    this.defaultSceneBackground = new THREE.Color(this.sceneOptions.backgroundColor || '#151922')
    this.worldRenderGroup = new THREE.Group()
    this.worldRenderGroup.name = 'WorldRender'
    this.worldCollisionGroup = new THREE.Group()
    this.worldCollisionGroup.name = 'WorldCollision'
    this.worldTriggerGroup = new THREE.Group()
    this.worldTriggerGroup.name = 'WorldTriggers'
    this.worldLightGroup = new THREE.Group()
    this.worldLightGroup.name = 'WorldLights'
    this.collisionBrushDebugGroup = new THREE.Group()
    this.collisionBrushDebugGroup.name = 'CollisionBrushDebug'
    this.collisionBrushDebugGroup.visible = false
    this.worldStats = {
      renderTriangles: 0,
      collisionTriangles: 0,
    }
    this.collider = new StaticWorldCollider(this.projectConfig.collision)
    this.triggers = new TriggerVolumeSystem()
    this.input = new InputManager({
      canvas: this.canvas,
      config: this.projectConfig.input,
    })
    this.debugPanel = new DebugPanel({
      element: debugElement,
      onVisibilityChange: (visible) => this.playerDebugView?.setVisible(visible),
    })
    this.performanceRecorder = new PerformanceRecorder({
      contextProvider: () => this.getProfilerContext(),
    })
    this.camera = new EngineCamera(this.projectConfig.camera)
    this.materials = new WorldMaterialSystem({
      ...(this.projectConfig.materials || {}),
      manifestUrl: this.assetOptions.materialsManifestUrl || this.projectConfig.materials?.manifestUrl,
    })
    this.skyboxes = new SkyboxLoader({
      baseUrl: this.assetOptions.skyboxBaseUrl,
    })
    this.propAssetLoader = new PropAssetLoader({ materials: this.materials })
    this.audio = new AudioSystem({
      camera: this.camera.instance,
      canvas: this.canvas,
      config: {
        ...(this.projectConfig.audio || {}),
        manifestUrl: this.assetOptions.audioManifestUrl || this.projectConfig.audio?.manifestUrl,
      },
    })
    this.renderer = new EngineRenderer({
      canvas: this.canvas,
      scene: this.scene,
      camera: this.camera.instance,
      config: this.projectConfig.renderer,
    })
    this.materials.setTextureAnisotropyLimit(this.renderer.getMaxTextureAnisotropy())
    this.renderLoop = new RenderLoop({
      update: (deltaTime, elapsedTime) => this.update(deltaTime, elapsedTime),
      render: () => this.renderFrame(),
      afterFrame: (frameTiming) => this.finalizeFrame(frameTiming),
      config: this.projectConfig.renderLoop,
    })
    this.fixedStepper = new FixedStepper({
      fixedTimeStep: this.movementConfig.fixedTimeStep,
      maxSubSteps: this.movementConfig.maxSubSteps,
      step: (fixedDeltaTime) => this.fixedUpdate(fixedDeltaTime),
    })
    this.player = null
    this.playerDebugView = null
    this.settingsMenu = null
    this.marker = null
    this.worldResources = null
    this.skyboxRef = null
    this.activeSkyboxTexture = null
    this.latestFrameStats = null
    this.ready = false
    this.playerBounds = new THREE.Box3()
    this.profilerDrawingBufferSize = new THREE.Vector2()

    this.resize = () => this.handleResize()
  }

  async initialize() {
    EngineConsole.info('Initializing engine', {
      mapUrl: this.mapUrl,
      skybox: this.skyboxOverride,
      lightingMode: this.lightingMode,
      runtimeBakeSettings: this.runtimeBakeSettings,
      projectConfigUrl: this.projectConfig.url,
    })
    await this.prepareScene()
    await this.loadStartupAssets()
    await this.loadStartupWorld()
    this.buildRuntimeWorld()
    this.createRuntimePlayer()
    this.createRuntimeUi()
    this.finishInitialization()

    return this
  }

  async prepareScene() {
    this.reportLoading({
      stage: 'scene',
      label: 'Preparing scene',
      progress: 0.02,
    })
    this.setupScene()
  }

  async loadStartupAssets() {
    this.reportLoading({
      stage: 'materials',
      label: 'Loading materials',
      progress: 0.08,
    })
    await this.materials.loadManifest()
  }

  async loadStartupWorld() {
    this.reportLoading({
      stage: 'world',
      label: 'Loading world',
      progress: 0.16,
      detail: `bake=${this.lightingMode}`,
    })
    await this.loadWorld()
  }

  buildRuntimeWorld() {
    this.reportLoading({
      stage: 'collision',
      label: 'Building collision',
      progress: 0.82,
    })
    this.worldStats.renderTriangles = countTriangles(this.worldRenderGroup)
    this.worldStats.collisionTriangles = countTriangles(this.worldCollisionGroup)
    this.collider.buildFromSceneObject(this.worldCollisionGroup)
    this.triggers.buildFromSceneObject(this.worldTriggerGroup)
  }

  createRuntimePlayer() {
    this.reportLoading({
      stage: 'player',
      label: 'Spawning player',
      progress: 0.9,
    })
    this.player = new FirstPersonPlayer({
      camera: this.camera.instance,
      collider: this.collider,
      input: this.input,
      config: this.movementConfig,
      spawnPosition: this.playerStart,
    })
  }

  createRuntimeUi() {
    this.playerDebugView = new PlayerDebugView({
      scene: this.scene,
      config: this.movementConfig,
    })
    this.playerDebugView.setVisible(false)
    this.settingsMenu = new SettingsMenu({
      element: this.settingsElement,
      engine: this,
      settings: this.projectConfig.settingsMenu,
    })
  }

  finishInitialization() {
    this.handleResize()
    this.ready = true
    this.reportLoading({
      stage: 'ready',
      label: 'Ready',
      progress: 1,
    })
    EngineConsole.info('Engine ready', {
      worldStats: this.worldStats,
      collisionWorld: {
        brushBoxes: this.collider.brushBoxes.length,
        convexBrushes: this.collider.convexBrushes.length,
        terrainPatches: this.collider.terrainPatches.length,
        hasTriangleCollision: this.collider.hasTriangleCollision,
        triggerVolumes: this.triggers.volumes.length,
      },
    })
  }

  start() {
    if (!this.ready) {
      throw new Error('Aqua Engine must be initialized before start().')
    }

    window.addEventListener('resize', this.resize)
    this.input.start()
    this.renderLoop.start()
  }

  stop() {
    window.removeEventListener('resize', this.resize)
    this.input.stop()
    this.debugPanel.dispose()
    this.performanceRecorder.dispose()
    this.settingsMenu?.dispose()
    this.renderLoop.stop()
    this.disposeWorldResources()
    this.audio.dispose()
    this.propAssetLoader.dispose()
    this.skyboxes.dispose()
    this.renderer.dispose()
    this.materials.dispose()
  }

  setupScene() {
    this.scene.background = this.defaultSceneBackground
    this.scene.fog = createSceneFog(this.sceneOptions, this.defaultSceneBackground)

    this.scene.add(this.worldRenderGroup)
    this.scene.add(this.worldTriggerGroup)
    this.scene.add(this.worldLightGroup)
    this.scene.add(this.audio.group)
    this.scene.add(this.collisionBrushDebugGroup)
  }

  async loadWorld() {
    EngineConsole.info('Loading world', {
      mapUrl: this.mapUrl,
      lightingMode: this.lightingMode,
    })
    const map = await loadBrushMap({
      url: this.mapUrl,
      materials: this.materials,
      propAssetLoader: this.propAssetLoader,
      lightingMode: this.lightingMode,
      runtimeBakeSettings: this.runtimeBakeSettings,
      propBaseUrl: this.assetOptions.propBaseUrl,
      onProgress: (event) => {
        this.reportLoading({
          stage: event.stage,
          label: event.label,
          progress: 0.16 + (event.progress ?? 0) * 0.64,
          detail: event.detail,
        })
      },
    })

    this.disposeWorldResources()
    this.worldResources = map.resources || null
    await this.applyMapSkybox(this.skyboxOverride || map.skybox)
    this.worldLightGroup.add(createRuntimeLightGroup(map.source))
    this.worldRenderGroup.add(map.renderGroup)
    this.worldCollisionGroup.add(map.collisionGroup)
    this.worldTriggerGroup.add(map.triggerGroup)
    this.collisionBrushDebugGroup.add(map.collisionDebugGroup)
    this.collisionBrushDebugGroup.add(map.triggerDebugGroup)

    if (map.propRefs.length > 0) {
      const props = await this.propAssetLoader.loadInstances(map.propRefs)

      this.worldRenderGroup.add(props.renderGroup)
      this.worldCollisionGroup.add(props.collisionGroup)
      this.worldResources?.trackOwner(props.resources)
    }

    if (map.audioRefs.length > 0) {
      this.reportLoading({
        stage: 'audio:load',
        label: 'Loading audio',
        progress: 0.8,
        detail: `${map.audioRefs.length} source(s)`,
      })
      await this.audio.loadMapAudio(map.audioRefs)
    }

    this.playerStart = map.playerStart
    EngineConsole.info('World loaded', {
      renderChildren: this.worldRenderGroup.children.length,
      collisionChildren: this.worldCollisionGroup.children.length,
      triggerChildren: this.worldTriggerGroup.children.length,
      propRefs: map.propRefs.length,
      audioRefs: map.audioRefs.length,
      playerStart: this.playerStart?.toArray?.(),
    })
  }

  disposeWorldResources() {
    this.worldResources?.dispose()
    this.worldResources = null
    this.worldLightGroup.clear()
    this.skyboxRef = null
  }

  async applyMapSkybox(skyboxRef) {
    if (!skyboxRef) {
      this.scene.background = this.defaultSceneBackground
      this.scene.environment = null
      this.activeSkyboxTexture = null
      this.skyboxRef = null
      return
    }

    try {
      const skyboxTexture = await this.skyboxes.load(skyboxRef)

      this.scene.background = skyboxTexture || this.defaultSceneBackground
      this.scene.environment = skyboxTexture || null
      this.activeSkyboxTexture = skyboxTexture || null
      this.skyboxRef = skyboxTexture ? skyboxRef : null
      EngineConsole.info('Skybox applied', {
        skybox: this.skyboxRef,
        texture: skyboxTexture?.name || null,
      })
    } catch (error) {
      this.scene.background = this.defaultSceneBackground
      this.scene.environment = null
      this.activeSkyboxTexture = null
      this.skyboxRef = null
      EngineConsole.warn(`Failed to load skybox "${skyboxRef}"`, error)
    }
  }

  reportLoading(event) {
    const loadingEvent = {
      detail: '',
      ...event,
      progress: THREE.MathUtils.clamp(event.progress ?? 0, 0, 1),
    }

    EngineConsole.info(`Loading: ${loadingEvent.stage || loadingEvent.label || 'stage'}`, loadingEvent)
    this.onLoadingProgress(loadingEvent)
  }

  fixedUpdate(deltaTime) {
    this.player.fixedUpdate(deltaTime)
  }

  update(deltaTime, elapsedTime) {
    this.runPhysicsTicks(deltaTime)
    this.updateFrameState(deltaTime, elapsedTime)
  }

  runPhysicsTicks(deltaTime) {
    // Fixed simulation advances before render-frame state so cameras and debug views read the latest physics result.
    this.fixedStepper.update(deltaTime)
  }

  updateFrameState(deltaTime, elapsedTime) {
    this.player.updateCamera(deltaTime)

    const playerState = this.player.getDebugState()
    const triggerEvents = this.triggers.update(this.player.getBounds(this.playerBounds))
    this.audio.update(deltaTime, { triggerEvents, playerState })
    this.renderer.update(deltaTime, elapsedTime)
    this.playerDebugView.update(playerState)
    const collisionStats = this.collider.flushStats()

    this.latestFrameStats = {
      deltaTime,
      fixedSteps: this.fixedStepper.lastStepCount,
      playerState,
      collisionStats,
      triggerEvents,
      audioState: this.audio.getDebugState(),
      input: this.input,
      worldStats: this.worldStats,
    }
  }

  renderFrame() {
    this.renderer.render()
  }

  finalizeFrame(frameTiming) {
    if (!this.latestFrameStats) {
      return
    }

    // TODO(render-perf): This post-render debug/profiling path still allocates stats snapshots every rendered frame.
    // DebugPanel and PerformanceRecorder currently consume immutable frame objects, so keep behavior until they accept reusable buffers.
    const renderStats = { ...this.renderer.instance.info.render }
    const rendererMemoryStats = { ...this.renderer.instance.info.memory }
    const frameStats = {
      ...this.latestFrameStats,
      renderStats,
      rendererMemoryStats,
      frameTiming,
      context: this.getProfilerContext(),
    }

    this.performanceRecorder.sample(frameStats)
    this.debugPanel.update({
      ...frameStats,
      profilerStatus: this.performanceRecorder.getStatus(),
    })
  }

  handleResize() {
    const width = window.innerWidth
    const height = window.innerHeight

    this.camera.resize(width, height)
    this.renderer.resize(width, height)
  }

  setFpsCap(fpsCap) {
    this.renderLoop.setFpsCap(fpsCap)
  }

  setResolutionScale(scale) {
    this.renderer.setResolutionScale(scale)
  }

  setMouseSensitivityScale(scale) {
    this.input.setMouseSensitivityScale(scale)
  }

  setGraphicsQuality(quality) {
    this.materials.setQuality(quality)
  }

  setTextureQuality(quality) {
    this.materials.setTextureQuality(quality)
  }

  setPostProcessingEnabled(enabled) {
    this.renderer.setPostProcessingConfig({ enabled: Boolean(enabled) })
    return this.getPostProcessingConfig().enabled
  }

  setPostProcessingEffectSettings(effectName, settings) {
    if (!effectName || !settings) {
      return this.getPostProcessingConfig()
    }

    this.renderer.setPostProcessingConfig({
      [effectName]: settings,
    })
    return this.getPostProcessingConfig()
  }

  getPostProcessingConfig() {
    return this.renderer.getPostProcessingConfig()
  }

  setDebugVisible(visible) {
    this.debugPanel.setVisible(visible)
    this.playerDebugView.setVisible(visible)
  }

  setCollisionBrushesVisible(visible) {
    this.collisionBrushDebugGroup.visible = visible
    this.collisionBrushDebugGroup.traverse((child) => {
      child.visible = visible
    })
  }

  setNoclipEnabled(enabled) {
    this.player.setNoclip(enabled)
    return this.player.isNoclipEnabled()
  }

  toggleNoclip() {
    return this.setNoclipEnabled(!this.player.isNoclipEnabled())
  }

  togglePerformanceRecording() {
    return this.performanceRecorder.toggle()
  }

  downloadLastPerformanceReport() {
    return this.performanceRecorder.downloadLastReport()
  }

  getPerformanceProfileStatus() {
    return this.performanceRecorder.getStatus()
  }

  setProfilerStateChangeHandler(handler) {
    this.performanceRecorder.setStateChangeHandler(handler)
  }

  getProfilerContext() {
    const drawingBufferSize = this.profilerDrawingBufferSize
    this.renderer?.instance?.getDrawingBufferSize(drawingBufferSize)

    return {
      url: window.location.href,
      projectConfigUrl: this.projectConfig.url,
      mapUrl: this.mapUrl,
      lightingMode: this.lightingMode,
      runtimeBakeSettings: this.runtimeBakeSettings,
      fpsCap: this.renderLoop?.fpsCap ?? 0,
      frameBudgetMs:
        this.renderLoop?.getFrameBudgetMs?.() ??
        (this.renderLoop?.fpsCap > 0 ? 1000 / this.renderLoop.fpsCap : 1000 / 60),
      resolutionScale: this.renderer?.resolutionScale ?? 1,
      pixelRatio: this.renderer?.instance?.getPixelRatio?.() ?? window.devicePixelRatio,
      graphicsQuality: this.materials?.quality ?? 'unknown',
      textureQuality: this.materials?.textureQuality ?? 'unknown',
      postProcessing: this.renderer?.getPostProcessingConfig?.() || null,
      skybox: this.skyboxRef,
      maxTextureAnisotropy: this.renderer?.getMaxTextureAnisotropy?.() ?? 1,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      drawingBuffer: {
        width: drawingBufferSize.x,
        height: drawingBufferSize.y,
      },
      worldStats: { ...this.worldStats },
      collisionWorld: {
        brushBoxes: this.collider.brushBoxes.length,
        convexBrushes: this.collider.convexBrushes.length,
        terrainPatches: this.collider.terrainPatches.length,
        hasTriangleCollision: this.collider.hasTriangleCollision,
        triggerVolumes: this.triggers.volumes.length,
      },
      audio: this.audio.getDebugState(),
      userAgent: window.navigator.userAgent,
    }
  }
}

function createSceneFog(sceneOptions, fallbackColor) {
  const fogOptions = sceneOptions?.fog || {}

  if (fogOptions.enabled === false) {
    return null
  }

  return new THREE.Fog(
    fogOptions.color || sceneOptions?.backgroundColor || fallbackColor,
    readFiniteNumber(fogOptions.near, 22),
    readFiniteNumber(fogOptions.far, 55),
  )
}

function readFiniteNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function countTriangles(object) {
  let triangles = 0

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return
    }

    const position = child.geometry.getAttribute('position')

    if (!position) {
      return
    }

    triangles += child.geometry.index ? child.geometry.index.count / 3 : position.count / 3
  })

  return triangles
}

function createRuntimeLightGroup(sourceScene) {
  const group = new THREE.Group()

  group.name = 'AuthoredRuntimeLights'
  sourceScene?.updateMatrixWorld(true)
  sourceScene?.traverse((object) => {
    const light = createRuntimeLight(object)

    if (!light) {
      return
    }

    group.add(light)

    if (light.target && !light.target.parent) {
      group.add(light.target)
    }
  })

  EngineConsole.info('Runtime authored lights ready', {
    count: group.children.filter((child) => child.isLight).length,
  })

  return group
}

function createRuntimeLight(object) {
  const authoredType = getString(object.userData, 'aqua_light_type', 'aquaLightType')?.toLowerCase()

  if (authoredType === 'ambient') {
    const light = new THREE.AmbientLight(
      getLightColor(object, '#ffffff'),
      getNumber(object.userData, 'aqua_light_intensity', 'aquaLightIntensity') ?? getLightIntensity(object, 1),
    )

    light.name = `${object.name || 'aqua_ambient'}_runtime`
    return light
  }

  if (authoredType === 'sun' || authoredType === 'directional') {
    return createRuntimeDirectionalLight(object)
  }

  if (!object.isLight) {
    return null
  }

  const light = object.clone(false)

  light.name = `${object.name || 'aqua_light'}_runtime`
  light.color.copy(getLightColor(object, light.color || '#ffffff'))
  light.intensity = getNumber(object.userData, 'aqua_light_intensity', 'aquaLightIntensity') ?? object.intensity ?? 1

  const range = getNumber(object.userData, 'aqua_light_range', 'aquaLightRange')

  if (range != null && 'distance' in light) {
    light.distance = range
  }

  copyWorldTransform(object, light)

  if (light.isSpotLight) {
    const targetPosition = getSpotTargetPosition(object)

    light.target = new THREE.Object3D()
    light.target.name = `${light.name}_target`
    light.target.position.copy(targetPosition)
  }

  return light
}

function createRuntimeDirectionalLight(object) {
  const direction = getAuthoredLightDirection(object)
  const light = new THREE.DirectionalLight(
    getLightColor(object, '#ffffff'),
    getNumber(object.userData, 'aqua_light_intensity', 'aquaLightIntensity') ?? getLightIntensity(object, 1),
  )

  light.name = `${object.name || 'aqua_directional'}_runtime`
  light.position.copy(direction).multiplyScalar(100)
  light.target = new THREE.Object3D()
  light.target.name = `${light.name}_target`
  light.target.position.set(0, 0, 0)

  return light
}

function getAuthoredLightDirection(object) {
  const explicitDirection = getValue(object.userData, 'aqua_light_direction', 'aquaLightDirection')

  if (Array.isArray(explicitDirection) && explicitDirection.length >= 3) {
    return new THREE.Vector3(
      Number(explicitDirection[0]) || 0,
      Number(explicitDirection[1]) || 0,
      Number(explicitDirection[2]) || 0,
    ).normalize()
  }

  return new THREE.Vector3(0, 0, 1)
    .transformDirection(object.matrixWorld)
    .normalize()
}

function getSpotTargetPosition(object) {
  const position = new THREE.Vector3()
  const direction = new THREE.Vector3(0, 0, -1)

  object.getWorldPosition(position)
  direction.transformDirection(object.matrixWorld)

  return position.add(direction)
}

function copyWorldTransform(source, target) {
  target.matrix.copy(source.matrixWorld)
  target.matrix.decompose(target.position, target.quaternion, target.scale)
}

function getLightColor(object, fallback) {
  const color = getValue(object.userData, 'aqua_light_color', 'aquaLightColor')

  if (color) {
    return new THREE.Color(color)
  }

  if (object.color?.isColor) {
    return object.color
  }

  return new THREE.Color(fallback)
}

function getLightIntensity(object, fallback) {
  return Number.isFinite(object.intensity) ? object.intensity : fallback
}

function getValue(userData, ...keys) {
  for (const key of keys) {
    if (userData?.[key] !== undefined) {
      return userData[key]
    }
  }

  return null
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
