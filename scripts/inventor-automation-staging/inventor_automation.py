"""
Inventor COM Automation Interface

Wraps win32com.client calls to Autodesk Inventor for parametric part
generation, export of flat-pattern DXF, shop-drawing PDF, and PNG thumbnail.

All dimensions passed to Inventor are in centimetres (1 inch = 2.54 cm).
All angles are in radians.
"""

from __future__ import annotations

import os
import math
import tempfile
import traceback
from dataclasses import dataclass, field
from typing import Callable, Optional

# pywin32 is only available on Windows with Inventor installed.
# We guard imports so the module can at least be imported on other platforms.
try:
    import win32com.client
    import pythoncom
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False


# ──────────────────────────────────────────────
#  Data Classes
# ──────────────────────────────────────────────

@dataclass
class PartParameters:
    """All parameters required to generate one cladding profile part."""

    template_name: str
    part_file:     str          # Full path to .ipt Inventor part template
    drawing_file:  str          # Full path to .idw Inventor drawing template
    profile_code:  str          # Short code, e.g. "Z", "C", "U"

    # Geometry (inches)
    L1:           float = 3.0   # Flange 1 length
    L2:           float = 6.0   # Web height
    L3:           float = 3.0   # Flange 3 length
    A1:           float = 90.0  # Bend angle 1 (degrees)
    A2:           float = 90.0  # Bend angle 2 (degrees)
    gauge:        int   = 16    # Sheet metal gauge
    total_length: float = 120.0 # Full part length (inches)

    @property
    def part_number(self) -> str:
        """
        Generate part number.

        Format: {ProfileCode}{Gauge:02d}00{L1_thou}
        Example: Z1600750  →  Z-bar, 16 ga, L1 = 0.750″
                 C2001625  →  C-channel, 20 ga, L1 = 1.625″
        L1_thou is L1 × 1000, no fixed width (drops leading zeros).
        """
        thou = int(round(self.L1 * 1000))
        return f"{self.profile_code}{self.gauge:02d}00{thou}"

    @property
    def thickness_inches(self) -> float:
        """Approximate sheet thickness for common gauges (inches)."""
        gauge_map = {
            14: 0.0747, 16: 0.0598, 18: 0.0478,
            20: 0.0359, 22: 0.0299,
        }
        return gauge_map.get(self.gauge, 0.0598)

    # ── Unit Conversions ─────────────────────────

    def to_cm(self, inches: float) -> float:
        """Convert inches to centimetres (Inventor internal unit)."""
        return inches * 2.54

    def to_rad(self, degrees: float) -> float:
        """Convert degrees to radians."""
        return degrees * math.pi / 180.0


@dataclass
class GenerationResult:
    """Result of generating a single part."""

    part_number: str
    success:     bool
    message:     str  = ""
    pdf_path:    str  = ""
    dxf_path:    str  = ""
    png_path:    str  = ""
    weight_kg:   float = 0.0


# ──────────────────────────────────────────────
#  Inventor Automation
# ──────────────────────────────────────────────

