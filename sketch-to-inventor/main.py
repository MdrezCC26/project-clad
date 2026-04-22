"""sketch-to-inventor — convert a hand-drawn cladding profile to an Inventor
sheet-metal part (.ipt) and a dimensioned drawing (.idw).

Usage
-----
  python main.py  sketch_photo.jpg                     # full pipeline
  python main.py  sketch_photo.jpg --length 96          # 8-ft run length
  python main.py  --json extracted.json                 # skip vision, use JSON
  python main.py  sketch_photo.jpg --dry-run            # extract only, no Inventor
"""

import argparse
import json
import sys
from pathlib import Path

from config import DEFAULT_LENGTH_INCHES, DEFAULT_OUTPUT_DIR
from geometry import SketchData


def _print_summary(data: SketchData) -> None:
    length = data.length or DEFAULT_LENGTH_INCHES
    print()
    print("=" * 52)
    print("  EXTRACTED PROFILE DATA")
    print("=" * 52)
    print(f"  Gauge        : {data.gauge}  ({data.thickness_in:.4f}\")")
    print(f"  Colour       : {data.colour}")
    print(f"  Quantity     : {data.quantity}")
    print(f"  Painted Side : {data.painted_side}")
    print(f"  Inside R     : {data.inside_radius_in:.4f}\"  (1x thickness)")
    print(f"  Outside R    : {data.outside_radius_in:.4f}\"  (2x thickness)")
    print(f"  Run length   : {length}\"")
    print()
    print("  Segments:")
    for i, seg in enumerate(data.segments, 1):
        print(f"    {i}. {seg.direction:>5s}  {seg.length}\"")
    print()
    pts = data.profile_points_in()
    print("  Vertices (inches):")
    for j, (x, y) in enumerate(pts):
        print(f"    P{j}: ({x:.3f}, {y:.3f})")
    print()
    if data.job_name or data.order_number:
        print(f"  Job          : {data.job_name}")
        print(f"  Location     : {data.job_location}")
        print(f"  Order #      : {data.order_number}")
        print(f"  Date         : {data.date}")
        print(f"  Ordered by   : {data.ordered_by}")
        print()
    print("=" * 52)
    print()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Hand sketch → Inventor sheet-metal part + drawing")
    ap.add_argument("image", nargs="?", help="Path to sketch photo / scan")
    ap.add_argument("--json", dest="json_file",
                    help="JSON input (skip vision API)")
    ap.add_argument("--length", type=float, default=None,
                    help=f"Run / extrusion length in inches (default {DEFAULT_LENGTH_INCHES})")
    ap.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT_DIR),
                    help="Output directory")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="Drawing view scale (default 1.0)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Extract + display only — do not open Inventor")
    args = ap.parse_args()

    if not args.image and not args.json_file:
        ap.error("Provide a sketch image path or --json file")

    # ── step 1: extract profile data ─────────────────────────────────────────
    from sketch_reader import read_json, read_sketch

    if args.json_file:
        data = read_json(args.json_file)
        print(f"[reader] Loaded JSON: {args.json_file}")
    else:
        print(f"[reader] Analysing image: {args.image}")
        data = read_sketch(args.image)
        print("[reader] Extraction complete.")

    if args.length is not None:
        data.length = args.length

    _print_summary(data)

    if args.dry_run:
        out = Path(args.output)
        out.mkdir(parents=True, exist_ok=True)
        json_out = out / "extracted.json"
        with open(json_out, "w") as fh:
            json.dump({
                "gauge": data.gauge,
                "colour": data.colour,
                "quantity": data.quantity,
                "painted_side": data.painted_side,
                "segments": [{"direction": s.direction, "length": s.length}
                             for s in data.segments],
                "length": data.length,
                "job_location": data.job_location,
                "date": data.date,
                "job_name": data.job_name,
                "order_number": data.order_number,
                "ordered_by": data.ordered_by,
            }, fh, indent=2)
        print(f"[dry-run] Saved extracted data -> {json_out}")
        return

    # ── step 2: build Inventor part ──────────────────────────────────────────
    from inventor_part import connect_inventor, create_part

    app = connect_inventor()
    output_dir = Path(args.output)
    part_doc = create_part(app, data, output_dir)

    # ── step 3: build Inventor drawing ───────────────────────────────────────
    from inventor_drawing import create_drawing

    create_drawing(app, part_doc, data, output_dir, scale=args.scale)

    print()
    print("Done.  Files saved to:", output_dir.resolve())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
