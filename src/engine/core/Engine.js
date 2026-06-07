import * as THREE from 'three'
import { StaticWorldCollider } from '../collision/StaticWorldCollider.js'
import { DebugPanel } from '../debug/DebugPanel.js'
import { PlayerDebugView } from '../debug/PlayerDebugView.js'
import { PerformanceRecorder } from '../debug/PerformanceRecorder.js'
import { SettingsMenu } from '../debug/SettingsMenu.js'
import { InputManager } from '../input/InputManager.js'
import { EngineCamera } from '../render/EngineCamera.js'
import { EngineRenderer } from '../render/EngineRenderer.js'
import { DEFAULT_LIGHTING_MODE, DEFAULT_MAP_URL, loadBrushMap } from '../world/BrushMapLoader.js'
import { PropAssetLoader } from '../world/PropAssetLoader.js'
import { WorldMaterialSystem } from '../../materialsystem/WorldMaterialSystem.js'
import { FirstPersonPlayer } from '../../game/client/FirstPersonPlayer.js'
import { MovementConfig } from '../../game/shared/MovementConfig.js'
import { FixedStepper } from './FixedStepper.js'
import { RenderLoop } from './RenderLoop.js'

export class Engine {
  constructor({
    canvas,
    debugElement,
    settingsElement,
    mapUrl = DEFAULT_MAP_URL,
    lightingMode = DEFAULT_LIGHTING_MODE,
    runtimeBakeSettings = {},
    onLoadingProgress = () => {},
  }) {
    this.canvas = canvas
    this.settingsElement = settingsElement
    this.mapUrl = mapUrl
    this.lightingMode = lightingMode
    this.runtimeBakeSettings = runtimeBakeSettings
    this.onLoadingProgress = typeof onLoadingProgress === 'function' ? onLoadingProgress : () => {}
    this.scene = new THREE.Scene()
    this.worldRenderGroup = new THREE.Group()
    this.worldRenderGroup.name = 'WorldRender'
    this.worldCollisionGroup = new THREE.Group()
    this.worldCollisionGroup.name = 'WorldCollision'
    this.collisionBrushDebugGroup = new THREE.Group()
    this.collisionBrushDebugGroup.name = 'CollisionBrushDebug'
    this.collisionBrushDebugGroup.visible = false
    this.worldStats = {
      renderTriangles: 0,
      collisionTriangles: 0,
    }
    this.collider = new StaticWorldCollider()
    this.input = new InputManager({ canvas: this.canvas })
    this.debugPanel = new DebugPanel({
      element: debugElement,
      onVisibilityChange: (visible) => this.playerDebugView?.setVisible(visible),
    })
    this.performanceRecorder = new PerformanceRecorder({
      contextProvider: () => this.getProfilerContext(),
    })
    this.camera = new EngineCamera()
    this.materials = new WorldMaterialSystem()
    this.propAssetLoader = new PropAssetLoader()
    this.renderer = new EngineRenderer({
      canvas: this.canvas,
      scene: this.scene,
      camera: this.camera.instance,
    })
    this.materials.setTextureAnisotropyLimit(this.renderer.getMaxTextureAnisotropy())
    this.renderLoop = new RenderLoop({
      update: (deltaTime, elapsedTime) => this.update(deltaTime, elapsedTime),
      render: () => this.renderer.render(),
      afterFrame: (frameTiming) => this.afterFrame(frameTiming),
    })
    this.fixedStepper = new FixedStepper({
      fixedTimeStep: MovementConfig.fixedTimeStep,
      step: (fixedDeltaTime) => this.fixedUpdate(fixedDeltaTime),
    })
    this.player = null
    this.playerDebugView = null
    this.settingsMenu = null
    this.marker = null
    this.latestFrameStats = null
    this.ready = false

    this.resize = () => this.handleResize()
  }

  async initialize() {
    this.reportLoading({
      stage: 'scene',
      label: 'Preparing scene',
      progress: 0.02,
    })
    this.setupScene()

    this.reportLoading({
      stage: 'materials',
      label: 'Loading materials',
      progress: 0.08,
    })
    await this.materials.loadManifest()

    this.reportLoading({
      stage: 'world',
      label: 'Loading world',
      progress: 0.16,
      detail: `bake=${this.lightingMode}`,
    })
    await this.loadWorld()

    this.reportLoading({
      stage: 'collision',
      label: 'Building collision',
      progress: 0.82,
    })
    this.worldStats.renderTriangles = countTriangles(this.worldRenderGroup)
    this.worldStats.collisionTriangles = countTriangles(this.worldCollisionGroup)
    this.collider.buildFromSceneObject(this.worldCollisionGroup)

    this.reportLoading({
      stage: 'player',
      label: 'Spawning player',
      progress: 0.9,
    })
    this.player = new FirstPersonPlayer({
      camera: this.camera.instance,
      collider: this.collider,
      input: this.input,
      config: MovementConfig,
      spawnPosition: this.playerStart,
    })
    this.playerDebugView = new PlayerDebugView({
      scene: this.scene,
      config: MovementConfig,
    })
    this.playerDebugView.setVisible(false)
    this.settingsMenu = new SettingsMenu({
      element: this.settingsElement,
      engine: this,
    })
    this.handleResize()
    this.ready = true
    this.reportLoading({
      stage: 'ready',
      label: 'Ready',
      progress: 1,
    })

    return this
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
    this.renderer.dispose()
    this.materials.dispose()
  }

