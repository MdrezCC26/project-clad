"""
Set Variant Price for Z parts from: **gauge**, per-gauge **Value**, and **Girth**.

**Girth (inches)** should match the drawing title block, not the size in the product
title. Example: handle `z2205625` is “Z BAR 5.625” in Shopify, but the PDF in
`…\\Z Bars\\PDF\\Z2205625.pdf` says `GIRTH: 8.6 in` — that **8.6** is what this
script uses when you pass `--pdf-dir`.

  pip install pypdf    # required for --pdf-dir

  python set_z_part_prices_gauge_value_girth.py --csv products_export.csv ^
    --pdf-dir "C:\\Users\\…\\DRAWINGS & MODELS\\Z Bars\\PDF" --dry-run

**Fallback** (no `--pdf-dir`): girth is parsed from the handle as five digits after
the two-digit gauge (`z2206000` → 6.000). That is only a rough stand-in if PDFs are
unavailable.

Gauge for the Value table comes from `Gauge (product.metafields.custom.gauge)` when
present (e.g. `22 Gauge`), otherwise from the two digits after `z` in the handle.

Default Value table:

  16 → 0.30   18 → 0.23   20 → 0.21   22 → 0.22   24 → 0.25   26 → 0.21

Formula (--formula; default is **value_girth_10**):

  value_girth_10     →  round(Value × Girth × 10, 2)   [current rule]
  gauge_value_girth  →  round(gauge × Value × Girth, 2)
  value_girth        →  round(Value × Girth, 2)

Gauge still selects **Value** from the table; it is only multiplied in gauge_value_girth.

Optional `--girth-csv` (columns part,girth): precomputed girth per handle (lowercase
z########); skips PDF parsing. Use after exporting once with a small helper or Excel.

Override gauge values: `--values-csv` with gauge,value columns.
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

PRICE_COL = "Variant Price"
GAUGE_METAFIELD_COL = "Gauge (product.metafields.custom.gauge)"

DEFAULT_VALUES: dict[int, float] = {
    16: 0.30,
    18: 0.23,
    20: 0.21,
    22: 0.22,
    24: 0.25,
    26: 0.21,
}

# z + 2-digit gauge + 5-digit girth in thousandths (06000 → 6.0)
Z_GIRTH_HANDLE_RE = re.compile(r"^z(\d{2})(\d{5})$", re.IGNORECASE)
GAUGE_FROM_META_RE = re.compile(r"^(\d{2})\s*gauge", re.IGNORECASE)


def parse_gauge_from_metafield(cell: str) -> int | None:
    s = (cell or "").strip()
    if not s:
        return None
    m = GAUGE_FROM_META_RE.match(s)
    if m:
        return int(m.group(1))
    m2 = re.match(r"^(\d{1,2})\b", s)
    if m2:
        g = int(m2.group(1))
        if 10 <= g <= 32:
            return g
    return None


def parse_handle_gauge_girth(handle: str) -> tuple[int, float] | None:
    h = (handle or "").strip()
    m = Z_GIRTH_HANDLE_RE.match(h)
    if not m:
        return None
    gauge = int(m.group(1))
    girth = int(m.group(2)) / 1000.0
    return gauge, girth


def _pdf_reader_cls():
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as e:
        raise SystemExit(
            "Reading girth from PDFs requires pypdf. Run: pip install pypdf"
        ) from e
    return PdfReader


GIRTH_LINE_RE = re.compile(r"GIRTH:\s*([\d.]+)\s*in", re.IGNORECASE)
PART_LINE_RE = re.compile(r"PART\s*#:\s*(Z\d+)", re.IGNORECASE)


def extract_text_from_pdf(path: Path, PdfReader: type) -> str:
    r = PdfReader(str(path))
    parts: list[str] = []
    for page in r.pages[:3]:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def load_girth_from_pdf_dir(pdf_dir: Path) -> dict[str, float]:
    """Map handle key (lowercase z########) → girth inches from Z*.pdf title blocks."""
    if not pdf_dir.is_dir():
        raise SystemExit(f"Not a directory: {pdf_dir}")
    PdfReader = _pdf_reader_cls()
    out: dict[str, float] = {}
    missing: list[str] = []
    for pdf in sorted(pdf_dir.glob("*.pdf")):
        stem = pdf.stem
        if not re.match(r"^Z\d+$", stem, re.I):
            continue
        key = stem.lower()
        try:
            text = extract_text_from_pdf(pdf, PdfReader)
        except Exception:
            missing.append(pdf.name)
            continue
        gm = GIRTH_LINE_RE.search(text)
        if not gm:
            missing.append(pdf.name)
            continue
        pm = PART_LINE_RE.search(text)
        if pm and pm.group(1).lower() != key:
            print(
                f"Warning: {pdf.name} PART# {pm.group(1)!r} != filename; using file key {key}",
                file=sys.stderr,
            )
        try:
            out[key] = float(gm.group(1))
        except ValueError:
            missing.append(pdf.name)
    print(f"Girth from PDFs: {len(out)} parts in {pdf_dir}")
    if missing:
        print(f"Could not parse GIRTH from {len(missing)} PDF(s) (see first 8):", file=sys.stderr)
        for name in missing[:8]:
            print(f"  {name}", file=sys.stderr)
    return out


def load_girth_csv(path: Path, encoding: str | None) -> dict[str, float]:
    raw, _ = read_text_with_encoding(path, encoding)
    delim = detect_delimiter(raw)
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if len(rows) < 2:
        raise SystemExit(f"No data in {path}")
    header = [c.strip().lower() for c in rows[0]]
    pi = next((i for i, h in enumerate(header) if h in ("part", "handle", "sku")), -1)
    gi = next((i for i, h in enumerate(header) if h == "girth"), -1)
    if pi < 0 or gi < 0:
        raise SystemExit(f"{path}: need columns part,girth (got {rows[0]!r})")
    out: dict[str, float] = {}
    for r in rows[1:]:
        if len(r) <= max(pi, gi):
            continue
        k = (r[pi] or "").strip().lower()
        try:
            g = float((r[gi] or "").strip().replace(",", ""))
        except ValueError:
            continue
        if k:
            out[k] = g
    if not out:
        raise SystemExit(f"No part,girth pairs in {path}")
    print(f"Loaded girth for {len(out)} parts from {path}")
    return out


def load_values_csv(path: Path, encoding: str | None) -> dict[int, float]:
    raw, _ = read_text_with_encoding(path, encoding)
    delim = detect_delimiter(raw)
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if len(rows) < 2:
        raise SystemExit(f"No data in {path}")
    header = [c.strip().lower() for c in rows[0]]
    gi = next((i for i, h in enumerate(header) if h in ("gauge", "ga", "g")), -1)
    vi = next((i for i, h in enumerate(header) if h in ("value", "price", "rate")), -1)
    if gi < 0 or vi < 0:
        raise SystemExit(f"{path}: need columns gauge,value (got {rows[0]!r})")
    out: dict[int, float] = {}
    for r in rows[1:]:
        if len(r) <= max(gi, vi):
            continue
        try:
            g = int(float((r[gi] or "").strip()))
            v = float((r[vi] or "").strip().replace("$", "").replace(",", ""))
        except ValueError:
            continue
        out[g] = v
    if not out:
        raise SystemExit(f"No gauge,value pairs in {path}")
    return out


def compute_price(
    formula: str,
    gauge: int,
    value: float,
    girth: float,
) -> float:
    if formula == "value_girth_10":
        raw = value * girth * 10
    elif formula == "gauge_value_girth":
        raw = gauge * value * girth
    elif formula == "value_girth":
        raw = value * girth
    else:
        raise ValueError(formula)
    return round(raw + 1e-12, 2)


def find_gauge_column(header: list[str]) -> int:
    for i, name in enumerate(header):
        if name == GAUGE_METAFIELD_COL or "custom.gauge" in name.lower():
            return i
    return -1


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Z-part Variant Price: Value×Girth×10 by default (see module docstring)"
    )
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument(
        "--formula",
        choices=("value_girth_10", "gauge_value_girth", "value_girth"),
        default="value_girth_10",
        help="value×girth×10 (default), gauge×value×girth, or value×girth",
    )
    ap.add_argument("--values-csv", type=Path, default=None, help="Override gauge→value table")
    ap.add_argument(
        "--pdf-dir",
        type=Path,
        default=None,
        help="Folder of Z########.pdf — read GIRTH (in) from title block (needs pypdf)",
    )
    ap.add_argument(
        "--girth-csv",
        type=Path,
        default=None,
        help="part,girth CSV (lowercase handle); overrides PDF dir if both set",
    )
    ap.add_argument(
        "--girth-fallback-handle",
        action="store_true",
        help="If PDF/girth-csv lacks a part, use 5-digit handle girth instead of skipping",
    )
    ap.add_argument("--encoding", default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    csv_path: Path = args.csv
    if not csv_path.is_file():
        raise SystemExit(f"CSV not found: {csv_path}")

    values = dict(DEFAULT_VALUES)
    if args.values_csv is not None:
        values = load_values_csv(args.values_csv, args.encoding)

    girth_map: dict[str, float] | None = None
    if args.girth_csv is not None:
        girth_map = load_girth_csv(args.girth_csv, args.encoding)
    elif args.pdf_dir is not None:
        girth_map = load_girth_from_pdf_dir(args.pdf_dir)

    raw, _ = read_text_with_encoding(csv_path, args.encoding)
    delim = detect_delimiter(raw)
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if not rows or (rows[0][0] or "").strip() != "Handle":
        raise SystemExit("CSV must start with Handle header.")

    header = rows[0]
    ncols = len(header)
    hi = header.index("Handle")
    try:
        vpi = header.index(PRICE_COL)
    except ValueError as e:
        raise SystemExit(f'Missing "{PRICE_COL}" column.') from e
    gauge_ci = find_gauge_column(header)

    missing_value_gauge: set[int] = set()
    missing_girth: list[str] = []
    bad_handle = 0
    updated = 0
    rows_priced = 0

    for r in rows[1:]:
        while len(r) < ncols:
            r.append("")
        handle = r[hi] if hi < len(r) else ""
        if not re.match(r"^z\d+$", (handle or "").strip(), re.I):
            continue

        parsed = parse_handle_gauge_girth(handle)
        if parsed is None:
            bad_handle += 1
            continue

        _hg, girth_from_handle = parsed
        hkey = (handle or "").strip().lower()
        girth: float | None = None
        if girth_map is not None:
            girth = girth_map.get(hkey)
            if girth is None and args.girth_fallback_handle:
                girth = girth_from_handle
            if girth is None:
                missing_girth.append(hkey)
                continue
        else:
            girth = girth_from_handle

        meta_g = (
            parse_gauge_from_metafield(r[gauge_ci])
            if gauge_ci >= 0 and gauge_ci < len(r)
            else None
        )
        gauge = meta_g if meta_g is not None else _hg

        val = values.get(gauge)
        if val is None:
            missing_value_gauge.add(gauge)
            continue

        price = compute_price(args.formula, gauge, val, girth)
        new_s = f"{price:.2f}"
        old = (r[vpi] or "").strip()
        if old != new_s:
            updated += 1
        r[vpi] = new_s
        rows_priced += 1

    z_like = sum(
        1
        for r in rows[1:]
        if len(r) > hi and re.match(r"^z\d+$", (r[hi] or "").strip(), re.I)
    )
    print(f"Z-style handles (any /^z\\d+$/): {z_like}")
    print(f"Rows priced: {rows_priced}")
    print(f"Z rows skipped (handle not zGGGGGGG): {bad_handle}")
    if missing_girth:
        print(f"Skipped (no girth for {len(missing_girth)} handles):", file=sys.stderr)
        for h in missing_girth[:12]:
            print(f"  {h}", file=sys.stderr)
        if len(missing_girth) > 12:
            print("  …", file=sys.stderr)
    print(f"Rows with Variant Price change: {updated}")
    if missing_value_gauge:
        print(
            f"Skipped (no Value for gauge): {sorted(missing_value_gauge)}",
            file=sys.stderr,
        )

    if args.dry_run:
        return

    if args.in_place:
        out_path = csv_path
        bak = csv_path.with_suffix(csv_path.suffix + ".bak")
        shutil.copy2(csv_path, bak)
        print(f"Backup: {bak}")
    elif args.out:
        out_path = args.out
    else:
        out_path = csv_path.with_name(csv_path.stem + "_gauge_priced.csv")

    newline = "\r\n" if "\r\n" in raw else "\n"
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator=newline).writerows(rows)
    print(f"Wrote: {out_path}")
    print("Import: Shopify Admin → Products → Import.")


if __name__ == "__main__":
    main()
