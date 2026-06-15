# Aqua Engine

Aqua Engine is a JavaScript-first Three.js experiment aimed at a Source-inspired, browser-native 3D engine: static maps, simple rendering, predictable first-person movement, explicit collision, and tooling that stays friendly to Blender.

# Aqua Engine Folder Structure

This project is JavaScript-first and browser-native, but its broad layout borrows from Source's separation of engine runtime, game code, tools, materials, and map content.

The goal is not to recreate Source's C++ tree one-to-one. Instead, these folders give the browser engine the same kind of boundaries:

- `src/client`: browser bootstrapping and app shell code.
- `src/engine`: core runtime systems that are not game-specific.
  - `audio`: audio manifest loading, positional sources, and ambient trigger fades.
  - `config`: centralized project config loading and fallback normalization.
  - `core`: engine lifecycle, scene ownership, fixed timestep, render loop.
  - `collision`: static world collision primitives and hull traces.
  - `debug`: runtime debug overlays, settings, profiler tools.
  - `input`: browser input and pointer-lock handling.
  - `render`: Three.js renderer and camera wrappers.
- `src/game/client`: first-person presentation, camera-facing code, and local player view logic.
- `src/game/shared`: gameplay definitions shared by runtime systems, map data, and future tools.
- `src/materialsystem`: material creation, custom shaders, quality presets, and future material definition loading.
- `tools/mapcompiler`: offline Blender-to-engine map compiler scaffolding.
- `public/config`: central JSON runtime settings.
- `public/assets`: runtime-loadable maps, models, textures, and compiled content.

## Run

```sh
npm install
npm run dev
```

For a production build:

```sh
npm run build
```

## Structure

- `src/client`: browser bootstrapping and app shell.
- `src/engine/config`: project config loading and normalization.
- `src/engine/core`: engine lifecycle, fixed timestep, and render loop.
- `src/engine/audio`: manifest-backed runtime audio, positional sources, and trigger soundscapes.
- `src/engine/collision`: static world collision and player hull traces.
- `src/engine/debug`: debug panel, settings menu, profiler, and collision/player overlays.
- `src/engine/render`: Three.js renderer and camera wrappers.
- `src/engine/world`: map loading and brush construction.
- `src/game`: first-person player and shared movement config.
- `src/materialsystem`: simple world material creation and graphics quality hooks.
- `public/config`: central runtime project settings.
- `public/assets`: runtime-loadable maps and assets.
- `tools`: offline or editor-side tooling.

## Project Configuration

Runtime tuning lives in `public/config/aqua.project.json`. Edit this file for startup map/skybox defaults, bake settings, renderer and camera settings, frame pacing, input sensitivity, player movement, collision tuning, material quality presets, texture quality presets, audio defaults, asset manifest paths, and settings menu defaults.

The app loads `/config/aqua.project.json` at startup. You can temporarily point the browser at a different config with `?config=/path/to/other.project.json`; URL parameters such as `?map=`, `?skybox=`, `?bake=`, `?bounces=`, and `?batch-size=` still override the startup slice for quick testing.

## Blender Map Workflow

Blender remains the first-class map editor. The first pipeline slice uses GLTF custom properties as brush datapoints:

1. Install `tools/blender/aqua_brushes.py` in Blender.
2. Use the `Aqua` sidebar tab to spawn boxes, flat planes, ramps, uneven terrain, and player starts.
3. Export with custom properties enabled.
4. Place the exported map under `public/assets/maps/test_map/`.
5. The runtime loads the GLTF and creates engine-native brush meshes and collision data from the exported transforms.

Blender is still authored Z-up; the GLTF export/import path converts that into the engine's Y-up Three.js space.

The current default map path is `/assets/maps/demo_map/demo.glb`.

## Baked Lighting

Aqua now has a first offline baked-lighting pass inspired by Source VRAD's broad flow: sample direct lights, trace visibility, bounce light between surface patches, and finalize texture lightmaps for runtime.

```sh
npm run bake:lights -- public/assets/maps/demo_map/demo.glb
```

The command writes `*.light.json` beside the map plus a sibling `*.lightmaps` PNG folder. `BrushMapLoader` automatically loads that sidecar when present, applies each surface's `uv2` data, and renders those world surfaces with unlit lightmapped materials. The Blender add-on can create point, sun, and ambient light markers in the `LIGHTS` collection; the baker also supports GLTF `KHR_lights_punctual`.

