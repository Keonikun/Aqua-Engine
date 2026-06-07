export class RenderLoop {
  constructor({ update, render, afterFrame = null }) {
    this.update = update
    this.render = render
    this.afterFrame = afterFrame
    this.animationFrameId = null
    this.lastTime = 0
    this.lastRenderTime = 0
    this.elapsedTime = 0
    this.running = false
    this.fpsCap = 60
    this.frameInterval = 1 / this.fpsCap
    this.frameAccumulator = 0
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

    const deltaTime = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time
    this.frameAccumulator += deltaTime

    if (this.fpsCap === 0 || this.frameAccumulator + 0.0005 >= this.frameInterval) {
      const frameDeltaTime = this.fpsCap === 0 ? deltaTime : this.frameInterval
      const wallDeltaTime = Math.min((time - this.lastRenderTime) / 1000, 0.5)
      this.frameAccumulator = this.fpsCap === 0 ? 0 : this.frameAccumulator - this.frameInterval
      this.lastRenderTime = time

      if (this.frameAccumulator > this.frameInterval) {
        this.frameAccumulator = 0
      }

      this.elapsedTime += frameDeltaTime

      const updateStart = performance.now()
      this.update(frameDeltaTime, this.elapsedTime)
      const renderStart = performance.now()
      this.render()
      const renderEnd = performance.now()

      if (this.afterFrame) {
        this.afterFrame({
          simulationDeltaTime: frameDeltaTime,
          wallDeltaTime,
          updateTimeMs: renderStart - updateStart,
          renderTimeMs: renderEnd - renderStart,
          frameCpuTimeMs: renderEnd - updateStart,
          fpsCap: this.fpsCap,
        })
      }
    }

    this.animationFrameId = window.requestAnimationFrame((nextTime) => this.tick(nextTime))
  }

  setFpsCap(fpsCap) {
    this.fpsCap = fpsCap
    this.frameInterval = fpsCap > 0 ? 1 / fpsCap : 0
    this.frameAccumulator = 0
  }
}
