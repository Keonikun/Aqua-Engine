bl_info = {
    "name": "Aqua Brush Authoring",
    "author": "Aqua Engine",
    "version": (0, 1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Aqua",
    "description": "Create Aqua Engine brush datapoints and export them as GLTF extras.",
    "category": "Object",
}

import json
import math
import re
from pathlib import Path

import bpy
import mathutils


BRUSH_COLLECTION = "MAP_BRUSHES"
ENTITY_COLLECTION = "ENTITIES"
TRIGGER_COLLECTION = "TRIGGERS"
PROP_COLLECTION = "PROPS"
LIGHT_COLLECTION = "LIGHTS"
AUDIO_COLLECTION = "AUDIO"
SKYBOX_COLLECTION = "SKYBOX"

TOOL_MATERIAL_PREFIX = "tool_"
BRUSH_WIREFRAME_COLOR = "#ff2d2d"
TRIGGER_WIREFRAME_COLOR = "#b45cff"
DUPLICATE_MATERIAL_SUFFIX_RE = re.compile(r"^(.+)\.\d{3}$")
NON_WORLD_COLLECTIONS = {
    ENTITY_COLLECTION,
    TRIGGER_COLLECTION,
    PROP_COLLECTION,
    LIGHT_COLLECTION,
    AUDIO_COLLECTION,
    SKYBOX_COLLECTION,
}
PROP_ASSET_URL_PREFIX = "/assets/props"
AUDIO_ASSET_URL_PREFIX = "/assets/audio"
DEFAULT_SKYBOX_NAME = "citrus_orchard"
AQUA_CUSTOM_PROPERTY_PREFIX = "aqua_"


def ensure_collection(name):
    collection = bpy.data.collections.get(name)

    if collection is None:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)

    return collection


def link_to_collection(obj, collection_name):
    collection = ensure_collection(collection_name)

    if obj.name not in collection.objects.keys():
        collection.objects.link(obj)

    for source_collection in list(obj.users_collection):
        if source_collection != collection:
            source_collection.objects.unlink(obj)


def make_tool_material(name, color):
    material_name = f"{TOOL_MATERIAL_PREFIX}{name}"
    material = bpy.data.materials.get(material_name)

    if material is None:
        material = bpy.data.materials.new(material_name)
        material.diffuse_color = color_to_rgba(color)

    return material


def color_to_rgba(color):
    if isinstance(color, str) and color.startswith("#") and len(color) == 7:
        return (
            int(color[1:3], 16) / 255.0,
            int(color[3:5], 16) / 255.0,
            int(color[5:7], 16) / 255.0,
            1.0,
        )

    if isinstance(color, (list, tuple)) and len(color) >= 3:
        alpha = color[3] if len(color) >= 4 else 1.0
        return (color[0], color[1], color[2], alpha)

    return (0.5, 0.55, 0.58, 1.0)


def rgba_to_hex(color):
    r = max(0, min(255, round(float(color[0]) * 255)))
    g = max(0, min(255, round(float(color[1]) * 255)))
    b = max(0, min(255, round(float(color[2]) * 255)))
    return f"#{r:02x}{g:02x}{b:02x}"


def set_common_brush_props(obj, brush_type, color="#7f8a8f"):
    obj["aqua_brush_type"] = brush_type
    obj["aqua_color"] = color
    obj["aqua_bake_id"] = obj.name
    obj["aqua_collision_kind"] = "terrain" if brush_type == "terrain" else "brush"
    obj.display_type = "TEXTURED"
    obj.show_name = True


def set_collision_brush_preview(obj):
    obj.display_type = "WIRE"
    obj.show_in_front = True
    obj.color = color_to_rgba(BRUSH_WIREFRAME_COLOR)

    if len(obj.data.materials) == 0:
        obj.data.materials.append(make_tool_material("collision_wire", BRUSH_WIREFRAME_COLOR))
    else:
        obj.data.materials[0] = make_tool_material("collision_wire", BRUSH_WIREFRAME_COLOR)


def set_trigger_brush_props(obj, trigger_type="generic", trigger_event="trigger"):
    obj["aqua_brush_type"] = "trigger"
    obj["aqua_trigger"] = True
    obj["aqua_trigger_id"] = obj.name
    obj["aqua_trigger_type"] = trigger_type
    obj["aqua_trigger_event"] = trigger_event
    obj["aqua_collision_kind"] = "none"
    obj.display_type = "WIRE"
    obj.show_in_front = True
    obj.show_name = True
    obj.color = color_to_rgba(TRIGGER_WIREFRAME_COLOR)

    if len(obj.data.materials) == 0:
        obj.data.materials.append(make_tool_material("trigger_wire", TRIGGER_WIREFRAME_COLOR))
    else:
        obj.data.materials[0] = make_tool_material("trigger_wire", TRIGGER_WIREFRAME_COLOR)


def set_audio_custom_property_ui(obj, key, description=None, min_value=None, max_value=None):
    try:
        ui = obj.id_properties_ui(key)
        settings = {}

        if description is not None:
            settings["description"] = description

        if min_value is not None:
            settings["min"] = min_value

        if max_value is not None:
            settings["max"] = max_value

        if settings:
            ui.update(**settings)
    except (AttributeError, KeyError, TypeError, RuntimeError):
        pass


def set_positional_audio_props(
    obj,
    asset_id=None,
    volume=1.0,
    audio_range=14.0,
    ref_distance=1.5,
    rolloff=1.0,
    loop=True,
):
    obj["aqua_entity"] = "audio_source"
    obj["aqua_audio_type"] = "positional"
    obj["aqua_audio_asset"] = normalize_audio_asset_ref(asset_id)
    obj["aqua_audio_volume"] = float(volume)
    obj["aqua_audio_range"] = float(audio_range)
    obj["aqua_audio_ref_distance"] = float(ref_distance)
    obj["aqua_audio_rolloff"] = float(rolloff)
    obj["aqua_audio_distance_model"] = "linear"
    obj["aqua_audio_loop"] = bool(loop)
    if obj.type == "EMPTY":
        obj.empty_display_type = "SPHERE"
        obj.empty_display_size = 0.65
    obj.show_name = True
    set_audio_property_ui(obj)


def set_trigger_audio_props(
    obj,
    asset_id,
    volume=1.0,
    fade_in=1.25,
    fade_out=1.25,
    priority=0,
    loop=True,
):
    set_trigger_brush_props(obj, trigger_type="audio", trigger_event="soundscape")
    obj["aqua_audio_type"] = "ambient"
    obj["aqua_audio_asset"] = normalize_audio_asset_ref(asset_id)
    obj["aqua_audio_volume"] = float(volume)
    obj["aqua_audio_fade_in"] = float(fade_in)
    obj["aqua_audio_fade_out"] = float(fade_out)
    obj["aqua_audio_priority"] = int(priority)
    obj["aqua_audio_loop"] = bool(loop)
    set_audio_property_ui(obj)


def clear_trigger_audio_props(obj):
    for key in [
        "aqua_audio_type",
        "aqua_audio_asset",
        "aqua_audio_volume",
        "aqua_audio_fade_in",
        "aqua_audio_fade_out",
        "aqua_audio_priority",
        "aqua_audio_loop",
    ]:
        if key in obj:
            del obj[key]


def set_audio_property_ui(obj):
    set_audio_custom_property_ui(obj, "aqua_audio_asset", "Audio manifest id or direct /assets/audio URL")
    set_audio_custom_property_ui(obj, "aqua_audio_volume", "Default playback volume", 0.0, 1.0)
    set_audio_custom_property_ui(obj, "aqua_audio_range", "Maximum positional audio range in engine units", 0.01, 1000.0)
    set_audio_custom_property_ui(obj, "aqua_audio_ref_distance", "Distance where positional audio starts attenuating", 0.01, 1000.0)
    set_audio_custom_property_ui(obj, "aqua_audio_rolloff", "Positional audio attenuation strength", 0.0, 10.0)
    set_audio_custom_property_ui(obj, "aqua_audio_fade_in", "Ambient fade-in duration in seconds", 0.0, 60.0)
    set_audio_custom_property_ui(obj, "aqua_audio_fade_out", "Ambient fade-out duration in seconds", 0.0, 60.0)
    set_audio_custom_property_ui(obj, "aqua_audio_priority", "Ambient trigger priority", -1000, 1000)


DOOR_METADATA_KEYS = (
    "aqua_prop_type",
    "aqua_door",
    "aqua_door_open_audio",
    "aqua_door_close_audio",
)


def set_door_property_ui(obj):
    set_audio_custom_property_ui(obj, "aqua_prop_type", "Runtime prop behavior type")
    set_audio_custom_property_ui(obj, "aqua_door", "Marks this prop instance as an interactable door")
    set_audio_custom_property_ui(obj, "aqua_door_open_audio", "Audio manifest id or direct /assets/audio URL played when the door opens")
    set_audio_custom_property_ui(obj, "aqua_door_close_audio", "Audio manifest id or direct /assets/audio URL played when the door closes")


def set_door_props(obj, open_audio=None, close_audio=None):
    obj["aqua_prop_type"] = "door"
    obj["aqua_door"] = True
    obj["aqua_door_open_audio"] = normalize_audio_asset_ref(open_audio)
    obj["aqua_door_close_audio"] = normalize_audio_asset_ref(close_audio)
    obj.show_name = True
    set_door_property_ui(obj)


def clear_door_props(obj):
    for key in DOOR_METADATA_KEYS:
        if key in obj:
            del obj[key]


def set_skybox_property_ui(obj):
    set_audio_custom_property_ui(obj, "aqua_skybox", "Skybox id under /assets/skyboxes")


def set_skybox_props(obj, skybox_name=None):
    obj["aqua_entity"] = "skybox"
    obj["aqua_skybox"] = normalize_skybox_name(skybox_name)
    if obj.type == "EMPTY":
        obj.empty_display_type = "SPHERE"
        obj.empty_display_size = 1.2
    obj.show_name = True
    set_skybox_property_ui(obj)
    link_to_collection(obj, SKYBOX_COLLECTION)


