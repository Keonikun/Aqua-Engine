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

TOOL_MATERIAL_PREFIX = "tool_"
DUPLICATE_MATERIAL_SUFFIX_RE = re.compile(r"^(.+)\.\d{3}$")
NON_WORLD_COLLECTIONS = {
    ENTITY_COLLECTION,
    TRIGGER_COLLECTION,
    PROP_COLLECTION,
    LIGHT_COLLECTION,
}


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


def set_common_brush_props(obj, brush_type, color="#7f8a8f"):
    obj["aqua_brush_type"] = brush_type
    obj["aqua_color"] = color
    obj["aqua_bake_id"] = obj.name
    obj["aqua_collision_kind"] = "terrain" if brush_type == "terrain" else "brush"
    obj.display_type = "TEXTURED"
    obj.show_name = True


def select_object(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def is_collision_brush(obj):
    return "aqua_collision_kind" in obj


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


def create_cube_brush(name, brush_type, location, scale, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(make_tool_material(brush_type, color))
    set_common_brush_props(obj, brush_type, color)
    link_to_collection(obj, BRUSH_COLLECTION)
    select_object(obj)
    return obj


def create_ramp_brush(name, location, scale, color):
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
    obj.data.materials.append(make_tool_material("ramp", color))
    set_common_brush_props(obj, "ramp", color)
    obj["aqua_collision_kind"] = "slope"
    link_to_collection(obj, BRUSH_COLLECTION)
    select_object(obj)
    return obj


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


def create_light_marker(name, light_type, location, color="#fff2d0", intensity=1.0, light_range=None, direction=None):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.65
    empty.location = location
    empty.show_name = True
    empty["aqua_light_type"] = light_type
    empty["aqua_light_color"] = color
    empty["aqua_light_intensity"] = intensity

    if light_range is not None:
        empty["aqua_light_range"] = light_range

    if direction is not None:
        empty["aqua_light_direction"] = direction

    if light_type == "point":
        empty.empty_display_type = "SPHERE"
    elif light_type in {"sun", "directional"}:
        empty.empty_display_type = "SINGLE_ARROW"
    else:
        empty.empty_display_type = "CUBE"

    link_to_collection(empty, LIGHT_COLLECTION)
    select_object(empty)
    return empty


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
        ]:
            ensure_collection(name)

        return {"FINISHED"}


class AQUA_OT_add_box_brush(bpy.types.Operator):
    bl_idname = "aqua.add_box_brush"
    bl_label = "Add Box Brush"
    bl_description = "Create an Aqua box brush datapoint"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        create_cube_brush(
            "brush_box",
            "box",
            context.scene.cursor.location,
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
        create_cube_brush(
            "brush_floor",
            "plane",
            context.scene.cursor.location,
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
        create_ramp_brush(
            "brush_ramp",
            context.scene.cursor.location,
            (3.0, 2.0, 1.0),
            "#7f8a8f",
        )
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


class AQUA_OT_add_point_light(bpy.types.Operator):
    bl_idname = "aqua.add_point_light"
    bl_label = "Add Point Light"
    bl_description = "Create an Aqua point light marker for offline baking"
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
    bl_description = "Create an Aqua directional sun marker for offline baking"
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
    bl_description = "Create an Aqua ambient light marker for offline baking"
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
    clean = "".join(char.lower() if char.isalnum() else "_" for char in name.strip())
    clean = "_".join(part for part in clean.split("_") if part)
    return clean or "aqua_prop"


def selected_export_objects(context):
    return [obj for obj in context.selected_objects if obj.type in {"MESH", "EMPTY"}]


def mesh_objects(objects):
    return [obj for obj in objects if obj.type == "MESH"]


def begin_stripped_material_export(objects):
    mesh_list = mesh_objects(objects)
    export_materials = {}
    renamed_materials = []
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
                original_name = material.name

                material.name = unique_material_name(f"__aqua_authoring_{original_name}")
                renamed_materials.append((material, original_name))

                export_material = create_export_stripped_material(original_name, material.diffuse_color)
                export_materials[material] = export_material
                temporary_materials.append(export_material)

            slot.material = export_materials[material]

    return {
        "renamed_materials": renamed_materials,
        "slot_materials": slot_materials,
        "added_slots": added_slots,
        "temporary_materials": temporary_materials,
    }


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

    for material, original_name in state["renamed_materials"]:
        if material and material.name in bpy.data.materials:
            material.name = original_name


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


def write_prop_metadata(output_path, objects, active_object):
    asset_name = clean_asset_name(active_object.name if active_object else Path(output_path).stem)
    metadata_path = Path(output_path).with_suffix(".aqua_prop.json")
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
            "type": "render_mesh",
        },
        "pivot": {
            "blender": [0.0, 0.0, 0.0],
            "engine": [0.0, 0.0, 0.0],
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
        material_state = begin_stripped_material_export(context.scene.objects)

        try:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_extras=True,
                export_materials="EXPORT",
                use_selection=False,
            )
        finally:
            end_stripped_material_export(material_state)

        self.report({"INFO"}, f"Exported Aqua map to {output_path}; auto-marked {auto_marked_count} world mesh(es)")
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
        objects = selected_export_objects(context)

        if not objects:
            self.report({"ERROR"}, "Select at least one mesh or empty to export as a prop")
            return {"CANCELLED"}

        output_path = bpy.path.abspath(self.filepath)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        active_object = context.view_layer.objects.active or objects[0]

        for obj in objects:
            obj["aqua_asset_type"] = "prop"
            obj["aqua_prop_name"] = clean_asset_name(active_object.name)

        material_state = begin_stripped_material_export(objects)

        try:
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_extras=True,
                export_materials="EXPORT",
                use_selection=True,
            )
        finally:
            end_stripped_material_export(material_state)

        metadata_path = write_prop_metadata(output_path, objects, active_object)
        self.report({"INFO"}, f"Exported Aqua prop to {output_path} with metadata {metadata_path}")
        return {"FINISHED"}

    def invoke(self, context, event):
        active_object = context.view_layer.objects.active

        if active_object:
            self.filepath = f"//{clean_asset_name(active_object.name)}.glb"

        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


class AQUA_PT_brush_panel(bpy.types.Panel):
    bl_label = "Aqua Brushes"
    bl_idname = "AQUA_PT_brush_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Aqua"

    def draw(self, context):
        layout = self.layout

        layout.operator("aqua.setup_collections")
        layout.separator()
        layout.operator("aqua.add_floor_brush")
        layout.operator("aqua.add_box_brush")
        layout.operator("aqua.add_ramp_brush")
        layout.operator("aqua.mark_world_mesh")
        layout.operator("aqua.add_terrain_brush")
        toggle_label = "Hide Collision Brushes" if context.scene.aqua_collision_brushes_visible else "Show Collision Brushes"
        layout.operator("aqua.toggle_collision_brush_visibility", text=toggle_label)
        layout.separator()
        layout.operator("aqua.add_player_start")
        layout.operator("aqua.add_point_light")
        layout.operator("aqua.add_sun_light")
        layout.operator("aqua.add_ambient_light")
        layout.operator("aqua.create_test_map")
        layout.separator()
        layout.operator("aqua.merge_duplicate_materials")
        layout.separator()
        layout.operator("aqua.export_gltf")
        layout.operator("aqua.export_prop_gltf")


CLASSES = (
    AQUA_OT_setup_collections,
    AQUA_OT_add_box_brush,
    AQUA_OT_add_floor_brush,
    AQUA_OT_add_ramp_brush,
    AQUA_OT_add_terrain_brush,
    AQUA_OT_mark_world_mesh,
    AQUA_OT_add_player_start,
    AQUA_OT_add_point_light,
    AQUA_OT_add_sun_light,
    AQUA_OT_add_ambient_light,
    AQUA_OT_toggle_collision_brush_visibility,
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

    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)

    del bpy.types.Scene.aqua_collision_brushes_visible


if __name__ == "__main__":
    register()
