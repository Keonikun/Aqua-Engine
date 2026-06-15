# Architecture Notes

## Resource Lifecycle

Runtime asset loading separates four responsibilities:

1. Parsing: loaders read GLTF scenes, sidecar JSON, and custom `aqua_*` metadata into runtime objects.
2. Caching: long-lived asset systems keep shared materials, textures, audio buffers, and prop source GLTFs.
3. Three.js creation: loaders and runtime systems create `Object3D`, `Mesh`, `Geometry`, `Material`, and `Texture` instances.
4. Disposal: the system that owns a resource must remove object roots from the scene and dispose GPU resources when the lifetime ends.

Map-loaded resources are owned by a `ResourceOwner` returned from `loadBrushMap()`. The engine stores this as the current world resource handle and disposes it before shared renderer/material/prop caches are disposed. Map ownership includes generated brush geometries, map render/collision/trigger/debug object roots, sidecar lightmap geometry replacements, and prop instance roots. Shared material and texture objects remain owned by `WorldMaterialSystem`; shared prop source GLTF resources remain owned by `PropAssetLoader`.

The current resource owners are:

- `Engine`: owns the renderer, persistent scene groups, input, audio system, current world resource handle, and high-level runtime lifetime.
- `WorldMaterialSystem`: owns engine-created materials, shared textures, baked material variants, lightmapped material variants, white/error textures, and texture quality cache state.
- `PropAssetLoader`: owns cached prop source GLTF resources and prop metadata/model cache entries.
- `loadBrushMap()` result resources: own per-map generated geometry and per-map object roots.
- `PropAssetLoader.loadInstances()` result resources: own per-map prop instance roots, while sharing cached source geometry/materials.
- Debug systems: own their runtime debug Object3D helpers and DOM/event listeners.

Three.js resource creation sites to keep audited:

- Textures and materials: `src/materialsystem/WorldMaterialSystem.js`.
- Map groups, meshes, brush geometries, collision/debug/trigger helper objects: `src/engine/world/BrushMapLoader.js`.
- Prop source cache and per-map prop instance/collision objects: `src/engine/world/PropAssetLoader.js`.
- Engine-owned scene groups and marker mesh: `src/engine/core/Engine.js`.
- Audio Object3D group: `src/engine/audio/AudioSystem.js`.
- Collision fallback scene graph objects: `src/engine/collision/StaticWorldCollider.js`.
- Player/collision debug visuals: `src/engine/debug/PlayerDebugView.js`.
- Offline-only compiler geometries: `tools/mapcompiler/bakeLighting.js`.

Rules for future changes:

- Do not create map-load `Geometry`, `Mesh`, `Group`, or other `Object3D` instances without tracking them in the active map `ResourceOwner` or a child owner.
- Do not dispose shared material-system textures/materials from map disposal.
- Do not dispose prop source GLTF resources while prop instances that share their geometry are still active.
- When replacing a geometry during load, such as converting a lightmapped surface to non-indexed geometry, track the replacement geometry as well as the original.
- Keep parsing helpers free of disposal decisions; resource owners sit at creation boundaries.
