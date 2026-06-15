import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const DEFAULT_POST_PROCESSING = {
  enabled: true,
  grain: {
    enabled: true,
    intensity: 0.035,
    size: 1.25,
    speed: 18,
  },
  fishEye: {
    enabled: true,
    strength: 0.08,
    overscan: 1.18,
  },
  vignette: {
    enabled: true,
    offset: 0.35,
    darkness: 0.42,
  },
  chromaticAberration: {
    enabled: true,
    offset: 1.15,
    radialModulation: true,
  },
}

const postProcessShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uEnabled: { value: true },
    uGrainEnabled: { value: true },
    uGrainIntensity: { value: 0.035 },
    uGrainSize: { value: 1.25 },
    uGrainSpeed: { value: 18 },
    uFishEyeEnabled: { value: true },
    uFishEyeStrength: { value: 0.08 },
    uFishEyeSourceScale: { value: 1 },
    uVignetteEnabled: { value: true },
    uVignetteOffset: { value: 0.35 },
    uVignetteDarkness: { value: 0.42 },
    uChromaticAberrationEnabled: { value: true },
    uChromaticAberrationOffset: { value: 1.15 },
    uChromaticAberrationRadial: { value: true },
  },
  vertexShader: `
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;

    attribute vec3 position;
    attribute vec2 uv;

    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform bool uEnabled;
    uniform bool uGrainEnabled;
    uniform float uGrainIntensity;
    uniform float uGrainSize;
    uniform float uGrainSpeed;
    uniform bool uFishEyeEnabled;
    uniform float uFishEyeStrength;
    uniform float uFishEyeSourceScale;
    uniform bool uVignetteEnabled;
    uniform float uVignetteOffset;
    uniform float uVignetteDarkness;
    uniform bool uChromaticAberrationEnabled;
    uniform float uChromaticAberrationOffset;
    uniform bool uChromaticAberrationRadial;

    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      if (!uEnabled) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 centered = vUv * 2.0 - 1.0;
      float radius = length(centered);
      vec2 sampleUv = vUv;

      if (uFishEyeEnabled && abs(uFishEyeStrength) > 0.0001) {
        float distortion = 1.0 + uFishEyeStrength * radius * radius;
        sampleUv = centered * distortion * uFishEyeSourceScale * 0.5 + 0.5;
      }

      sampleUv = clamp(sampleUv, vec2(0.001), vec2(0.999));
      vec4 color = texture2D(tDiffuse, sampleUv);

      if (uChromaticAberrationEnabled && uChromaticAberrationOffset > 0.0001) {
        vec2 direction = centered / max(radius, 0.0001);
        float radialScale = uChromaticAberrationRadial ? max(radius, 0.15) : 1.0;
        vec2 channelOffset = direction * uChromaticAberrationOffset * radialScale / max(uResolution, vec2(1.0));
        color.r = texture2D(tDiffuse, clamp(sampleUv + channelOffset, vec2(0.001), vec2(0.999))).r;
        color.b = texture2D(tDiffuse, clamp(sampleUv - channelOffset, vec2(0.001), vec2(0.999))).b;
      }

      if (uVignetteEnabled && uVignetteDarkness > 0.0001) {
        float vignette = smoothstep(uVignetteOffset, 1.0, radius);
        color.rgb *= mix(1.0, max(1.0 - uVignetteDarkness, 0.0), vignette);
      }

      if (uGrainEnabled && uGrainIntensity > 0.0001) {
        vec2 grainUv = floor(gl_FragCoord.xy / max(uGrainSize, 1.0));
        float grain = hash(grainUv + uTime * uGrainSpeed) - 0.5;
        color.rgb += grain * uGrainIntensity;
      }

      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }
  `,
}

