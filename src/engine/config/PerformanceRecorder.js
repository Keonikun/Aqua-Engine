const LIVE_SAMPLE_WINDOW = 180
const WORST_FRAME_COUNT = 20
const STUTTER_EVENT_COUNT = 12
const DEFAULT_FRAME_BUDGET_MS = 1000 / 60

export class PerformanceRecorder {
  constructor({ contextProvider = null } = {}) {
    this.contextProvider = contextProvider
    this.recording = false
    this.startedAt = 0
    this.elapsed = 0
    this.samples = []
    this.startedContext = null
    this.latestContext = null
    this.lastReport = null
    this.onStateChange = null
    this.onKeyDown = (event) => this.handleKeyDown(event)

    window.addEventListener('keydown', this.onKeyDown)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
  }

  sample({
    deltaTime,
    fixedSteps,
    playerState,
    renderStats,
    rendererMemoryStats,
    collisionStats,
    frameTiming = {},
    context = null,
  }) {
    if (!this.recording) {
      return
    }

    this.elapsed += deltaTime
    this.latestContext = context || this.latestContext || this.readContext()

    const frameTimeMs = readNumber(frameTiming.wallDeltaTime * 1000, deltaTime * 1000)
    const simulationTimeMs = readNumber(frameTiming.simulationDeltaTime * 1000, deltaTime * 1000)
    const updateTimeMs = readNumber(frameTiming.updateTimeMs, 0)
    const renderTimeMs = readNumber(frameTiming.renderTimeMs, 0)
    const cpuFrameTimeMs = readNumber(frameTiming.frameCpuTimeMs, updateTimeMs + renderTimeMs)
    const jsMemory = readJsMemory()
    const hullTraces = readNumber(collisionStats.hullTraces, 0)
    const collisionTimeMs = readNumber(collisionStats.queryTimeMs, 0)

    this.samples.push({
      index: this.samples.length,
      t: round(this.elapsed, 3),
      fps: frameTimeMs > 0 ? round(1000 / frameTimeMs, 3) : 0,
      frameTimeMs: round(frameTimeMs, 3),
      simulationTimeMs: round(simulationTimeMs, 3),
      updateTimeMs: round(updateTimeMs, 3),
      renderTimeMs: round(renderTimeMs, 3),
      cpuFrameTimeMs: round(cpuFrameTimeMs, 3),
      fixedSteps,
      drawCalls: readNumber(renderStats.calls, 0),
      triangles: readNumber(renderStats.triangles, 0),
      lines: readNumber(renderStats.lines, 0),
      points: readNumber(renderStats.points, 0),
      geometries: readNumber(rendererMemoryStats.geometries, 0),
      textures: readNumber(rendererMemoryStats.textures, 0),
      hullTraces,
      hullIntersections: readNumber(collisionStats.hullIntersections, 0),
      collisionTimeMs: round(collisionTimeMs, 3),
      collisionTimePerTraceMs: hullTraces > 0 ? round(collisionTimeMs / hullTraces, 4) : 0,
      grounded: playerState.grounded,
      noclip: playerState.noclip,
      stuck: playerState.stuck,
      position: vectorToArray(playerState.position),
      velocity: vectorToArray(playerState.velocity),
      contacts: playerState.contacts.length,
      jsHeapUsedMB: jsMemory ? jsMemory.used : null,
      jsHeapTotalMB: jsMemory ? jsMemory.total : null,
    })
  }

  toggle() {
    if (this.recording) {
      return this.stop()
    }

    this.start()
    return null
  }

  start() {
    this.recording = true
    this.startedAt = Date.now()
    this.elapsed = 0
    this.samples.length = 0
    this.startedContext = this.readContext()
    this.latestContext = this.startedContext
    this.lastReport = null
    this.emitStateChange()
  }

  stop() {
    if (!this.recording) {
      return this.lastReport
    }

    this.recording = false
    this.lastReport = this.buildReport()
    this.downloadReport(this.lastReport)
    this.emitStateChange()

    return this.lastReport
  }

  downloadLastReport() {
    if (!this.lastReport) {
      return null
    }

    this.downloadReport(this.lastReport)
    return this.lastReport
  }

