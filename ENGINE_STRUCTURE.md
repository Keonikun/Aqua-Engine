# Aqua Engine Folder Structure

This project is JavaScript-first and browser-native, but its broad layout borrows from Source's separation of engine runtime, game code, tools, materials, and map content.

The goal is not to recreate Source's C++ tree one-to-one. Instead, these folders give the browser engine the same kind of boundaries:

- `src/client`: browser bootstrapping and app shell code.
- `src/engine`: core runtime systems that are not game-specific.
  - `core`: engine lifecycle, scene ownership, fixed timestep, render loop.
  - `collision`: static world collision primitives and hull traces.
  - `debug`: runtime debug overlays, settings, profiler tools.
  - `input`: browser input and pointer-lock handling.
  - `render`: Three.js renderer and camera wrappers.
- `src/game/client`: first-person presentation, camera-facing code, and local player view logic.
- `src/game/shared`: gameplay definitions shared by runtime systems, map data, and future tools.
- `src/materialsystem`: material creation, custom shaders, quality presets, and future material definition loading.
- `tools/mapcompiler`: offline Blender-to-engine map compiler scaffolding.
- `public/assets`: runtime-loadable maps, models, textures, and compiled content.

`External_Projects` remains reference-only. J-Engine can inform Blender naming conventions and asset workflow. Source SDK can inform architecture and movement concepts, but no Valve code or assets should be copied into the runtime.
