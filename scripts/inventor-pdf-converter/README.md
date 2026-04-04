# Inventor PDF → PNG Converter

Converts drawing PDFs to 300 DPI PNG. Default folders are **Z Bars**:

- PDF in: `...\DRAWINGS & MODELS\Z Bars\PDF`
- PNG out: `...\DRAWINGS & MODELS\Z Bars\PNG`

Naming: `Part# - Part Name.png` when the PDF text contains `PART NAME: ...`, otherwise `Part#.png`.

## Setup

1. **Install Python 3.10+** from [python.org](https://www.python.org/downloads/) (check "Add Python to PATH").
2. In this folder:

   ```powershell
   python -m pip install -r requirements.txt
   ```

## Run

**Watch folder** (leave running while Inventor saves PDFs):

```powershell
python converter.py
```

On startup, watch mode **first converts every PDF already in the folder** (then skips any whose PNG is newer — so restarts are quick). Files that were there *before* you started the watcher are included; that was the usual reason no PNGs appeared.

- Only want *new* files after start? `python converter.py --no-initial-scan`
- **One-shot** (convert all PDFs, replace PNGs, then exit): `python converter.py batch`

The watcher also reacts to **modified** events (Inventor overwriting a PDF).

**Custom folders:**

```powershell
python converter.py watch --pdf-dir "D:\In\PDF" --png-dir "D:\Out\PNG"
python converter.py batch --pdf-dir "D:\In\PDF" --png-dir "D:\Out\PNG"
```

**Environment variables** (optional): `Z_BARS_PDF_DIR`, `Z_BARS_PNG_DIR`, `Z_BARS_PNG_DPI`, `Z_BARS_PDF_CONVERT_DELAY`.

## Desktop shortcut (Z Bars)

From this folder (note **`.ps1`**, not `.ps10`):

```powershell
powershell -ExecutionPolicy Bypass -File .\create_z_bars_desktop_shortcut.ps1
```

Creates **Z Bars PDF to PNG.lnk** on your Desktop (same idea as **PDF TO PNG** — `pythonw.exe` + `converter.py`).

## Z Bars: batch export drawings → PDF

From the repo, Inventor must be closed or the script will attach to the running session:

```powershell
cd "c:\Users\Micha\shopify-apps\project-clad\scripts\inventor-worker"
cscript //nologo batch_export_drawings_pdf.vbs
```

Add `overwrite` to replace existing PDFs in `Z Bars\PDF`. Add `showui` if you need the full Inventor UI during export.

## Run at Startup (Optional)

Put the Desktop shortcut (or `pythonw.exe` + `converter.py`) in your Windows Startup folder so PNG conversion runs in the background.