  getStatus() {
    const liveSummary = this.recording ? this.buildLiveSummary() : null

    return {
      recording: this.recording,
      elapsed: this.elapsed,
      sampleCount: this.samples.length,
      liveSummary,
      liveBudget: liveSummary ? liveSummary.budget : null,
      lastReport: this.lastReport,
      lastReportSummary: this.lastReport ? this.lastReport.summary : null,
      lastReportBudget: this.lastReport ? this.lastReport.budget : null,
    }
  }

  buildLiveSummary() {
    const samples = this.samples.slice(-LIVE_SAMPLE_WINDOW)
    const frameBudgetMs = getFrameBudgetMs(this.latestContext)

    return {
      windowSamples: samples.length,
      summary: buildSummary(samples),
      budget: summarizeBudget(samples, frameBudgetMs),
      worstFrame: getWorstFrames(samples, 1)[0] || null,
    }
  }

  buildReport() {
    const endedContext = this.readContext()
    const frameBudgetMs = getFrameBudgetMs(this.latestContext || this.startedContext)
    const summary = buildSummary(this.samples)
    const budget = summarizeBudget(this.samples, frameBudgetMs)

    return {
      type: 'aqua-engine-performance-profile',
      version: 2,
      createdAt: new Date().toISOString(),
      durationSeconds: round(this.elapsed, 3),
      sampleCount: this.samples.length,
      context: {
        started: this.startedContext,
        ended: endedContext,
      },
      summary,
      budget,
      worstFrames: getWorstFrames(this.samples, WORST_FRAME_COUNT),
      stutterEvents: getStutterEvents(this.samples, frameBudgetMs),
      samples: this.samples,
    }
  }

