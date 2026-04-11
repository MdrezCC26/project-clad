"""
Print Shopify Tags lines for Z######## parts: size label, part name, gauge, main dimension.

  Z BAR 6, Z BAR 6, 22 Gauge, 6 in

Main dimension = same numeric size as in the title (last 5 digits of SKU / 1000),
tagged as a plain inch value (e.g. 5.875 in). Gauge = digits 3–4 after Z.
Part name comes from a source CSV `Title` column matched by `Handle` (or `Variant SKU`)
when `--source-csv` is provided.

  python z_bar_tags.py
  python z_bar_tags.py --skus Z2206000 Z2205875
  python z_bar_tags.py --csv-out z_bar_tags.csv
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

DEFAULT_SKUS: list[str] = []
for g in (22, 20, 18, 16):
    for s in range(6000, 749, -125):
        DEFAULT_SKUS.append(f"Z{g}{s:05d}")


def _size_label_from_thousandths(thou: int) -> tuple[str, str]:
    """(Z BAR …, main dimension tag)."""
    v = thou / 1000.0
    if abs(v - round(v)) < 1e-9:
        plain = str(int(round(v)))
    else:
        plain = f"{v:.4f}".rstrip("0").rstrip(".")
    return f"Z BAR {plain}", f"{plain} in"


def load_part_name_map(source_csv: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    with source_csv.open(newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            title = (row.get("Title") or "").strip()
            if not title:
                continue
            handle = (row.get("Handle") or "").strip().lower()
            sku = (row.get("Variant SKU") or "").strip().upper()
            if handle and handle not in out:
                out[handle] = title
            if sku and sku not in out:
                out[sku] = title
    return out


def z_bar_tags(sku: str, part_name_map: dict[str, str] | None = None) -> str:
    sku_u = sku.strip().upper()
    m = re.match(r"^Z(\d{2})(\d{5})$", sku_u)
    if not m:
        return sku_u
    gauge = int(m.group(1))
    thou = int(m.group(2))
    bar, dim_in = _size_label_from_thousandths(thou)
    part_name = bar
    if part_name_map:
        part_name = part_name_map.get(sku_u) or part_name_map.get(sku_u.lower()) or bar
    return f"{bar}, {part_name}, {gauge} Gauge, {dim_in}"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Z part Shopify tags: size, part name, gauge, main dimension (in)"
    )
    ap.add_argument(
        "--skus",
        nargs="*",
        default=None,
        help="Part numbers (default: full Z22/Z20/Z18/Z16 grid 6000→0750)",
    )
    ap.add_argument(
        "--csv-out",
        type=Path,
        default=None,
        help="Write UTF-8 CSV: Handle (lowercase), Tags",
    )
    ap.add_argument(
        "--source-csv",
        type=Path,
        default=None,
        help="CSV with Handle/Variant SKU/Title to use real part names",
    )
    args = ap.parse_args()
    skus = args.skus if args.skus is not None else DEFAULT_SKUS
    part_name_map = load_part_name_map(args.source_csv) if args.source_csv else None

    rows: list[tuple[str, str]] = []
    for sku in skus:
        line = z_bar_tags(sku, part_name_map)
        rows.append((sku.strip().lower(), line))
        if args.csv_out is None:
            print(line)

    if args.csv_out is not None:
        with args.csv_out.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Handle", "Tags"])
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {args.csv_out}", file=sys.stderr)


if __name__ == "__main__":
    main()
