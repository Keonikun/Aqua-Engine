# Props

Reusable prop assets live here.

The Blender addon prop exporter writes a GLB plus Aqua metadata sidecar:

```text
crate_01.glb
crate_01.aqua_prop.json
```

Maps should reference the metadata file with a GLTF custom property on a marker object:

```text
aqua_prop_asset = /assets/props/crate_01/crate_01.aqua_prop.json
```

At runtime the prop asset loader reads the metadata, loads the sibling GLB listed by `model`, and creates render and collision instances at the marker transform.
