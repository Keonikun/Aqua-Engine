# Blender Brush Pipeline

This folder contains the first Aqua Engine Blender authoring tool. It keeps Blender as the map editor while avoiding runtime dependence on messy scene hierarchy.

## Install

1. In Blender, open `Edit > Preferences > Add-ons`.
2. Click `Install...`.
3. Select `tools/blender/aqua_brushes.py`.
4. Enable `Aqua Brush Authoring`.
5. In the 3D View, open the sidebar and use the `Aqua` tab.

## Authoring Model

The add-on creates objects with GLTF-exported custom properties. The runtime reads those properties as brush datapoints, then creates engine-native Three.js brushes in the same world transform.

Blender remains Z-up while the runtime is Y-up. The GLTF exporter handles that axis conversion, so author brushes normally in Blender: floors lie on Blender's X/Y plane, vertical height is Blender Z, and the loaded engine map will arrive in Three.js Y-up space.

Collections:

- `MAP_BRUSHES`: visible brush datapoints.
- `ENTITIES`: entity markers such as `info_player_start`.
- `TRIGGERS`: non-solid trigger volumes.
- `PROPS`: reserved for static prop references.
- `LIGHTS`: Blender lights used by the Aqua runtime and light baker.
- `AUDIO`: positional audio source markers.

Custom properties exported through GLTF extras:

- `aqua_brush_type`: `box`, `plane`, `ramp`, or `terrain`. Ramps are authored as five-sided triangular prisms, not rotated boxes.
- `aqua_color`: render color used by the current simple material system.
- `aqua_collision_kind`: collision hint. Authored one-sided terrain meshes use `terrain_mesh`.
- `aqua_entity`: entity classname, currently `info_player_start`.
- `aqua_trigger`, `aqua_trigger_id`, `aqua_trigger_type`, `aqua_trigger_event`, `aqua_trigger_payload`: optional trigger volume metadata. Trigger volumes are non-solid and emit runtime enter/stay/exit events.
- `aqua_segments_x`, `aqua_segments_z`, `aqua_height_mode`, `aqua_max_snap_depth`: optional grid terrain metadata for generated or heightfield-style terrain.
- `aqua_asset_type`, `aqua_prop_id`, `aqua_prop_name`, `aqua_prop_asset`: prop asset metadata written during selected prop export.
- `aqua_light_type`: optional fallback/type override for lights, usually `ambient`, `directional`, `point`, or `spot`.
- `aqua_light_color`, `aqua_light_intensity`, `aqua_light_range`, `aqua_light_direction`: legacy/fallback bake light settings. The Aqua exporter syncs these from native Blender light data before map export.
- `aqua_lightmap_resolution`: optional world units per lightmap texel for baked surfaces. Lower values are sharper and slower.
- `aqua_lightmap_texel_size`: explicit texture-lightmap texel size override; this takes precedence over `aqua_lightmap_resolution`.
- `aqua_audio_type`, `aqua_audio_asset`, `aqua_audio_volume`, `aqua_audio_loop`: shared audio metadata. `aqua_audio_asset` should usually be an id from `public/assets/audio/audio.json`.
- `aqua_audio_range`, `aqua_audio_ref_distance`, `aqua_audio_rolloff`, `aqua_audio_distance_model`: positional audio attenuation metadata.
- `aqua_audio_fade_in`, `aqua_audio_fade_out`, `aqua_audio_priority`: ambient trigger crossfade metadata.
- `aqua_prop_type = door`, `aqua_door`, `aqua_door_open_audio`, `aqua_door_close_audio`: prop instance metadata for interactable doors and their open/close audio ids.

## Fresh Metadata

Use `Aqua > Fresh Metadata` when a selected object has stale or conflicting Aqua custom properties. Each preset removes existing `aqua_*` fields from the selected object set, then writes a clean field set for the selected role:

- `Prop`: `aqua_asset_type`, `aqua_prop_id`, `aqua_prop_name`, and `aqua_prop_asset`. The selected prop root's object name is used for the prop id, so child mesh datablock names such as Blender's default `Cube` do not become asset ids. Existing or helper-named child collision brushes such as `brush_box`, `brush_floor`, `brush_ramp`, `collision_box`, or `ucx_*` receive only collision-helper metadata (`aqua_brush_type`, `aqua_collision_kind`, and optional `aqua_attached_to`) instead of prop render metadata.
- `Door Prop`: prop metadata plus `aqua_prop_type = door`, `aqua_door`, and optional open/close audio ids from the current Door fields.
- `Decorative Mesh`: non-colliding world mesh fields.
- `Colliding Mesh`: triangle-colliding world mesh fields.
- `Terrain`: authored uneven terrain fields.
- `Trigger`: non-solid trigger volume fields.
- `Player Start`: `info_player_start` entity fields.
- `Positional Audio`: `audio_source` entity fields plus positional audio metadata.

The operator includes children by default, so a selected prop root can be refreshed as a complete object set. Unsupported selections are skipped without clearing their metadata.

## Authored Terrain

Create uneven terrain as a normal Blender mesh first, usually as a flat, one-sided plane with edited vertices. Select that mesh and use `Aqua > Mark Uneven Terrain`.

The add-on does not generate terrain geometry for this action. It tags the selected mesh with `aqua_brush_type = terrain`, `aqua_collision_kind = terrain_mesh`, and `aqua_height_mode = authored_mesh`, then moves it into `MAP_BRUSHES` for export. At runtime the mesh is rendered directly and used as irregular triangle collision.

Use `Aqua > Hide Collision Brushes` or `Aqua > Show Collision Brushes` to toggle the viewport visibility of objects tagged with `aqua_collision_kind`.

Use `Aqua > Clean Geometry` on selected props or mesh roots to remove Aqua custom metadata from those objects and their children, reset name labels, and stop decorative geometry from being treated as brush/collision data.

## Authored World Meshes

For manually modeled decorative walls, trim, props baked into the map, or other non-colliding map-local geometry, leave the meshes as normal Blender meshes. During `Aqua > Export Aqua GLB`, unmarked mesh objects in the scene are automatically tagged with `aqua_brush_type = mesh` and `aqua_collision_kind = none`, unless they are inside reserved Aqua reference collections: `PROPS`, `TRIGGERS`, `ENTITIES`, or `LIGHTS`.

Use `Aqua > Mark World Mesh` only when you want selected mesh objects to become colliding triangle world geometry. Use `Aqua > Mark Uneven Terrain` for one-sided authored ground that should collide as irregular terrain.

## Collision Brush Helpers

When a normal mesh is selected, `Add Box Brush`, `Add Flat Plane`, and `Add Ramp Brush` create the new brush at the selected mesh's position, rotation, and scale, then parent the brush to that mesh. The brush still lives in the `MAP_BRUSHES` collection, so the render mesh and collision helper do not need to share a collection. Moving, rotating, or scaling the parent mesh moves the attached brush with it.

Generated brush helpers display as red wireframe objects in the Blender viewport and are shown in front of shaded geometry. This keeps collision/bake helper volumes visible without obscuring the authored mesh surface.

## Trigger Volumes

Use `Aqua > Add Trigger Volume` to create a non-solid box volume in the `TRIGGERS` collection. The runtime checks the player's movement hull against these volumes every frame and dispatches `aqua:trigger` browser events with `phase` set to `enter`, `stay`, or `exit`.

For ambient soundscapes, enter an audio manifest id in `Aqua > Audio > Asset`, select one or more trigger volumes, then click `Assign Trigger Audio`. The add-on sets `aqua_trigger_type = audio`, `aqua_trigger_event = soundscape`, and stores the selected clip in `aqua_audio_asset`. Runtime trigger transitions fade out the old ambient loop and fade in the new one.

## Audio

Use `Aqua > Audio > Add Positional Audio` to create a 3D audio source marker in the `AUDIO` collection. Set `Asset` to a manifest id from `public/assets/audio/audio.json`, then tune `Volume`, `Range`, `Ref Distance`, and `Rolloff`. Positional sources are exported as lightweight empty markers and play from their world position at runtime.

Use the same `Asset`, `Volume`, `Loop`, `Fade In`, `Fade Out`, and `Priority` fields before assigning trigger audio. Overlapping ambient triggers choose the highest priority, then the most recently entered trigger.

## Door Props