class LinearShaderPass extends Pass {
  constructor(shader, textureID = 'tDiffuse') {
    super()
    this.textureID = textureID
    this.uniforms = THREE.UniformsUtils.clone(shader.uniforms)
    this.material = new THREE.RawShaderMaterial({
      name: shader.name || 'AquaPostProcessShader',
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    })
    this.fsQuad = new FullScreenQuad(this.material)
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.uniforms[this.textureID]) {
      this.uniforms[this.textureID].value = readBuffer.texture
    }

    if (this.renderToScreen) {
      renderer.setRenderTarget(null)
    } else {
      renderer.setRenderTarget(writeBuffer)

      if (this.clear) {
        renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil)
      }
    }

    this.fsQuad.render(renderer)
  }

  dispose() {
    this.material.dispose()
    this.fsQuad.dispose()
  }
}

export class PostProcessingPipeline {
  constructor({ renderer, scene, camera, config = {} }) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.config = normalizePostProcessingConfig(config)
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.effectPass = new LinearShaderPass(postProcessShader)
    this.outputPass = new OutputPass()

    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.effectPass)
    this.composer.addPass(this.outputPass)
    this.applyConfig(this.config)
  }

  update(deltaTime, elapsedTime) {
    this.effectPass.uniforms.uTime.value = Number.isFinite(elapsedTime)
      ? elapsedTime
      : this.effectPass.uniforms.uTime.value + Math.max(deltaTime || 0, 0)
  }

  render() {
    if (!this.isActive()) {
      this.renderer.render(this.scene, this.camera)
      return
    }

    const restoreCamera = this.applyFishEyeCameraOverscan()

    try {
      this.composer.render()
    } finally {
      restoreCamera()
    }
  }

  resize(width, height, pixelRatio = 1) {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
    this.effectPass.uniforms.uResolution.value.set(
      Math.max(width * pixelRatio, 1),
      Math.max(height * pixelRatio, 1),
    )
  }

  setConfig(config = {}) {
    this.config = normalizePostProcessingConfig({
      ...this.config,
      ...config,
      grain: {
        ...this.config.grain,
        ...(config.grain || {}),
      },
      fishEye: {
        ...this.config.fishEye,
        ...(config.fishEye || {}),
      },
      vignette: {
        ...this.config.vignette,
        ...(config.vignette || {}),
      },
      chromaticAberration: {
        ...this.config.chromaticAberration,
        ...(config.chromaticAberration || {}),
      },
    })
    this.applyConfig(this.config)
  }

  getConfig() {
    return cloneConfig(this.config)
  }

  isActive() {
    const config = this.config

    return Boolean(
      config.enabled &&
      (
        (config.grain.enabled && config.grain.intensity > 0) ||
        (config.fishEye.enabled && Math.abs(config.fishEye.strength) > 0.0001) ||
        (config.vignette.enabled && config.vignette.darkness > 0) ||
        (config.chromaticAberration.enabled && config.chromaticAberration.offset > 0)
      )
    )
  }

  dispose() {
    this.composer?.dispose?.()
    this.effectPass?.dispose?.()
    this.outputPass?.dispose?.()
  }

  applyConfig(config) {
    const uniforms = this.effectPass.uniforms

    uniforms.uEnabled.value = config.enabled
    uniforms.uGrainEnabled.value = config.grain.enabled
    uniforms.uGrainIntensity.value = config.grain.intensity
    uniforms.uGrainSize.value = config.grain.size
    uniforms.uGrainSpeed.value = config.grain.speed
    uniforms.uFishEyeEnabled.value = config.fishEye.enabled
    uniforms.uFishEyeStrength.value = config.fishEye.strength
    uniforms.uFishEyeSourceScale.value = this.getFishEyeSourceScale()
    uniforms.uVignetteEnabled.value = config.vignette.enabled
    uniforms.uVignetteOffset.value = config.vignette.offset
    uniforms.uVignetteDarkness.value = config.vignette.darkness
    uniforms.uChromaticAberrationEnabled.value = config.chromaticAberration.enabled
    uniforms.uChromaticAberrationOffset.value = config.chromaticAberration.offset
    uniforms.uChromaticAberrationRadial.value = config.chromaticAberration.radialModulation
  }

  applyFishEyeCameraOverscan() {
    if (!this.shouldUseFishEyeOverscan() || !this.camera?.isPerspectiveCamera) {
      this.effectPass.uniforms.uFishEyeSourceScale.value = 1
      return () => {}
    }

    const originalFov = this.camera.fov
    const originalZoom = this.camera.zoom
    const overscan = this.getFishEyeOverscan()

    this.effectPass.uniforms.uFishEyeSourceScale.value = 1 / overscan
    this.camera.fov = expandPerspectiveFov(originalFov, overscan)
    this.camera.updateProjectionMatrix()

    return () => {
      this.camera.fov = originalFov
      this.camera.zoom = originalZoom
      this.camera.updateProjectionMatrix()
    }
  }

  shouldUseFishEyeOverscan() {
    return Boolean(
      this.config.enabled &&
      this.config.fishEye.enabled &&
      this.config.fishEye.strength > 0.0001
    )
  }

  getFishEyeSourceScale() {
    return this.shouldUseFishEyeOverscan() && this.camera?.isPerspectiveCamera
      ? 1 / this.getFishEyeOverscan()
      : 1
  }

  getFishEyeOverscan() {
    const strengthOverscan = 1 + Math.max(this.config.fishEye.strength, 0) * 2

    return Math.max(this.config.fishEye.overscan, strengthOverscan, 1)
  }
}

