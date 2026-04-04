"""
Prepare Shopify product CSV for native import:
- Keep comma-separated UTF-8 with BOM and proper quoting
- Ensure header row (abort if first column is not Handle)
- Clear Option1–3 Linked To (metafield refs often confuse validators / older import docs)
- Clamp Variant Inventory Qty to >= 0
- Normalize TRUE/FALSE booleans to lowercase true/false
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

DEFAULT_IN = Path(r"C:\Users\Micha\Desktop\CCProducts_no_color_variants.csv")
DEFAULT_OUT = Path(r"C:\Users\Micha\Desktop\CCProducts_shopify_fixed.csv")

LINKED_COLS = (
    "Option1 Linked To",
    "Option2 Linked To",
    "Option3 Linked To",
)
QTY_COL = "Variant Inventory Qty"
BOOL_COLS = (
    "Published",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Gift Card",
)


def read_text_with_encoding(path: Path, preferred: str | None) -> tuple[str, str]:
    """Read file as text; try common encodings (Excel on Windows often uses cp1252)."""
    data = path.read_bytes()
    if preferred:
        try:
            return data.decode(preferred), preferred
        except UnicodeDecodeError as e:
            raise ValueError(f"--encoding {preferred!r} failed: {e}") from e

    order = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
    for enc in order:
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    text = data.decode("utf-8", errors="replace")
    print(
        "Warning: used UTF-8 with replacement for undecodable bytes.",
        file=sys.stderr,
    )
    return text, "utf-8-replace"


def detect_delimiter(first_line: str) -> str:
    tc = first_line.count("\t")
    cc = first_line.count(",")
    if tc > cc and tc >= 3:
        return "\t"
    return ","


def norm_bool(cell: str) -> str:
    s = (cell or "").strip()
    if s.upper() in ("TRUE", "FALSE"):
        return s.lower()
    return cell


def fix_qty(cell: str) -> tuple[str, bool]:
    """Return (new_value, changed)."""
    s = (cell or "").strip()
    if not s:
        return cell, False
    try:
        n = float(s)
        if n < 0:
            return "0", True
        if n == int(n):
            return str(int(n)), False
        return s, False
    except ValueError:
        return cell, False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=DEFAULT_IN)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--encoding",
        default=None,
        metavar="ENC",
        help="Input file encoding (default: try utf-8-sig, utf-8, cp1252, latin-1)",
    )
    args = ap.parse_args()
    inp, out = args.input, args.out

    if not inp.is_file():
        print(f"Input not found: {inp}", file=sys.stderr)
        return 1

    try:
        raw, enc_used = read_text_with_encoding(inp, args.encoding)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    if enc_used != "utf-8-sig" and enc_used != "utf-8":
        print(f"Read input as {enc_used!r}; writing output as UTF-8 with BOM for Shopify.")
    lines = raw.splitlines()
    if not lines:
        print("Empty file.", file=sys.stderr)
        return 1

    delim = detect_delimiter(lines[0])
    if delim == "\t":
        print("Note: detected tab-separated input; converting to comma-separated CSV.")

    # csv.reader needs newline="" file; use StringIO
    import io

    f = io.StringIO(raw)
    reader = csv.reader(f, delimiter=delim)
    rows = list(reader)
    if not rows:
        print("No rows parsed.", file=sys.stderr)
        return 1

    header = rows[0]
    if not header or (header[0] or "").strip() != "Handle":
        print(
            "First row does not start with Handle — not a valid Shopify header. "
            "Fix the source file or export again from Shopify.",
            file=sys.stderr,
        )
        return 1

    ncols = len(header)
    col = {name: i for i, name in enumerate(header)}

    fixed_qty = 0
    cleared_links = 0

    out_rows: list[list[str]] = [header]
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < ncols:
            row.append("")
        row = row[:ncols]

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

        out_rows.append(row)

    try:
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out_rows)
    except OSError as e:
        print(f"Could not write {out}: {e}", file=sys.stderr)
        return 1

    print(f"Wrote: {out}")
    print(f"Rows: {len(out_rows) - 1} (delimiter in: {delim!r})")
    print(f"Cleared {cleared_links} non-empty Option* Linked To cell(s).")
    print(f"Clamped {fixed_qty} negative {QTY_COL} value(s) to 0.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
