"""
Collapse Shopify product CSV to one row per Handle (first row kept).
Clears Option1–3 name/value/linked columns and Color pattern metafield.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

DEFAULT_IN = Path(r"C:\Users\Micha\Desktop\CCProducts.csv")
DEFAULT_OUT = Path(r"C:\Users\Micha\Desktop\CCProducts_no_color_variants.csv")

OPTION_COLS = (
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


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Remove color (and other) variant rows; one row per Handle."
    )
    ap.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_IN,
        help=f"Source CSV (default: {DEFAULT_IN})",
    )
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    inp = args.input
    out = args.out

    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        return 1

    with inp.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        print("Empty CSV.", file=sys.stderr)
        return 1

    header = rows[0]
    n = len(header)
    col = {name: i for i, name in enumerate(header)}

    seen: set[str] = set()
    out_rows: list[list[str]] = [header]

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
        while len(padded) < n:
            padded.append("")
        padded = padded[:n]

        for name in OPTION_COLS:
            if name in col:
                padded[col[name]] = ""
        if COLOR_METAFIELD in col:
            padded[col[COLOR_METAFIELD]] = ""
        if "Variant Image" in col:
            padded[col["Variant Image"]] = ""

        out_rows.append(padded)

    try:
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out_rows)
    except OSError as e:
        print(f"Could not write {out}: {e}", file=sys.stderr)
        return 1

    removed = len(rows) - 1 - (len(out_rows) - 1)
    print(f"Wrote: {out}")
    print(f"Rows: {len(rows) - 1} -> {len(out_rows) - 1} (dropped {removed} variant row(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
