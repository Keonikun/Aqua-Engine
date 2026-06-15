import * as THREE from 'three'
import { PostProcessingPipeline } from './PostProcessingPipeline.js'

export class EngineRenderer {
  constructor({ canvas, scene, camera, config = {} }) {
    this.scene = scene
    this.camera = camera
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: config.antialias !== false,
      powerPreference: config.powerPreference || 'high-performance',
    })
    this.resolutionScale = clamp(readNumber(config.resolutionScale, 1), 0.1, 2)
    this.maxPixelRatio = Math.max(readNumber(config.maxPixelRatio, 2), 0.1)
    this.pixelRatio = 1

    this.instance.outputColorSpace = THREE.SRGBColorSpace
    this.instance.setClearColor(config.clearColor || '#151922')
    this.postProcessing = new PostProcessingPipeline({
      renderer: this.instance,
      scene: this.scene,
      camera: this.camera,
      config: config.postProcessing,
    })
  }

  resize(width, height) {
    this.pixelRatio = Math.min(window.devicePixelRatio, this.maxPixelRatio) * this.resolutionScale
    this.instance.setSize(width, height, false)
    this.instance.setPixelRatio(this.pixelRatio)
    this.postProcessing.resize(width, height, this.pixelRatio)
  }

  update(deltaTime, elapsedTime) {
    this.postProcessing.update(deltaTime, elapsedTime)
  }

  setResolutionScale(scale) {
    this.resolutionScale = clamp(readNumber(scale, this.resolutionScale), 0.1, 2)
    this.resize(window.innerWidth, window.innerHeight)
  }

  getMaxTextureAnisotropy() {
    return this.instance.capabilities.getMaxAnisotropy()
  }

  render() {
    this.postProcessing.render()
  }

  setPostProcessingConfig(config) {
    this.postProcessing.setConfig(config)
  }

  getPostProcessingConfig() {
    return this.postProcessing.getConfig()
  }

  dispose() {
    this.postProcessing.dispose()
    this.instance.dispose()
  }
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
