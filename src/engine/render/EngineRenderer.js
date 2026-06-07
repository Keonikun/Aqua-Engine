import * as THREE from 'three'

export class EngineRenderer {
  constructor({ canvas, scene, camera }) {
    this.scene = scene
    this.camera = camera
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.resolutionScale = 1

    this.instance.outputColorSpace = THREE.SRGBColorSpace
    this.instance.setClearColor('#151922')
  }

  resize(width, height) {
    this.instance.setSize(width, height, false)
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.resolutionScale)
  }

  setResolutionScale(scale) {
    this.resolutionScale = scale
    this.resize(window.innerWidth, window.innerHeight)
  }

  getMaxTextureAnisotropy() {
    return this.instance.capabilities.getMaxAnisotropy()
  }

  render() {
    this.instance.render(this.scene, this.camera)
  }

  dispose() {
    this.instance.dispose()
  }
}