def normalize_skybox_name(value):
    return clean_asset_name(value or DEFAULT_SKYBOX_NAME)


def select_object(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def is_collision_brush(obj):
    brush_type = get_custom_string(obj, "aqua_brush_type", "aquaBrushType")
    collision_kind = get_custom_string(obj, "aqua_collision_kind", "aquaCollisionKind")

    return brush_type in {"box", "plane", "ramp"} or collision_kind in {"brush", "slope", "convex"}


def clean_geometry_object(obj):
    removed_count = remove_aqua_metadata(obj)

    try:
        obj.show_name = False
    except (AttributeError, TypeError, RuntimeError):
        pass

    if obj.type == "MESH":
        try:
            obj.display_type = "TEXTURED"
            obj.show_in_front = False
        except (AttributeError, TypeError, RuntimeError):
            pass

    return removed_count


def remove_aqua_metadata(obj):
    removed_count = 0

    for key in list(obj.keys()):
        if not key.startswith(AQUA_CUSTOM_PROPERTY_PREFIX):
            continue

        try:
            del obj[key]
            removed_count += 1
        except (AttributeError, TypeError, RuntimeError):
            continue

    return removed_count


def initialize_fresh_aqua_metadata(obj, metadata_kind, prop_asset_id=None, prop_asset_url=None, prop_root=None):
    if not supports_fresh_aqua_metadata(obj, metadata_kind):
        return 0, False

    if metadata_kind in {"PROP", "DOOR"} and is_prop_collision_helper(obj, prop_root):
        return initialize_fresh_collision_helper_metadata(obj)

    removed_count = remove_aqua_metadata(obj)

    if metadata_kind == "PROP":
        prop_asset_id = clean_asset_name(prop_asset_id or clean_object_asset_name(obj))
        prop_asset_url = prop_asset_url or f"{PROP_ASSET_URL_PREFIX}/{prop_asset_id}.aqua_prop.json"
        apply_persistent_prop_metadata([obj], prop_asset_id, prop_asset_url)
        obj.show_name = True
        link_to_collection(obj, PROP_COLLECTION)
        return removed_count, True

    if metadata_kind == "DOOR":
        prop_asset_id = clean_asset_name(prop_asset_id or clean_object_asset_name(obj))
        prop_asset_url = prop_asset_url or f"{PROP_ASSET_URL_PREFIX}/{prop_asset_id}.aqua_prop.json"
        apply_persistent_prop_metadata([obj], prop_asset_id, prop_asset_url)
        set_door_props(
            obj,
            bpy.context.scene.aqua_door_open_audio_asset_id,
            bpy.context.scene.aqua_door_close_audio_asset_id,
        )
        link_to_collection(obj, PROP_COLLECTION)
        return removed_count, True

    if metadata_kind == "WORLD_DECORATIVE":
        if obj.type == "MESH":
            mark_decorative_world_mesh(obj)
            return removed_count, True
        return removed_count, False

    if metadata_kind == "WORLD_COLLISION":
        if obj.type == "MESH":
            mark_world_mesh(obj)
            return removed_count, True
        return removed_count, False

    if metadata_kind == "TERRAIN":
        if obj.type == "MESH":
            mark_terrain_mesh(obj)
            return removed_count, True
        return removed_count, False

    if metadata_kind == "TRIGGER":
        if obj.type == "MESH":
            set_trigger_brush_props(obj)
            link_to_collection(obj, TRIGGER_COLLECTION)
            return removed_count, True
        return removed_count, False

    if metadata_kind == "PLAYER_START":
        obj["aqua_entity"] = "info_player_start"
        obj.show_name = True
        link_to_collection(obj, ENTITY_COLLECTION)
        return removed_count, True

    if metadata_kind == "POSITIONAL_AUDIO":
        set_positional_audio_props(obj)
        link_to_collection(obj, AUDIO_COLLECTION)
        return removed_count, True

    if metadata_kind == "SKYBOX":
        set_skybox_props(obj, bpy.context.scene.aqua_skybox_name)
        return removed_count, True

    return removed_count, False


def is_prop_collision_helper(obj, prop_root=None):
    if obj.type != "MESH":
        return False

    brush_type = obj.get("aqua_brush_type")
    collision_kind = obj.get("aqua_collision_kind")

    if brush_type in {"box", "plane", "ramp"} or collision_kind in {"brush", "slope", "convex"}:
        return True

    if prop_root and obj != prop_root and is_descendant_of(obj, prop_root):
        return infer_collision_helper_brush_type(obj) is not None

    return obj.parent is not None and infer_collision_helper_brush_type(obj) is not None


def is_descendant_of(obj, root):
    parent = obj.parent

    while parent:
        if parent == root:
            return True

        parent = parent.parent

    return False


def infer_collision_helper_brush_type(obj):
    brush_type = get_custom_string(obj, "aqua_brush_type", "aquaBrushType")

    if brush_type in {"box", "plane", "ramp"}:
        return brush_type

    names = [
        obj.name,
        getattr(getattr(obj, "data", None), "name", ""),
    ]

    for name in names:
        clean_name = clean_asset_name(strip_blender_duplicate_suffix(name))

        if clean_name.startswith(("brush_ramp", "collision_ramp", "collider_ramp")) or clean_name in {"ramp_collision", "ramp_collider"}:
            return "ramp"

        if clean_name.startswith(("brush_floor", "brush_plane", "collision_plane", "collider_plane")) or clean_name in {"floor_collision", "plane_collision"}:
            return "plane"

        if clean_name.startswith((
            "brush_box",
            "collision_box",
            "collider_box",
            "ucx_",
        )) or clean_name in {"collision", "collider", "box_collision", "box_collider"}:
            return "box"

    return None


def initialize_fresh_collision_helper_metadata(obj):
    brush_type = infer_collision_helper_brush_type(obj) or "box"
    collision_kind = get_custom_string(obj, "aqua_collision_kind", "aquaCollisionKind")
    removed_count = remove_aqua_metadata(obj)

    if brush_type not in {"box", "plane", "ramp"}:
        brush_type = "box"

    obj["aqua_brush_type"] = brush_type

    if collision_kind in {"brush", "slope", "convex"}:
        obj["aqua_collision_kind"] = collision_kind
    elif brush_type == "ramp":
        obj["aqua_collision_kind"] = "slope"
    else:
        obj["aqua_collision_kind"] = "brush"

    if obj.parent:
        obj["aqua_attached_to"] = obj.parent.name

    obj.show_name = True
    set_collision_brush_preview(obj)
    link_to_collection(obj, BRUSH_COLLECTION)
    return removed_count, True


def supports_fresh_aqua_metadata(obj, metadata_kind):
    if metadata_kind in {"WORLD_DECORATIVE", "WORLD_COLLISION", "TERRAIN", "TRIGGER"}:
        return obj.type == "MESH"

    return metadata_kind in {"PROP", "DOOR", "PLAYER_START", "POSITIONAL_AUDIO", "SKYBOX"}


def selected_objects_and_children(context):
    objects = []
    seen = set()

    def add_object(obj):
        if obj.name in seen:
            return

        seen.add(obj.name)
        objects.append(obj)

        for child in obj.children:
            add_object(child)

    for obj in context.selected_objects:
        add_object(obj)

    return objects


def object_and_children(root):
    objects = []
    seen = set()

    def add_object(obj):
        if obj.name in seen:
            return

        seen.add(obj.name)
        objects.append(obj)

        for child in obj.children:
            add_object(child)

    add_object(root)
    return objects


PROP_EXPORT_METADATA_KEYS = (
    "aqua_asset_type",
    "aqua_prop_id",
    "aqua_prop_name",
    "aqua_prop_asset",
)


def begin_prop_metadata_export(objects, prop_asset_id, prop_asset_url, prop_root=None):
    state = []

    for obj in objects:
        if is_prop_collision_helper(obj, prop_root):
            state.append((obj, {}))
            initialize_fresh_collision_helper_metadata(obj)
            continue

        previous_values = {}

        for key in PROP_EXPORT_METADATA_KEYS:
            previous_values[key] = (key in obj, obj.get(key))

        state.append((obj, previous_values))
        obj["aqua_asset_type"] = "prop"
        obj["aqua_prop_id"] = prop_asset_id
        obj["aqua_prop_name"] = prop_asset_id
        obj["aqua_prop_asset"] = prop_asset_url

    return state


def end_prop_metadata_export(state):
    for obj, previous_values in reversed(state):
        for key, (had_value, value) in previous_values.items():
            try:
                if had_value:
                    obj[key] = value
                elif key in obj:
                    del obj[key]
            except (AttributeError, TypeError, RuntimeError):
                continue


def apply_persistent_prop_metadata(objects, prop_asset_id, prop_asset_url, prop_root=None):
    for obj in objects:
        if is_prop_collision_helper(obj, prop_root):
            initialize_fresh_collision_helper_metadata(obj)
            continue

        obj["aqua_asset_type"] = "prop"
        obj["aqua_prop_id"] = prop_asset_id
        obj["aqua_prop_name"] = prop_asset_id
        obj["aqua_prop_asset"] = prop_asset_url


def set_collision_brushes_visible(visible):
    count = 0

    for obj in bpy.data.objects:
        if not is_collision_brush(obj):
            continue

        obj.hide_set(not visible)
        count += 1

    return count


def base_material_name_for_duplicate(name):
    match = DUPLICATE_MATERIAL_SUFFIX_RE.match(name)

    if not match:
        return None

    return match.group(1)


def merge_duplicate_materials():
    merged_count = 0
    removed_count = 0
    skipped_count = 0

    for material in list(bpy.data.materials):
        base_name = base_material_name_for_duplicate(material.name)

        if not base_name:
            continue

        base_material = bpy.data.materials.get(base_name)

        if base_material is None or base_material == material:
            continue

        if material.library:
            skipped_count += 1
            continue

        try:
            material.user_remap(base_material)
            merged_count += 1
        except RuntimeError:
            skipped_count += 1
            continue

        if remove_material_if_possible(material):
            removed_count += 1

    return {
        "merged": merged_count,
        "removed": removed_count,
        "skipped": skipped_count,
    }


def object_in_collection_tree(obj, collection_name):
    collection = bpy.data.collections.get(collection_name)

    if collection is None:
        return False

    return collection_contains_object(collection, obj)


def collection_contains_object(collection, obj):
    if obj.name in collection.objects.keys():
        return True

    for child in collection.children:
        if collection_contains_object(child, obj):
            return True

    return False


def is_reserved_non_world_object(obj):
    return any(object_in_collection_tree(obj, collection_name) for collection_name in NON_WORLD_COLLECTIONS)


def auto_mark_world_meshes_for_export():
    count = 0

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue

        if is_prop_render_source_object(obj):
            continue

        if is_reserved_non_world_object(obj):
            continue

        if obj.get("aqua_brush_type") == "mesh":
            mark_decorative_world_mesh(obj)
            count += 1
            continue

        if "aqua_brush_type" in obj or "aqua_asset_type" in obj:
            continue

        mark_decorative_world_mesh(obj)
        count += 1

    return count


def engine_location_to_blender(location):
    x, y, z = location
    return (x, -z, y)


def engine_scale_to_blender(scale):
    x, y, z = scale
    return (x, z, y)


def blender_location_to_engine(location):
    x, y, z = location
    return (x, z, -y)


def create_engine_cube_brush(name, brush_type, location, scale, color):
    return create_cube_brush(
        name,
        brush_type,
        engine_location_to_blender(location),
        engine_scale_to_blender(scale),
        color,
    )


def create_engine_ramp_brush(name, location, scale, color):
    return create_ramp_brush(
        name,
        engine_location_to_blender(location),
        engine_scale_to_blender(scale),
        color,
    )


def create_cube_brush(name, brush_type, location, scale, color, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    set_common_brush_props(obj, brush_type, color)
    set_collision_brush_preview(obj)
    attach_brush_to_parent(obj, parent)
    normalize_prop_collision_helper_on_create(obj, parent)
    link_to_collection(obj, BRUSH_COLLECTION)
    select_object(obj)
    return obj


def create_ramp_brush(name, location, scale, color, parent=None):
    vertices = [
        (-0.5, -0.5, -0.5),
        (0.5, -0.5, -0.5),
        (-0.5, 0.5, -0.5),
        (0.5, 0.5, -0.5),
        (-0.5, 0.5, 0.5),
        (0.5, 0.5, 0.5),
    ]
    faces = [
        (0, 2, 3, 1),
        (2, 4, 5, 3),
        (0, 1, 5, 4),
        (0, 4, 2),
        (1, 3, 5),
    ]
    mesh = bpy.data.meshes.new(name)

    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.scale = scale
    set_common_brush_props(obj, "ramp", color)
    obj["aqua_collision_kind"] = "slope"
    set_collision_brush_preview(obj)
    attach_brush_to_parent(obj, parent)
    normalize_prop_collision_helper_on_create(obj, parent)
    link_to_collection(obj, BRUSH_COLLECTION)
    select_object(obj)
    return obj


def normalize_prop_collision_helper_on_create(obj, parent):
    if parent is None or not is_prop_source_object(parent):
        return

    initialize_fresh_collision_helper_metadata(obj)


def attach_brush_to_parent(obj, parent):
    if parent is None:
        return

    obj.matrix_world = parent.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj["aqua_attached_to"] = parent.name


def is_brush_parent_anchor(obj):
    if not obj or is_collision_brush(obj):
        return False

    if obj.type == "MESH":
        return True

    if obj.type != "EMPTY":
        return False

    return bool(
        is_prop_source_object(obj) or
        getattr(obj, "instance_collection", None) or
        obj.children
    )


def selected_brush_parent_anchor(context):
    active = context.view_layer.objects.active

    if is_brush_parent_anchor(active):
        return active

    for obj in context.selected_objects:
        if is_brush_parent_anchor(obj):
            return obj

    return None


def create_attached_or_default_cube_brush(context, name, brush_type, default_scale, color):
    parent = selected_brush_parent_anchor(context)

    if parent:
        return create_cube_brush(name, brush_type, parent.location, parent.scale, color, parent=parent)

    return create_cube_brush(name, brush_type, context.scene.cursor.location, default_scale, color)


def create_trigger_volume(name, location, scale, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    set_trigger_brush_props(obj)
    attach_brush_to_parent(obj, parent)
    link_to_collection(obj, TRIGGER_COLLECTION)
    select_object(obj)
    return obj


def create_attached_or_default_trigger_volume(context, name, default_scale):
    parent = selected_brush_parent_anchor(context)

    if parent:
        return create_trigger_volume(name, parent.location, parent.scale, parent=parent)

    return create_trigger_volume(name, context.scene.cursor.location, default_scale)


def create_positional_audio_source(context, name="audio_source"):
    obj = bpy.data.objects.new(name, None)
    obj.location = context.scene.cursor.location
    set_positional_audio_props(
        obj,
        context.scene.aqua_audio_asset_id,
        context.scene.aqua_audio_volume,
        context.scene.aqua_audio_range,
        context.scene.aqua_audio_ref_distance,
        context.scene.aqua_audio_rolloff,
        context.scene.aqua_audio_loop,
    )
    link_to_collection(obj, AUDIO_COLLECTION)
    select_object(obj)
    return obj


def selected_trigger_objects(context):
    return [
        obj
        for obj in context.selected_objects
        if is_trigger_volume_object(obj)
    ]


def selected_prop_roots(context):
    roots = []
    seen = set()

    for obj in context.selected_objects:
        root = prop_reference_root(obj) if obj else None

        if not root or not is_prop_source_object(root) or root.name in seen:
            continue

        seen.add(root.name)
        roots.append(root)

    return roots


def is_trigger_volume_object(obj):
    if obj is None:
        return False

    return obj.get("aqua_brush_type") == "trigger" or bool(obj.get("aqua_trigger"))


def create_attached_or_default_ramp_brush(context, name, default_scale, color):
    parent = selected_brush_parent_anchor(context)

    if parent:
        return create_ramp_brush(name, parent.location, parent.scale, color, parent=parent)

    return create_ramp_brush(name, context.scene.cursor.location, default_scale, color)


def mark_terrain_mesh(obj):
    obj["aqua_brush_type"] = "terrain"
    obj["aqua_color"] = "#4f765d"
    obj["aqua_bake_id"] = obj.name
    obj["aqua_collision_kind"] = "terrain_mesh"
    obj["aqua_height_mode"] = "authored_mesh"
    obj.display_type = "TEXTURED"
    obj.show_name = True

    if len(obj.data.materials) == 0:
        obj.data.materials.append(make_tool_material("terrain", (0.22, 0.42, 0.26, 1.0)))

    link_to_collection(obj, BRUSH_COLLECTION)


def mark_world_mesh(obj):
    obj["aqua_brush_type"] = "mesh"
    obj["aqua_color"] = "#7f8a8f"
    obj["aqua_bake_id"] = obj.name
    obj["aqua_collision_kind"] = "triangle"
    obj.display_type = "TEXTURED"
    obj.show_name = True
    link_to_collection(obj, BRUSH_COLLECTION)


def mark_decorative_world_mesh(obj):
    obj["aqua_brush_type"] = "mesh"
    obj["aqua_color"] = "#7f8a8f"
    obj["aqua_bake_id"] = obj.name
    obj["aqua_collision_kind"] = "none"
    obj.display_type = "TEXTURED"
    obj.show_name = True
    link_to_collection(obj, BRUSH_COLLECTION)


def create_skybox_marker(context):
    obj = bpy.data.objects.get("skybox")

    if obj is None:
        obj = bpy.data.objects.new("skybox", None)
        obj.location = context.scene.cursor.location
    else:
        obj.name = "skybox"

    set_skybox_props(obj, context.scene.aqua_skybox_name)
    select_object(obj)
    return obj


def create_light_marker(name, light_type, location, color="#fff2d0", intensity=1.0, light_range=None, direction=None):
    return create_blender_light(name, light_type, location, color, intensity, light_range, direction)


def create_blender_light(name, light_type, location, color="#fff2d0", intensity=1.0, light_range=None, direction=None):
    normalized_type = "directional" if light_type == "sun" else light_type
    blender_type = {
        "ambient": "POINT",
        "directional": "SUN",
        "point": "POINT",
        "spot": "SPOT",
    }.get(normalized_type, "POINT")
    light_data = bpy.data.lights.new(name, type=blender_type)
    obj = bpy.data.objects.new(name, light_data)
    rgba = color_to_rgba(color)

    obj.location = location
    obj.show_name = True
    light_data.color = rgba[:3]
    light_data.energy = float(intensity)

    if light_range is not None and hasattr(light_data, "cutoff_distance"):
        light_data.use_custom_distance = True
        light_data.cutoff_distance = float(light_range)

    if normalized_type == "spot":
        light_data.spot_size = math.radians(45.0)
        light_data.spot_blend = 0.5

    if normalized_type == "directional" and direction is not None:
        set_light_direction(obj, direction)

    sync_aqua_light_props(obj, normalized_type)
    link_to_collection(obj, LIGHT_COLLECTION)
    select_object(obj)
    return obj


def set_light_direction(obj, engine_direction):
    direction = mathutils.Vector((engine_direction[0], -engine_direction[2], engine_direction[1]))

    if direction.length <= 0:
        return

    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()


def sync_aqua_light_props(obj, light_type=None):
    if obj.type != "LIGHT":
        return

    data = obj.data
    resolved_type = light_type or obj.get("aqua_light_type") or aqua_light_type_from_blender(data)
    if resolved_type == "sun":
        resolved_type = "directional"
    obj["aqua_light_type"] = resolved_type
    obj["aqua_light_color"] = rgba_to_hex((*data.color, 1.0))
    obj["aqua_light_intensity"] = float(data.energy)

    if resolved_type in {"point", "spot"}:
        obj["aqua_light_range"] = float(data.cutoff_distance if getattr(data, "use_custom_distance", False) else 10.0)
    elif "aqua_light_range" in obj:
        del obj["aqua_light_range"]

    if resolved_type == "spot":
        obj["aqua_light_inner_cone"] = float(data.spot_size * max(1.0 - data.spot_blend, 0.0))
        obj["aqua_light_outer_cone"] = float(data.spot_size)
    else:
        for key in ("aqua_light_inner_cone", "aqua_light_outer_cone"):
            if key in obj:
                del obj[key]

    if "aqua_light_direction" in obj:
        del obj["aqua_light_direction"]


def aqua_light_type_from_blender(light_data):
    if light_data.type == "SUN":
        return "directional"

    if light_data.type == "POINT":
        return "point"

    if light_data.type == "SPOT":
        return "spot"

    return "ambient"


def sync_lights_for_export():
    count = 0

    for obj in bpy.context.scene.objects:
        if obj.type != "LIGHT":
            continue

        if not object_in_collection_tree(obj, LIGHT_COLLECTION) and "aqua_light_type" not in obj:
            continue

        sync_aqua_light_props(obj)
        count += 1

    return count


def create_terrain_mesh(name, location, width=5.0, depth=4.0, segments_x=12, segments_z=10):
    vertices = []
    faces = []

    for row in range(segments_z + 1):
        z_ratio = row / segments_z
        engine_z = (z_ratio - 0.5) * depth

        for column in range(segments_x + 1):
            x_ratio = column / segments_x
            x = (x_ratio - 0.5) * width
            height = terrain_height(x_ratio, z_ratio)
            vertices.append((x, -engine_z, height))

    columns = segments_x + 1

    for row in range(segments_z):
        for column in range(segments_x):
            a = row * columns + column
            b = a + 1
            c = a + columns
            d = c + 1
            faces.append((a, c, b))
            faces.append((b, c, d))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.data.materials.append(make_tool_material("terrain", (0.22, 0.42, 0.26, 1.0)))
    set_common_brush_props(obj, "terrain", "#4f765d")
    obj["aqua_segments_x"] = segments_x
    obj["aqua_segments_z"] = segments_z
    obj["aqua_height_mode"] = "authored_mesh"
    obj["aqua_max_snap_depth"] = 0.55
    link_to_collection(obj, BRUSH_COLLECTION)
    select_object(obj)
    return obj


def terrain_height(x_ratio, z_ratio):
    return (
        math.sin(x_ratio * math.pi * 2.25) * 0.12
        + math.cos(z_ratio * math.pi * 2.0) * 0.08
        + math.sin((x_ratio + z_ratio) * math.pi * 1.5) * 0.05
    )


class AQUA_OT_setup_collections(bpy.types.Operator):
    bl_idname = "aqua.setup_collections"
    bl_label = "Create Aqua Collections"
    bl_description = "Create the Blender collections used by the Aqua map pipeline"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        for name in [
            BRUSH_COLLECTION,
            ENTITY_COLLECTION,
            TRIGGER_COLLECTION,
            PROP_COLLECTION,
            LIGHT_COLLECTION,
            AUDIO_COLLECTION,
            SKYBOX_COLLECTION,
        ]:
            ensure_collection(name)

        return {"FINISHED"}


class AQUA_OT_add_box_brush(bpy.types.Operator):
    bl_idname = "aqua.add_box_brush"
    bl_label = "Add Box Brush"
    bl_description = "Create an Aqua box brush datapoint"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_attached_or_default_cube_brush(
            context,
            "brush_box",
            "box",
            (2.0, 2.0, 1.0),
            "#7f8a8f",
        )
        return {"FINISHED"}


class AQUA_OT_add_floor_brush(bpy.types.Operator):
    bl_idname = "aqua.add_floor_brush"
    bl_label = "Add Flat Plane"
    bl_description = "Create a thin flat brush suitable for floors"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_attached_or_default_cube_brush(
            context,
            "brush_floor",
            "plane",
            (8.0, 8.0, 0.12),
            "#29313a",
        )
        return {"FINISHED"}


class AQUA_OT_add_ramp_brush(bpy.types.Operator):
    bl_idname = "aqua.add_ramp_brush"
    bl_label = "Add Ramp Brush"
    bl_description = "Create a five-sided triangular prism ramp brush"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_attached_or_default_ramp_brush(
            context,
            "brush_ramp",
            (3.0, 2.0, 1.0),
            "#7f8a8f",
        )
        return {"FINISHED"}


class AQUA_OT_add_trigger_volume(bpy.types.Operator):
    bl_idname = "aqua.add_trigger_volume"
    bl_label = "Add Trigger Volume"
    bl_description = "Create a non-solid Aqua trigger volume"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_attached_or_default_trigger_volume(
            context,
            "trigger_volume",
            (3.0, 3.0, 2.0),
        )
        return {"FINISHED"}


class AQUA_OT_add_positional_audio_source(bpy.types.Operator):
    bl_idname = "aqua.add_positional_audio_source"
    bl_label = "Add Positional Audio"
    bl_description = "Create a positional audio source marker using the current Audio defaults"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_positional_audio_source(context)
        return {"FINISHED"}


class AQUA_OT_assign_trigger_audio(bpy.types.Operator):
    bl_idname = "aqua.assign_trigger_audio"
    bl_label = "Assign Trigger Audio"
    bl_description = "Link selected trigger volumes to the current ambient audio asset"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        asset_id = normalize_audio_asset_ref(context.scene.aqua_audio_asset_id)

        if not asset_id:
            self.report({"ERROR"}, "Set an Audio Asset id before assigning trigger audio")
            return {"CANCELLED"}

        triggers = selected_trigger_objects(context)

        if not triggers:
            self.report({"ERROR"}, "Select at least one Aqua trigger volume")
            return {"CANCELLED"}

        for obj in triggers:
            set_trigger_audio_props(
                obj,
                asset_id,
                context.scene.aqua_audio_volume,
                context.scene.aqua_audio_fade_in,
                context.scene.aqua_audio_fade_out,
                context.scene.aqua_audio_priority,
                context.scene.aqua_audio_loop,
            )

        self.report({"INFO"}, f"Assigned ambient audio '{asset_id}' to {len(triggers)} trigger volume(s)")
        return {"FINISHED"}


class AQUA_OT_clear_trigger_audio(bpy.types.Operator):
    bl_idname = "aqua.clear_trigger_audio"
    bl_label = "Clear Trigger Audio"
    bl_description = "Remove ambient audio metadata from selected trigger volumes"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        triggers = selected_trigger_objects(context)

        if not triggers:
            self.report({"ERROR"}, "Select at least one Aqua trigger volume")
            return {"CANCELLED"}

        for obj in triggers:
            clear_trigger_audio_props(obj)

        self.report({"INFO"}, f"Cleared ambient audio from {len(triggers)} trigger volume(s)")
        return {"FINISHED"}


class AQUA_OT_assign_door_metadata(bpy.types.Operator):
    bl_idname = "aqua.assign_door_metadata"
    bl_label = "Assign Door"
    bl_description = "Mark selected prop roots as doors and assign open/close audio metadata"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        props = selected_prop_roots(context)

        if not props:
            self.report({"ERROR"}, "Select at least one Aqua prop")
            return {"CANCELLED"}

        open_audio = normalize_audio_asset_ref(context.scene.aqua_door_open_audio_asset_id)
        close_audio = normalize_audio_asset_ref(context.scene.aqua_door_close_audio_asset_id)

        for obj in props:
            set_door_props(obj, open_audio, close_audio)

        self.report({"INFO"}, f"Assigned door metadata to {len(props)} prop(s)")
        return {"FINISHED"}


class AQUA_OT_clear_door_metadata(bpy.types.Operator):
    bl_idname = "aqua.clear_door_metadata"
    bl_label = "Clear Door"
    bl_description = "Remove door metadata from selected prop roots"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        props = selected_prop_roots(context)

        if not props:
            self.report({"ERROR"}, "Select at least one Aqua prop")
            return {"CANCELLED"}

        for obj in props:
            clear_door_props(obj)

        self.report({"INFO"}, f"Cleared door metadata from {len(props)} prop(s)")
        return {"FINISHED"}


class AQUA_OT_add_terrain_brush(bpy.types.Operator):
    bl_idname = "aqua.add_terrain_brush"
    bl_label = "Mark Uneven Terrain"
    bl_description = "Mark selected mesh objects as one-sided authored terrain collision"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]

        if not meshes:
            self.report({"ERROR"}, "Select at least one mesh to mark as uneven terrain")
            return {"CANCELLED"}

        for obj in meshes:
            mark_terrain_mesh(obj)

        self.report({"INFO"}, f"Marked {len(meshes)} mesh object(s) as Aqua uneven terrain")
        return {"FINISHED"}


class AQUA_OT_mark_world_mesh(bpy.types.Operator):
    bl_idname = "aqua.mark_world_mesh"
    bl_label = "Mark World Mesh"
    bl_description = "Mark selected mesh objects as engine world geometry with triangle collision"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]

        if not meshes:
            self.report({"ERROR"}, "Select at least one mesh to mark as world geometry")
            return {"CANCELLED"}

        for obj in meshes:
            mark_world_mesh(obj)

        self.report({"INFO"}, f"Marked {len(meshes)} mesh object(s) as Aqua world geometry")
        return {"FINISHED"}


class AQUA_OT_add_player_start(bpy.types.Operator):
    bl_idname = "aqua.add_player_start"
    bl_label = "Add Player Start"
    bl_description = "Create an info_player_start entity marker"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        empty = bpy.data.objects.new("info_player_start", None)
        empty.empty_display_type = "ARROWS"
        empty.empty_display_size = 0.8
        empty.location = context.scene.cursor.location
        empty["aqua_entity"] = "info_player_start"
        empty.show_name = True
        link_to_collection(empty, ENTITY_COLLECTION)
        select_object(empty)
        return {"FINISHED"}


class AQUA_OT_add_skybox_marker(bpy.types.Operator):
    bl_idname = "aqua.add_skybox_marker"
    bl_label = "Add Skybox"
    bl_description = "Create or update the skybox marker used by Aqua maps"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        obj = create_skybox_marker(context)
        self.report({"INFO"}, f"Skybox marker set to '{obj['aqua_skybox']}'")
        return {"FINISHED"}


class AQUA_OT_add_point_light(bpy.types.Operator):
    bl_idname = "aqua.add_point_light"
    bl_label = "Add Point Light"
    bl_description = "Create a Blender point light used by Aqua lighting"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_light_marker(
            "light_point",
            "point",
            context.scene.cursor.location,
            "#fff2d0",
            5.0,
            8.0,
        )
        return {"FINISHED"}


class AQUA_OT_add_sun_light(bpy.types.Operator):
    bl_idname = "aqua.add_sun_light"
    bl_label = "Add Sun Light"
    bl_description = "Create a Blender sun light used by Aqua lighting"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_light_marker(
            "light_sun",
            "sun",
            context.scene.cursor.location,
            "#fff2d0",
            1.15,
            direction=[-0.55, 0.82, 0.35],
        )
        return {"FINISHED"}


class AQUA_OT_add_ambient_light(bpy.types.Operator):
    bl_idname = "aqua.add_ambient_light"
    bl_label = "Add Ambient Light"
    bl_description = "Create a Blender light used as Aqua ambient lighting"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_light_marker(
            "light_ambient",
            "ambient",
            context.scene.cursor.location,
            "#8aa7bd",
            0.22,
        )
        return {"FINISHED"}


class AQUA_OT_toggle_collision_brush_visibility(bpy.types.Operator):
    bl_idname = "aqua.toggle_collision_brush_visibility"
    bl_label = "Toggle Collision Brushes"
    bl_description = "Show or hide Aqua collision brush objects in the viewport"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        visible = not context.scene.aqua_collision_brushes_visible
        count = set_collision_brushes_visible(visible)
        context.scene.aqua_collision_brushes_visible = visible

        state = "Shown" if visible else "Hidden"
        self.report({"INFO"}, f"{state} {count} Aqua collision brush object(s)")
        return {"FINISHED"}


class AQUA_OT_initialize_metadata(bpy.types.Operator):
    bl_idname = "aqua.initialize_metadata"
    bl_label = "Fresh Aqua Metadata"
    bl_description = "Clear existing Aqua custom properties and stamp a fresh metadata preset"
    bl_options = {"REGISTER", "UNDO"}

    metadata_kind: bpy.props.EnumProperty(
        name="Metadata Type",
        items=[
            ("PROP", "Prop", "Reusable prop source metadata"),
            ("DOOR", "Door Prop", "Reusable prop metadata plus door interaction/audio fields"),
            ("WORLD_DECORATIVE", "Decorative World Mesh", "Non-colliding world mesh metadata"),
            ("WORLD_COLLISION", "Colliding World Mesh", "Triangle-colliding world mesh metadata"),
            ("TERRAIN", "Uneven Terrain", "One-sided terrain mesh metadata"),
            ("TRIGGER", "Trigger Volume", "Non-solid trigger volume metadata"),
            ("PLAYER_START", "Player Start", "info_player_start entity metadata"),
            ("POSITIONAL_AUDIO", "Positional Audio", "3D positional audio source metadata"),
            ("SKYBOX", "Skybox", "Map skybox metadata marker"),
        ],
        default="PROP",
    )
    include_children: bpy.props.BoolProperty(
        name="Include Children",
        default=True,
        description="Also initialize selected child objects",
    )

    def execute(self, context):
        objects = selected_objects_and_children(context) if self.include_children else list(context.selected_objects)

        if not objects:
            self.report({"ERROR"}, "Select at least one object to initialize")
            return {"CANCELLED"}

        removed_count = 0
        initialized_count = 0

        if self.metadata_kind in {"PROP", "DOOR"}:
            roots = list(context.selected_objects)
            initialized_names = set()

            for root in roots:
                prop_source = root.parent if is_prop_collision_helper(root, root.parent) and root.parent else root
                prop_asset_id = clean_object_asset_name(prop_source)
                prop_asset_url = f"{PROP_ASSET_URL_PREFIX}/{prop_asset_id}.aqua_prop.json"
                root_objects = object_and_children(root) if self.include_children else [root]

                for obj in root_objects:
                    if obj.name in initialized_names:
                        continue

                    removed, initialized = initialize_fresh_aqua_metadata(
                        obj,
                        self.metadata_kind,
                        prop_asset_id=prop_asset_id,
                        prop_asset_url=prop_asset_url,
                        prop_root=prop_source,
                    )
                    removed_count += removed

                    if initialized:
                        initialized_count += 1
                        initialized_names.add(obj.name)
        else:
            for obj in objects:
                removed, initialized = initialize_fresh_aqua_metadata(obj, self.metadata_kind)
                removed_count += removed

                if initialized:
                    initialized_count += 1

        if initialized_count == 0:
            self.report({"ERROR"}, f"No selected object supports {self.metadata_kind.lower()} metadata")
            return {"CANCELLED"}

        self.report({"INFO"}, f"Initialized {initialized_count} object(s); removed {removed_count} old Aqua metadata value(s)")
        return {"FINISHED"}


class AQUA_OT_clean_geometry(bpy.types.Operator):
    bl_idname = "aqua.clean_geometry"
    bl_label = "Clean Geometry"
    bl_description = "Remove Aqua metadata and viewport labels from selected geometry and child objects"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        objects = selected_objects_and_children(context)

        if not objects:
            self.report({"ERROR"}, "Select at least one object to clean")
            return {"CANCELLED"}

        removed_count = 0

        for obj in objects:
            removed_count += clean_geometry_object(obj)

        self.report({"INFO"}, f"Cleaned {len(objects)} object(s), removed {removed_count} Aqua metadata value(s)")
        return {"FINISHED"}


class AQUA_OT_merge_duplicate_materials(bpy.types.Operator):
    bl_idname = "aqua.merge_duplicate_materials"
    bl_label = "Merge Duplicate Materials"
    bl_description = "Replace material copies like asphalt.001 with their base material and remove the copies"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        result = merge_duplicate_materials()

        if result["merged"] == 0:
            if result["skipped"] > 0:
                self.report({"WARNING"}, f"No local duplicates merged; skipped {result['skipped']} linked or locked material(s)")
            else:
                self.report({"INFO"}, "No duplicate .001-style materials found")

            return {"FINISHED"}

        message = f"Merged {result['merged']} duplicate material(s); removed {result['removed']} material datablock(s)"

        if result["skipped"] > 0:
            message += f"; skipped {result['skipped']}"

        self.report({"INFO"}, message)
        return {"FINISHED"}


def clean_asset_name(name):
    clean = "".join(char.lower() if char.isalnum() else "_" for char in str(name).strip())
    clean = "_".join(part for part in clean.split("_") if part)
    return clean or "aqua_prop"


def normalize_audio_asset_ref(value):
    text = str(value or "").strip()

    if not text:
        return ""

    if "/" in text or "\\" in text or "." in Path(text).name:
        return text.replace("\\", "/")

    return clean_asset_name(text)


def strip_blender_duplicate_suffix(name):
    return re.sub(r"\.\d{3}$", "", str(name or ""))


def clean_object_asset_name(obj):
    custom_name = get_custom_string(obj, "aqua_prop_id", "aquaPropId", "aqua_prop_name", "aquaPropName")

    if custom_name:
        return clean_asset_name(custom_name)

    object_name = clean_asset_name(strip_blender_duplicate_suffix(obj.name))

    if object_name != "aqua_prop":
        return object_name

    data_name = getattr(getattr(obj, "data", None), "name", None)

    if data_name:
        clean_data_name = clean_asset_name(strip_blender_duplicate_suffix(data_name))

        if clean_data_name != "aqua_prop":
            return clean_data_name

    return clean_asset_name(strip_blender_duplicate_suffix(obj.name))


def selected_export_objects(context):
    return [obj for obj in context.selected_objects if obj.type in {"MESH", "EMPTY"}]


def selected_prop_export_objects(context):
    objects = []
    seen = set()

    def add_object(obj):
        if obj.name in seen or obj.type not in {"MESH", "EMPTY"}:
            return

        seen.add(obj.name)
        objects.append(obj)

        for child in obj.children:
            add_object(child)

    for obj in context.selected_objects:
        add_object(obj)

    return objects


def mesh_objects(objects):
    return [obj for obj in objects if obj.type == "MESH"]


def collision_helper_objects(objects, prop_root=None):
    return [
        obj
        for obj in objects
        if is_prop_collision_helper(obj, prop_root)
    ]


def prop_collision_objects(objects, prop_root=None):
    return [
        obj
        for obj in objects
        if is_prop_collision_helper(obj, prop_root) or is_triangle_collision_object(obj)
    ]


def is_triangle_collision_object(obj):
    if obj.type != "MESH":
        return False

    collision_kind = get_custom_string(obj, "aqua_collision_kind", "aquaCollisionKind")
    return collision_kind in {"triangle", "terrain_mesh"}


def get_custom_string(obj, *keys):
    for key in keys:
        value = obj.get(key)

        if isinstance(value, str) and value:
            return value

    return None


def linked_library_path(obj):
    library = getattr(obj, "library", None) or getattr(getattr(obj, "data", None), "library", None)

    if not library:
        return None

    filepath = getattr(library, "filepath", None)
    return bpy.path.abspath(filepath) if filepath else None


def is_prop_reference_object(obj):
    return bool(get_custom_string(obj, "aqua_prop_asset", "aquaPropAsset", "aqua_asset", "aquaAsset"))


def is_prop_source_object(obj):
    if is_prop_reference_object(obj):
        return True

    asset_type = get_custom_string(obj, "aqua_asset_type", "aquaAssetType")

    if asset_type == "prop":
        return True

    if object_in_collection_tree(obj, PROP_COLLECTION):
        return True

    return bool(linked_library_path(obj))


def is_prop_render_source_object(obj):
    if obj.type != "MESH":
        return False

    return is_prop_source_object(obj)


def prop_asset_id_from_asset_url(asset_url):
    if not asset_url:
        return None

    stem = Path(str(asset_url).split("?", 1)[0].split("#", 1)[0]).name
    stem = stem.removesuffix(".aqua_prop.json")

    if not stem or stem == "Aqua-Engine_Props":
        return None

    return clean_asset_name(stem)


def infer_prop_asset_id(obj):
    explicit_id = get_custom_string(obj, "aqua_prop_id", "aquaPropId", "aqua_prop_name", "aquaPropName")

    if explicit_id:
        return clean_asset_name(explicit_id)

    asset_id = prop_asset_id_from_asset_url(get_custom_string(obj, "aqua_prop_asset", "aquaPropAsset", "aqua_asset", "aquaAsset"))

    if asset_id:
        return asset_id

    return clean_object_asset_name(obj)


def infer_prop_asset_url(obj):
    explicit_asset = get_custom_string(obj, "aqua_prop_asset", "aquaPropAsset", "aqua_asset", "aquaAsset")

    if explicit_asset:
        return explicit_asset

    prop_name = infer_prop_asset_id(obj)

    if prop_name:
        return f"{PROP_ASSET_URL_PREFIX}/{prop_name}.aqua_prop.json"

    clean_name = clean_object_asset_name(obj)

    if clean_name.startswith("prop_"):
        return f"{PROP_ASSET_URL_PREFIX}/{clean_name}.aqua_prop.json"

    library_path = linked_library_path(obj)

    if library_path:
        library_stem = Path(library_path).stem

        if library_stem:
            return f"{PROP_ASSET_URL_PREFIX}/{library_stem}.aqua_prop.json"

    return f"{PROP_ASSET_URL_PREFIX}/{clean_name}.aqua_prop.json"


def prop_reference_root(obj):
    root = obj

    while root.parent and is_prop_source_object(root.parent):
        root = root.parent

    return root


def begin_map_prop_reference_export(objects):
    source_roots = {}
    temporary_markers = []

    for obj in objects:
        if not is_prop_render_source_object(obj):
            continue

        root = prop_reference_root(obj)

        if root.name in source_roots:
            continue

        source_roots[root.name] = root
        asset_id = infer_prop_asset_id(root)
        asset_url = infer_prop_asset_url(root)
        marker = bpy.data.objects.new(f"{root.name}_aqua_prop_ref", None)

        marker.empty_display_type = "CUBE"
        marker.empty_display_size = 1.0
        marker.matrix_world = root.matrix_world.copy()
        marker["aqua_prop_asset"] = asset_url
        marker["aqua_asset_type"] = "prop_ref"
        marker["aqua_prop_id"] = asset_id
        marker["aqua_prop_name"] = asset_id
        copy_door_metadata(root, marker)
        ensure_collection(PROP_COLLECTION).objects.link(marker)
        temporary_markers.append(marker)

    return {
        "temporary_markers": temporary_markers,
        "source_roots": list(source_roots.values()),
    }


def copy_door_metadata(source, target):
    for key in DOOR_METADATA_KEYS:
        if key in source:
            target[key] = source[key]

    if any(key in target for key in DOOR_METADATA_KEYS):
        set_door_property_ui(target)


def end_map_prop_reference_export(state):
    for marker in state["temporary_markers"]:
        try:
            bpy.data.objects.remove(marker, do_unlink=True)
        except (AttributeError, ReferenceError, RuntimeError):
            continue


def map_export_objects(objects, prop_reference_state):
    temporary_markers = set(prop_reference_state["temporary_markers"])

    return [
        obj
        for obj in objects
        if obj in temporary_markers or not is_prop_render_source_object(obj)
    ]


def begin_selection_export(context, objects):
    previous_selected = list(context.selected_objects)
    previous_active = context.view_layer.objects.active

    bpy.ops.object.select_all(action="DESELECT")

    active_object = None

    for obj in objects:
        try:
            obj.select_set(True)
        except RuntimeError:
            continue

        if active_object is None:
            active_object = obj

    context.view_layer.objects.active = active_object

    return {
        "selected": previous_selected,
        "active": previous_active,
    }


def end_selection_export(context, state):
    bpy.ops.object.select_all(action="DESELECT")

    for obj in state["selected"]:
        try:
            obj.select_set(True)
        except (ReferenceError, RuntimeError):
            continue

    try:
        context.view_layer.objects.active = state["active"]
    except (ReferenceError, RuntimeError):
        context.view_layer.objects.active = None


def begin_stripped_material_export(objects):
    mesh_list = mesh_objects(objects)
    export_materials = {}
    slot_materials = []
    added_slots = []
    temporary_materials = []

    for obj in mesh_list:
        if len(obj.material_slots) == 0:
            placeholder = create_export_stripped_material("aqua_missing_material", (1.0, 0.0, 1.0, 1.0))
            temporary_materials.append(placeholder)
            obj.data.materials.append(placeholder)
            added_slots.append((obj, len(obj.material_slots) - 1))
            continue

        for slot_index, slot in enumerate(obj.material_slots):
            material = slot.material
            slot_materials.append((obj, slot_index, material))

            if material is None:
                placeholder = create_export_stripped_material("aqua_missing_material", (1.0, 0.0, 1.0, 1.0))
                temporary_materials.append(placeholder)
                slot.material = placeholder
                continue

            if material not in export_materials:
                export_material = get_export_placeholder_material(material, temporary_materials)
                export_materials[material] = export_material

            slot.material = export_materials[material]

    return {
        "slot_materials": slot_materials,
        "added_slots": added_slots,
        "temporary_materials": temporary_materials,
    }


def get_export_placeholder_material(material, temporary_materials):
    original_name = material.name.removesuffix("_p")
    placeholder_name = f"{original_name}_p"
    placeholder = bpy.data.materials.get(placeholder_name)

    if placeholder:
        return placeholder

    placeholder = create_export_stripped_material(placeholder_name, material.diffuse_color)
    temporary_materials.append(placeholder)
    return placeholder


def create_export_stripped_material(name, diffuse_color):
    material = bpy.data.materials.new(name)

    material.diffuse_color = diffuse_color
    strip_material_for_export(material)

    return material


def unique_material_name(name):
    if name not in bpy.data.materials:
        return name

    index = 1

    while f"{name}_{index}" in bpy.data.materials:
        index += 1

    return f"{name}_{index}"


def strip_material_for_export(material):
    material.use_nodes = True
    material.node_tree.nodes.clear()

    output = material.node_tree.nodes.new(type="ShaderNodeOutputMaterial")
    principled = material.node_tree.nodes.new(type="ShaderNodeBsdfPrincipled")

    output.location = (300, 0)
    principled.location = (0, 0)
    material.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    if principled:
        base_color = principled.inputs.get("Base Color")
        alpha = principled.inputs.get("Alpha")
        roughness = principled.inputs.get("Roughness")
        metallic = principled.inputs.get("Metallic")

        if base_color:
            base_color.default_value = material.diffuse_color

        if alpha:
            alpha.default_value = material.diffuse_color[3] if len(material.diffuse_color) > 3 else 1.0

        if roughness:
            roughness.default_value = 1.0

        if metallic:
            metallic.default_value = 0.0


def end_stripped_material_export(state):
    for obj, slot_index, material in reversed(state["slot_materials"]):
        if slot_index < len(obj.material_slots):
            obj.material_slots[slot_index].material = material

    for obj, slot_index in reversed(state["added_slots"]):
        if slot_index < len(obj.material_slots):
            obj.data.materials.pop(index=slot_index)

    for material in state["temporary_materials"]:
        remove_material_if_possible(material)


def remove_material_if_possible(material):
    try:
        if material and material.name in bpy.data.materials:
            bpy.data.materials.remove(material)
            return True
    except (AttributeError, ReferenceError, RuntimeError):
        return False

    return False


def round_vector(vector):
    return [round(float(value), 6) for value in vector]


def bounds_to_engine(min_corner, max_corner):
    corners = [
        (x, y, z)
        for x in (min_corner[0], max_corner[0])
        for y in (min_corner[1], max_corner[1])
        for z in (min_corner[2], max_corner[2])
    ]
    engine_corners = [blender_location_to_engine(corner) for corner in corners]

    return {
        "min": round_vector((
            min(corner[0] for corner in engine_corners),
            min(corner[1] for corner in engine_corners),
            min(corner[2] for corner in engine_corners),
        )),
        "max": round_vector((
            max(corner[0] for corner in engine_corners),
            max(corner[1] for corner in engine_corners),
            max(corner[2] for corner in engine_corners),
        )),
    }


def bounds_from_objects(objects):
    corners = []

    for obj in objects:
        if obj.type != "MESH":
            continue

        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ mathutils.Vector(corner))

    if not corners:
        return None

    min_corner = (
        min(corner.x for corner in corners),
        min(corner.y for corner in corners),
        min(corner.z for corner in corners),
    )
    max_corner = (
        max(corner.x for corner in corners),
        max(corner.y for corner in corners),
        max(corner.z for corner in corners),
    )

    return {
        "blender": {
            "min": round_vector(min_corner),
            "max": round_vector(max_corner),
        },
        "engine": bounds_to_engine(min_corner, max_corner),
    }


