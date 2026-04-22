"""Create an Inventor drawing (.idw) with views, dimensions, and job notes.

Uses the Inventor COM API via pywin32.
"""

from pathlib import Path

from config import (
    INCHES_TO_CM,
    K_DRAWING_DOC,
    K_FRONT_VIEW,
    K_HIDDEN_LINE_REMOVED,
    K_IMPERIAL,
    K_ISO_TOP_RIGHT,
    K_RIGHT_VIEW,
    K_SHADED,
)
from geometry import SketchData


def _get_template(app) -> str:
    try:
        return app.FileManager.GetTemplateFile(K_DRAWING_DOC, K_IMPERIAL)
    except Exception:
        return ""


def create_drawing(
    app,
    part_doc,
    data: SketchData,
    output_dir: Path,
    scale: float = 1.0,
) -> object:
    """Build a dimensioned .idw for *part_doc* and save it.

    Returns the DrawingDocument COM object.
    """
    tg = app.TransientGeometry

    # ── 1. new drawing document ──────────────────────────────────────────────
    template = _get_template(app)
    draw_doc = app.Documents.Add(K_DRAWING_DOC, template, True)
    sheet = draw_doc.ActiveSheet
    sw = sheet.Width    # cm
    sh = sheet.Height   # cm
    print(f"[drawing] New drawing - sheet {sw / INCHES_TO_CM:.0f}\" x {sh / INCHES_TO_CM:.0f}\"")

    # ── 2. base view (front – shows profile cross-section) ───────────────────
    base_pos = tg.CreatePoint2d(sw * 0.30, sh * 0.50)
    try:
        base_view = sheet.DrawingViews.AddBaseView(
            part_doc, base_pos, scale,
            K_FRONT_VIEW, K_HIDDEN_LINE_REMOVED)
        print("[drawing] Placed base view (front).")
    except Exception as exc:
        print(f"[drawing] Base view failed ({exc}); trying without style …")
        base_view = sheet.DrawingViews.AddBaseView(
            part_doc, base_pos, scale, K_FRONT_VIEW)

    # ── 3. projected views ───────────────────────────────────────────────────
    try:
        right_pos = tg.CreatePoint2d(sw * 0.65, sh * 0.50)
        sheet.DrawingViews.AddProjectedView(base_view, right_pos, K_HIDDEN_LINE_REMOVED)
        print("[drawing] Placed projected view (right).")
    except Exception:
        pass

    try:
        iso_pos = tg.CreatePoint2d(sw * 0.65, sh * 0.80)
        sheet.DrawingViews.AddBaseView(
            part_doc, iso_pos, scale * 0.5,
            K_ISO_TOP_RIGHT, K_SHADED)
        print("[drawing] Placed isometric view.")
    except Exception:
        pass

    # ── 4. retrieve model dimensions into the front view ─────────────────────
    _retrieve_dims(base_view)

    # ── 5. job-info notes ────────────────────────────────────────────────────
    _add_notes(sheet, tg, data, sw, sh)

    # ── 6. flat pattern view (best-effort) ───────────────────────────────────
    try:
        flat_pos = tg.CreatePoint2d(sw * 0.30, sh * 0.15)
        flat_view = sheet.DrawingViews.AddBaseView(
            part_doc, flat_pos, scale,
            K_FRONT_VIEW, K_HIDDEN_LINE_REMOVED, "Flat Pattern")
        print("[drawing] Placed flat-pattern view.")
    except Exception:
        pass

    # ── 7. save ──────────────────────────────────────────────────────────────
    output_dir.mkdir(parents=True, exist_ok=True)
    name = data.order_number.strip().replace(" ", "_") or "part"
    idw_path = output_dir / f"{name}.idw"
    draw_doc.SaveAs(str(idw_path), False)
    print(f"[drawing] Saved -> {idw_path}")

    return draw_doc


# ── internal helpers ─────────────────────────────────────────────────────────

def _retrieve_dims(view) -> None:
    """Try several Inventor API patterns to pull model dims into the view."""
    for method_name in ("RetrieveModelDimensions", "RetrieveDimensions"):
        try:
            getattr(view, method_name)()
            print("[drawing] Retrieved model dimensions.")
            return
        except Exception:
            continue

    # Manual fallback: iterate retrievable dimensions
    try:
        dims = view.GetRetrievableModelDimensions()
        if dims:
            for d in dims:
                try:
                    d.Retrieve(view)
                except Exception:
                    pass
            print(f"[drawing] Retrieved {dims.Count} dimension(s) individually.")
            return
    except Exception:
        pass

    print("[drawing] Could not auto-retrieve dimensions — add them manually.")


def _add_notes(sheet, tg, data: SketchData, sw: float, sh: float) -> None:
    """Add a text block with order / job metadata."""
    lines = [
        f"Gauge: {data.gauge}   Colour: {data.colour}   Qty: {data.quantity}",
        f"Painted Side: {data.painted_side}",
        f"Inside R: {data.inside_radius_in:.4f}\"   "
        f"Outside R: {data.outside_radius_in:.4f}\"",
    ]
    if data.job_name:
        lines.append(f"Job: {data.job_name}")
    if data.job_location:
        lines.append(f"Location: {data.job_location}")
    if data.order_number:
        lines.append(f"Order #: {data.order_number}")
    if data.date:
        lines.append(f"Date: {data.date}")

    text = "\n".join(lines)
    pos = tg.CreatePoint2d(sw * 0.02, sh * 0.12)

    try:
        sheet.DrawingNotes.GeneralNotes.AddFitted(pos, text)
        print("[drawing] Added job-info note.")
    except Exception:
        try:
            sheet.DrawingNotes.GeneralNotes.Add(pos, text)
            print("[drawing] Added job-info note (alt method).")
        except Exception as exc:
            print(f"[drawing] Could not add notes ({exc}).")
