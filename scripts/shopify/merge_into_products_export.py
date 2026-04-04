"""
Append rows from CCProducts_IMPORT_READY.csv into products_export.csv.
- Keeps products_export.csv header and column order exactly (no column switching).
- Appends Z-bar handles (z + 7 digits) from IMPORT that are not already in the export.
  Use --all-missing-handles to append every missing handle (full catalog diff).
- Backs up products_export.csv to products_export.csv.bak before writing.
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

DEFAULT_EXPORT = Path(r"C:\Users\Micha\Desktop\products_export.csv")
_IMPORT_CANDIDATES = (
    Path(r"C:\Users\Micha\Desktop\CCProducts_IMPORT_READY.csv"),
    Path(r"C:\Users\Micha\Desktop\New folder\CCProducts_IMPORT_READY.csv"),
)


def resolve_import_csv(explicit: Path | None) -> Path | None:
    if explicit is not None and explicit.is_file():
        return explicit
    for p in _IMPORT_CANDIDATES:
        if p.is_file():
            return p
    return None


def parse_csv(path: Path, encoding: str | None) -> tuple[list[str], list[list[str]], str]:
    raw, enc_used = read_text_with_encoding(path, encoding)
    lines = raw.splitlines()
    if not lines:
        raise ValueError(f"Empty: {path}")
    delim = detect_delimiter(lines[0])
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if not rows:
        raise ValueError(f"No rows: {path}")
    return rows[0], rows[1:], enc_used


def row_dict(header: list[str], row: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i, name in enumerate(header):
        out[name] = row[i] if i < len(row) else ""
    return out


def align_to_header(dst_header: list[str], src_header: list[str], row: list[str]) -> list[str]:
    """Map source row onto destination column order by header name."""
    src = row_dict(src_header, row)
    return [src.get(col, "") for col in dst_header]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", type=Path, default=DEFAULT_EXPORT, help="Target CSV (header kept)")
    ap.add_argument(
        "--import-csv",
        type=Path,
        default=None,
        dest="import_csv",
        help="Source of new rows (default: CCProducts_IMPORT_READY on Desktop or Desktop/New folder)",
    )
    ap.add_argument("--encoding", default=None, metavar="ENC")
    ap.add_argument(
        "--all-missing-handles",
        action="store_true",
        help="Append every handle from IMPORT missing in export (default: only z+7digit Z-bar handles)",
    )
    args = ap.parse_args()

    exp_path: Path = args.export
    imp_path = resolve_import_csv(args.import_csv)

    if not exp_path.is_file():
        print(f"Export file not found: {exp_path}", file=sys.stderr)
        return 1
    if imp_path is None:
        print("Import source not found. Tried:", file=sys.stderr)
        for p in _IMPORT_CANDIDATES:
            print(f"  {p}", file=sys.stderr)
        print("Run build_ccproducts_import_ready.py or pass --import-csv", file=sys.stderr)
        return 1

    try:
        dst_header, exp_rows, _ = parse_csv(exp_path, args.encoding)
        src_header, imp_rows, _ = parse_csv(imp_path, args.encoding)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1

    if dst_header[0].strip() != "Handle" or src_header[0].strip() != "Handle":
        print("Expected Handle in column A.", file=sys.stderr)
        return 1

    dst_set = set(dst_header)
    src_set = set(src_header)
    if dst_set != src_set:
        missing_in_src = dst_set - src_set
        missing_in_dst = src_set - dst_set
        if missing_in_src:
            print("Column names in export missing from import:", file=sys.stderr)
            for n in sorted(missing_in_src):
                print(f"  {n}", file=sys.stderr)
        if missing_in_dst:
            print("Column names in import missing from export:", file=sys.stderr)
            for n in sorted(missing_in_dst):
                print(f"  {n}", file=sys.stderr)
        print("Merging by matching column names; empty string for missing.", file=sys.stderr)

    existing = {(r[0] or "").strip().lower() for r in exp_rows if r and (r[0] or "").strip()}
    zpat = re.compile(r"^z\d{7}$", re.IGNORECASE)

    to_add: list[list[str]] = []
    for row in imp_rows:
        if not row or not (row[0] or "").strip():
            continue
        h = (row[0] or "").strip()
        key = h.lower()
        if key in existing:
            continue
        if not args.all_missing_handles and not zpat.match(key):
            continue
        aligned = align_to_header(dst_header, src_header, row)
        while len(aligned) < len(dst_header):
            aligned.append("")
        aligned = aligned[: len(dst_header)]
        to_add.append(aligned)
        existing.add(key)

    if not to_add:
        print(f"Import file used: {imp_path}")
        print(
            "No new Z-bar handles to append (all z+7digit handles from that file are already in the export)."
        )
        print("If you expected new rows, check --import-csv or rebuild CCProducts_IMPORT_READY.csv.")
        return 0

    bak = exp_path.with_suffix(exp_path.suffix + ".bak")
    shutil.copy2(exp_path, bak)

    out_rows = [dst_header] + exp_rows + to_add
    try:
        with exp_path.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(out_rows)
    except OSError as e:
        print(f"Could not write {exp_path}: {e}", file=sys.stderr)
        return 1

    print(f"Backup: {bak}")
    print(f"Appended {len(to_add)} row(s) to {exp_path}")
    print(f"Total data rows: {len(exp_rows) + len(to_add)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