def write_prop_metadata(output_path, objects, active_object, asset_name=None):
    asset_name = clean_asset_name(asset_name or Path(output_path).stem)
    metadata_path = Path(output_path).with_suffix(".aqua_prop.json")
    collision_objects = prop_collision_objects(objects, active_object)
    source_objects = []

    for obj in objects:
        source_objects.append({
            "name": obj.name,
            "type": obj.type,
            "location": {
                "blender": round_vector(obj.location),
                "engine": round_vector(blender_location_to_engine(obj.location)),
            },
        })

    metadata = {
        "schema": "aqua.prop.v1",
        "name": asset_name,
        "displayName": active_object.name if active_object else asset_name,
        "model": Path(output_path).name,
        "static": True,
        "collision": {
            "type": "authored" if collision_objects else "none",
            "source": "aqua_collision_kind",
            "meshCount": len(collision_objects),
        },
        "pivot": {
            "blender": round_vector(active_object.location) if active_object else [0.0, 0.0, 0.0],
            "engine": round_vector(blender_location_to_engine(active_object.location)) if active_object else [0.0, 0.0, 0.0],
        },
        "bounds": bounds_from_objects(objects),
        "sourceObjects": source_objects,
        "tags": [],
    }

    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2)
        file.write("\n")

    return metadata_path


