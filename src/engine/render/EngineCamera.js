import * as THREE from 'three'

export class EngineCamera {
  constructor() {
    this.instance = new THREE.PerspectiveCamera(70, 1, 0.05, 120)
    this.instance.rotation.order = 'YXZ'
  }

  resize(width, height) {
    this.instance.aspect = width / Math.max(height, 1)
    this.instance.updateProjectionMatrix()
  }
}
