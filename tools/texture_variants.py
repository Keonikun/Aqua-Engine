#!/usr/bin/env python3
"""Create lower-resolution JPG texture variants for Aqua Engine assets."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


VARIANTS = {
    "medium": 512,
    "low": 256,
    "very_low": 128,
}
GENERATED_SUFFIXES = tuple(f"_{name}" for name in VARIANTS)


def main() -> None:
    args = parse_args()
    source_dir = Path(args.folder).resolve()

    if not source_dir.is_dir():
        raise SystemExit(f"Texture folder does not exist: {source_dir}")

    output_dir = Path(args.output_dir).resolve() if args.output_dir else None
    sources = find_jpgs(source_dir, recursive=args.recursive)
    processed = 0
    written = 0
    skipped = 0

    for source_path in sources:
        if is_generated_variant(source_path):
            skipped += 1
            continue

        processed += 1

        for variant_name, size in VARIANTS.items():
            target_path = get_target_path(source_path, source_dir, output_dir, variant_name)

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

    print(f"Scanned {len(sources)} JPG file(s).")
    print(f"Processed {processed} source texture(s).")
    print(f"Wrote {written} variant file(s).")
    print(f"Skipped {skipped} file(s).")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create 512x512, 256x256, and 128x128 JPG variants for each JPG in a folder.",
    )

    parser.add_argument(
        "folder",
        help="Folder containing JPG textures.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        help="Optional output directory. Defaults to writing variants beside each source JPG.",
    )
    parser.add_argument(
        "-r",
        "--recursive",
        action="store_true",
        help="Walk nested folders.",
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


def find_jpgs(folder: Path, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"

    return sorted(
        path
        for path in folder.glob(pattern)
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
    )


def is_generated_variant(path: Path) -> bool:
    return path.stem.endswith(GENERATED_SUFFIXES)


def get_target_path(source_path: Path, source_dir: Path, output_dir: Path | None, variant_name: str) -> Path:
    filename = f"{source_path.stem}_{variant_name}.jpg"

    if output_dir is None:
        return source_path.with_name(filename)

    relative_parent = source_path.parent.relative_to(source_dir)
    return output_dir / relative_parent / filename


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