class AQUA_OT_create_test_map(bpy.types.Operator):
    bl_idname = "aqua.create_test_map"
    bl_label = "Create Test Map"
    bl_description = "Create the same minimal brush layout used by the engine test map"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        bpy.ops.aqua.setup_collections()

        player_start = bpy.data.objects.new("info_player_start", None)
        player_start.empty_display_type = "ARROWS"
        player_start.empty_display_size = 0.8
        player_start.location = engine_location_to_blender((0.0, 0.1, 4.0))
        player_start["aqua_entity"] = "info_player_start"
        player_start.show_name = True
        link_to_collection(player_start, ENTITY_COLLECTION)

        skybox = bpy.data.objects.new("skybox", None)
        skybox.location = engine_location_to_blender((0.0, 2.0, 0.0))
        set_skybox_props(skybox, DEFAULT_SKYBOX_NAME)

        create_light_marker("light_ambient", "ambient", engine_location_to_blender((0.0, 2.0, 0.0)), "#8aa7bd", 0.22)
        create_light_marker("light_sun", "sun", engine_location_to_blender((0.0, 3.0, 0.0)), "#fff2d0", 1.15, direction=[-0.55, 0.82, 0.35])
        create_light_marker("light_point", "point", engine_location_to_blender((2.5, 2.25, 1.5)), "#ffd6a0", 4.5, light_range=6.5)

        create_engine_cube_brush("brush_floor", "plane", (0.0, -0.06, 0.0), (24.0, 0.12, 24.0), "#29313a")
        create_engine_cube_brush("brush_back_wall", "box", (0.0, 1.0, -8.0), (12.0, 2.0, 0.5), "#7f8a8f")
        create_engine_cube_brush("brush_left_wall", "box", (-6.0, 1.0, -2.0), (0.5, 2.0, 8.0), "#7f8a8f")
        create_engine_cube_brush("brush_right_wall", "box", (6.0, 1.0, -2.0), (0.5, 2.0, 8.0), "#7f8a8f")
        create_engine_cube_brush("brush_jump_box", "box", (4.0, 0.5, -3.0), (2.0, 1.0, 2.0), "#d7ad5f")
        create_engine_cube_brush("brush_low_step", "box", (0.0, 0.15, 3.0), (2.5, 0.3, 1.2), "#7f8a8f")
        create_engine_cube_brush("brush_mid_step", "box", (-2.2, 0.3, 3.0), (1.0, 0.6, 1.2), "#7f8a8f")
        create_engine_cube_brush("brush_ceiling_test", "box", (-4.0, 1.85, 1.0), (2.5, 0.35, 2.5), "#d7ad5f")

        create_engine_ramp_brush("brush_ramp", (2.5, 0.5, 2.5), (3.0, 1.0, 2.0), "#7f8a8f")

        create_terrain_mesh("brush_terrain_test", engine_location_to_blender((-2.5, 0.04, 7.0)))

        return {"FINISHED"}