  setupScene() {
    this.scene.background = new THREE.Color('#151922')
    this.scene.fog = new THREE.Fog('#151922', 22, 55)

    const ambientLight = new THREE.HemisphereLight('#d8f3ff', '#1d232b', 1.8)
    this.scene.add(ambientLight)

    const keyLight = new THREE.DirectionalLight('#fff2d0', 2.6)
    keyLight.position.set(6, 8, 4)
    this.scene.add(keyLight)

    const grid = new THREE.GridHelper(24, 24, '#6f7a86', '#303842')
    grid.position.y = 0.01
    this.scene.add(grid)
    this.scene.add(this.worldRenderGroup)
    this.scene.add(this.collisionBrushDebugGroup)

    this.marker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.35, 1),
      this.materials.createMaterial({ color: '#75d3c8' })
    )
    this.marker.position.set(0, 1.4, 0)
    this.scene.add(this.marker)
  }

  async loadWorld() {
    const map = await loadBrushMap({
      url: this.mapUrl,
      materials: this.materials,
      lightingMode: this.lightingMode,
      runtimeBakeSettings: this.runtimeBakeSettings,
      onProgress: (event) => {
        this.reportLoading({
          stage: event.stage,
          label: event.label,
          progress: 0.16 + (event.progress ?? 0) * 0.64,
          detail: event.detail,
        })
      },
    })

    this.worldRenderGroup.add(map.renderGroup)
    this.worldCollisionGroup.add(map.collisionGroup)
    this.collisionBrushDebugGroup.add(map.collisionDebugGroup)

    if (map.propRefs.length > 0) {
      const props = await this.propAssetLoader.loadInstances(map.propRefs)

      this.worldRenderGroup.add(props.renderGroup)
      this.worldCollisionGroup.add(props.collisionGroup)
    }

    this.playerStart = map.playerStart
  }

  reportLoading(event) {
    this.onLoadingProgress({
      detail: '',
      ...event,
      progress: THREE.MathUtils.clamp(event.progress ?? 0, 0, 1),
    })
  }

  fixedUpdate(deltaTime) {
    this.player.fixedUpdate(deltaTime)
  }

  update(deltaTime, elapsedTime) {
    this.fixedStepper.update(deltaTime)
    this.player.updateCamera(deltaTime)

    this.marker.rotation.x += deltaTime * 0.8
    this.marker.rotation.y += deltaTime * 1.2
    this.marker.position.y = 1.4 + Math.sin(elapsedTime * 1.6) * 0.12

    const playerState = this.player.getDebugState()
    this.playerDebugView.update(playerState)
    const collisionStats = this.collider.flushStats()

    this.latestFrameStats = {
      deltaTime,
      fixedSteps: this.fixedStepper.lastStepCount,
      playerState,
      collisionStats,
      input: this.input,
      worldStats: this.worldStats,
    }
  }

  afterFrame(frameTiming) {
    if (!this.latestFrameStats) {
      return
    }

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
    const drawingBufferSize = new THREE.Vector2()
    this.renderer?.instance?.getDrawingBufferSize(drawingBufferSize)

    return {
      url: window.location.href,
      mapUrl: this.mapUrl,
      lightingMode: this.lightingMode,
      runtimeBakeSettings: this.runtimeBakeSettings,
      fpsCap: this.renderLoop?.fpsCap ?? 0,
      frameBudgetMs: this.renderLoop?.fpsCap > 0 ? 1000 / this.renderLoop.fpsCap : 1000 / 60,
      resolutionScale: this.renderer?.resolutionScale ?? 1,
      pixelRatio: this.renderer?.instance?.getPixelRatio?.() ?? window.devicePixelRatio,
      graphicsQuality: this.materials?.quality ?? 'unknown',
      textureQuality: this.materials?.textureQuality ?? 'unknown',
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
      },
      userAgent: window.navigator.userAgent,
    }
  }
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
