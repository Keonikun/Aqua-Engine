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
- `TRIGGERS`: reserved for trigger volumes.
- `PROPS`: reserved for static prop references.
- `LIGHTS`: point, sun, and ambient bake markers.

Custom properties exported through GLTF extras:

- `aqua_brush_type`: `box`, `plane`, `ramp`, or `terrain`. Ramps are authored as five-sided triangular prisms, not rotated boxes.
- `aqua_color`: render color used by the current simple material system.
- `aqua_collision_kind`: collision hint. Authored one-sided terrain meshes use `terrain_mesh`.
- `aqua_entity`: entity classname, currently `info_player_start`.
- `aqua_segments_x`, `aqua_segments_z`, `aqua_height_mode`, `aqua_max_snap_depth`: optional grid terrain metadata for generated or heightfield-style terrain.
- `aqua_asset_type`, `aqua_prop_name`: prop asset metadata written during selected prop export.
- `aqua_light_type`: `ambient`, `sun`, `directional`, `point`, or `spot`.
- `aqua_light_color`, `aqua_light_intensity`, `aqua_light_range`, `aqua_light_direction`: offline bake light settings.
- `aqua_lightmap_resolution`: optional world units per baked sample for flat floors/walls. Lower values are sharper and slower.

## Authored Terrain

Create uneven terrain as a normal Blender mesh first, usually as a flat, one-sided plane with edited vertices. Select that mesh and use `Aqua > Mark Uneven Terrain`.

The add-on does not generate terrain geometry for this action. It tags the selected mesh with `aqua_brush_type = terrain`, `aqua_collision_kind = terrain_mesh`, and `aqua_height_mode = authored_mesh`, then moves it into `MAP_BRUSHES` for export. At runtime the mesh is rendered directly and used as irregular triangle collision.

Use `Aqua > Hide Collision Brushes` or `Aqua > Show Collision Brushes` to toggle the viewport visibility of objects tagged with `aqua_collision_kind`.

## Authored World Meshes

For manually modeled decorative walls, trim, props baked into the map, or other non-colliding map-local geometry, leave the meshes as normal Blender meshes. During `Aqua > Export Aqua GLB`, unmarked mesh objects in the scene are automatically tagged with `aqua_brush_type = mesh` and `aqua_collision_kind = none`, unless they are inside reserved Aqua reference collections: `PROPS`, `TRIGGERS`, `ENTITIES`, or `LIGHTS`.

Use `Aqua > Mark World Mesh` only when you want selected mesh objects to become colliding triangle world geometry. Use `Aqua > Mark Uneven Terrain` for one-sided authored ground that should collide as irregular terrain.

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

Map and prop exports swap mesh slots to temporary texture-free Principled materials, then restore the original material slots after export. The exporter does not clear or rebuild authoring material node trees. Material names are preserved in the GLB, but texture images are not embedded or copied. Name Blender preview materials exactly the same as engine material names in `public/assets/materials/materials.json`; the runtime replaces each placeholder by looking up that name. Missing names render with the Aqua error checker material.

Use `Aqua > Merge Duplicate Materials` to clean Blender copies such as `asphalt.001` or `trim.002`. The tool remaps those users back to the unsuffixed material, then removes the duplicate datablocks when possible.

## Baked Light Markers

Use the light buttons in the `Aqua` sidebar to add bake-only point, sun, and ambient markers. They export as empties in the `LIGHTS` collection with Aqua custom properties. Run `npm run bake:lights -- <map>` after export to produce the map's `*.light.json` sidecar.

## Prop Export

Use `Aqua > Export Selected Prop GLB` to export the current selection through Blender's built-in GLTF exporter and write Aqua metadata beside it. This produces:

```text
prop_name.glb
prop_name.aqua_prop.json
```

The `.glb` contains the selected render geometry, materials, textures supported by Blender's exporter, and exported custom properties. The `.aqua_prop.json` sidecar describes the engine-facing asset:

- `schema`: currently `aqua.prop.v1`.
- `name` and `displayName`: stable asset id plus source display name.
- `model`: sibling `.glb` filename.
- `static`: default static prop hint.
- `collision`: currently defaults to `render_mesh`.
- `pivot`: current asset origin in Blender and engine coordinates.
- `bounds`: aggregate selected mesh bounds in Blender and engine coordinates.
- `sourceObjects`: selected objects included in the export.

Map exports should reference the prop metadata path rather than embedding reusable prop geometry directly into the map.

## Current Scope

This is a marker-to-brush pipeline, not a complete map compiler yet. The runtime supports authored brush transforms, player start, color hints, one-sided authored terrain meshes, prop metadata sidecars, and baked vertex-light sidecars. Triggers, material definitions, split render/collision outputs, and BSP-style lightmap atlas generation remain compiler work for later milestones.
