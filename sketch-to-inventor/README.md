# sketch-to-inventor

Convert hand-drawn Canadian Cladding order-form sketches into Autodesk Inventor
sheet-metal parts (`.ipt`) and dimensioned drawings (`.idw`).

## How it works

1. **Photo / scan** of the order form is sent to GPT-4o Vision, which extracts
   the profile segments, dimensions, gauge, colour, quantity, and job metadata.
2. The program connects to **Inventor via COM** (pywin32), creates a fully
   constrained 2-D sketch of the profile on the XY plane, and applies a
   **Contour Flange** to produce a sheet-metal part.
3. A drawing is created with front, right, isometric, and (optionally)
   flat-pattern views.  Model dimensions are retrieved automatically and a
   text note with job info is placed on the sheet.

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.10+ | Windows only (COM) |
| Autodesk Inventor | 2022 or later recommended |
| OpenAI API key | For the vision step; skip with `--json` |

## Setup

```powershell
cd sketch-to-inventor
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create a `.env` file (or set env vars):

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o          # optional, defaults to gpt-4o
```

## Usage

### Full pipeline (photo → part + drawing)

```powershell
python main.py  "C:\path\to\sketch_photo.jpg"
```

### Override run length (default 120″ / 10 ft)

```powershell
python main.py  sketch.jpg --length 96
```

### Dry run (extract + display, no Inventor)

```powershell
python main.py  sketch.jpg --dry-run
```

Writes `output/extracted.json` so you can inspect and hand-edit before feeding
it back with `--json`.

### Skip vision, use JSON directly

```powershell
python main.py  --json sample_input.json
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--length` | `120` | Extrusion / run length in inches |
| `--output` | `./output` | Directory for `.ipt` and `.idw` files |
| `--scale` | `1.0` | Drawing view scale |
| `--dry-run` | off | Extract only — do not open Inventor |
| `--json` | — | JSON input file (skips the vision API) |

## Input format

The program expects the standard Canadian Cladding order form:

- **Gauge** and **Colour** in the header fields
- A **profile cross-section** drawn on the grid as connected straight-line
  segments, each labelled with a dimension in inches
- **Quantity**, **Painted Side**, and job-info fields below the grid

### Sheet-metal rules (hard-coded)

| Property | Value |
|---|---|
| Inside bend radius | 1 × material thickness |
| Outside bend radius | 2 × material thickness |
| Thickness | from standard steel-gauge table |

## Sample

`sample_input.json` matches the sketch in the repo — a 16-ga galvanized step
profile: right 2″, down 4″, right 4″ at 120″ run length.

```powershell
python main.py --json sample_input.json
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `pywintypes.com_error` on document creation | Make sure Inventor is installed and licensed. Try opening Inventor manually first, then re-run. |
| Contour Flange fails | The sketch is still saved. Open the `.ipt` in Inventor and create the Contour Flange manually (select the open profile, set thickness + bend radius). |
| Wrong dimensions / segments | Use `--dry-run` first, edit `extracted.json`, re-run with `--json extracted.json`. |
| Vision API errors | Check `OPENAI_API_KEY`. Ensure the image is a supported format (jpg/png/webp). |
