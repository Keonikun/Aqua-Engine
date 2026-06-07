# Collision

Static-world collision and query code.

Current modules:

- `StaticWorldCollider.js`

The runtime collider should work from compiled collision geometry, not visible scene hierarchy.

Player movement uses a Source-inspired swept bbox hull. Axis-aligned brush boxes use exact swept AABB traces, rotated/ramp brush boxes use convex plane traces, and terrain uses a simple heightfield fallback. Three's `Octree` helper remains a fallback for non-brush triangle collision.

Longer term, this folder should expose trace-style methods such as ray casts and trigger-volume queries. The player controller should keep depending on that collision interface rather than on Three scene objects directly.
