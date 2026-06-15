# Maps

Runtime-loadable map content lives here.

The current first slice loads a Blender/GLTF brush datapoint file:

- `test_map/aqua_brush_test.gltf`

Each brush object exports GLTF `extras` such as `aqua_brush_type`, `aqua_color`, and optional terrain metadata. The runtime reads those datapoints and creates engine-native render and collision brushes. Authored uneven terrain meshes use `aqua_brush_type = terrain` with `aqua_collision_kind = terrain_mesh`; these are loaded as one-sided mesh geometry and routed through triangle collision.

Trigger volumes export `aqua_brush_type = trigger` plus optional `aqua_trigger_*` metadata. They are loaded as invisible, non-solid volumes and dispatch runtime `aqua:trigger` events when the player's hull enters, stays inside, or exits them.

Prop markers can export `aqua_prop_asset` in GLTF `extras`. The value points to a `.aqua_prop.json` metadata file, usually under `/assets/props/`. The runtime resolves relative prop paths against the map file URL and places a loaded prop instance at the marker transform.

The eventual compiled map folder should contain:

- `map.json`
- `world.glb`
- `collision.glb`
- trigger volumes
- prop references
- optional lightmaps
- optional material definitions
