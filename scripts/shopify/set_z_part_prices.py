"""
Set Variant Price (and optionally Variant Compare At Price) for Z part products in a
Shopify **product export** CSV (Admin → Products → Export).

A row counts as a Z part if **Handle** matches /^z\\d+$/i (e.g. z2206000, Z1600750).

Usage — same price for every Z part:
  python set_z_part_prices.py --csv "C:\\Users\\...\\products_export.csv" --price 9.99 --in-place

Usage — per-part prices (UTF-8 CSV: part,price  OR  handle,price  OR  sku,price):
  python set_z_part_prices.py --csv products_export.csv --prices z_prices.csv --in-place

Optional:
  --compare-at 12.99          (with --price only; same compare-at for all Z rows)
  --dry-run                   print how many rows would change, no write
  --encoding                  passed to read_text_with_encoding
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import shutil
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from fix_shopify_product_csv import detect_delimiter, read_text_with_encoding

Z_HANDLE_RE = re.compile(r"^z\d+$", re.IGNORECASE)

PRICE_COL = "Variant Price"
COMPARE_COL = "Variant Compare At Price"


def is_z_handle(handle: str) -> bool:
    h = (handle or "").strip()
    return bool(Z_HANDLE_RE.match(h))


def normalize_key(s: str) -> str:
    return (s or "").strip().lower()


def load_price_map(path: Path, encoding: str | None) -> dict[str, str]:
    raw, _ = read_text_with_encoding(path, encoding)
    delim = detect_delimiter(raw)
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if len(rows) < 2:
        raise SystemExit(f"No data rows in {path}")
    header = [c.strip().lower() for c in rows[0]]
    key_aliases = ("handle", "part", "sku", "variant sku")
    price_aliases = ("price", "variant price")

    def pick(candidates: tuple[str, ...]) -> int:
        for name in candidates:
            if name in header:
                return header.index(name)
        return -1

    ki = pick(key_aliases)
    pi = pick(price_aliases)
    if ki < 0 or pi < 0:
        print(
            "Prices CSV needs two columns, headers like: part,price  or handle,variant price",
            file=sys.stderr,
        )
        raise SystemExit(f"Bad header in {path}: {rows[0]!r}")

    out: dict[str, str] = {}
    for r in rows[1:]:
        if len(r) <= max(ki, pi):
            continue
        k = normalize_key(r[ki])
        p = (r[pi] or "").strip()
        if k and p:
            out[k] = p
    if not out:
        raise SystemExit(f"No part,price pairs parsed from {path}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Set Variant Price for Z######## handles in Shopify product CSV")
    ap.add_argument("--csv", type=Path, required=True, help="Shopify products_export*.csv")
    ap.add_argument("--encoding", default=None, help="Force encoding (else auto-detect)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--price", type=str, help="One price for all Z rows (e.g. 9.99)")
    g.add_argument("--prices", type=Path, help="CSV mapping part → price (see docstring)")
    ap.add_argument(
        "--compare-at",
        type=str,
        default=None,
        help="Variant Compare At Price for all Z rows (only with --price)",
    )
    ap.add_argument("--out", type=Path, default=None, help="Output path (default: *_priced.csv)")
    ap.add_argument("--in-place", action="store_true", help="Overwrite --csv (writes .bak first)")
    ap.add_argument("--dry-run", action="store_true", help="Print stats only")
    args = ap.parse_args()

    if args.compare_at is not None and args.prices is not None:
        print("--compare-at is only supported with --price (not with --prices).", file=sys.stderr)
        sys.exit(2)

    csv_path: Path = args.csv
    if not csv_path.is_file():
        raise SystemExit(f"CSV not found: {csv_path}")

    raw, _enc = read_text_with_encoding(csv_path, args.encoding)
    delim = detect_delimiter(raw)
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if not rows or (rows[0][0] or "").strip() != "Handle":
        raise SystemExit('CSV must start with a Handle column header.')

    header = rows[0]
    try:
        hi = header.index("Handle")
    except ValueError as e:
        raise SystemExit("CSV has no Handle column.") from e
    try:
        vpi = header.index(PRICE_COL)
    except ValueError as e:
        raise SystemExit(f'CSV has no "{PRICE_COL}" column.') from e
    ci = header.index(COMPARE_COL) if COMPARE_COL in header else -1

    sku_i = header.index("Variant SKU") if "Variant SKU" in header else -1

    single_price = args.price.strip() if args.price else None
    compare_val = args.compare_at.strip() if args.compare_at else None
    price_map: dict[str, str] | None = None
    if args.prices is not None:
        price_map = load_price_map(args.prices, args.encoding)

    changed = 0
    skipped_no_map = 0
    z_rows = 0

    for r in rows[1:]:
        if len(r) <= hi:
            continue
        handle = r[hi] if hi < len(r) else ""
        if not is_z_handle(handle):
            continue
        z_rows += 1
        key = normalize_key(handle)
        if price_map is not None:
            sku_key = normalize_key(r[sku_i]) if sku_i >= 0 and sku_i < len(r) else ""
            new_p = price_map.get(key) or (price_map.get(sku_key) if sku_key else None)
            if new_p is None:
                skipped_no_map += 1
                continue
        else:
            new_p = single_price
        assert new_p is not None

        while len(r) <= vpi:
            r.append("")
        old = (r[vpi] or "").strip()
        if old != new_p.strip():
            changed += 1
        r[vpi] = new_p

        if compare_val is not None and ci >= 0:
            while len(r) <= ci:
                r.append("")
            r[ci] = compare_val

    print(f"Z-part rows: {z_rows}")
    print(f"Rows with price change: {changed}")
    if price_map is not None:
        print(f"Z rows missing from --prices file (unchanged): {skipped_no_map}")

    if args.dry_run:
        return

    ncols = len(header)
    for r in rows[1:]:
        while len(r) < ncols:
            r.append("")

    if args.in_place:
        out_path = csv_path
        bak = csv_path.with_suffix(csv_path.suffix + ".bak")
        shutil.copy2(csv_path, bak)
        print(f"Backup: {bak}")
    elif args.out:
        out_path = args.out
    else:
        out_path = csv_path.with_name(csv_path.stem + "_priced.csv")

    newline = "\r\n" if "\r\n" in raw else "\n"
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator=newline).writerows(rows)
    print(f"Wrote: {out_path}")
    print("Re-import in Shopify Admin → Products → Import (same CSV format).")


if __name__ == "__main__":
    main()