class AQUA_OT_export_gltf(bpy.types.Operator):
    bl_idname = "aqua.export_gltf"
    bl_label = "Export Aqua GLB"
    bl_description = "Export the current Blender map with custom properties enabled"
    bl_options = {"REGISTER"}

    filepath: bpy.props.StringProperty(
        name="Output File",
        subtype="FILE_PATH",
        default="//aqua_brush_test.glb",
    )

    def execute(self, context):
        output_path = bpy.path.abspath(self.filepath)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        auto_marked_count = auto_mark_world_meshes_for_export()
        synced_light_count = sync_lights_for_export()
        prop_reference_state = begin_map_prop_reference_export(context.scene.objects)
        export_objects = map_export_objects(context.scene.objects, prop_reference_state)
        material_state = begin_stripped_material_export(export_objects)
        selection_state = begin_selection_export(context, export_objects)

        try:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_extras=True,
                export_lights=True,
                export_materials="EXPORT",
                use_selection=True,
            )
        finally:
            end_selection_export(context, selection_state)
            end_stripped_material_export(material_state)
            end_map_prop_reference_export(prop_reference_state)

        self.report({"INFO"}, f"Exported Aqua map to {output_path}; auto-marked {auto_marked_count} world mesh(es), synced {synced_light_count} light(s), referenced {len(prop_reference_state['temporary_markers'])} prop(s)")
        return {"FINISHED"}

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


