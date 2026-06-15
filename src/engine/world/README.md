# Material System

Owns engine material creation, shader quality presets, and material definition loading.

Current modules:

- `WorldMaterialSystem.js`: creates low-fidelity color materials, loads engine texture materials by name, and updates graphics-quality uniforms.

Runtime material definitions live in:

```text
public/assets/textures/materials.json
```

Map and prop GLBs should export placeholder materials only. The runtime reads each GLTF material name, looks it up in the manifest, and replaces it with the engine-owned material of the same name. If the name is missing, Aqua uses a magenta/black error checker material.

For packed ARM textures, Aqua assumes:

```text
R = ambient occlusion
G = roughness
B = metallic
```
