#!/usr/bin/env python3
"""Create lower-resolution JPG texture folders for Aqua Engine assets."""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing Pillow. Install tool dependencies with:\n"
        "  python -m pip install -r tools/requirements.txt\n"
        "or:\n"
        "  npm run tools:install\n"
    ) from error


SOURCE_SIZE_FOLDER = "1024x1024"
VARIANTS = {
    "512x512": 512,
    "256x256": 256,
    "128x128": 128,
}
GENERATED_SUFFIXES = ("_medium", "_low", "_very_low")


def main() -> None:
    args = parse_args()
    requested_dir = Path(args.folder).resolve()
    source_dir = resolve_source_dir(requested_dir, args.source_size_folder)

    if not source_dir.is_dir():
        raise SystemExit(f"Texture folder does not exist: {source_dir}")

    output_root = Path(args.output_dir).resolve() if args.output_dir else source_dir.parent
    sources = find_jpgs(source_dir, recursive=args.recursive)
    processed = 0
    written = 0
    skipped = 0

    for source_path in sources:
        if is_generated_variant(source_path):
            skipped += 1
            continue

        processed += 1

        for folder_name, size in VARIANTS.items():
            target_path = get_target_path(source_path, source_dir, output_root, folder_name)

            if target_path.exists() and not args.overwrite:
                skipped += 1
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)
            write_variant(
                source_path=source_path,
                target_path=target_path,
                size=size,
                fit=args.fit,
                quality=args.quality,
            )
            written += 1

    print(f"Source folder: {source_dir}")
    print(f"Output root: {output_root}")
    print(f"Scanned {len(sources)} JPG file(s).")
    print(f"Processed {processed} source texture(s).")
    print(f"Wrote {written} variant file(s).")
    print(f"Skipped {skipped} file(s).")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create 512x512, 256x256, and 128x128 texture folders from source JPGs.",
    )

    parser.add_argument(
        "folder",
        help="Texture root or source-size folder. If the root contains 1024x1024, that folder is used.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        help="Optional texture root for generated size folders. Defaults to the source folder parent.",
    )
    parser.add_argument(
        "-r",
        "--recursive",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Walk nested folders. Default: true.",
    )
    parser.add_argument(
        "--source-size-folder",
        default=SOURCE_SIZE_FOLDER,
        help=f"Source texture size folder name. Default: {SOURCE_SIZE_FOLDER}.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing variant files.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=90,
        help="JPEG quality from 1 to 95. Default: 90.",
    )
    parser.add_argument(
        "--fit",
        choices=("stretch", "cover", "contain"),
        default="stretch",
        help="How to handle non-square source images. Default: stretch.",
    )

    args = parser.parse_args()
    args.quality = max(1, min(args.quality, 95))
    return args


def resolve_source_dir(folder: Path, source_size_folder: str) -> Path:
    nested_source_dir = folder / source_size_folder

    if folder.name != source_size_folder and nested_source_dir.is_dir():
        return nested_source_dir

    return folder


def find_jpgs(folder: Path, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"

    return sorted(
        path
        for path in folder.glob(pattern)
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
    )


def is_generated_variant(path: Path) -> bool:
    return path.stem.endswith(GENERATED_SUFFIXES)


def get_target_path(source_path: Path, source_dir: Path, output_root: Path, folder_name: str) -> Path:
    relative_parent = source_path.parent.relative_to(source_dir)
    return output_root / folder_name / relative_parent / source_path.name


def write_variant(source_path: Path, target_path: Path, size: int, fit: str, quality: int) -> None:
    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        image = resize_image(image, size=size, fit=fit)

        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")

        image.save(target_path, "JPEG", quality=quality, optimize=True)


def resize_image(image: Image.Image, size: int, fit: str) -> Image.Image:
    target_size = (size, size)

    if fit == "cover":
        return ImageOps.fit(image, target_size, method=Image.Resampling.LANCZOS)

    if fit == "contain":
        contained = ImageOps.contain(image, target_size, method=Image.Resampling.LANCZOS)
        background_color = 0 if contained.mode == "L" else (0, 0, 0)
        canvas = Image.new(contained.mode, target_size, background_color)
        offset = (
            (target_size[0] - contained.width) // 2,
            (target_size[1] - contained.height) // 2,
        )
        canvas.paste(contained, offset)
        return canvas

    return image.resize(target_size, Image.Resampling.LANCZOS)


if __name__ == "__main__":
    main()
