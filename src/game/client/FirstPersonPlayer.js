import * as THREE from 'three'
import { CharacterController } from '../shared/CharacterController.js'

const TAU = Math.PI * 2
const eyePosition = new THREE.Vector3()
const headbobRight = new THREE.Vector3()

export class FirstPersonPlayer {
  constructor({ camera, collider, input, config, spawnPosition = null }) {
    this.camera = camera
    this.input = input
    this.config = config
    this.controller = new CharacterController({ collider, config, spawnPosition })
    this.headbobPhase = 0
    this.headbobStrength = 0
    this.camera.rotation.order = 'YXZ'
  }

  fixedUpdate(deltaTime) {
    this.controller.fixedUpdate(deltaTime, this.input)
  }

  updateCamera(deltaTime) {
    this.controller.getEyePosition(eyePosition)
    this.camera.position.copy(eyePosition)
    this.applyHeadbob(deltaTime)
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ')
  }

  applyHeadbob(deltaTime) {
    if (!this.config.headbobEnabled) {
      this.headbobStrength = 0
      return
    }

    const state = this.controller.getState()
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z)
    const movingOnGround = !state.noclip && state.grounded && horizontalSpeed > this.config.headbobMinSpeed
    const targetStrength = movingOnGround
      ? Math.min(horizontalSpeed / this.config.maxGroundSpeed, 1)
      : 0
    const smoothing = 1 - Math.exp(-this.config.headbobSmoothing * deltaTime)

    this.headbobStrength += (targetStrength - this.headbobStrength) * smoothing

    if (this.headbobStrength <= 0.001) {
      return
    }

    this.headbobPhase += TAU * this.config.headbobFrequency * Math.max(targetStrength, 0.35) * deltaTime

    const verticalOffset = Math.sin(this.headbobPhase * 2) *
      this.config.headbobVerticalAmplitude *
      this.headbobStrength
    const lateralOffset = Math.cos(this.headbobPhase) *
      this.config.headbobLateralAmplitude *
      this.headbobStrength

    headbobRight.set(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw))
    this.camera.position.y += verticalOffset
    this.camera.position.addScaledVector(headbobRight, lateralOffset)
  }

  getDebugState() {
    return this.controller.getState()
  }

  setNoclip(enabled) {
    this.controller.setNoclip(enabled)
  }

  isNoclipEnabled() {
    return this.controller.noclip
  }
}