export function normalizePostProcessingConfig(config = {}) {
  const grain = config.grain || {}
  const fishEye = config.fishEye || {}
  const vignette = config.vignette || {}
  const chromaticAberration = config.chromaticAberration || {}

  return {
    enabled: readBoolean(config.enabled, DEFAULT_POST_PROCESSING.enabled),
    grain: {
      enabled: readBoolean(grain.enabled, DEFAULT_POST_PROCESSING.grain.enabled),
      intensity: clamp(readNumber(grain.intensity, DEFAULT_POST_PROCESSING.grain.intensity), 0, 1),
      size: Math.max(readNumber(grain.size, DEFAULT_POST_PROCESSING.grain.size), 1),
      speed: Math.max(readNumber(grain.speed, DEFAULT_POST_PROCESSING.grain.speed), 0),
    },
    fishEye: {
      enabled: readBoolean(fishEye.enabled, DEFAULT_POST_PROCESSING.fishEye.enabled),
      strength: clamp(readNumber(fishEye.strength, DEFAULT_POST_PROCESSING.fishEye.strength), -1, 1),
      overscan: clamp(readNumber(fishEye.overscan, DEFAULT_POST_PROCESSING.fishEye.overscan), 1, 2.5),
    },
    vignette: {
      enabled: readBoolean(vignette.enabled, DEFAULT_POST_PROCESSING.vignette.enabled),
      offset: clamp(readNumber(vignette.offset, DEFAULT_POST_PROCESSING.vignette.offset), 0, 1),
      darkness: clamp(readNumber(vignette.darkness, DEFAULT_POST_PROCESSING.vignette.darkness), 0, 1),
    },
    chromaticAberration: {
      enabled: readBoolean(chromaticAberration.enabled, DEFAULT_POST_PROCESSING.chromaticAberration.enabled),
      offset: Math.max(readNumber(chromaticAberration.offset, DEFAULT_POST_PROCESSING.chromaticAberration.offset), 0),
      radialModulation: readBoolean(
        chromaticAberration.radialModulation,
        DEFAULT_POST_PROCESSING.chromaticAberration.radialModulation,
      ),
    },
  }
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config))
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function expandPerspectiveFov(fov, overscan) {
  const halfFov = THREE.MathUtils.degToRad(fov) * 0.5
  const expandedHalfFov = Math.atan(Math.tan(halfFov) * Math.max(overscan, 1))

  return THREE.MathUtils.radToDeg(expandedHalfFov * 2)
}
