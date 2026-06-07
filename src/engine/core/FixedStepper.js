export class FixedStepper {
  constructor({ fixedTimeStep, maxSubSteps = 5, step }) {
    this.fixedTimeStep = fixedTimeStep
    this.maxSubSteps = maxSubSteps
    this.step = step
    this.accumulator = 0
    this.lastStepCount = 0
  }

  update(deltaTime) {
    this.accumulator += Math.min(deltaTime, this.fixedTimeStep * this.maxSubSteps)
    this.lastStepCount = 0

    while (this.accumulator >= this.fixedTimeStep && this.lastStepCount < this.maxSubSteps) {
      this.step(this.fixedTimeStep)
      this.accumulator -= this.fixedTimeStep
      this.lastStepCount += 1
    }
  }
}
