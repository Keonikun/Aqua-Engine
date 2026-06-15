#!/usr/bin/env python3
"""Import, validate, and sync Aqua Engine runtime assets."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


PROP_SCHEMA = "aqua.prop.v1"
MATERIAL_SCHEMA = "aqua.material_manifest.v1"
AUDIO_SCHEMA = "aqua.audio_manifest.v1"
SKYBOX_SCHEMA = "aqua.skybox.v1"
PROJECT_CONFIG_SCHEMA = "aqua.project_config.v1"
SOURCE_TEXTURE_FOLDER = "1024x1024"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MODEL_SUFFIXES = {".glb", ".gltf"}
AUDIO_SUFFIXES = {".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac", ".opus", ".webm"}
SKYBOX_FACES = ("px", "nx", "py", "ny", "pz", "nz")

CHANNEL_ALIASES = {
    "diffuse": ("diff", "diffuse", "albedo", "basecolor", "base_color", "color", "col"),
    "arm": ("arm", "orm", "aorm", "ao_rough_metal", "ambient_rough_metal"),
    "normal": ("nor", "normal", "nrm"),
}

SKYBOX_FACE_ALIASES = {
    "px": ("px", "posx", "positive_x", "right"),
    "nx": ("nx", "negx", "negative_x", "left"),
    "py": ("py", "posy", "positive_y", "top", "up"),
    "ny": ("ny", "negy", "negative_y", "bottom", "down"),
    "pz": ("pz", "posz", "positive_z", "front"),
    "nz": ("nz", "negz", "negative_z", "back"),
}


@dataclass
class Report:
    copied: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    warnings: int = 0

    def print(self, label: str) -> None:
        print(
            f"{label}: copied {self.copied}, created {self.created}, "
            f"updated {self.updated}, skipped {self.skipped}, warnings {self.warnings}"
        )


def main() -> None:
    args = parse_args()
    args.func(args)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Streamline Aqua prop, texture, skybox, and audio ingestion into public/assets.",
    )
    parser.set_defaults(func=lambda _: parser.print_help())

    subparsers = parser.add_subparsers(dest="command")

    add_sync_parser(subparsers)
    add_import_props_parser(subparsers)
    add_import_textures_parser(subparsers)
    add_import_skybox_parser(subparsers)
    add_import_audio_parser(subparsers)
    add_validate_parser(subparsers)

    return parser.parse_args()


def add_common_asset_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--assets-root",
        default="public/assets",
        help="Runtime asset root. Default: public/assets.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the work that would be done without writing files.",
    )


def add_sync_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "sync",
        help="Sync existing runtime props, textures, and audio into canonical sidecars and manifests.",
    )
    add_common_asset_args(parser)
    parser.add_argument(
        "--overwrite-materials",
        action="store_true",
        help="Replace existing manifest entries when a 1024x1024 texture folder is rediscovered.",
    )
    parser.add_argument(
        "--variants",
        action="store_true",
        help="Run tools/texture_variants.py after syncing texture manifest entries.",
    )
    parser.set_defaults(func=sync_assets)


def add_import_props_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "import-props",
        help="Copy GLB/GLTF props into public/assets/props and create or normalize Aqua sidecars.",
    )
    add_common_asset_args(parser)
    parser.add_argument("source", help="A prop model file or a directory containing prop models.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing prop models and sidecars in the runtime asset folder.",
    )
    parser.add_argument(
        "--collision",
        choices=("none", "authored"),
        default="none",
        help="Collision type for generated sidecars when no sidecar exists. Default: none.",
    )
    parser.set_defaults(func=import_props)


def add_import_textures_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "import-textures",
        help="Copy texture material folders into public/assets/textures/1024x1024 and update materials.json.",
    )
    add_common_asset_args(parser)
    parser.add_argument("source", help="A texture folder or a directory containing texture material folders.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing texture files and material manifest entries.",
    )
    parser.add_argument(
        "--material-name",
        help="Material id to use when SOURCE is a single material folder.",
    )
    parser.add_argument(
        "--skip-variants",
        action="store_true",
        help="Do not run tools/texture_variants.py after importing textures.",
    )
    parser.add_argument(
        "--skip-sync",
        action="store_true",
        help="Do not run the asset sync pass after importing textures.",
    )
    parser.set_defaults(func=import_textures)


def add_import_audio_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "import-audio",
        help="Copy audio clips into public/assets/audio and update audio.json.",
    )
    add_common_asset_args(parser)
    parser.add_argument("source", help="An audio file or a directory containing audio files.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing audio files and manifest entries.",
    )
    parser.add_argument(
        "--name",
        help="Audio asset id to use when SOURCE is a single audio file.",
    )
    parser.add_argument(
        "--volume",
        type=float,
        default=1.0,
        help="Default runtime volume for the imported audio asset. Default: 1.0.",
    )
    parser.add_argument(
        "--no-loop",
        action="store_true",
        help="Mark imported audio as non-looping in the manifest.",
    )
    parser.add_argument(
        "--tags",
        default="",
        help="Comma-separated tags to write into the manifest entry.",
    )
    parser.set_defaults(func=import_audio)


def add_import_skybox_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "import-skybox",
        help="Copy cubemap face images into public/assets/skyboxes and write skybox.json.",
    )
    add_common_asset_args(parser)
    parser.add_argument("source", help="A folder containing px/nx/py/ny/pz/nz cubemap face images.")
    parser.add_argument(
        "--name",
        help="Skybox id to write under public/assets/skyboxes. Default: source folder name.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing skybox face files and sidecar metadata.",
    )
    parser.set_defaults(func=import_skybox)


def add_validate_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "validate",
        help="Validate existing prop sidecars and material texture references without writing files.",
    )
    add_common_asset_args(parser)
    parser.set_defaults(func=validate_assets)


def sync_assets(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    prop_report = sync_props(assets_root, overwrite=False, dry_run=args.dry_run)
    texture_report = sync_texture_manifest(
        assets_root,
        overwrite=args.overwrite_materials,
        dry_run=args.dry_run,
    )
    audio_report = sync_audio_manifest(assets_root, overwrite=False, dry_run=args.dry_run)

    if args.variants and not args.dry_run:
        run_texture_variants(assets_root / "textures")

    prop_report.print("Props")
    texture_report.print("Textures")
    audio_report.print("Audio")


def import_props(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    source = resolve_path(args.source)
    props_dir = assets_root / "props"
    report = Report()

    for model_path in find_model_files(source):
        asset_name = clean_asset_name(model_path.stem)
        target_model = props_dir / f"{asset_name}{model_path.suffix.lower()}"
        source_sidecar = model_path.with_suffix(".aqua_prop.json")
        target_sidecar = props_dir / f"{asset_name}.aqua_prop.json"

        copy_file(model_path, target_model, overwrite=args.overwrite, dry_run=args.dry_run, report=report)

        if source_sidecar.is_file():
            metadata = read_json(source_sidecar)
        else:
            metadata = create_prop_metadata(
                asset_name=asset_name,
                display_name=model_path.stem,
                model_name=target_model.name,
                collision_type=args.collision,
            )
            report.created += 1

        normalized = normalize_prop_metadata(metadata, target_sidecar, target_model)
        write_json_if_changed(target_sidecar, normalized, dry_run=args.dry_run, report=report)

    report.print("Props")


def import_textures(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    source = resolve_path(args.source)
    textures_root = assets_root / "textures" / SOURCE_TEXTURE_FOLDER
    report = Report()

    material_sources = find_material_sources(source, args.material_name)
    if not material_sources:
        raise SystemExit(f"No texture material folders found under {source}")

    manifest = load_material_manifest(assets_root)
    materials = manifest.setdefault("materials", {})

    for material_name, material_dir in material_sources:
        target_dir = textures_root / material_name
        copied_files = copy_texture_files(
            material_dir,
            target_dir,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            report=report,
        )
        definition = discover_material_definition(target_dir, copied_files)

        if not definition:
            report.warnings += 1
            print(f"Warning: no diffuse/arm/normal texture channels found for {material_name}")
            continue

        if material_name in materials and not args.overwrite:
            report.skipped += 1
            continue

        if materials.get(material_name) != definition:
            materials[material_name] = definition
            report.updated += 1

    write_material_manifest(assets_root, manifest, dry_run=args.dry_run, report=report)
    report.print("Textures")

    if not args.skip_variants and not args.dry_run:
        run_texture_variants(assets_root / "textures")

    if not args.skip_sync:
        sync_imported_assets(assets_root, overwrite_materials=args.overwrite, dry_run=args.dry_run)


def import_audio(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    source = resolve_path(args.source)
    audio_dir = assets_root / "audio"
    report = Report()
    audio_files = find_audio_files(source)

    if not audio_files:
        raise SystemExit(f"No audio files found under {source}")

    if args.name and len(audio_files) > 1:
        raise SystemExit("--name can only be used when importing a single audio file")

    manifest = load_audio_manifest(assets_root)
    audio_entries = manifest.setdefault("audio", {})
    tags = parse_tags(args.tags)

    for audio_path in audio_files:
        asset_name = clean_asset_name(args.name or audio_path.stem)
        target_audio = audio_dir / f"{asset_name}{audio_path.suffix.lower()}"
        copy_file(audio_path, target_audio, overwrite=args.overwrite, dry_run=args.dry_run, report=report)

        definition = create_audio_definition(
            target_audio,
            display_name=audio_path.stem,
            loop=not args.no_loop,
            volume=args.volume,
            tags=tags,
        )

        if asset_name in audio_entries and not args.overwrite:
            report.skipped += 1
            continue

        if audio_entries.get(asset_name) != definition:
            audio_entries[asset_name] = definition
            report.updated += 1

    write_audio_manifest(assets_root, manifest, dry_run=args.dry_run, report=report)
    report.print("Audio")


def import_skybox(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    source = resolve_path(args.source)

    if not source.is_dir():
        raise SystemExit(f"Skybox source is not a directory: {source}")

    asset_name = clean_asset_name(args.name or source.name)
    target_dir = assets_root / "skyboxes" / asset_name
    report = Report()
    face_files = find_skybox_face_files(source)
    missing_faces = [face for face in SKYBOX_FACES if face not in face_files]

    if missing_faces:
        raise SystemExit(f"Missing skybox face(s) in {source}: {', '.join(missing_faces)}")

    copied_faces = {}

    for face in SKYBOX_FACES:
        source_face = face_files[face]
        target_face = target_dir / f"{face}{source_face.suffix.lower()}"
        copy_file(source_face, target_face, overwrite=args.overwrite, dry_run=args.dry_run, report=report)
        copied_faces[face] = target_face.name

    manifest = {
        "schema": SKYBOX_SCHEMA,
        "name": asset_name,
        "faces": copied_faces,
    }
    write_json_if_changed(target_dir / "skybox.json", manifest, dry_run=args.dry_run, report=report)
    report.print("Skybox")


def validate_assets(args: argparse.Namespace) -> None:
    assets_root = resolve_path(args.assets_root)
    prop_report = validate_props(assets_root)
    texture_report = validate_material_manifest(assets_root)
    audio_report = validate_audio_manifest(assets_root)
    skybox_report = validate_skyboxes(assets_root)
    project_config_report = validate_project_config(assets_root)

    prop_report.print("Props")
    texture_report.print("Textures")
    audio_report.print("Audio")
    skybox_report.print("Skyboxes")
    project_config_report.print("Project config")

    if (
        prop_report.warnings
        or texture_report.warnings
        or audio_report.warnings
        or skybox_report.warnings
        or project_config_report.warnings
    ):
        raise SystemExit(1)


def sync_imported_assets(assets_root: Path, *, overwrite_materials: bool, dry_run: bool) -> None:
    prop_report = sync_props(assets_root, overwrite=False, dry_run=dry_run)
    texture_report = sync_texture_manifest(
        assets_root,
        overwrite=overwrite_materials,
        dry_run=dry_run,
    )
    audio_report = sync_audio_manifest(assets_root, overwrite=False, dry_run=dry_run)

    prop_report.print("Synced props")
    texture_report.print("Synced textures")
    audio_report.print("Synced audio")


def sync_props(assets_root: Path, overwrite: bool, dry_run: bool) -> Report:
    props_dir = assets_root / "props"
    report = Report()

    for model_path in sorted(props_dir.glob("*")):
        if not model_path.is_file() or model_path.suffix.lower() not in MODEL_SUFFIXES:
            continue

        sidecar_path = model_path.with_suffix(".aqua_prop.json")
        if sidecar_path.is_file():
            metadata = read_json(sidecar_path)
        else:
            metadata = create_prop_metadata(
                asset_name=clean_asset_name(model_path.stem),
                display_name=model_path.stem,
                model_name=model_path.name,
                collision_type="none",
            )
            report.created += 1

        normalized = normalize_prop_metadata(metadata, sidecar_path, model_path)

        if not overwrite and sidecar_path.is_file():
            write_json_if_changed(sidecar_path, normalized, dry_run=dry_run, report=report)
        else:
            write_json_if_changed(sidecar_path, normalized, dry_run=dry_run, report=report)

    return report


def validate_props(assets_root: Path) -> Report:
    props_dir = assets_root / "props"
    report = Report()
    model_names = {path.name for path in props_dir.glob("*") if path.suffix.lower() in MODEL_SUFFIXES}

    for sidecar_path in sorted(props_dir.glob("*.aqua_prop.json")):
        metadata = read_json(sidecar_path)
        if metadata.get("schema") != PROP_SCHEMA:
            report.warnings += 1
            print(f"Warning: {sidecar_path} has invalid schema {metadata.get('schema')!r}")

        model = metadata.get("model")
        model_name = model if Path(str(model)).suffix else f"{model}.glb"

        if not model or model_name not in model_names:
            report.warnings += 1
            print(f"Warning: {sidecar_path} references missing model {model!r}")

    return report


def sync_texture_manifest(assets_root: Path, overwrite: bool, dry_run: bool) -> Report:
    report = Report()
    manifest = load_material_manifest(assets_root)
    materials = manifest.setdefault("materials", {})
    source_root = assets_root / "textures" / SOURCE_TEXTURE_FOLDER

    for material_dir in sorted(path for path in source_root.glob("*") if path.is_dir()):
        material_name = clean_asset_name(material_dir.name)
        definition = discover_material_definition(material_dir)

        if not definition:
            report.warnings += 1
            print(f"Warning: no texture channels found in {material_dir}")
            continue

        if material_name in materials and not overwrite:
            report.skipped += 1
            continue

        if materials.get(material_name) != definition:
            materials[material_name] = definition
            report.updated += 1

    write_material_manifest(assets_root, manifest, dry_run=dry_run, report=report)
    return report


def validate_material_manifest(assets_root: Path) -> Report:
    manifest = load_material_manifest(assets_root)
    report = Report()

    if manifest.get("schema") != MATERIAL_SCHEMA:
        report.warnings += 1
        print(f"Warning: material manifest has invalid schema {manifest.get('schema')!r}")

    for material_name, definition in manifest.get("materials", {}).items():
        for channel in ("diffuse", "arm", "normal"):
            texture_url = definition.get(channel)

            if not texture_url:
                continue

            texture_path = asset_url_to_path(assets_root, texture_url)
            if texture_path is None or not texture_path.is_file():
                report.warnings += 1
                print(f"Warning: material {material_name}.{channel} references missing texture {texture_url}")

    return report


def sync_audio_manifest(assets_root: Path, overwrite: bool, dry_run: bool) -> Report:
    report = Report()
    audio_dir = assets_root / "audio"
    manifest = load_audio_manifest(assets_root)
    audio_entries = manifest.setdefault("audio", {})

    if not audio_dir.is_dir():
        write_audio_manifest(assets_root, manifest, dry_run=dry_run, report=report)
        return report

    for audio_path in sorted(path for path in audio_dir.rglob("*") if path.is_file()):
        if audio_path.name == "audio.json" or audio_path.suffix.lower() not in AUDIO_SUFFIXES:
            continue

        asset_name = clean_asset_name(audio_path.stem)
        definition = create_audio_definition(
            audio_path,
            display_name=audio_path.stem,
            loop=True,
            volume=1.0,
            tags=[],
        )

        if asset_name in audio_entries and not overwrite:
            report.skipped += 1
            continue

        if audio_entries.get(asset_name) != definition:
            audio_entries[asset_name] = definition
            report.updated += 1

    write_audio_manifest(assets_root, manifest, dry_run=dry_run, report=report)
    return report


def validate_audio_manifest(assets_root: Path) -> Report:
    manifest = load_audio_manifest(assets_root)
    report = Report()

    if manifest.get("schema") != AUDIO_SCHEMA:
        report.warnings += 1
        print(f"Warning: audio manifest has invalid schema {manifest.get('schema')!r}")

    audio_entries = manifest.get("audio", {})
    if not isinstance(audio_entries, dict):
        report.warnings += 1
        print("Warning: audio manifest field 'audio' must be an object")
        return report

    for asset_name, definition in audio_entries.items():
        if not isinstance(definition, dict):
            report.warnings += 1
            print(f"Warning: audio asset {asset_name} must be an object")
            continue

        audio_url = definition.get("src")
        audio_path = asset_url_to_path(assets_root, audio_url)

        if audio_path is None or not audio_path.is_file():
            report.warnings += 1
            print(f"Warning: audio asset {asset_name} references missing file {audio_url}")

        volume = definition.get("volume", 1.0)
        if not isinstance(volume, (int, float)) or not 0 <= float(volume) <= 1:
            report.warnings += 1
            print(f"Warning: audio asset {asset_name} has invalid volume {volume!r}")

    footstep_sets = manifest.get("footstepSets", {})
    if footstep_sets and not isinstance(footstep_sets, dict):
        report.warnings += 1
        print("Warning: audio manifest field 'footstepSets' must be an object")
        return report

    for set_name, definition in footstep_sets.items():
        if not isinstance(definition, dict):
            report.warnings += 1
            print(f"Warning: footstep set {set_name} must be an object")
            continue

        clips = definition.get("clips", [])
        if not isinstance(clips, list) or len(clips) == 0:
            report.warnings += 1
            print(f"Warning: footstep set {set_name} must define one or more clips")
            continue

        for clip_url in clips:
            clip_path = asset_url_to_path(assets_root, clip_url)

            if clip_path is None or not clip_path.is_file():
                report.warnings += 1
                print(f"Warning: footstep set {set_name} references missing file {clip_url}")

        volume = definition.get("volume", 1.0)
        if not isinstance(volume, (int, float)) or not 0 <= float(volume) <= 1:
            report.warnings += 1
            print(f"Warning: footstep set {set_name} has invalid volume {volume!r}")

    return report


def validate_skyboxes(assets_root: Path) -> Report:
    skyboxes_dir = assets_root / "skyboxes"
    report = Report()

    if not skyboxes_dir.is_dir():
        return report

    for skybox_dir in sorted(path for path in skyboxes_dir.iterdir() if path.is_dir()):
        manifest_path = skybox_dir / "skybox.json"

        if manifest_path.is_file():
            metadata = read_json(manifest_path)
            if metadata.get("schema") != SKYBOX_SCHEMA:
                report.warnings += 1
                print(f"Warning: {manifest_path} has invalid schema {metadata.get('schema')!r}")
                continue

            faces = metadata.get("faces") if isinstance(metadata.get("faces"), dict) else {}
            for face in SKYBOX_FACES:
                face_name = faces.get(face)
                if not face_name or not (skybox_dir / str(face_name)).is_file():
                    report.warnings += 1
                    print(f"Warning: skybox {skybox_dir.name} missing manifest face {face!r}")
            continue

        for face in SKYBOX_FACES:
            if not (skybox_dir / f"{face}.png").is_file():
                report.warnings += 1
                print(f"Warning: skybox {skybox_dir.name} missing canonical face {face}.png")

    return report


def validate_project_config(assets_root: Path) -> Report:
    config_path = assets_root.parent / "config" / "aqua.project.json"
    report = Report()

    if not config_path.is_file():
        report.warnings += 1
        print(f"Warning: missing project config {config_path}")
        return report

    config = read_json(config_path)
    if config.get("schema") != PROJECT_CONFIG_SCHEMA:
        report.warnings += 1
        print(f"Warning: project config has invalid schema {config.get('schema')!r}")

    startup = config.get("startup") if isinstance(config.get("startup"), dict) else {}
    assets = config.get("assets") if isinstance(config.get("assets"), dict) else {}
    materials = config.get("materials") if isinstance(config.get("materials"), dict) else {}
    audio = config.get("audio") if isinstance(config.get("audio"), dict) else {}

    validate_asset_url(report, assets_root, "startup.mapUrl", startup.get("mapUrl"), "file")
    validate_asset_url(report, assets_root, "assets.materialsManifestUrl", assets.get("materialsManifestUrl"), "file")
    validate_asset_url(report, assets_root, "assets.audioManifestUrl", assets.get("audioManifestUrl"), "file")
    validate_asset_url(report, assets_root, "assets.skyboxBaseUrl", assets.get("skyboxBaseUrl"), "dir")
    validate_asset_url(report, assets_root, "assets.propBaseUrl", assets.get("propBaseUrl"), "dir")

    if materials.get("manifestUrl"):
        validate_asset_url(report, assets_root, "materials.manifestUrl", materials.get("manifestUrl"), "file")

    if audio.get("manifestUrl"):
        validate_asset_url(report, assets_root, "audio.manifestUrl", audio.get("manifestUrl"), "file")

    return report


def validate_asset_url(report: Report, assets_root: Path, label: str, url: object, expected_kind: str) -> None:
    if not url:
        return

    path = asset_url_to_path(assets_root, str(url))
    if path is None:
        return

    exists = path.is_dir() if expected_kind == "dir" else path.is_file()
    if exists:
        return

    report.warnings += 1
    print(f"Warning: project config {label} references missing {expected_kind} {url}")


def find_model_files(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() in MODEL_SUFFIXES:
        return [source]

    if source.is_dir():
        return sorted(
            path
            for path in source.rglob("*")
            if path.is_file() and path.suffix.lower() in MODEL_SUFFIXES
        )

    raise SystemExit(f"No model file or directory found: {source}")


def find_audio_files(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() in AUDIO_SUFFIXES:
        return [source]

    if source.is_dir():
        return sorted(
            path
            for path in source.rglob("*")
            if path.is_file() and path.suffix.lower() in AUDIO_SUFFIXES
        )

    raise SystemExit(f"No audio file or directory found: {source}")


def find_skybox_face_files(source: Path) -> dict[str, Path]:
    matches = {}

    for path in sorted(source.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue

        tokens = set(tokenize(path.stem))

        for face, aliases in SKYBOX_FACE_ALIASES.items():
            if face in matches:
                continue

            if tokens.intersection(aliases):
                matches[face] = path

    return matches


def find_material_sources(source: Path, explicit_name: str | None) -> list[tuple[str, Path]]:
    if not source.is_dir():
        raise SystemExit(f"Texture source is not a directory: {source}")

    if has_texture_channels(source):
        return [(clean_asset_name(explicit_name or source.name), source)]

    sources = []
    for folder in sorted(path for path in source.iterdir() if path.is_dir()):
        if has_texture_channels(folder):
            sources.append((clean_asset_name(folder.name), folder))

    return sources


def has_texture_channels(folder: Path) -> bool:
    return any(path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES for path in folder.iterdir())


def copy_texture_files(
    source_dir: Path,
    target_dir: Path,
    *,
    overwrite: bool,
    dry_run: bool,
    report: Report,
) -> list[Path]:
    copied = []
    for source_path in sorted(source_dir.iterdir()):
        if not source_path.is_file() or source_path.suffix.lower() not in IMAGE_SUFFIXES:
            continue

        target_path = target_dir / source_path.name
        copy_file(source_path, target_path, overwrite=overwrite, dry_run=dry_run, report=report)
        copied.append(target_path)

    return copied


def copy_file(source: Path, target: Path, *, overwrite: bool, dry_run: bool, report: Report) -> None:
    if target.exists() and not overwrite:
        report.skipped += 1
        return

    if source.resolve() == target.resolve():
        report.skipped += 1
        return

    if dry_run:
        print(f"Would copy {source} -> {target}")
        report.copied += 1
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    report.copied += 1


def create_prop_metadata(
    *,
    asset_name: str,
    display_name: str,
    model_name: str,
    collision_type: str,
) -> dict:
    return {
        "schema": PROP_SCHEMA,
        "name": asset_name,
        "displayName": display_name,
        "model": model_name,
        "static": True,
        "collision": {
            "type": collision_type,
            "source": "aqua_collision_kind",
            "meshCount": 0,
        },
        "tags": [],
    }


def normalize_prop_metadata(metadata: dict, sidecar_path: Path, model_path: Path) -> dict:
    asset_name = clean_asset_name(metadata.get("name") or sidecar_path.stem.replace(".aqua_prop", ""))
    normalized = {
        "schema": PROP_SCHEMA,
        "name": asset_name,
        "displayName": metadata.get("displayName") or metadata.get("name") or asset_name,
        "model": normalize_model_name(metadata.get("model"), model_path),
        "static": bool(metadata.get("static", True)),
    }

    collision = metadata.get("collision") if isinstance(metadata.get("collision"), dict) else {}
    collision_type = collision.get("type") or "none"
    normalized["collision"] = {
        "type": collision_type,
        "source": collision.get("source") or "aqua_collision_kind",
        "meshCount": int(collision.get("meshCount") or 0),
    }

    for key, value in metadata.items():
        if key not in normalized and key != "collision":
            normalized[key] = value

    return normalized


def normalize_model_name(model: object, model_path: Path) -> str:
    model_text = str(model or "").strip()

    if not model_text:
        return model_path.name

    model_name = Path(model_text).name
    if Path(model_name).suffix:
        return model_name

    if model_name == model_path.stem:
        return model_path.name

    return f"{model_name}.glb"


def discover_material_definition(material_dir: Path, known_files: list[Path] | None = None) -> dict:
    files = known_files or sorted(
        path
        for path in material_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )
    channels = {}

    for channel in ("diffuse", "arm", "normal"):
        match = find_channel_file(files, channel)
        if match:
            channels[channel] = texture_url(match)

    if "diffuse" not in channels and len(files) == 1:
        channels["diffuse"] = texture_url(files[0])

    return channels


def find_channel_file(files: list[Path], channel: str) -> Path | None:
    aliases = CHANNEL_ALIASES[channel]
    scored_matches = []

    for path in files:
        tokens = tokenize(path.stem)
        for index, token in enumerate(tokens):
            if token in aliases:
                scored_matches.append((index, len(path.name), path))
                break

    if not scored_matches:
        return None

    return sorted(scored_matches)[0][2]


def tokenize(value: str) -> list[str]:
    return [
        token
        for token in clean_asset_name(value).split("_")
        if token
    ]


def texture_url(path: Path) -> str:
    texture_parts = path.parts[path.parts.index("textures") :]
    return "/assets/" + "/".join(texture_parts).replace("\\", "/")


def audio_url(path: Path) -> str:
    audio_parts = path.parts[path.parts.index("audio") :]
    return "/assets/" + "/".join(audio_parts).replace("\\", "/")


def asset_url_to_path(assets_root: Path, url: str) -> Path | None:
    if not isinstance(url, str) or not url.startswith("/assets/"):
        return None

    relative = url.removeprefix("/assets/").split("?", 1)[0].split("#", 1)[0]
    return assets_root / Path(relative)


def load_material_manifest(assets_root: Path) -> dict:
    manifest_path = material_manifest_path(assets_root)
    if not manifest_path.is_file():
        return {"schema": MATERIAL_SCHEMA, "materials": {}}

    manifest = read_json(manifest_path)
    manifest.setdefault("schema", MATERIAL_SCHEMA)
    manifest.setdefault("materials", {})
    return manifest


def load_audio_manifest(assets_root: Path) -> dict:
    manifest_path = audio_manifest_path(assets_root)
    if not manifest_path.is_file():
        return {"schema": AUDIO_SCHEMA, "audio": {}}

    manifest = read_json(manifest_path)
    manifest.setdefault("schema", AUDIO_SCHEMA)
    manifest.setdefault("audio", {})
    return manifest


def write_material_manifest(assets_root: Path, manifest: dict, *, dry_run: bool, report: Report) -> None:
    write_json_if_changed(material_manifest_path(assets_root), manifest, dry_run=dry_run, report=report)


def write_audio_manifest(assets_root: Path, manifest: dict, *, dry_run: bool, report: Report) -> None:
    write_json_if_changed(audio_manifest_path(assets_root), manifest, dry_run=dry_run, report=report)


def material_manifest_path(assets_root: Path) -> Path:
    return assets_root / "textures" / "materials.json"


def audio_manifest_path(assets_root: Path) -> Path:
    return assets_root / "audio" / "audio.json"


def create_audio_definition(path: Path, *, display_name: str, loop: bool, volume: float, tags: list[str]) -> dict:
    return {
        "src": audio_url(path),
        "displayName": display_name,
        "loop": bool(loop),
        "volume": clamp_volume(volume),
        "tags": tags,
    }


def parse_tags(value: str) -> list[str]:
    return [
        clean_asset_name(tag)
        for tag in str(value or "").split(",")
        if clean_asset_name(tag)
    ]


def clamp_volume(value: object) -> float:
    try:
        volume = float(value)
    except (TypeError, ValueError):
        return 1.0

    return max(0.0, min(1.0, volume))


def read_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error


def write_json_if_changed(path: Path, payload: dict, *, dry_run: bool, report: Report) -> None:
    next_text = json.dumps(payload, indent=2) + "\n"

    if path.is_file() and path.read_text(encoding="utf-8") == next_text:
        report.skipped += 1
        return

    if dry_run:
        print(f"Would write {path}")
        report.updated += 1
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(next_text, encoding="utf-8")
    report.updated += 1


def run_texture_variants(texture_root: Path) -> None:
    script = Path(__file__).with_name("texture_variants.py")
    subprocess.run([sys.executable, str(script), str(texture_root)], check=True)


def resolve_path(path: str) -> Path:
    return Path(path).expanduser().resolve()


def clean_asset_name(name: object) -> str:
    cleaned = "".join(character.lower() if character.isalnum() else "_" for character in str(name or ""))
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned or "aqua_asset"


if __name__ == "__main__":
    main()
