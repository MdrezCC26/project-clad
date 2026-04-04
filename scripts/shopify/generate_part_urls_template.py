"""
Create part_urls.csv on your Desktop: column A = Z1600750, column B = empty.

Fill column B with the CDN URL from Shopify Admin → Content → Files (copy link per file),
then run:

  python fill_image_src_from_shopify_files.py --csv ...\\products_export.csv --mapping ...\\part_urls.csv --in-place

PNG folder default: Z Bars PNG (same stems as your part numbers).
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

_DEFAULT_PNG = Path(
    r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\PNG"
)
_DEFAULT_OUT = Path(r"C:\Users\Micha\Desktop\part_urls.csv")


def part_from_png_name(name: str) -> str | None:
    stem = Path(name).stem
    if " - " in stem:
        stem = stem.split(" - ", 1)[0].strip()
    if re.match(r"^Z\d{7}$", stem, re.IGNORECASE):
        return stem[0].upper() + stem[1:].upper()
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--png-dir",
        type=Path,
        default=_DEFAULT_PNG,
        help="Folder with Z########.png files",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=_DEFAULT_OUT,
        help="Output CSV path",
    )
    args = ap.parse_args()

    if not args.png_dir.is_dir():
        print(f"PNG folder not found: {args.png_dir}", file=sys.stderr)
        print("Pass --png-dir to your images folder.", file=sys.stderr)
        return 1

    parts: list[str] = []
    for p in sorted(args.png_dir.glob("*.png")):
        code = part_from_png_name(p.name)
        if code:
            parts.append(code)
    parts = sorted(set(parts))
    if not parts:
        print("No Z########.png files found.", file=sys.stderr)
        return 1

    try:
        with args.out.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Part", "URL"])
            for code in parts:
                w.writerow([code, ""])
    except OSError as e:
        print(f"Could not write {args.out}: {e}", file=sys.stderr)
        return 1

    print(f"Wrote {len(parts)} rows to {args.out}")
    print(
        "Paste each file's URL from Shopify > Content > Files into column B, save, then run fill_image_src_from_shopify_files.py --mapping"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
