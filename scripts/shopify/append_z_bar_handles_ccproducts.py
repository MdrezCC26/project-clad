"""
Append Shopify CSV rows for each Z######## from Z Bars PNG folder.
Column A (Handle) = lowercase part id (e.g. z1600750). Backs up CSV to .bak first.
"""
from __future__ import annotations

import csv
import re
import shutil
import sys
from pathlib import Path

CSV_PATH = Path(r"C:\Users\Micha\Desktop\CCProducts.csv")
PNG_DIR = Path(
    r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\PNG"
)
TEMPLATE_HANDLE = "z-bar-2"


def z_bar_title_from_code(code: str) -> str:
    """Z1600750 -> gauge 16, thou 00750 -> Z BAR 0.75"""
    code = code.strip().upper()
    if len(code) != 8 or code[0] != "Z" or not code[1:].isdigit():
        return f"Z BAR {code}"
    thou = int(code[3:8], 10)
    v = thou / 1000.0
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return f"Z BAR {s}"


def gauge_metafield_from_code(code: str) -> str:
    g = int(code[1:3], 10)
    return f"{g} Gauge"


def part_code_from_png_name(name: str) -> str | None:
    stem = Path(name).stem
    if " - " in stem:
        stem = stem.split(" - ", 1)[0].strip()
    m = re.match(r"^(Z\d{7})$", stem, re.IGNORECASE)
    return m.group(1).upper() if m else None


def row_by_handle(rows: list[list[str]], handle: str) -> list[str] | None:
    h = handle.strip().lower()
    for row in rows[1:]:
        if not row:
            continue
        if row[0].strip().lower() == h:
            return list(row)
    return None


def pad_row(row: list[str], n: int) -> list[str]:
    out = list(row)
    while len(out) < n:
        out.append("")
    return out[:n]


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output CSV (default: overwrite CCProducts.csv; use if file is open in Excel)",
    )
    args = ap.parse_args()
    out_path = args.out if args.out is not None else CSV_PATH

    if not CSV_PATH.is_file():
        print(f"CSV not found: {CSV_PATH}", file=sys.stderr)
        return 1
    if not PNG_DIR.is_dir():
        print(f"PNG folder not found: {PNG_DIR}", file=sys.stderr)
        return 1

    codes: list[str] = []
    for p in sorted(PNG_DIR.glob("*.png")):
        c = part_code_from_png_name(p.name)
        if c:
            codes.append(c)
    codes = sorted(set(codes))
    if not codes:
        print("No Z########.png files found.", file=sys.stderr)
        return 1

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if len(rows) < 2:
        print("CSV has no data rows.", file=sys.stderr)
        return 1

    header = rows[0]
    ncols = len(header)
    col = {name: i for i, name in enumerate(header)}

    existing_handles = {r[0].strip().lower() for r in rows[1:] if r and r[0].strip()}

    template = row_by_handle(rows, TEMPLATE_HANDLE)
    if not template:
        print(f"Template row Handle={TEMPLATE_HANDLE!r} not found.", file=sys.stderr)
        return 1
    template = pad_row(template, ncols)

    new_rows: list[list[str]] = []
    for code in codes:
        handle = code.lower()
        if handle in existing_handles:
            continue
        row = pad_row(template, ncols)
        row[col["Handle"]] = handle
        title_txt = z_bar_title_from_code(code)
        row[col["Title"]] = title_txt
        if "Variant SKU" in col:
            row[col["Variant SKU"]] = code
        gcol = "Gauge (product.metafields.custom.gauge)"
        if gcol in col:
            row[col[gcol]] = gauge_metafield_from_code(code)
        if "Image Src" in col:
            row[col["Image Src"]] = ""
        if "Image Position" in col:
            row[col["Image Position"]] = ""
        if "Image Alt Text" in col:
            row[col["Image Alt Text"]] = ""
        if "Tags" in col:
            row[col["Tags"]] = code
        new_rows.append(row)

    if not new_rows:
        print("All Z-bar part codes from PNG folder already have a Handle row; nothing added.")
        return 0

    out = rows + new_rows
    if out_path.resolve() == CSV_PATH.resolve():
        bak = CSV_PATH.with_suffix(".csv.bak")
        shutil.copy2(CSV_PATH, bak)
        print(f"Backup: {bak}")

    try:
        with out_path.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out)
    except OSError as e:
        alt = CSV_PATH.parent / "CCProducts_with_zbars.csv"
        print(f"Could not write {out_path}: {e}", file=sys.stderr)
        print(f"Writing instead to: {alt}", file=sys.stderr)
        with alt.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out)
        out_path = alt

    print(f"Wrote: {out_path}")
    print(
        f"Added {len(new_rows)} row(s); Handle (column A) = lowercase part number (e.g. z1600750)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
