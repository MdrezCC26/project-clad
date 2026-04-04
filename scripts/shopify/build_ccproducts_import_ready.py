"""
Build ONE Shopify import file that includes:
- Every product from CCProducts_with_zbars.csv (your catalog + appended Z######## rows)
- One row per Handle (extra color variants removed)
- Inventory / linked-column / boolean fixes from fix_shopify_product_csv

Output: Desktop\\CCProducts_IMPORT_READY.csv  ← use this in Admin → Import.

The file CCProducts_shopify_fixed.csv is only built from CCProducts_no_color_variants.csv
and does NOT contain the new Z-bar parts — that is why imports looked like nothing new added.
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from fix_shopify_product_csv import (
    BOOL_COLS,
    LINKED_COLS,
    QTY_COL,
    detect_delimiter,
    fix_qty,
    norm_bool,
    read_text_with_encoding,
)

_DESKTOP = Path(r"C:\Users\Micha\Desktop")
_WITH_ZBARS_CANDIDATES = (
    _DESKTOP / "CCProducts_with_zbars.csv",
    _DESKTOP / "New folder" / "CCProducts_with_zbars.csv",
    _DESKTOP / "CCProducts_with_zbars_shopify_fixed.csv",
    _DESKTOP / "New folder" / "CCProducts_with_zbars_shopify_fixed.csv",
)
_DEFAULT_OUT_DESKTOP = _DESKTOP / "CCProducts_IMPORT_READY.csv"
_DEFAULT_OUT_NEWFOLDER = _DESKTOP / "New folder" / "CCProducts_IMPORT_READY.csv"


def resolve_with_zbars_csv(explicit: Path | None) -> Path | None:
    if explicit is not None and explicit.is_file():
        return explicit
    for p in _WITH_ZBARS_CANDIDATES:
        if p.is_file():
            return p
    return None

OPTION_CLEAR_COLS = (
    "Option1 Name",
    "Option1 Value",
    "Option1 Linked To",
    "Option2 Name",
    "Option2 Value",
    "Option2 Linked To",
    "Option3 Name",
    "Option3 Value",
    "Option3 Linked To",
)
COLOR_METAFIELD = "Color (product.metafields.shopify.color-pattern)"
ZBAR_HANDLE_RE = re.compile(r"^z\d{7}$", re.IGNORECASE)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Collapse variants + fix fields → CCProducts_IMPORT_READY.csv"
    )
    ap.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Catalog + Z rows (default: find CCProducts_with_zbars*.csv on Desktop or Desktop/New folder)",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output path (default: Desktop CCProducts_IMPORT_READY.csv, or next to --input if write fails)",
    )
    ap.add_argument("--encoding", default=None, metavar="ENC")
    args = ap.parse_args()

    inp = resolve_with_zbars_csv(args.input)
    if inp is None:
        print("Input not found. Looked for:", file=sys.stderr)
        for p in _WITH_ZBARS_CANDIDATES:
            print(f"  {p}", file=sys.stderr)
        print("Pass --input path\\to\\CCProducts_with_zbars.csv", file=sys.stderr)
        return 1

    if args.out is not None:
        out = args.out
    else:
        out = _DEFAULT_OUT_DESKTOP

    print(f"Using input: {inp}")

    try:
        raw, enc_used = read_text_with_encoding(inp, args.encoding)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    if enc_used not in ("utf-8-sig", "utf-8"):
        print(f"Read input as {enc_used!r}; output will be UTF-8 with BOM.")

    lines = raw.splitlines()
    if not lines:
        print("Empty file.", file=sys.stderr)
        return 1
    delim = detect_delimiter(lines[0])
    f = io.StringIO(raw)
    rows = list(csv.reader(f, delimiter=delim))
    if not rows or (rows[0][0] or "").strip() != "Handle":
        print("Invalid CSV: first column must be Handle.", file=sys.stderr)
        return 1

    header = rows[0]
    ncols = len(header)
    col = {name: i for i, name in enumerate(header)}

    seen: set[str] = set()
    collapsed: list[list[str]] = []
    for row in rows[1:]:
        if not row:
            continue
        handle = (row[0] or "").strip()
        if not handle:
            continue
        key = handle.lower()
        if key in seen:
            continue
        seen.add(key)
        padded = list(row)
        while len(padded) < ncols:
            padded.append("")
        padded = padded[:ncols]
        for name in OPTION_CLEAR_COLS:
            if name in col:
                padded[col[name]] = ""
        if COLOR_METAFIELD in col:
            padded[col[COLOR_METAFIELD]] = ""
        if "Variant Image" in col:
            padded[col["Variant Image"]] = ""
        collapsed.append(padded)

    zbar_handles = sum(1 for r in collapsed if r[0].strip().lower().startswith("z") and len(r[0].strip()) == 8 and r[0].strip()[1:].isdigit())

    fixed_qty = 0
    cleared_links = 0
    out_rows: list[list[str]] = [header]
    for row in collapsed:
        for name in LINKED_COLS:
            if name in col and row[col[name]].strip():
                row[col[name]] = ""
                cleared_links += 1
        if QTY_COL in col:
            new_q, ch = fix_qty(row[col[QTY_COL]])
            row[col[QTY_COL]] = new_q
            if ch:
                fixed_qty += 1
        for name in BOOL_COLS:
            if name in col:
                row[col[name]] = norm_bool(row[col[name]])
        if "Tags" in col:
            hk = (row[col["Handle"]] or "").strip()
            if ZBAR_HANDLE_RE.match(hk):
                sku = (
                    (row[col["Variant SKU"]] or "").strip()
                    if "Variant SKU" in col
                    else ""
                )
                part = sku if sku else hk.upper()
                if re.match(r"^Z\d{7}$", part, re.I):
                    part = "Z" + part[1:].upper()
                row[col["Tags"]] = part
        out_rows.append(row)

    try:
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out_rows)
    except OSError as e:
        alt = inp.parent / "CCProducts_IMPORT_READY.csv"
        if alt.resolve() != out.resolve():
            print(f"Could not write {out}: {e}", file=sys.stderr)
            print(f"Trying: {alt}", file=sys.stderr)
            try:
                with alt.open("w", newline="", encoding="utf-8-sig") as f:
                    csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out_rows)
                out = alt
            except OSError as e2:
                print(f"Could not write {alt}: {e2}", file=sys.stderr)
                return 1
        else:
            print(f"Could not write {out}: {e}", file=sys.stderr)
            return 1

    print(f"Wrote: {out}")
    print(f"Products (unique handles): {len(out_rows) - 1}")
    print(f"  (handles like z1234567, counted as Z-bar style): ~{zbar_handles}")
    print(f"Cleared {cleared_links} Option* Linked To cell(s).")
    print(f"Clamped {fixed_qty} negative {QTY_COL} value(s) to 0.")
    print()
    print(
        "In Shopify Admin > Products > Import, choose THIS file (not CCProducts_shopify_fixed.csv)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