class InventorAutomation:
    """
    Thin wrapper around the Autodesk Inventor COM API.

    Usage
    -----
        auto = InventorAutomation(log_callback=print)
        if auto.connect():
            result = auto.generate_part(params, output_dir, ...)
            auto.disconnect()
    """

    def __init__(self, log_callback: Optional[Callable[[str], None]] = None,
                 visible: bool = False):
        self._log   = log_callback or (lambda msg: None)
        self._visible = visible
        self._app   = None   # Inventor Application COM object

    # ── Connection ────────────────────────────────

    def connect(self) -> bool:
        """Attach to a running Inventor instance or launch a new one."""
        if not HAS_WIN32:
            self._log("❌ pywin32 not installed — cannot connect to Inventor.")
            return False

        pythoncom.CoInitialize()
        try:
            # Try to grab an existing running instance first
            try:
                self._app = win32com.client.GetActiveObject("Inventor.Application")
                self._log("✓ Connected to existing Inventor session.")
            except Exception:
                # Not running → launch a new instance
                self._log("  Launching Autodesk Inventor…")
                self._app = win32com.client.Dispatch("Inventor.Application")
                self._app.Visible = self._visible

            return True

        except Exception as exc:
            self._log(f"❌ Failed to connect to Inventor: {exc}")
            return False

    def disconnect(self):
        """Release the COM reference."""
        self._app = None
        if HAS_WIN32:
            pythoncom.CoUninitialize()
        self._log("  Inventor COM released.")

    # ── Core Generation ───────────────────────────

    def generate_part(
        self,
        params:     PartParameters,
        output_dir: str,
        export_pdf: bool = True,
        export_dxf: bool = True,
        export_png: bool = True,
    ) -> GenerationResult:
        """
        Open the parametric template, apply dimensions, and export files.

        Returns a GenerationResult regardless of success/failure.
        """
        result = GenerationResult(part_number=params.part_number, success=False)

        try:
            # 1. Validate template files
            if not os.path.isfile(params.part_file):
                raise FileNotFoundError(f"Part template not found: {params.part_file}")

            # 2. Open part template (do NOT save over original)
            self._log(f"  Opening template: {os.path.basename(params.part_file)}")
            part_doc = self._open_document(params.part_file)

            # 3. Set parameters
            self._log("  Setting parameters…")
            self._set_parameters(part_doc, params)

            # 4. Update model
            self._log("  Updating geometry…")
            part_doc.Update()

            # 5. Read mass properties
            try:
                mass = part_doc.ComponentDefinition.MassProperties.Mass
                # Inventor returns mass in kg
                result.weight_kg = round(mass, 3)
                self._log(f"  Weight: {result.weight_kg} kg")
            except Exception:
                self._log("  (Could not read mass properties)")

            # 6. Ensure output directory exists
            os.makedirs(output_dir, exist_ok=True)
            base_name = os.path.join(output_dir, params.part_number)

            # 7. Exports
            if export_dxf:
                result.dxf_path = self._export_dxf(part_doc, f"{base_name}.dxf")
                if result.dxf_path:
                    self._log(f"  ✓ DXF: {os.path.basename(result.dxf_path)}")

            if export_png:
                result.png_path = self._export_png(part_doc, f"{base_name}.png")
                if result.png_path:
                    self._log(f"  ✓ PNG: {os.path.basename(result.png_path)}")

            if export_pdf:
                if os.path.isfile(params.drawing_file):
                    result.pdf_path = self._export_pdf_from_drawing(
                        params.drawing_file, part_doc, f"{base_name}.pdf"
                    )
                else:
                    # Fallback: export PDF directly from the part
                    result.pdf_path = self._export_pdf_from_part(
                        part_doc, f"{base_name}.pdf"
                    )
                if result.pdf_path:
                    self._log(f"  ✓ PDF: {os.path.basename(result.pdf_path)}")

            # 8. Close without saving (preserve template)
            part_doc.Close(SkipSave=True)
            result.success = True
            result.message = "OK"

        except FileNotFoundError as exc:
            result.message = str(exc)
            self._log(f"  ❌ {exc}")
        except Exception as exc:
            result.message = str(exc)
            self._log(f"  ❌ Unexpected error: {exc}")
            self._log(traceback.format_exc())

        return result

    # ── Document Helpers ──────────────────────────

    def _open_document(self, path: str):
        """Open a document and return the Document COM object."""
        return self._app.Documents.Open(path)

    def _set_parameters(self, part_doc, params: PartParameters):
        """
        Write dimension values into the part's parametric table.

        Inventor parameters are accessed by name via
        ComponentDefinition.Parameters.  Units: cm for length, radians for angles.
        """
        p = part_doc.ComponentDefinition.Parameters

        def set_param(name: str, value: float, unit: str = "cm"):
            """Attempt to set a named parameter; log a warning if not found."""
            try:
                param = p.Item(name)
                param.Expression = f"{value} {unit}"
            except Exception:
                self._log(f"  ⚠ Parameter '{name}' not found in template — skipped.")

        # Lengths (inches → cm)
        set_param("L1",          params.to_cm(params.L1))
        set_param("L2",          params.to_cm(params.L2))
        set_param("L3",          params.to_cm(params.L3))
        set_param("TotalLength", params.to_cm(params.total_length))
        set_param("Thickness",   params.to_cm(params.thickness_inches))

        # Angles (degrees → radians, unit = "rad")
        set_param("A1", params.to_rad(params.A1), "rad")
        set_param("A2", params.to_rad(params.A2), "rad")

    # ── Export Helpers ────────────────────────────

    def _export_dxf(self, part_doc, out_path: str) -> str:
        """
        Export the flat pattern as a DXF file.

        Inventor requires the active browser to be set to the flat pattern
        before calling the DXF exporter.
        """
        try:
            comp_def = part_doc.ComponentDefinition

            # Activate flat pattern
            flat_def = comp_def.FlatPattern
            if flat_def is None:
                # Try to create flat pattern if not present
                comp_def.Unfold()
                flat_def = comp_def.FlatPattern

            # Use the DataIO interface to export DXF
            data_io = part_doc.ComponentDefinition.DataIO
            # DXF export context string for flat pattern
            # "FlatPattern DXF" is the Inventor-supplied translator ID
            data_io.WriteDataToFile("FlatPattern DXF", out_path)
            return out_path if os.path.isfile(out_path) else ""
        except Exception as exc:
            self._log(f"  ⚠ DXF export failed: {exc}")
            return ""

    def _export_png(self, part_doc, out_path: str) -> str:
        """Save a rendered PNG thumbnail of the 3D part."""
        try:
            # Inventor's SaveAs with a PNG extension triggers the image exporter
            part_doc.SaveAs(out_path, SaveCopyAs=True)
            return out_path if os.path.isfile(out_path) else ""
        except Exception as exc:
            self._log(f"  ⚠ PNG export failed (trying camera capture): {exc}")
            try:
                # Alternative: capture the active viewport
                camera = self._app.ActiveView.Camera
                camera.SaveAsBitmap(out_path, 512, 512)
                return out_path if os.path.isfile(out_path) else ""
            except Exception as exc2:
                self._log(f"  ⚠ PNG capture also failed: {exc2}")
                return ""

    def _export_pdf_from_drawing(self, drawing_file: str, part_doc, out_path: str) -> str:
        """
        Open the linked .idw drawing template and print/export to PDF.

        The drawing template must reference the same part so that it
        automatically picks up the updated geometry.
        """
        try:
            drawing_doc = self._app.Documents.Open(drawing_file)
            # Update drawing to reflect latest part geometry
            drawing_doc.Update()

            # Export all sheets to PDF via the PDF exporter
            pdf_export = self._app.TransientObjects.CreatePDFExportOptions()
            pdf_export.AllColor        = True
            pdf_export.VectorResolution = 400

            drawing_doc.SaveAs(out_path, SaveCopyAs=True)
            drawing_doc.Close(SkipSave=True)

            return out_path if os.path.isfile(out_path) else ""
        except Exception as exc:
            self._log(f"  ⚠ PDF from drawing failed: {exc}")
            return self._export_pdf_from_part(part_doc, out_path)

    def _export_pdf_from_part(self, part_doc, out_path: str) -> str:
        """Fallback: print the part directly to a PDF file."""
        try:
            part_doc.SaveAs(out_path, SaveCopyAs=True)
            return out_path if os.path.isfile(out_path) else ""
        except Exception as exc:
            self._log(f"  ⚠ PDF export failed: {exc}")
            return ""
