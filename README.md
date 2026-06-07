# Aqua Engine

Aqua Engine is a JavaScript-first Three.js experiment aimed at a Source-inspired, browser-native 3D engine: static maps, simple rendering, predictable first-person movement, explicit collision, and tooling that stays friendly to Blender.

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
- `src/engine/core`: engine lifecycle, fixed timestep, and render loop.
- `src/engine/collision`: static world collision and player hull traces.
- `src/engine/debug`: debug panel, settings menu, profiler, and collision/player overlays.
- `src/engine/render`: Three.js renderer and camera wrappers.
- `src/engine/world`: map loading and brush construction.
- `src/game`: first-person player and shared movement config.
- `src/materialsystem`: simple world material creation and graphics quality hooks.
- `public/assets`: runtime-loadable maps and assets.
- `tools`: offline or editor-side tooling.

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

Aqua now has a first offline baked-lighting pass inspired by Source VRAD's broad flow: sample direct lights, trace visibility, bounce light between surface patches, and finalize baked sample data for runtime.

```sh
npm run bake:lights -- public/assets/maps/demo_map/demo.glb
```

The command writes `*.light.json` beside the map. `BrushMapLoader` automatically loads that sidecar when present, applies the baked RGB values as vertex colors, and renders those world surfaces with baked unlit materials. The Blender add-on can create point, sun, and ambient light markers in the `LIGHTS` collection; the baker also supports GLTF `KHR_lights_punctual`.

The app can choose its bake path during initial map load:

```txt
http://127.0.0.1:5173/?bake=sidecar
http://127.0.0.1:5173/?bake=off
http://127.0.0.1:5173/?bake=runtime
```

`sidecar` is the default and loads the offline `*.light.json`. `off` skips baked lighting entirely. `runtime` bakes in the browser while the startup loading screen reports map, lighting, and bake progress. Runtime baking defaults to direct lighting for startup speed; add `&bounces=1` to opt into a radiosity bounce pass.

## Collision

The player uses a Source-like kinematic hull controller rather than a dynamic rigid body. Static brushes are traced as world collision, terrain uses a simple heightfield path, and the controller handles sliding, stepping, jumping, grounding, ceilings, and no-clip.

## Materials

The settings panel keeps shader graphics quality and texture quality separate. Texture quality updates shared texture sampler settings and anisotropy, so it still affects baked world surfaces because baked materials reuse the same diffuse texture objects. The material manifest also accepts optional texture variant objects such as `{ "low": "...", "medium": "...", "high": "..." }`; switching texture quality will swap existing materials to the matching variant when those paths are present.

Use `npm run textures:variants -- <folder>` to generate `_medium` 512x512, `_low` 256x256, and `_very_low` 128x128 JPG variants for texture folders.

## Debug Profiler

Use `F3` to show the debug panel and `F4` to start or stop a profile capture. The profiler records post-render frame samples and downloads a JSON report with frame-time percentiles, update/render CPU timing, collision timing, draw/triangle counts, GPU resource counts, budget misses, worst frames, and stutter events. The settings panel also has profiler start/stop and last-report download buttons.

## Deferred

The first milestone does not include full Hammer or BSP support, networking, weapons, AI, dynamic rigid bodies, BSP lightmap atlas generation, portals, occlusion, a complex ECS, or a complete Blender compiler. The next compiler step should split Blender output into `map.json`, `world.glb`, `collision.glb`, entity data, trigger data, baked lighting data, and material definitions.