class AQUA_OT_export_prop_gltf(bpy.types.Operator):
    bl_idname = "aqua.export_prop_gltf"
    bl_label = "Export Selected Prop GLB"
    bl_description = "Export selected prop geometry as GLB and write Aqua prop metadata beside it"
    bl_options = {"REGISTER"}

    filepath: bpy.props.StringProperty(
        name="Output File",
        subtype="FILE_PATH",
        default="//aqua_prop.glb",
    )

    def execute(self, context):
        objects = selected_prop_export_objects(context)

        if not objects:
            self.report({"ERROR"}, "Select at least one mesh or empty to export as a prop")
            return {"CANCELLED"}

        output_path = bpy.path.abspath(self.filepath)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        active_object = context.view_layer.objects.active or objects[0]
        prop_asset_id = clean_asset_name(Path(output_path).stem)
        prop_asset_url = f"{PROP_ASSET_URL_PREFIX}/{Path(output_path).with_suffix('.aqua_prop.json').name}"
        collision_count = len(prop_collision_objects(objects, active_object))

        prop_metadata_state = begin_prop_metadata_export(objects, prop_asset_id, prop_asset_url, active_object)
        material_state = begin_stripped_material_export(objects)
        selection_state = begin_selection_export(context, objects)

        try:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_extras=True,
                export_materials="EXPORT",
                use_selection=True,
            )
        finally:
            end_selection_export(context, selection_state)
            end_stripped_material_export(material_state)
            end_prop_metadata_export(prop_metadata_state)

        apply_persistent_prop_metadata(objects, prop_asset_id, prop_asset_url, active_object)
        metadata_path = write_prop_metadata(output_path, objects, active_object, prop_asset_id)
        self.report({"INFO"}, f"Exported Aqua prop to {output_path} with metadata {metadata_path}; included {collision_count} collision mesh(es)")
        return {"FINISHED"}

    def invoke(self, context, event):
        active_object = context.view_layer.objects.active

        if active_object:
            self.filepath = f"//{clean_asset_name(active_object.name)}.glb"

        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


