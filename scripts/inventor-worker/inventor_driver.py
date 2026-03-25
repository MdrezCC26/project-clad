"""
Inventor automation driver.
Drives Inventor via COM to create L/Z/U parts from a template and export PDF.

Implement create_and_export() with your Inventor template and parameter names.
Requires: Autodesk Inventor, pywin32 (win32com).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# Default gauge -> thickness (inches) if API doesn't provide
DEFAULT_THICKNESS = {
    16: 0.0598,
    18: 0.0478,
    20: 0.0516,
    24: 0.0239,
    26: 0.0179,
}


def sanitize_filename(text: str) -> str:
    """Remove characters invalid for Windows filenames."""
    invalid = r'[<>:"/\\|?*]'
    return re.sub(invalid, "_", str(text).strip()) or "part"


def create_and_export(
    shape_type: str,
    l1: float,
    l2: float,
    l3: float | None,
    a1: float | None,
    gauge: int,
    thickness_inches: float | None,
    output_pdf_folder: str,
    part_number: int,
) -> tuple[bool, str]:
    """
    Create part in Inventor and export to PDF.
    Uses VBScript subprocess (better Inventor COM support than Python).
    """
    thickness = thickness_inches if thickness_inches is not None else DEFAULT_THICKNESS.get(gauge, 0.06)
    pdf_name = f"{part_number}.pdf"
    output_pdf = Path(output_pdf_folder) / pdf_name
    a1_val = a1 if a1 is not None else 90.0  # default

    if shape_type != "L":
        return False, f"Shape type {shape_type} not yet implemented (L only for now)"

    template_path = os.environ.get("INVENTOR_L_TEMPLATE", "")
    if not template_path or not os.path.exists(template_path):
        return False, "Set INVENTOR_L_TEMPLATE env to your L-shape .ipt template path"

    base = Path(output_pdf_folder).parent
    models_folder = base / "MODELS"
    models_folder.mkdir(parents=True, exist_ok=True)
    part_path = models_folder / f"{part_number}.ipt"
    Path(output_pdf_folder).mkdir(parents=True, exist_ok=True)

    drawing_tpl = os.environ.get("INVENTOR_DRAWING_TEMPLATE", "").strip()
    if not drawing_tpl:
        tpl_dir = Path(template_path).parent
        stem = Path(template_path).stem.replace(".ipt", "")
        for ext in (".idw", ".dwg"):
            c = tpl_dir / (stem + ext)
            if c.exists():
                drawing_tpl = str(c)
                break
        if not drawing_tpl:
            std_tpl = tpl_dir / "Standard.idw"
            if std_tpl.exists():
                drawing_tpl = str(std_tpl)
    if not drawing_tpl or not os.path.exists(drawing_tpl):
        return False, "Set INVENTOR_DRAWING_TEMPLATE to .idw or .dwg template"

    vbs_dir = Path(__file__).resolve().parent
    vbs_path = vbs_dir / "create_l_part.vbs"
    if not vbs_path.exists():
        return False, "create_l_part.vbs not found"

    import subprocess
    args = [
        "cscript", "//nologo", str(vbs_path),
        template_path,
        str(part_path),
        drawing_tpl,
        str(output_pdf),
        str(l1), str(l2), str(a1_val), str(gauge), str(thickness),
    ]
    try:
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(vbs_dir),
        )
        if r.returncode == 0:
            return True, str(output_pdf)
        err = (r.stderr or r.stdout or "").strip()
        return False, err or f"VBS exit code {r.returncode}"
    except subprocess.TimeoutExpired:
        return False, "Inventor timed out (120s)"
    except Exception as e:
        return False, str(e)
