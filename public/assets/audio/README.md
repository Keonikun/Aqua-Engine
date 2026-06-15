# Audio

Runtime audio clips live here and are indexed by `audio.json`.

Import clips with:

```sh
npm run assets:import-audio -- path/to/sound.mp3 --name ambient_wind
```

Blender trigger volumes and positional audio markers reference the manifest id through:

```text
aqua_audio_asset = ambient_wind
```

Direct `/assets/audio/example.mp3` paths also work for quick tests, but manifest ids are preferred for reusable maps.

Footstep clips are grouped under `footstepSets` in `audio.json`:

```json
"footstepSets": {
  "outdoor": {
    "clips": [
      "/assets/audio/footsteps/outdoor/footstep_1.mp3"
    ],
    "volume": 0.55
  }
}
```

The active player footstep set and stereo-pan tuning live in `public/config/aqua.project.json` under `audio.footsteps`.