Use `Aqua > Doors` to set default Open Audio and Close Audio ids, then select one or more prop roots and click `Assign Door`. The add-on marks each selected prop with `aqua_prop_type = door`, `aqua_door = true`, `aqua_door_open_audio`, and `aqua_door_close_audio`. Map export copies those fields onto the temporary prop reference marker, so the runtime receives them as prop instance metadata.

## Export

Use `Aqua > Export Aqua GLB`, or Blender's GLTF exporter with `Custom Properties` enabled. Exported `.glb` or `.gltf` files can be placed in:

```text
public/assets/maps/test_map/
```

The engine currently loads:

```text
/assets/maps/demo_map/demo.glb
```

To test a Blender export immediately, either export over that file path as `.gltf`, or update `DEFAULT_MAP_URL` in `src/engine/world/BrushMapLoader.js` to point at your `.glb`.

Map and prop exports swap mesh slots to texture-free placeholder materials, then restore the original material slots after export. The exporter does not clear or rebuild authoring material node trees. This supports linked library materials that cannot be renamed or edited. For an authoring material named `stone_tiles`, create a local empty placeholder material named `stone_tiles_p`; the exporter will use that placeholder in the GLB. The runtime strips the `_p` suffix when looking up engine materials in `public/assets/textures/materials.json`. Missing names render with the Aqua error checker material.

Use `Aqua > Merge Duplicate Materials` to clean Blender copies such as `asphalt.001` or `trim.002`. The tool remaps those users back to the unsuffixed material, then removes the duplicate datablocks when possible.

## Lights

Use the light buttons in the `Aqua` sidebar to add native Blender lights in the `LIGHTS` collection. Edit their color, power/energy, distance, and spot cone in Blender's light properties. During `Aqua > Export Aqua GLB`, the add-on exports GLTF punctual lights and syncs Aqua fallback properties from the current Blender light settings.

Point, sun, and spot lights are read from exported GLTF light data by the sidecar baker. Ambient lighting uses a real Blender point light as an editable carrier with `aqua_light_type = ambient`; Aqua reads its color and energy as scene ambient light rather than as a point light. Run `npm run bake:lights -- <map>` after export to produce the map's `*.light.json` sidecar and lightmap PNG folder.

## Prop Export

Use `Aqua > Export Selected Prop GLB` to export the current selection through Blender's built-in GLTF exporter and write Aqua metadata beside it. This produces:

```text
prop_name.glb
prop_name.aqua_prop.json
```

The `.glb` contains the selected render geometry, materials, textures supported by Blender's exporter, and exported custom properties. The `.aqua_prop.json` sidecar describes the engine-facing asset:

- `schema`: currently `aqua.prop.v1`.
- `name` and `displayName`: stable asset id plus source display name. The stable id comes from the exported sidecar filename, not from Blender's instance object name.
- `model`: sibling `.glb` filename.
- `static`: default static prop hint.
- `collision`: `authored` when parented collision helper meshes are included, otherwise `none`.
- `pivot`: current asset origin in Blender and engine coordinates.
- `bounds`: aggregate selected mesh bounds in Blender and engine coordinates.
- `sourceObjects`: selected objects included in the export.

Map exports reference linked prop metadata paths rather than embedding reusable prop geometry directly into the map. During `Aqua > Export Aqua GLB`, linked prop render meshes and meshes in `PROPS` are replaced by temporary empty markers with `aqua_prop_asset` and `aqua_prop_id`; the exported map points at `/assets/props/prop_name.aqua_prop.json`, and the runtime loads the prop asset from that sidecar. Because prop identity is stored in Aqua metadata, duplicated Blender names such as `prop_chair_01.001` still resolve to the original prop asset.

Prop render meshes are always decorative at runtime. To give a prop reusable collision, parent one or more Aqua collision helpers to the prop before `Aqua > Export Selected Prop GLB`; selecting the prop root exports those child helpers with their `aqua_collision_kind` values. The runtime removes those helpers from the rendered prop instance and uses only them for prop collision.

## Current Scope

This is a marker-to-brush pipeline, not a complete map compiler yet. The runtime supports authored brush transforms, player start, color hints, one-sided authored terrain meshes, trigger volumes, prop metadata sidecars, and baked texture-lightmap sidecars. Material definitions, split render/collision outputs, and BSP-style global atlas generation remain compiler work for later milestones.
