# Engine

Core runtime systems live here.

Planned modules:

- `core`: engine lifecycle, fixed timestep, world ownership.
- `render`: Three.js renderer setup and debug rendering.
- `input`: keyboard, mouse, and pointer lock.
- `collision`: static world collision, traces, and capsule queries.
- `map`: engine-native map loading.
- `entity`: simple entity registry.
- `debug`: frame timing, overlays, and inspection tools.

This folder should not depend on game-specific entities or Blender scene conventions directly.