def draw_audio_authoring_ui(layout, context):
    scene = context.scene

    layout.prop(scene, "aqua_audio_asset_id", text="Asset")
    layout.prop(scene, "aqua_audio_volume", text="Volume")
    layout.prop(scene, "aqua_audio_loop", text="Loop")
    layout.operator("aqua.add_positional_audio_source")
    layout.prop(scene, "aqua_audio_range", text="Range")
    layout.prop(scene, "aqua_audio_ref_distance", text="Ref Distance")
    layout.prop(scene, "aqua_audio_rolloff", text="Rolloff")
    layout.operator("aqua.assign_trigger_audio")
    layout.operator("aqua.clear_trigger_audio")
    layout.prop(scene, "aqua_audio_fade_in", text="Fade In")
    layout.prop(scene, "aqua_audio_fade_out", text="Fade Out")
    layout.prop(scene, "aqua_audio_priority", text="Priority")
    draw_selected_audio_fields(layout, context)


def draw_door_authoring_ui(layout, context):
    scene = context.scene

    layout.prop(scene, "aqua_door_open_audio_asset_id", text="Open Audio")
    layout.prop(scene, "aqua_door_close_audio_asset_id", text="Close Audio")
    layout.operator("aqua.assign_door_metadata")
    layout.operator("aqua.clear_door_metadata")
    draw_selected_door_fields(layout, context)


def draw_selected_audio_fields(layout, context):
    obj = context.view_layer.objects.active

    if not obj or "aqua_audio_asset" not in obj:
        return

    layout.separator()
    layout.label(text=f"Selected Audio: {obj.name}")
    draw_custom_property(layout, obj, "aqua_audio_asset", "Asset")
    draw_custom_property(layout, obj, "aqua_audio_volume", "Volume")
    draw_custom_property(layout, obj, "aqua_audio_loop", "Loop")

    audio_type = get_custom_string(obj, "aqua_audio_type", "aquaAudioType")

    if audio_type == "positional":
        draw_custom_property(layout, obj, "aqua_audio_range", "Range")
        draw_custom_property(layout, obj, "aqua_audio_ref_distance", "Ref Distance")
        draw_custom_property(layout, obj, "aqua_audio_rolloff", "Rolloff")
        draw_custom_property(layout, obj, "aqua_audio_distance_model", "Distance")
    elif audio_type in {"ambient", "soundscape"}:
        draw_custom_property(layout, obj, "aqua_audio_fade_in", "Fade In")
        draw_custom_property(layout, obj, "aqua_audio_fade_out", "Fade Out")
        draw_custom_property(layout, obj, "aqua_audio_priority", "Priority")


def draw_selected_door_fields(layout, context):
    obj = context.view_layer.objects.active

    if not obj or not (obj.get("aqua_door") or get_custom_string(obj, "aqua_prop_type", "aquaPropType") == "door"):
        return

    layout.separator()
    layout.label(text=f"Selected Door: {obj.name}")
    draw_custom_property(layout, obj, "aqua_prop_type", "Type")
    draw_custom_property(layout, obj, "aqua_door", "Door")
    draw_custom_property(layout, obj, "aqua_door_open_audio", "Open Audio")
    draw_custom_property(layout, obj, "aqua_door_close_audio", "Close Audio")


def draw_custom_property(layout, obj, key, label):
    if key not in obj:
        return

    try:
        layout.prop(obj, f'["{key}"]', text=label)
    except (TypeError, RuntimeError):
        pass


