# Map Compiler

Blender-friendly compile and bake pipeline pieces.

## Baked Lighting

`bakeLighting.js` is Aqua's first VRAD-like lighting pass. It samples the
current GLTF map offline and writes texture lightmaps into a sidecar file:

```sh
npm run bake:lights -- public/assets/maps/demo_map/demo.glb
```

The default output path sits beside the map:

```txt
public/assets/maps/demo_map/demo.light.json
```

At runtime `BrushMapLoader` automatically looks for a matching `*.light.json`
file, loads the referenced PNG lightmaps, writes each surface's `uv2` attribute,
and swaps baked world surfaces to unlit lightmapped materials so they are not lit
a second time.

The browser can also pick the bake mode when the map is instantiated:

```txt
?bake=sidecar   load the offline sidecar, default
?bake=off       skip baked lighting
?bake=runtime   bake in the app during startup
```

Runtime baking is still a development fallback and uses the older vertex-color
shape in memory. Offline sidecars are the production path for texture lightmaps.

The baker mirrors VRAD at a high level:

- Collect renderable brush/world surfaces from GLTF custom properties.
- Pack per-surface triangle charts into PNG lightmaps.
- Gather direct light at each lightmap texel with ray visibility tests.
- Treat triangles as radiosity patches.
- Transfer a configurable number of bounce passes between visible patches.
- Finalize into a compact sidecar plus PNGs that the browser only has to load
  and sample.

Supported authored light inputs:

- GLTF `KHR_lights_punctual` point, spot, and directional lights exported from Blender light objects.
- Aqua light extras from the Blender tool as fallback data and for ambient light carriers:
  - `aqua_light_type`: `ambient`, `directional`, `point`, or `spot`
  - `aqua_light_color`: `#rrggbb` or RGB array
  - `aqua_light_intensity`
  - `aqua_light_range` for point/spot lights
  - `aqua_light_direction` for legacy sun/directional markers

For point, spot, and sun lights, GLTF light data takes precedence so Blender's native color, energy, distance, and cone values drive the bake. Ambient lighting uses an Aqua-tagged Blender light object because GLTF has no punctual ambient light type.

If no authored lights are present, the baker adds a default ambient light and a
default sun matching the current engine scene lighting.

Set `aqua_lightmap_resolution` or `aqua_lightmap_texel_size` on an object to
control its lightmap texel density in world units per texel. Smaller values
produce sharper shadows and slower bakes. The offline default is `0.25`.

Useful bake controls:

```sh
npm run bake:lights -- public/assets/maps/demo_map/demo.glb --texel-size 0.125 --lightmap-size 2048
```

- `--texel-size`: world units per lightmap texel.
- `--lightmap-size`: maximum generated PNG dimension.
- `--lightmap-padding`: chart padding in pixels.
- `--lightmap-bleed`: chart dilation passes.
- `--light-scale`: multiplier for authored non-ambient GLTF/Blender lights.

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
