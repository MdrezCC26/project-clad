"""Create an Inventor sheet-metal part (.ipt) from extracted profile data.

Uses the Inventor COM API via pywin32.  Requires Inventor to be installed.
"""

import time
from pathlib import Path

import win32com.client  # type: ignore

from config import (
    DEFAULT_LENGTH_INCHES,
    INCHES_TO_CM,
    K_HORIZONTAL_DIM,
    K_IMPERIAL,
    K_PART_DOC,
    K_SHEET_METAL_SUBTYPE,
    K_VERTICAL_DIM,
)
from geometry import SketchData


# ── helpers ───────────────────────────────────────────────────────────────────

def connect_inventor():
    """Return a reference to a running Inventor instance, or launch one."""
    try:
        app = win32com.client.GetActiveObject("Inventor.Application")
        print("[inventor] Connected to running instance.")
    except Exception:
        print("[inventor] Launching Inventor -- this may take a minute ...")
        app = win32com.client.Dispatch("Inventor.Application")
        app.Visible = True
        time.sleep(8)
        print("[inventor] Inventor is ready.")
    return app


def _get_template(app, subtype: str | None = None) -> str:
    """Try to locate a suitable part template; return '' as last resort."""
    for st in (subtype, None):
        try:
            args = [K_PART_DOC, K_IMPERIAL]
            if st:
                args += [None, st]
            return app.FileManager.GetTemplateFile(*args)
        except Exception:
            continue
    return ""


# ── main entry point ─────────────────────────────────────────────────────────

def create_part(app, data: SketchData, output_dir: Path) -> object:
    """Build a sheet-metal .ipt from *data* and save it.

    Returns the PartDocument COM object (kept open so the drawing step can
    reference it).
    """
    tg = app.TransientGeometry

    # ── 1. new document ──────────────────────────────────────────────────────
    template = _get_template(app, K_SHEET_METAL_SUBTYPE)
    part_doc = app.Documents.Add(K_PART_DOC, template, True)
    comp_def = part_doc.ComponentDefinition
    print(f"[part] Created new part (template: {'sheet-metal' if template else 'default'})")

    # ── 2. sheet-metal style ─────────────────────────────────────────────────
    try:
        style = comp_def.ActiveSheetMetalStyle
        style.Thickness.Value = data.thickness_cm
        style.BendRadius.Value = data.inside_radius_cm
        style.Save()
        print(f"[part] Sheet-metal style: {data.gauge} ga "
              f"({data.thickness_in:.4f}\"), bend R = {data.inside_radius_in:.4f}\"")
    except Exception:
        print("[part] Could not set sheet-metal style (will set via feature).")

    # ── 3. sketch on XY plane ────────────────────────────────────────────────
    xy_plane = comp_def.WorkPlanes.Item(3)
    sketch = comp_def.Sketches.Add(xy_plane)
    points_cm = data.profile_points_cm()

    lines = []
    for i in range(len(points_cm) - 1):
        if i == 0:
            p1 = tg.CreatePoint2d(points_cm[0][0], points_cm[0][1])
            p2 = tg.CreatePoint2d(points_cm[1][0], points_cm[1][1])
            line = sketch.SketchLines.AddByTwoPoints(p1, p2)
        else:
            p2 = tg.CreatePoint2d(points_cm[i + 1][0], points_cm[i + 1][1])
            line = sketch.SketchLines.AddByTwoPoints(lines[-1].EndSketchPoint, p2)
        lines.append(line)

    print(f"[part] Drew {len(lines)} line segment(s).")

    # ── 4. geometric constraints ─────────────────────────────────────────────
    sketch.GeometricConstraints.AddGround(lines[0].StartSketchPoint)
    for line, seg in zip(lines, data.segments):
        if seg.is_horizontal:
            sketch.GeometricConstraints.AddHorizontal(line)
        else:
            sketch.GeometricConstraints.AddVertical(line)

    # ── 5. dimension constraints ─────────────────────────────────────────────
    dim_offset_cm = 1.5
    for line, seg in zip(lines, data.segments):
        sp = line.StartSketchPoint
        ep = line.EndSketchPoint
        mx = (sp.Geometry.X + ep.Geometry.X) / 2
        my = (sp.Geometry.Y + ep.Geometry.Y) / 2
        if seg.is_horizontal:
            tp = tg.CreatePoint2d(mx, my + dim_offset_cm)
            sketch.DimensionConstraints.AddTwoPointDistance(
                sp, ep, K_HORIZONTAL_DIM, tp)
        else:
            tp = tg.CreatePoint2d(mx + dim_offset_cm, my)
            sketch.DimensionConstraints.AddTwoPointDistance(
                sp, ep, K_VERTICAL_DIM, tp)

    print("[part] Sketch fully constrained.")

    # ── 6. contour flange (3-D feature) ──────────────────────────────────────
    length_in = data.length or DEFAULT_LENGTH_INCHES
    length_cm = length_in * INCHES_TO_CM
    feature_ok = False

    try:
        path = comp_def.Features.CreatePath(lines[0])
        cf_features = comp_def.Features.ContourFlangeFeatures
        cf_def = cf_features.CreateContourFlangeDefinition(path)

        try:
            cf_def.Thickness.Value = data.thickness_cm
        except Exception:
            pass
        try:
            cf_def.BendRadius.Value = data.inside_radius_cm
        except Exception:
            pass

        # Symmetric width (extrusion length) from sketch plane
        try:
            cf_def.SetSymmetricExtent(length_cm / 2, True)
        except Exception:
            try:
                cf_def.Width.Expression = f"{length_in} in"
            except Exception:
                pass

        cf_features.Add(cf_def)
        feature_ok = True
        print(f"[part] Contour Flange created — length {length_in}\".")
    except Exception as exc:
        print(f"[part] Contour Flange failed ({exc}).")

    if not feature_ok:
        print("[part] Sketch is ready — create the Contour Flange manually in Inventor.")

    # ── 7. save ──────────────────────────────────────────────────────────────
    output_dir.mkdir(parents=True, exist_ok=True)
    name = data.order_number.strip().replace(" ", "_") or "part"
    ipt_path = output_dir / f"{name}.ipt"
    part_doc.SaveAs(str(ipt_path), False)
    print(f"[part] Saved -> {ipt_path}")

    return part_doc
