export class SettingsMenu {
  constructor({ element, engine }) {
    this.element = element
    this.engine = engine
    this.visible = false
    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.onPointerLockChange = () => this.handlePointerLockChange()

    this.render()
    this.bindControls()
    this.setVisible(false)
    this.engine.setProfilerStateChangeHandler((status) => this.syncProfilerButton(status))
    this.syncProfilerButton(this.engine.getPerformanceProfileStatus())
    window.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
  }

  render() {
    this.element.innerHTML = `
      <div class="settings-header">
        <p class="eyebrow">Settings</p>
        <button class="icon-button" type="button" data-action="toggle-settings" title="Hide settings">Esc</button>
      </div>
      <label>
        <span>FPS cap</span>
        <select data-setting="fps">
          <option value="0">Unlimited</option>
          <option value="30">30</option>
          <option value="45">45</option>
          <option value="60" selected>60</option>
          <option value="90">90</option>
          <option value="120">120</option>
        </select>
      </label>
      <label>
        <span>Resolution</span>
        <input data-setting="resolution" type="range" min="0.35" max="1" step="0.05" value="1">
        <output data-output="resolution">100%</output>
      </label>
      <label>
        <span>Graphics</span>
        <select data-setting="graphics">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        <span>Textures</span>
        <select data-setting="textures">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        <span>Mouse speed</span>
        <input data-setting="mouse" type="range" min="0.5" max="2.5" step="0.1" value="1">
        <output data-output="mouse">1.0x</output>
      </label>
      <label class="check-row">
        <span>Debug panel</span>
        <input data-setting="debug" type="checkbox">
      </label>
      <label class="check-row">
        <span>Collision brushes</span>
        <input data-setting="collision-brushes" type="checkbox">
      </label>
      <label class="check-row">
        <span>No-clip</span>
        <input data-setting="noclip" type="checkbox">
      </label>
      <button class="settings-action" type="button" data-action="toggle-profiler">Start profiler (F4)</button>
      <button class="settings-action" type="button" data-action="download-profile" disabled>Download last profile</button>
    `
  }

  bindControls() {
    this.element.querySelector('[data-action="toggle-settings"]').addEventListener('click', () => {
      this.setVisible(false)
    })

    this.element.querySelector('[data-setting="fps"]').addEventListener('change', (event) => {
      this.engine.setFpsCap(Number(event.target.value))
    })

    this.element.querySelector('[data-setting="resolution"]').addEventListener('input', (event) => {
      const scale = Number(event.target.value)
      this.engine.setResolutionScale(scale)
      this.element.querySelector('[data-output="resolution"]').textContent = `${Math.round(scale * 100)}%`
    })

    this.element.querySelector('[data-setting="graphics"]').addEventListener('change', (event) => {
      this.engine.setGraphicsQuality(event.target.value)
    })

    this.element.querySelector('[data-setting="textures"]').addEventListener('change', (event) => {
      this.engine.setTextureQuality(event.target.value)
    })

    this.element.querySelector('[data-setting="mouse"]').addEventListener('input', (event) => {
      const scale = Number(event.target.value)
      this.engine.setMouseSensitivityScale(scale)
      this.element.querySelector('[data-output="mouse"]').textContent = `${scale.toFixed(1)}x`
    })

    this.element.querySelector('[data-setting="debug"]').addEventListener('change', (event) => {
      this.engine.setDebugVisible(event.target.checked)
    })

    this.element.querySelector('[data-setting="collision-brushes"]').addEventListener('change', (event) => {
      this.engine.setCollisionBrushesVisible(event.target.checked)
    })

    this.element.querySelector('[data-setting="noclip"]').addEventListener('change', (event) => {
      this.engine.setNoclipEnabled(event.target.checked)
    })

    this.element.querySelector('[data-action="toggle-profiler"]').addEventListener('click', (event) => {
      const report = this.engine.togglePerformanceRecording()
      event.target.textContent = report ? 'Start profiler (F4)' : 'Stop profiler (F4)'
    })

    this.element.querySelector('[data-action="download-profile"]').addEventListener('click', () => {
      this.engine.downloadLastPerformanceReport()
    })
  }

  handleKeyDown(event) {
    if (event.code === 'Escape') {
      event.preventDefault()
      this.setVisible(!this.visible)
      return
    }

    if (event.code === 'KeyV') {
      event.preventDefault()
      this.setNoclipChecked(this.engine.toggleNoclip())
    }
  }

  handlePointerLockChange() {
    if (!document.pointerLockElement && !this.visible) {
      this.setVisible(true)
    }
  }

  setVisible(visible) {
    this.visible = visible
    this.element.hidden = !visible

    if (visible && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }

  syncProfilerButton(status) {
    const button = this.element.querySelector('[data-action="toggle-profiler"]')
    const downloadButton = this.element.querySelector('[data-action="download-profile"]')

    if (button) {
      button.textContent = status.recording ? 'Stop profiler (F4)' : 'Start profiler (F4)'
    }

    if (downloadButton) {
      downloadButton.disabled = status.recording || !status.lastReport
    }
  }

  setNoclipChecked(enabled) {
    const input = this.element.querySelector('[data-setting="noclip"]')

    if (input) {
      input.checked = enabled
    }
  }
}