  downloadReport(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    link.href = url
    link.download = `aqua-profile-${timestamp}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  handleKeyDown(event) {
    if (event.code !== 'F4') {
      return
    }

    event.preventDefault()
    this.toggle()
  }

  setStateChangeHandler(handler) {
    this.onStateChange = handler
  }

  emitStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getStatus())
    }
  }

  readContext() {
    if (!this.contextProvider) {
      return getFallbackContext()
    }

    try {
      return this.contextProvider()
    } catch (error) {
      return {
        ...getFallbackContext(),
        contextError: error?.message || 'Failed to read profiler context',
      }
    }
  }
}

function buildSummary(samples) {
  return {
    fps: summarize(samples, 'fps'),
    frameTimeMs: summarize(samples, 'frameTimeMs'),
    simulationTimeMs: summarize(samples, 'simulationTimeMs'),
    updateTimeMs: summarize(samples, 'updateTimeMs'),
    renderTimeMs: summarize(samples, 'renderTimeMs'),
    cpuFrameTimeMs: summarize(samples, 'cpuFrameTimeMs'),
    fixedSteps: summarize(samples, 'fixedSteps'),
    drawCalls: summarize(samples, 'drawCalls'),
    triangles: summarize(samples, 'triangles'),
    lines: summarize(samples, 'lines'),
    points: summarize(samples, 'points'),
    geometries: summarize(samples, 'geometries'),
    textures: summarize(samples, 'textures'),
    hullTraces: summarize(samples, 'hullTraces'),
    hullIntersections: summarize(samples, 'hullIntersections'),
    collisionTimeMs: summarize(samples, 'collisionTimeMs'),
    collisionTimePerTraceMs: summarize(samples, 'collisionTimePerTraceMs'),
    contacts: summarize(samples, 'contacts'),
    jsHeapUsedMB: summarize(samples, 'jsHeapUsedMB'),
  }
}

function summarize(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  if (values.length === 0) {
    return emptySummary()
  }

  let total = 0

  for (const value of values) {
    total += value
  }

  return {
    min: round(values[0]),
    p05: round(percentile(values, 0.05)),
    p50: round(percentile(values, 0.5)),
    p75: round(percentile(values, 0.75)),
    p90: round(percentile(values, 0.9)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(values[values.length - 1]),
    avg: round(total / values.length),
  }
}

function emptySummary() {
  return {
    min: 0,
    p05: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    p95: 0,
    p99: 0,
    max: 0,
    avg: 0,
  }
}

function percentile(values, ratio) {
  if (values.length === 1) {
    return values[0]
  }

  const index = (values.length - 1) * ratio
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  return values[lower] * (1 - weight) + values[upper] * weight
}

function summarizeBudget(samples, frameBudgetMs) {
  if (samples.length === 0) {
    return {
      frameBudgetMs: round(frameBudgetMs),
      overBudgetFrames: 0,
      overBudgetPercent: 0,
      overDoubleBudgetFrames: 0,
      overDoubleBudgetPercent: 0,
    }
  }

  let overBudgetFrames = 0
  let overDoubleBudgetFrames = 0

  for (const sample of samples) {
    if (sample.frameTimeMs > frameBudgetMs) {
      overBudgetFrames += 1
    }

    if (sample.frameTimeMs > frameBudgetMs * 2) {
      overDoubleBudgetFrames += 1
    }
  }

  return {
    frameBudgetMs: round(frameBudgetMs),
    overBudgetFrames,
    overBudgetPercent: round((overBudgetFrames / samples.length) * 100),
    overDoubleBudgetFrames,
    overDoubleBudgetPercent: round((overDoubleBudgetFrames / samples.length) * 100),
  }
}

function getWorstFrames(samples, count) {
  return [...samples]
    .sort((a, b) => b.frameTimeMs - a.frameTimeMs)
    .slice(0, count)
    .map(compactFrameSample)
}

function getStutterEvents(samples, frameBudgetMs) {
  const events = []
  let current = null

  for (const sample of samples) {
    if (sample.frameTimeMs <= frameBudgetMs) {
      if (current) {
        events.push(current)
        current = null
      }

      continue
    }

    if (!current) {
      current = {
        startTime: sample.t,
        endTime: sample.t,
        frames: 0,
        maxFrameTimeMs: 0,
        avgFrameTimeMs: 0,
        totalFrameTimeMs: 0,
      }
    }

    current.endTime = sample.t
    current.frames += 1
    current.maxFrameTimeMs = Math.max(current.maxFrameTimeMs, sample.frameTimeMs)
    current.totalFrameTimeMs += sample.frameTimeMs
    current.avgFrameTimeMs = round(current.totalFrameTimeMs / current.frames)
  }

  if (current) {
    events.push(current)
  }

  return events
    .map((event) => ({
      ...event,
      startTime: round(event.startTime, 3),
      endTime: round(event.endTime, 3),
      maxFrameTimeMs: round(event.maxFrameTimeMs),
      totalFrameTimeMs: round(event.totalFrameTimeMs),
    }))
    .sort((a, b) => b.maxFrameTimeMs - a.maxFrameTimeMs)
    .slice(0, STUTTER_EVENT_COUNT)
}

function compactFrameSample(sample) {
  return {
    index: sample.index,
    t: sample.t,
    fps: sample.fps,
    frameTimeMs: sample.frameTimeMs,
    simulationTimeMs: sample.simulationTimeMs,
    updateTimeMs: sample.updateTimeMs,
    renderTimeMs: sample.renderTimeMs,
    cpuFrameTimeMs: sample.cpuFrameTimeMs,
    fixedSteps: sample.fixedSteps,
    drawCalls: sample.drawCalls,
    triangles: sample.triangles,
    hullTraces: sample.hullTraces,
    hullIntersections: sample.hullIntersections,
    collisionTimeMs: sample.collisionTimeMs,
    contacts: sample.contacts,
    position: sample.position,
  }
}

function getFrameBudgetMs(context) {
  const budget = Number(context?.frameBudgetMs)

  return Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_FRAME_BUDGET_MS
}

function getFallbackContext() {
  return {
    url: window.location.href,
    frameBudgetMs: DEFAULT_FRAME_BUDGET_MS,
    userAgent: window.navigator.userAgent,
  }
}

function readJsMemory() {
  const memory = performance.memory

  if (!memory) {
    return null
  }

  return {
    used: round(bytesToMegabytes(memory.usedJSHeapSize), 3),
    total: round(bytesToMegabytes(memory.totalJSHeapSize), 3),
  }
}

function bytesToMegabytes(value) {
  return value / (1024 * 1024)
}

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits

  return Math.round(value * multiplier) / multiplier
}

function vectorToArray(vector) {
  return [
    round(vector.x, 3),
    round(vector.y, 3),
    round(vector.z, 3),
  ]
}
