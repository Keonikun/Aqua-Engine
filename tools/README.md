# Tools

Offline or development-time tools live here.

The runtime should not depend on these modules directly.

- `blender`: Blender add-on for authoring Aqua brush datapoints and exporting GLTF extras.
- `mapcompiler`: placeholder for the future Blender-to-engine compiler.
- `asset_pipeline.py`: imports/syncs prop sidecars, texture material manifest entries, and audio manifest entries.
- `texture_variants.py`: creates 512x512, 256x256, and 128x128 texture folders from 1024x1024 source textures.

## Asset Pipeline

Use the asset pipeline after exporting props from Blender or dropping in a new texture pack or audio clip:

```sh
npm run assets:sync
npm run assets:validate
```

Useful import commands:

```sh
npm run assets:import-props -- path/to/exported_props
npm run assets:import-textures -- path/to/texture_pack
npm run assets:import-audio -- path/to/sound.mp3 --name ambient_wind
```

`import-props` copies `.glb`/`.gltf` files into `public/assets/props`, creates missing `.aqua_prop.json` sidecars, and normalizes sidecar `model` fields to sibling model filenames.

`import-textures` copies material folders into `public/assets/textures/1024x1024`, discovers `diffuse`, `arm`, and `normal` maps by filename, updates `public/assets/textures/materials.json`, generates lower-resolution texture variants, and runs an asset sync pass. Use `--skip-variants` or `--skip-sync` only when you need a partial import.

`import-audio` copies browser-playable audio into `public/assets/audio`, updates `public/assets/audio/audio.json`, and writes default loop/volume metadata. Use manifest ids from that file in Blender `aqua_audio_asset` fields.

## Texture Variants

Requires Python with Pillow installed:

```sh
npm run tools:install
```

Create size-folder variants from the 1024x1024 texture source folder:

```sh
npm run textures:variants -- public/assets/textures
```

This writes:

```txt
1024x1024/stone_tiles/stone_tiles_diff.jpg  source
512x512/stone_tiles/stone_tiles_diff.jpg
256x256/stone_tiles/stone_tiles_diff.jpg
128x128/stone_tiles/stone_tiles_diff.jpg
```

Useful options:

```sh
python tools/texture_variants.py public/assets/textures/1024x1024
python tools/texture_variants.py public/assets/textures --output-dir public/assets/textures_variants
python tools/texture_variants.py public/assets/textures --overwrite --fit cover
```