def draw_collapsible_section(layout, scene, property_name, title):
    is_open = getattr(scene, property_name)
    row = layout.row(align=True)
    row.prop(
        scene,
        property_name,
        text="",
        icon="TRIA_DOWN" if is_open else "TRIA_RIGHT",
        emboss=False,
    )
    row.label(text=title)

    if not is_open:
        return None

    return layout.box()


def draw_setup_section(layout):
    layout.operator("aqua.setup_collections")


def draw_brush_section(layout):
    layout.operator("aqua.add_floor_brush")
    layout.operator("aqua.add_box_brush")
    layout.operator("aqua.add_ramp_brush")
    layout.operator("aqua.mark_world_mesh")
    layout.operator("aqua.add_terrain_brush")
    layout.operator("aqua.add_trigger_volume")
    layout.operator("aqua.clean_geometry")


def draw_metadata_section(layout):
    op = layout.operator("aqua.initialize_metadata", text="Prop")
    op.metadata_kind = "PROP"
    op = layout.operator("aqua.initialize_metadata", text="Door Prop")
    op.metadata_kind = "DOOR"
    op = layout.operator("aqua.initialize_metadata", text="Decorative Mesh")
    op.metadata_kind = "WORLD_DECORATIVE"
    op = layout.operator("aqua.initialize_metadata", text="Colliding Mesh")
    op.metadata_kind = "WORLD_COLLISION"
    op = layout.operator("aqua.initialize_metadata", text="Terrain")
    op.metadata_kind = "TERRAIN"
    op = layout.operator("aqua.initialize_metadata", text="Trigger")
    op.metadata_kind = "TRIGGER"
    op = layout.operator("aqua.initialize_metadata", text="Player Start")
    op.metadata_kind = "PLAYER_START"
    op = layout.operator("aqua.initialize_metadata", text="Positional Audio")
    op.metadata_kind = "POSITIONAL_AUDIO"


def draw_visibility_section(layout, context):
    toggle_label = "Hide Collision Brushes" if context.scene.aqua_collision_brushes_visible else "Show Collision Brushes"
    layout.operator("aqua.toggle_collision_brush_visibility", text=toggle_label)


def draw_entities_lighting_section(layout, context):
    scene = context.scene

    layout.operator("aqua.add_player_start")
    layout.prop(scene, "aqua_skybox_name", text="Skybox")
    layout.operator("aqua.add_skybox_marker")
    draw_selected_skybox_fields(layout, context)
    layout.operator("aqua.add_point_light")
    layout.operator("aqua.add_sun_light")
    layout.operator("aqua.add_ambient_light")


def draw_selected_skybox_fields(layout, context):
    obj = context.view_layer.objects.active

    if not obj or get_custom_string(obj, "aqua_entity", "aquaEntity") != "skybox":
        return

    layout.separator()
    layout.label(text=f"Selected Skybox: {obj.name}")
    draw_custom_property(layout, obj, "aqua_skybox", "Skybox")


def draw_utilities_section(layout):
    layout.operator("aqua.create_test_map")
    layout.operator("aqua.merge_duplicate_materials")


def draw_export_section(layout):
    layout.operator("aqua.export_gltf")
    layout.operator("aqua.export_prop_gltf")


class AQUA_PT_brush_panel(bpy.types.Panel):
    bl_label = "Aqua Brushes"
    bl_idname = "AQUA_PT_brush_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Aqua"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        section = draw_collapsible_section(layout, scene, "aqua_ui_setup_open", "Setup")
        if section is not None:
            draw_setup_section(section)

        section = draw_collapsible_section(layout, scene, "aqua_ui_brushes_open", "Brushes")
        if section is not None:
            draw_brush_section(section)

        section = draw_collapsible_section(layout, scene, "aqua_ui_metadata_open", "Fresh Metadata")
        if section is not None:
            draw_metadata_section(section)

        section = draw_collapsible_section(layout, scene, "aqua_ui_visibility_open", "Visibility")
        if section is not None:
            draw_visibility_section(section, context)

        section = draw_collapsible_section(layout, scene, "aqua_ui_entities_lighting_open", "Entities & Lighting")
        if section is not None:
            draw_entities_lighting_section(section, context)

        section = draw_collapsible_section(layout, scene, "aqua_ui_audio_open", "Audio")
        if section is not None:
            draw_audio_authoring_ui(section, context)

        section = draw_collapsible_section(layout, scene, "aqua_ui_doors_open", "Doors")
        if section is not None:
            draw_door_authoring_ui(section, context)

        section = draw_collapsible_section(layout, scene, "aqua_ui_utilities_open", "Utilities")
        if section is not None:
            draw_utilities_section(section)

        section = draw_collapsible_section(layout, scene, "aqua_ui_export_open", "Export")
        if section is not None:
            draw_export_section(section)


UI_SECTION_PROPERTIES = (
    ("aqua_ui_setup_open", "Setup", True),
    ("aqua_ui_brushes_open", "Brushes", True),
    ("aqua_ui_metadata_open", "Fresh Metadata", False),
    ("aqua_ui_visibility_open", "Visibility", False),
    ("aqua_ui_entities_lighting_open", "Entities & Lighting", False),
    ("aqua_ui_audio_open", "Audio", False),
    ("aqua_ui_doors_open", "Doors", False),
    ("aqua_ui_utilities_open", "Utilities", False),
    ("aqua_ui_export_open", "Export", True),
)


CLASSES = (
    AQUA_OT_setup_collections,
    AQUA_OT_add_box_brush,
    AQUA_OT_add_floor_brush,
    AQUA_OT_add_ramp_brush,
    AQUA_OT_add_trigger_volume,
    AQUA_OT_add_positional_audio_source,
    AQUA_OT_assign_trigger_audio,
    AQUA_OT_clear_trigger_audio,
    AQUA_OT_assign_door_metadata,
    AQUA_OT_clear_door_metadata,
    AQUA_OT_add_terrain_brush,
    AQUA_OT_mark_world_mesh,
    AQUA_OT_clean_geometry,
    AQUA_OT_add_player_start,
    AQUA_OT_add_skybox_marker,
    AQUA_OT_add_point_light,
    AQUA_OT_add_sun_light,
    AQUA_OT_add_ambient_light,
    AQUA_OT_toggle_collision_brush_visibility,
    AQUA_OT_initialize_metadata,
    AQUA_OT_merge_duplicate_materials,
    AQUA_OT_create_test_map,
    AQUA_OT_export_gltf,
    AQUA_OT_export_prop_gltf,
    AQUA_PT_brush_panel,
)


def register():
    bpy.types.Scene.aqua_collision_brushes_visible = bpy.props.BoolProperty(
        name="Aqua Collision Brushes Visible",
        default=True,
    )
    for property_name, label, default_open in UI_SECTION_PROPERTIES:
        setattr(
            bpy.types.Scene,
            property_name,
            bpy.props.BoolProperty(
                name=f"{label} Section Open",
                default=default_open,
            ),
        )

    bpy.types.Scene.aqua_audio_asset_id = bpy.props.StringProperty(
        name="Audio Asset",
        description="Audio manifest id or direct /assets/audio URL",
        default="",
    )
    bpy.types.Scene.aqua_audio_volume = bpy.props.FloatProperty(
        name="Audio Volume",
        default=1.0,
        min=0.0,
        max=1.0,
    )
    bpy.types.Scene.aqua_audio_range = bpy.props.FloatProperty(
        name="Audio Range",
        default=14.0,
        min=0.01,
    )
    bpy.types.Scene.aqua_audio_ref_distance = bpy.props.FloatProperty(
        name="Audio Reference Distance",
        default=1.5,
        min=0.01,
    )
    bpy.types.Scene.aqua_audio_rolloff = bpy.props.FloatProperty(
        name="Audio Rolloff",
        default=1.0,
        min=0.0,
    )
    bpy.types.Scene.aqua_audio_fade_in = bpy.props.FloatProperty(
        name="Audio Fade In",
        default=1.25,
        min=0.0,
    )
    bpy.types.Scene.aqua_audio_fade_out = bpy.props.FloatProperty(
        name="Audio Fade Out",
        default=1.25,
        min=0.0,
    )
    bpy.types.Scene.aqua_audio_priority = bpy.props.IntProperty(
        name="Audio Priority",
        default=0,
    )
    bpy.types.Scene.aqua_audio_loop = bpy.props.BoolProperty(
        name="Audio Loop",
        default=True,
    )
    bpy.types.Scene.aqua_door_open_audio_asset_id = bpy.props.StringProperty(
        name="Door Open Audio",
        description="Audio manifest id or direct /assets/audio URL played when a door opens",
        default="",
    )
    bpy.types.Scene.aqua_door_close_audio_asset_id = bpy.props.StringProperty(
        name="Door Close Audio",
        description="Audio manifest id or direct /assets/audio URL played when a door closes",
        default="",
    )
    bpy.types.Scene.aqua_skybox_name = bpy.props.StringProperty(
        name="Skybox",
        description="Skybox id under /assets/skyboxes",
        default=DEFAULT_SKYBOX_NAME,
    )

    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)

    for property_name, _label, _default_open in UI_SECTION_PROPERTIES:
        delattr(bpy.types.Scene, property_name)

    del bpy.types.Scene.aqua_collision_brushes_visible
    del bpy.types.Scene.aqua_audio_asset_id
    del bpy.types.Scene.aqua_audio_volume
    del bpy.types.Scene.aqua_audio_range
    del bpy.types.Scene.aqua_audio_ref_distance
    del bpy.types.Scene.aqua_audio_rolloff
    del bpy.types.Scene.aqua_audio_fade_in
    del bpy.types.Scene.aqua_audio_fade_out
    del bpy.types.Scene.aqua_audio_priority
    del bpy.types.Scene.aqua_audio_loop
    del bpy.types.Scene.aqua_door_open_audio_asset_id
    del bpy.types.Scene.aqua_door_close_audio_asset_id
    del bpy.types.Scene.aqua_skybox_name


if __name__ == "__main__":
    register()
