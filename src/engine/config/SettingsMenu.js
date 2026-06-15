export class SettingsMenu {
  constructor({ element, engine, settings = {} }) {
    this.element = element
    this.engine = engine
    this.settings = normalizeSettings(settings, engine)
    this.visible = false
    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.onPointerLockChange = () => this.handlePointerLockChange()

    this.render()
    this.bindControls()
    this.applyInitialSettings()
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
          ${this.renderOptions(this.settings.fpsOptions, this.settings.defaults.fpsCap, formatFpsOption)}
        </select>
      </label>
      <label>
        <span>Resolution</span>
        <input data-setting="resolution" type="range" ${renderRangeAttributes(this.settings.resolutionScale)} value="${escapeAttribute(this.settings.defaults.resolutionScale)}">
        <output data-output="resolution">${formatPercent(this.settings.defaults.resolutionScale)}</output>
      </label>
      <label>
        <span>Graphics</span>
        <select data-setting="graphics">
          ${this.renderOptions(this.settings.graphicsOptions, this.settings.defaults.graphicsQuality, formatLabel)}
        </select>
      </label>
      <label>
        <span>Textures</span>
        <select data-setting="textures">
          ${this.renderOptions(this.settings.textureOptions, this.settings.defaults.textureQuality, formatLabel)}
        </select>
      </label>
      <label>
        <span>Mouse speed</span>
        <input data-setting="mouse" type="range" ${renderRangeAttributes(this.settings.mouseSensitivityScale)} value="${escapeAttribute(this.settings.defaults.mouseSensitivityScale)}">
        <output data-output="mouse">${formatScale(this.settings.defaults.mouseSensitivityScale)}</output>
      </label>
      <label class="check-row">
        <span>Post processing</span>
        <input data-setting="post-processing-enabled" type="checkbox"${this.settings.defaults.postProcessing.enabled ? ' checked' : ''}>
      </label>
      <label class="check-row">
        <span>Grain</span>
        <input data-setting="grain-enabled" type="checkbox"${this.settings.defaults.postProcessing.grain.enabled ? ' checked' : ''}>
      </label>
      <label>
        <span>Grain amount</span>
        <input data-setting="grain-intensity" type="range" ${renderRangeAttributes(this.settings.postProcessing.grainIntensity)} value="${escapeAttribute(this.settings.defaults.postProcessing.grain.intensity)}">
        <output data-output="grain-intensity">${formatDecimal(this.settings.defaults.postProcessing.grain.intensity, 3)}</output>
      </label>
      <label class="check-row">
        <span>Fish-eye</span>
        <input data-setting="fish-eye-enabled" type="checkbox"${this.settings.defaults.postProcessing.fishEye.enabled ? ' checked' : ''}>
      </label>
      <label>
        <span>Fish-eye amount</span>
        <input data-setting="fish-eye-strength" type="range" ${renderRangeAttributes(this.settings.postProcessing.fishEyeStrength)} value="${escapeAttribute(this.settings.defaults.postProcessing.fishEye.strength)}">
        <output data-output="fish-eye-strength">${formatDecimal(this.settings.defaults.postProcessing.fishEye.strength, 2)}</output>
      </label>
      <label class="check-row">
        <span>Vignette</span>
        <input data-setting="vignette-enabled" type="checkbox"${this.settings.defaults.postProcessing.vignette.enabled ? ' checked' : ''}>
      </label>
      <label>
        <span>Vignette amount</span>
        <input data-setting="vignette-darkness" type="range" ${renderRangeAttributes(this.settings.postProcessing.vignetteDarkness)} value="${escapeAttribute(this.settings.defaults.postProcessing.vignette.darkness)}">
        <output data-output="vignette-darkness">${formatDecimal(this.settings.defaults.postProcessing.vignette.darkness, 2)}</output>
      </label>
      <label class="check-row">
        <span>Chromatic</span>
        <input data-setting="chromatic-aberration-enabled" type="checkbox"${this.settings.defaults.postProcessing.chromaticAberration.enabled ? ' checked' : ''}>
      </label>
      <label>
        <span>Chromatic amount</span>
        <input data-setting="chromatic-aberration-offset" type="range" ${renderRangeAttributes(this.settings.postProcessing.chromaticAberrationOffset)} value="${escapeAttribute(this.settings.defaults.postProcessing.chromaticAberration.offset)}">
        <output data-output="chromatic-aberration-offset">${formatDecimal(this.settings.defaults.postProcessing.chromaticAberration.offset, 1)}</output>
      </label>
      <label class="check-row">
        <span>Debug panel</span>
        <input data-setting="debug" type="checkbox"${this.settings.defaults.debugVisible ? ' checked' : ''}>
      </label>
      <label class="check-row">
        <span>Collision brushes</span>
        <input data-setting="collision-brushes" type="checkbox"${this.settings.defaults.collisionBrushesVisible ? ' checked' : ''}>
      </label>
      <label class="check-row">
        <span>No-clip</span>
        <input data-setting="noclip" type="checkbox"${this.settings.defaults.noclipEnabled ? ' checked' : ''}>
      </label>
      <button class="settings-action" type="button" data-action="toggle-profiler">Start profiler (F4)</button>
      <button class="settings-action" type="button" data-action="download-profile" disabled>Download last profile</button>
    `
  }

  renderOptions(options, selectedValue, labelFormatter) {
    return options.map((option) => {
      const value = String(option)
      const selected = String(selectedValue) === value ? ' selected' : ''

      return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(labelFormatter(option))}</option>`
    }).join('')
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
      this.element.querySelector('[data-output="resolution"]').textContent = formatPercent(scale)
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
      this.element.querySelector('[data-output="mouse"]').textContent = formatScale(scale)
    })

    this.element.querySelector('[data-setting="post-processing-enabled"]').addEventListener('change', (event) => {
      this.engine.setPostProcessingEnabled(event.target.checked)
    })

    this.element.querySelector('[data-setting="grain-enabled"]').addEventListener('change', (event) => {
      this.engine.setPostProcessingEffectSettings('grain', { enabled: event.target.checked })
    })

    this.element.querySelector('[data-setting="grain-intensity"]').addEventListener('input', (event) => {
      const intensity = Number(event.target.value)

      this.engine.setPostProcessingEffectSettings('grain', { intensity })
      this.element.querySelector('[data-output="grain-intensity"]').textContent = formatDecimal(intensity, 3)
    })

    this.element.querySelector('[data-setting="fish-eye-enabled"]').addEventListener('change', (event) => {
      this.engine.setPostProcessingEffectSettings('fishEye', { enabled: event.target.checked })
    })

    this.element.querySelector('[data-setting="fish-eye-strength"]').addEventListener('input', (event) => {
      const strength = Number(event.target.value)

      this.engine.setPostProcessingEffectSettings('fishEye', { strength })
      this.element.querySelector('[data-output="fish-eye-strength"]').textContent = formatDecimal(strength, 2)
    })

    this.element.querySelector('[data-setting="vignette-enabled"]').addEventListener('change', (event) => {
      this.engine.setPostProcessingEffectSettings('vignette', { enabled: event.target.checked })
    })

    this.element.querySelector('[data-setting="vignette-darkness"]').addEventListener('input', (event) => {
      const darkness = Number(event.target.value)

      this.engine.setPostProcessingEffectSettings('vignette', { darkness })
      this.element.querySelector('[data-output="vignette-darkness"]').textContent = formatDecimal(darkness, 2)
    })

    this.element.querySelector('[data-setting="chromatic-aberration-enabled"]').addEventListener('change', (event) => {
      this.engine.setPostProcessingEffectSettings('chromaticAberration', { enabled: event.target.checked })
    })

    this.element.querySelector('[data-setting="chromatic-aberration-offset"]').addEventListener('input', (event) => {
      const offset = Number(event.target.value)

      this.engine.setPostProcessingEffectSettings('chromaticAberration', { offset })
      this.element.querySelector('[data-output="chromatic-aberration-offset"]').textContent = formatDecimal(offset, 1)
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

  applyInitialSettings() {
    const defaults = this.settings.defaults

    this.engine.setFpsCap(defaults.fpsCap)
    this.engine.setResolutionScale(defaults.resolutionScale)
    this.engine.setGraphicsQuality(defaults.graphicsQuality)
    this.engine.setTextureQuality(defaults.textureQuality)
    this.engine.setMouseSensitivityScale(defaults.mouseSensitivityScale)
    this.engine.setPostProcessingEnabled(defaults.postProcessing.enabled)
    this.engine.setPostProcessingEffectSettings('grain', defaults.postProcessing.grain)
    this.engine.setPostProcessingEffectSettings('fishEye', defaults.postProcessing.fishEye)
    this.engine.setPostProcessingEffectSettings('vignette', defaults.postProcessing.vignette)
    this.engine.setPostProcessingEffectSettings('chromaticAberration', defaults.postProcessing.chromaticAberration)
    this.engine.setDebugVisible(defaults.debugVisible)
    this.engine.setCollisionBrushesVisible(defaults.collisionBrushesVisible)
    this.setNoclipChecked(this.engine.setNoclipEnabled(defaults.noclipEnabled))
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

function normalizeSettings(settings, engine) {
  const postProcessing = normalizePostProcessingDefaults(
    engine.getPostProcessingConfig?.(),
    settings.defaults?.postProcessing,
  )
  const defaults = {
    fpsCap: engine.renderLoop?.fpsCap ?? 60,
    resolutionScale: engine.renderer?.resolutionScale ?? 1,
    graphicsQuality: engine.materials?.quality ?? 'medium',
    textureQuality: engine.materials?.textureQuality ?? 'medium',
    mouseSensitivityScale: engine.input?.mouseSensitivityScale ?? 1,
    debugVisible: false,
    collisionBrushesVisible: false,
    noclipEnabled: false,
    ...(settings.defaults || {}),
    postProcessing,
  }

  return {
    defaults,
    fpsOptions: normalizeOptionList(settings.fpsOptions, [0, 30, 45, 60, 90, 120]),
    graphicsOptions: normalizeOptionList(settings.graphicsOptions, ['low', 'medium', 'high']),
    textureOptions: normalizeOptionList(settings.textureOptions, ['very_low', 'low', 'medium', 'high']),
    resolutionScale: normalizeRange(settings.resolutionScale, { min: 0.35, max: 1, step: 0.05 }),
    mouseSensitivityScale: normalizeRange(settings.mouseSensitivityScale, { min: 0.5, max: 2.5, step: 0.1 }),
    postProcessing: {
      grainIntensity: normalizeRange(settings.postProcessing?.grainIntensity, { min: 0, max: 0.2, step: 0.005 }),
      fishEyeStrength: normalizeRange(settings.postProcessing?.fishEyeStrength, { min: -0.4, max: 0.6, step: 0.01 }),
      vignetteDarkness: normalizeRange(settings.postProcessing?.vignetteDarkness, { min: 0, max: 1, step: 0.01 }),
      chromaticAberrationOffset: normalizeRange(
        settings.postProcessing?.chromaticAberrationOffset,
        { min: 0, max: 6, step: 0.1 },
      ),
    },
  }
}

function normalizePostProcessingDefaults(config = {}, overrides = {}) {
  return {
    enabled: readBoolean(overrides.enabled, readBoolean(config.enabled, true)),
    grain: {
      enabled: readBoolean(overrides.grain?.enabled, readBoolean(config.grain?.enabled, true)),
      intensity: readNumber(overrides.grain?.intensity, readNumber(config.grain?.intensity, 0.035)),
      size: readNumber(overrides.grain?.size, readNumber(config.grain?.size, 1.25)),
      speed: readNumber(overrides.grain?.speed, readNumber(config.grain?.speed, 18)),
    },
    fishEye: {
      enabled: readBoolean(overrides.fishEye?.enabled, readBoolean(config.fishEye?.enabled, true)),
      strength: readNumber(overrides.fishEye?.strength, readNumber(config.fishEye?.strength, 0.08)),
    },
    vignette: {
      enabled: readBoolean(overrides.vignette?.enabled, readBoolean(config.vignette?.enabled, true)),
      offset: readNumber(overrides.vignette?.offset, readNumber(config.vignette?.offset, 0.35)),
      darkness: readNumber(overrides.vignette?.darkness, readNumber(config.vignette?.darkness, 0.42)),
    },
    chromaticAberration: {
      enabled: readBoolean(
        overrides.chromaticAberration?.enabled,
        readBoolean(config.chromaticAberration?.enabled, true),
      ),
      offset: readNumber(
        overrides.chromaticAberration?.offset,
        readNumber(config.chromaticAberration?.offset, 1.15),
      ),
      radialModulation: readBoolean(
        overrides.chromaticAberration?.radialModulation,
        readBoolean(config.chromaticAberration?.radialModulation, true),
      ),
    },
  }
}

function normalizeOptionList(options, fallback) {
  return Array.isArray(options) && options.length > 0 ? options : fallback
}

function normalizeRange(range, fallback) {
  return {
    min: readNumber(range?.min, fallback.min),
    max: readNumber(range?.max, fallback.max),
    step: readNumber(range?.step, fallback.step),
  }
}

function renderRangeAttributes(range) {
  return `min="${escapeAttribute(range.min)}" max="${escapeAttribute(range.max)}" step="${escapeAttribute(range.step)}"`
}

function formatFpsOption(value) {
  return Number(value) === 0 ? 'Unlimited' : String(value)
}

function formatLabel(value) {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatPercent(value) {
  return `${Math.round(readNumber(value, 1) * 100)}%`
}

function formatScale(value) {
  return `${readNumber(value, 1).toFixed(1)}x`
}

function formatDecimal(value, digits) {
  return readNumber(value, 0).toFixed(digits)
}

function readNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function readBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }

  return fallback
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value)
}
