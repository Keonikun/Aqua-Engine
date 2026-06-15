# Project Config

`aqua.project.json` is the central runtime tuning surface for Aqua Engine.

Use it for startup defaults, asset manifest paths, renderer/camera settings, post-processing, frame pacing, input sensitivity, player movement, collision tuning, material quality presets, texture quality presets, audio defaults, and settings menu defaults.

The runtime loads `/config/aqua.project.json` by default. Use `?config=/config/other.project.json` to test another config file without editing source.
