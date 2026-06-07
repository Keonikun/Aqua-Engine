# Tools

Offline or development-time tools live here.

The runtime should not depend on these modules directly.

- `blender`: Blender add-on for authoring Aqua brush datapoints and exporting GLTF extras.
- `mapcompiler`: placeholder for the future Blender-to-engine compiler.
- `texture_variants.py`: creates `_medium`, `_low`, and `_very_low` JPG variants for texture folders.

## Texture Variants

Requires Python with Pillow installed:

```sh
npm run tools:install
```

Create adjacent variants for every JPG in a folder:

```sh
npm run textures:variants -- public/assets/textures/asphalt
```

This writes:

```txt
name_medium.jpg    512x512
name_low.jpg       256x256
name_very_low.jpg  128x128
```

Useful options:

```sh
python tools/texture_variants.py public/assets/textures --recursive
python tools/texture_variants.py public/assets/textures --recursive --output-dir public/assets/textures_variants
python tools/texture_variants.py public/assets/textures/asphalt --overwrite --fit cover
```
