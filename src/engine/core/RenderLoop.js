export class RenderLoop {
  constructor({ update, render, afterFrame = null, config = {} }) {
    this.updateFrame = update
    this.renderFrame = render
    this.afterFrame = afterFrame
    this.animationFrameId = null
    this.lastTime = 0
    this.lastRenderTime = 0
    this.elapsedTime = 0
    this.running = false
    this.maxDeltaTime = Math.max(readNumber(config.maxDeltaTime, 0.1), 0.001)
    this.maxWallDeltaTime = Math.max(readNumber(config.maxWallDeltaTime, 0.5), 0.001)
    this.fpsCap = normalizeFpsCap(config.fpsCap, 60)
    this.frameInterval = this.fpsCap > 0 ? 1 / this.fpsCap : 0
    this.frameAccumulator = 0
    this.displayFrameInterval = 1 / 60
    this.displayFrameSmoothing = clamp(readNumber(config.displayFrameSmoothing, 0.08), 0, 1)
    this.frameTiming = {
      simulationDeltaTime: 0,
      wallDeltaTime: 0,
      updateTimeMs: 0,
      renderTimeMs: 0,
      frameCpuTimeMs: 0,
      frameBudgetMs: 0,
      fpsCap: this.fpsCap,
    }
  }

  start() {
    if (this.running) {
      return
    }

    this.running = true
    this.lastTime = performance.now()
    this.lastRenderTime = this.lastTime
    this.animationFrameId = window.requestAnimationFrame((time) => this.tick(time))
  }

  stop() {
    this.running = false

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  tick(time) {
    if (!this.running) {
      return
    }

    const deltaTime = Math.min((time - this.lastTime) / 1000, this.maxDeltaTime)

    this.lastTime = time
    this.updateDisplayFrameInterval(deltaTime)
    this.frameAccumulator += deltaTime

    if (this.fpsCap === 0 || this.frameAccumulator + 0.0005 >= this.frameInterval) {
      this.runFrame(time, deltaTime)
    }

    this.scheduleNextTick()
  }

  runFrame(time, deltaTime) {
    const frameDeltaTime = this.fpsCap === 0 ? deltaTime : this.frameInterval
    const wallDeltaTime = Math.min((time - this.lastRenderTime) / 1000, this.maxWallDeltaTime)

    this.frameAccumulator = this.fpsCap === 0 ? 0 : this.frameAccumulator - this.frameInterval
    this.lastRenderTime = time

    if (this.frameAccumulator > this.frameInterval) {
      this.frameAccumulator = 0
    }

    this.elapsedTime += frameDeltaTime

    const updateStart = performance.now()
    this.updateFrame(frameDeltaTime, this.elapsedTime)
    const renderStart = performance.now()
    this.renderFrame()
    const renderEnd = performance.now()

    if (this.afterFrame) {
      this.writeFrameTiming(frameDeltaTime, wallDeltaTime, updateStart, renderStart, renderEnd)
      this.afterFrame(this.frameTiming)
    }
  }

  scheduleNextTick() {
    this.animationFrameId = window.requestAnimationFrame((nextTime) => this.tick(nextTime))
  }

  writeFrameTiming(frameDeltaTime, wallDeltaTime, updateStart, renderStart, renderEnd) {
    this.frameTiming.simulationDeltaTime = frameDeltaTime
    this.frameTiming.wallDeltaTime = wallDeltaTime
    this.frameTiming.updateTimeMs = renderStart - updateStart
    this.frameTiming.renderTimeMs = renderEnd - renderStart
    this.frameTiming.frameCpuTimeMs = renderEnd - updateStart
    this.frameTiming.frameBudgetMs = this.getFrameBudgetMs()
    this.frameTiming.fpsCap = this.fpsCap
  }

  updateDisplayFrameInterval(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0 || deltaTime >= this.maxDeltaTime) return
    this.displayFrameInterval += (deltaTime - this.displayFrameInterval) * this.displayFrameSmoothing
  }

  getFrameBudgetMs() {
    return (this.fpsCap > 0 ? this.frameInterval : this.displayFrameInterval) * 1000
  }

  setFpsCap(fpsCap) {
    this.fpsCap = normalizeFpsCap(fpsCap, this.fpsCap)
    this.frameInterval = this.fpsCap > 0 ? 1 / this.fpsCap : 0
    this.frameAccumulator = 0
  }
}

function normalizeFpsCap(value, fallback) {
  const fpsCap = Math.floor(readNumber(value, fallback))

  return Math.max(fpsCap, 0)
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
