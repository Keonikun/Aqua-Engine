# Map Compiler

Blender-friendly compile and bake pipeline pieces.

## Baked Lighting

`bakeLighting.js` is Aqua's first VRAD-like lighting pass. It does not build BSP
lightmap pages yet; instead it samples the current GLTF map offline and writes
per-vertex lighting into a sidecar file:

```sh
npm run bake:lights -- public/assets/maps/demo_map/demo.glb
```

The default output path sits beside the map:

```txt
public/assets/maps/demo_map/demo.light.json
```

At runtime `BrushMapLoader` automatically looks for a matching `*.light.json`
file, applies its RGB values as `geometry.color`, and swaps baked world surfaces
to unlit baked materials so they are not lit a second time.

The browser can also pick the bake mode when the map is instantiated:

```txt
?bake=sidecar   load the offline sidecar, default
?bake=off       skip baked lighting
?bake=runtime   bake in the app during startup
```

Runtime baking uses the same vertex-color sidecar shape in memory and reports
progress to the startup loading screen. It defaults to direct light only so the
app remains responsive; append `&bounces=1` for an in-browser bounce pass.

The baker mirrors VRAD at a high level:

- Collect renderable brush/world surfaces from GLTF custom properties.
- Gather direct light at each vertex sample with ray visibility tests.
- Treat triangles as radiosity patches.
- Transfer a configurable number of bounce passes between visible patches.
- Finalize into a compact sidecar that the browser only has to load and sample.

Supported authored light inputs:

- Aqua light marker extras from the Blender tool:
  - `aqua_light_type`: `ambient`, `sun`, `directional`, `point`, or `spot`
  - `aqua_light_color`: `#rrggbb` or RGB array
  - `aqua_light_intensity`
  - `aqua_light_range` for point/spot lights
  - `aqua_light_direction` for sun/directional lights
- GLTF `KHR_lights_punctual` point, spot, and directional lights.

If no authored lights are present, the baker adds a default ambient light and a
default sun matching the current engine scene lighting.

Flat `plane` brushes and simple authored quad meshes are tessellated for baking
so large floors can receive shadows. Set `aqua_lightmap_resolution` on an object
to control its grid size in world units per sample. Smaller values produce
sharper shadows and slower bakes; the default is `1`.

Planned input convention:

- `MAP_RENDER`
- `MAP_COLLISION`
- `ENTITIES`
- `TRIGGERS`
- `PROPS`
- `LIGHTS`

Planned output:

- `public/assets/maps/<map_name>/map.json`
- `public/assets/maps/<map_name>/world.glb`
- `public/assets/maps/<map_name>/collision.glb`

This first scaffold does not parse VMF or BSP.
