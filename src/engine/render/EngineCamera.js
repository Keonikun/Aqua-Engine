import * as THREE from 'three'

export class EngineCamera {
  constructor(config = {}) {
    this.instance = new THREE.PerspectiveCamera(
      readNumber(config.fov, 70),
      1,
      readNumber(config.near, 0.05),
      readNumber(config.far, 120),
    )
    this.instance.rotation.order = 'YXZ'
  }

  resize(width, height) {
    this.instance.aspect = width / Math.max(height, 1)
    this.instance.updateProjectionMatrix()
  }
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}