The app can choose its bake path during initial map load:

```txt
http://127.0.0.1:5173/?bake=sidecar
http://127.0.0.1:5173/?bake=off
http://127.0.0.1:5173/?bake=runtime
```

`sidecar` is the default and loads the offline texture-lightmap `*.light.json`. `off` skips baked lighting entirely. `runtime` remains a development fallback that bakes older vertex-color lighting in the browser while the startup loading screen reports map, lighting, and bake progress.

## Collision

The player uses a Source-like kinematic hull controller rather than a dynamic rigid body. Static brushes are traced as world collision, terrain uses a simple heightfield path, and the controller handles sliding, stepping, jumping, grounding, ceilings, and no-clip.

## Materials

The settings panel keeps shader graphics quality and texture quality separate. Texture quality updates shared texture sampler settings and anisotropy, so it still affects baked world surfaces because baked materials reuse the same diffuse texture objects. For string texture paths under `/assets/textures/1024x1024/`, `High` uses the 1024x1024 JPG, `Medium` uses the matching 512x512 folder path, `Low` uses 256x256, and `Very Low` uses 128x128. Legacy string paths still fall back to `_medium.jpg`, `_low.jpg`, and `_very_low.jpg`. The material manifest also accepts optional texture variant objects such as `{ "very_low": "...", "low": "...", "medium": "...", "high": "..." }`; switching texture quality will swap existing materials to the matching variant when those paths are present.

Use `npm run assets:import-textures -- path/to/texture_pack` to copy new texture material folders, update the material manifest, generate lower-resolution variants, and run an asset sync pass. Use `npm run assets:sync` to normalize prop metadata sidecars and add material manifest entries for texture folders already under `public/assets/textures/1024x1024`. Use `npm run assets:validate` to catch missing prop models or broken material texture references.

Use `npm run textures:variants -- public/assets/textures` to generate 512x512, 256x256, and 128x128 JPG folders from `public/assets/textures/1024x1024`.

## Post Processing

The renderer has a combined full-screen post-processing pass with grain, fish-eye lens distortion, vignette, and chromatic aberration. Defaults live under `renderer.postProcessing` in `public/config/aqua.project.json`, and the settings panel exposes live toggles plus strength sliders for the four effects. Fish-eye uses `fishEye.overscan` to render a slightly wider camera view before distortion, which prevents clamped or smeared edges.

## Audio

Aqua supports two map-authored audio paths:

- Positional audio sources are Blender empty markers with `aqua_audio_type = positional`. They play in 3D space and support `aqua_audio_volume`, `aqua_audio_range`, `aqua_audio_ref_distance`, `aqua_audio_rolloff`, and `aqua_audio_loop`.
- Ambient trigger audio is attached to trigger volumes with `aqua_audio_type = ambient` and `aqua_audio_asset`. Walking into and out of those volumes crossfades the selected ambient loop using `aqua_audio_fade_in`, `aqua_audio_fade_out`, `aqua_audio_volume`, and optional `aqua_audio_priority`.

Player footsteps are non-positional one-shots driven by grounded movement distance. They use manifest `footstepSets` and alternate stereo panning for left/right steps; tuning lives under `audio.footsteps` in `public/config/aqua.project.json`.

Door props can be tagged in Blender with `aqua_prop_type = door`, `aqua_door`, `aqua_door_open_audio`, and `aqua_door_close_audio`. Map export preserves those fields on prop reference markers, and loaded prop instances expose normalized `userData.aquaDoor` metadata for door interaction code.

Import reusable clips into `public/assets/audio` with:

```sh
npm run assets:import-audio -- path/to/ambient_wind.mp3 --name ambient_wind
```

The import writes `public/assets/audio/audio.json`; Blender fields should usually reference the manifest id, such as `ambient_wind`.

## Debug Profiler

Use `F3` to show the debug panel and `F4` to start or stop a profile capture. The profiler records post-render frame samples and downloads a JSON report with frame-time percentiles, update/render CPU timing, collision timing, draw/triangle counts, GPU resource counts, budget misses, worst frames, and stutter events. The settings panel also has profiler start/stop and last-report download buttons.
