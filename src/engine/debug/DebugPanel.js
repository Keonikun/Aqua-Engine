export class DebugPanel {
  constructor({ element, onVisibilityChange = null }) {
    this.element = element
    this.onVisibilityChange = onVisibilityChange
    this.frameCount = 0
    this.elapsed = 0
    this.fps = 0
    this.lastRender = null
    this.lastCollision = null
    this.lastUpdate = 0
    this.visible = false
    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.element.hidden = true

    window.addEventListener('keydown', this.onKeyDown)
  }

  update({
    deltaTime,
    fixedSteps,
    playerState,
    input,
    renderStats,
    rendererMemoryStats,
    collisionStats,
    worldStats,
    profilerStatus,
    frameTiming = {},
  }) {
    if (!this.visible) {
      return
    }

    this.frameCount += 1
    this.elapsed += deltaTime
    this.lastUpdate += deltaTime

    if (this.elapsed >= 0.25) {
      this.fps = Math.round(this.frameCount / this.elapsed)
      this.frameCount = 0
      this.elapsed = 0
    }

    this.lastRender = renderStats
    this.lastCollision = collisionStats

    if (this.lastUpdate < 0.15) {
      return
    }

    this.lastUpdate = 0

    const position = playerState.position
    const velocity = playerState.velocity
    const profilerRows = renderProfilerRows(profilerStatus)

    this.element.innerHTML = `
      <p class="eyebrow">Aqua Engine</p>
      <h1>Debug Panel</h1>
      <dl>
        <div><dt>FPS</dt><dd>${this.fps}</dd></div>
        <div><dt>Frame</dt><dd>${formatMs(frameTiming.wallDeltaTime * 1000 || deltaTime * 1000)}</dd></div>
        <div><dt>CPU frame</dt><dd>${formatMs(frameTiming.frameCpuTimeMs)}</dd></div>
        <div><dt>Update/render</dt><dd>${formatMs(frameTiming.updateTimeMs)} / ${formatMs(frameTiming.renderTimeMs)}</dd></div>
        <div><dt>Fixed steps</dt><dd>${fixedSteps}</dd></div>
        <div><dt>Draw calls</dt><dd>${renderStats.calls}</dd></div>
        <div><dt>Triangles</dt><dd>${formatNumber(renderStats.triangles)}</dd></div>
        <div><dt>GPU memory</dt><dd>${formatNumber(rendererMemoryStats.geometries)} geo / ${formatNumber(rendererMemoryStats.textures)} tex</dd></div>
        <div><dt>World tris</dt><dd>${formatNumber(worldStats.renderTriangles)} render / ${formatNumber(worldStats.collisionTriangles)} collision</dd></div>
        <div><dt>Hull traces</dt><dd>${collisionStats.hullTraces}</dd></div>
        <div><dt>Hull tests</dt><dd>${collisionStats.hullIntersections}</dd></div>
        <div><dt>Collision</dt><dd>${collisionStats.queryTimeMs.toFixed(3)} ms</dd></div>
        <div><dt>Pointer</dt><dd>${input.pointerLocked ? 'locked' : 'click canvas'}</dd></div>
        <div><dt>Grounded</dt><dd>${playerState.grounded}</dd></div>
        <div><dt>No-clip</dt><dd>${playerState.noclip}</dd></div>
        <div><dt>Stuck</dt><dd>${playerState.stuck}</dd></div>
        <div><dt>Position</dt><dd>${formatVector(position)}</dd></div>
        <div><dt>Velocity</dt><dd>${formatVector(velocity)}</dd></div>
        <div><dt>Contacts</dt><dd>${playerState.contacts.length}</dd></div>
        <div><dt>Profiler</dt><dd>${formatProfiler(profilerStatus)}</dd></div>
        ${profilerRows}
        <div><dt>Toggle</dt><dd>F3</dd></div>
        <div><dt>Record</dt><dd>F4</dd></div>
      </dl>
    `
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
  }

  handleKeyDown(event) {
    if (event.code !== 'F3') {
      return
    }

    event.preventDefault()
    this.visible = !this.visible
    this.setVisible(this.visible)
  }

  setVisible(visible) {
    this.visible = visible
    this.element.hidden = !visible

    if (this.onVisibilityChange) {
      this.onVisibilityChange(visible)
    }
  }
}

function formatVector(vector) {
  return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(2)} ms`
}

function formatProfiler(status) {
  if (status.recording) {
    return `recording ${status.elapsed.toFixed(1)}s / ${status.sampleCount} samples`
  }

  if (status.lastReport) {
    return `saved ${status.lastReport.durationSeconds.toFixed(1)}s`
  }

  return 'idle'
}

function renderProfilerRows(status) {
  const profile = status.recording
    ? status.liveSummary
    : {
        summary: status.lastReportSummary,
        budget: status.lastReportBudget,
        worstFrame: status.lastReport?.worstFrames?.[0] || null,
      }

  if (!profile?.summary) {
    return ''
  }

  const summary = profile.summary
  const budget = profile.budget
  const worstFrame = profile.worstFrame || status.lastReport?.worstFrames?.[0] || null

  return `
        <div><dt>FPS p05/p50</dt><dd>${summary.fps.p05.toFixed(1)} / ${summary.fps.p50.toFixed(1)}</dd></div>
        <div><dt>Frame p95/p99</dt><dd>${summary.frameTimeMs.p95.toFixed(2)} / ${summary.frameTimeMs.p99.toFixed(2)} ms</dd></div>
        <div><dt>CPU p95</dt><dd>${summary.cpuFrameTimeMs.p95.toFixed(2)} ms</dd></div>
        <div><dt>Update p95</dt><dd>${summary.updateTimeMs.p95.toFixed(2)} ms</dd></div>
        <div><dt>Render p95</dt><dd>${summary.renderTimeMs.p95.toFixed(2)} ms</dd></div>
        <div><dt>Collide p95</dt><dd>${summary.collisionTimeMs.p95.toFixed(3)} ms</dd></div>
        <div><dt>Budget miss</dt><dd>${budget.overBudgetPercent.toFixed(1)}% @ ${budget.frameBudgetMs.toFixed(2)} ms</dd></div>
        <div><dt>Worst frame</dt><dd>${worstFrame ? `${worstFrame.frameTimeMs.toFixed(2)} ms @ ${worstFrame.t.toFixed(2)}s` : 'none'}</dd></div>
  `
}
