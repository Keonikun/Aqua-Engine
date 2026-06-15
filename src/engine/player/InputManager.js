import { EngineConsole } from '../config/EngineConsole.js'

export class InputManager {
  constructor({ canvas, config = {} }) {
    this.canvas = canvas
    this.keys = new Set()
    this.yaw = 0
    this.pitch = 0
    this.pointerLocked = false
    this.jumpQueued = false
    this.baseMouseSensitivity = readNumber(config.baseMouseSensitivity, 0.0022)
    this.mouseSensitivityScale = readNumber(config.mouseSensitivityScale, 1)
    this.mouseSensitivity = this.baseMouseSensitivity * this.mouseSensitivityScale
    this.maxPitch = readMaxPitch(config)

    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.onKeyUp = (event) => this.handleKeyUp(event)
    this.onMouseMove = (event) => this.handleMouseMove(event)
    this.onPointerLockChange = () => this.handlePointerLockChange()
    this.onCanvasClick = () => this.requestPointerLock()
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    this.canvas.addEventListener('click', this.onCanvasClick)
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.canvas.removeEventListener('click', this.onCanvasClick)
  }

  consumeJump() {
    const queued = this.jumpQueued
    this.jumpQueued = false
    return queued
  }

  getMoveAxes() {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'))

    return { forward, right }
  }

  getNoclipMoveAxes() {
    const horizontal = this.getMoveAxes()
    const up = Number(this.keys.has('Space')) -
      Number(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))

    return {
      ...horizontal,
      up,
    }
  }

  clearJumpQueue() {
    this.jumpQueued = false
  }

  handleKeyDown(event) {
    this.keys.add(event.code)

    if (event.code === 'Space') {
      this.jumpQueued = true
      event.preventDefault()
    }
  }

  handleKeyUp(event) {
    this.keys.delete(event.code)
  }

  handleMouseMove(event) {
    if (!this.pointerLocked) {
      return
    }

    this.yaw -= event.movementX * this.mouseSensitivity
    this.pitch -= event.movementY * this.mouseSensitivity
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch))
  }

  handlePointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas
  }

  requestPointerLock() {
    if (document.pointerLockElement === this.canvas) {
      return
    }

    let request = null

    try {
      request = this.canvas.requestPointerLock?.()
    } catch (error) {
      this.reportPointerLockFailure(error)
      return
    }

    if (request?.catch) {
      request.catch((error) => this.reportPointerLockFailure(error))
    }
  }

  reportPointerLockFailure(error) {
    EngineConsole.warn('Pointer lock request failed', {
      reason: error?.message || String(error),
    })
  }

  setMouseSensitivityScale(scale) {
    const nextScale = readNumber(scale, this.mouseSensitivityScale)

    this.mouseSensitivityScale = nextScale
    this.mouseSensitivity = this.baseMouseSensitivity * nextScale
  }
}

function readMaxPitch(config) {
  const radians = readNumber(config.maxPitchRadians, null)

  if (radians != null) {
    return Math.max(0, Math.min(radians, Math.PI / 2 - 0.001))
  }

  const degrees = readNumber(config.maxPitchDegrees, null)

  if (degrees != null) {
    return Math.max(0, Math.min((degrees * Math.PI) / 180, Math.PI / 2 - 0.001))
  }

  return Math.PI / 2 - 0.01
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}
