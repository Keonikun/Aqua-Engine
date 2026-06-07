# Render

Three.js rendering setup and camera wrappers.

Keep this focused on renderer ownership, camera state, and render calls. Material creation and shader quality presets live in `src/materialsystem`.

Current modules:

- `EngineRenderer.js`: owns the WebGLRenderer and render calls.
- `EngineCamera.js`: owns the perspective camera and projection resizing.
