import { Engine } from '../engine/core/Engine.js'

export async function bootClient(rootElement) {
  if (!rootElement) {
    throw new Error('Aqua Engine needs a root DOM element to boot.')
  }

  const startupOptions = getStartupOptions()

  rootElement.innerHTML = `
    <main class="app-shell">
      <canvas class="engine-canvas" aria-label="Aqua Engine 3D viewport"></canvas>
      <section class="loading-screen" data-loading role="status" aria-live="polite">
        <div class="loading-panel">
          <p class="eyebrow">Aqua Engine</p>
          <h1 data-loading-title>Loading map</h1>
          <p data-loading-stage>Starting engine</p>
          <div class="loading-progress" aria-hidden="true">
            <span data-loading-bar></span>
          </div>
          <dl class="loading-meta">
            <div>
              <dt>Progress</dt>
              <dd data-loading-percent>0%</dd>
            </div>
            <div>
              <dt>Bake</dt>
              <dd data-loading-mode>${formatLightingMode(startupOptions.lightingMode)}</dd>
            </div>
            <div>
              <dt>Detail</dt>
              <dd data-loading-detail>Initializing</dd>
            </div>
          </dl>
        </div>
      </section>
      <section class="status-panel" aria-live="polite">
      </section>
      <section class="settings-panel" aria-label="Engine settings">
      </section>
    </main>
  `

  const loadingView = createLoadingView(rootElement)

  loadingView.update({
    label: 'Starting engine',
    progress: 0,
    detail: `bake=${startupOptions.lightingMode}`,
  })

  const engine = new Engine({
    canvas: rootElement.querySelector('.engine-canvas'),
    debugElement: rootElement.querySelector('.status-panel'),
    settingsElement: rootElement.querySelector('.settings-panel'),
    lightingMode: startupOptions.lightingMode,
    runtimeBakeSettings: startupOptions.runtimeBakeSettings,
    onLoadingProgress: (event) => loadingView.update(event),
  })

  try {
    await engine.initialize()
    engine.start()
    window.aquaEngine = engine
    loadingView.hide()
  } catch (error) {
    loadingView.showError(error)
    throw error
  }

  return engine
}

function getStartupOptions() {
  const params = new URLSearchParams(window.location.search)
  const lightingMode = normalizeLightingMode(params.get('bake') || params.get('lighting'))

  return {
    lightingMode,
    runtimeBakeSettings: {
      bounces: readNumberParam(params, 'bounces', 0),
      batchSize: readNumberParam(params, 'batch-size', 96),
    },
  }
}

function normalizeLightingMode(value) {
  const mode = String(value || 'sidecar').toLowerCase()

  if (mode === 'off' || mode === '0' || mode === 'false' || mode === 'none' || mode === 'disabled') {
    return 'off'
  }

  if (mode === 'runtime' || mode === 'browser' || mode === 'bake') {
    return 'runtime'
  }

  return 'sidecar'
}

function readNumberParam(params, key, fallback) {
  const value = Number(params.get(key))

  return Number.isFinite(value) ? value : fallback
}

function createLoadingView(rootElement) {
  const loadingElement = rootElement.querySelector('[data-loading]')
  const titleElement = rootElement.querySelector('[data-loading-title]')
  const stageElement = rootElement.querySelector('[data-loading-stage]')
  const detailElement = rootElement.querySelector('[data-loading-detail]')
  const percentElement = rootElement.querySelector('[data-loading-percent]')
  const barElement = rootElement.querySelector('[data-loading-bar]')

  return {
    update(event) {
      const progress = Math.max(0, Math.min(event.progress ?? 0, 1))

      stageElement.textContent = event.label || 'Loading'
      detailElement.textContent = event.detail || event.stage || 'Working'
      percentElement.textContent = `${Math.round(progress * 100)}%`
      barElement.style.transform = `scaleX(${progress})`
    },

    hide() {
      loadingElement.classList.add('is-hidden')
      window.setTimeout(() => {
        loadingElement.hidden = true
      }, 260)
    },

    showError(error) {
      titleElement.textContent = 'Startup failed'
      stageElement.textContent = error?.message || 'Aqua Engine could not start.'
      detailElement.textContent = 'Check the console for the full error.'
      percentElement.textContent = 'Error'
      barElement.style.transform = 'scaleX(1)'
      loadingElement.classList.add('is-error')
      loadingElement.hidden = false
    },
  }
}

function formatLightingMode(mode) {
  if (mode === 'off') {
    return 'Off'
  }

  if (mode === 'runtime') {
    return 'Runtime'
  }

  return 'Sidecar'
}
