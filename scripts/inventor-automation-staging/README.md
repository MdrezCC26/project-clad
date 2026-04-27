# 🍁 Canadian Cladding Profile Generator

Automates Autodesk Inventor shop drawing generation for steel cladding profiles
(Z-bar, C-channel, U-channel, hat channel, angle/L-bar, and custom profiles).

---

## Quick Start

### 1 — Prerequisites

| Requirement | Version |
|---|---|
| Windows 10/11 (64-bit) | — |
| Python | 3.9 or newer |
| Autodesk Inventor | 2021 or newer (for live mode) |

### 2 — Install Dependencies

```bat
pip install -r requirements.txt
```

> **Note (pywin32):** After installing pywin32 you may need to run the
> post-install script once:
> ```bat
> python Scripts/pywin32_postinstall.py -install
> ```

### 3 — Launch

Double-click **`run.bat`** or run:

```bat
python profile_generator.py
```

---

## First-Time Setup (No Inventor Yet)

1. Open the app and navigate to the **Settings** tab.
2. Check **"Test Mode (simulate without Inventor)"**.
3. Click **Save Settings**.
4. Use the **Single Part** or **Batch Generate** tabs normally — all
   parameters are logged but no files are written.

---

## Adding Inventor Templates

### What You Need

For each profile you want to generate, provide:

| File | Purpose |
|---|---|
| `MyProfile.ipt` | Parametric Inventor part with named parameters (see below) |
| `MyProfile.idw` | Linked Inventor drawing for PDF shop-drawing export |

Place both files in the `templates/` folder.

### Required Parameter Names in the `.ipt` File

The automation module writes these exact parameter names:

| Parameter | Unit in Inventor | Description |
|---|---|---|
| `L1` | cm | Flange / leg 1 length |
| `L2` | cm | Web / leg 2 length |
| `L3` | cm | Flange / leg 3 length |
| `A1` | rad | Bend angle 1 |
| `A2` | rad | Bend angle 2 |
| `Thickness` | cm | Material thickness (derived from gauge) |
| `TotalLength` | cm | Overall extrusion length |

Parameters missing from a template are silently skipped with a warning in
the log.

### Register the Template in `config.json`

Add an entry to the `"templates"` array:

```json
{
  "name":         "My Custom Profile",
  "profile_code": "M",
  "part_file":    "templates/MyProfile.ipt",
  "drawing_file": "templates/MyProfile.idw",
  "description":  "Brief description shown in tooltips",
  "parameters": [
    { "name": "L1",          "description": "Leg width (in)", "default": 2.0 },
    { "name": "L2",          "description": "Web depth (in)", "default": 4.0 },
    { "name": "TotalLength", "description": "Length (in)",    "default": 120.0 }
  ]
}
```

Restart the application to pick up the new template.

---

## Part Number Format

```
{ProfileCode}{Gauge:02d}00{L1*1000:04d}
```

Examples:

| Part Number | Meaning |
|---|---|
| `Z1600750` | Z-bar, 16 gauge, L1 = 0.750″ |
| `C2000162` | C-channel, 20 gauge, L1 = 0.162″ (1.625″ × 100 / 1000 — round to spec) |
| `H2001000` | Hat channel, 20 gauge, L1 = 1.000″ |

---

## Project Structure

```
ProfileGenerator/
├── profile_generator.py       # Main PyQt5 GUI
├── inventor_automation.py     # Inventor COM wrapper
├── config.json                # Template definitions & app config
├── requirements.txt           # Python dependencies
├── README.md                  # This file
├── run.bat                    # Windows launcher
└── templates/                 # Your .ipt and .idw files go here
```

---

## Troubleshooting

### "Could not connect to Autodesk Inventor"
- Ensure Inventor is installed and licensed.
- Try launching Inventor manually before starting this app.
- Enable **Test Mode** in Settings to verify the rest of the workflow.

### "Parameter 'L1' not found in template"
- Open your `.ipt` in Inventor and check **Manage → Parameters**.
- Rename the user parameter to match the name expected (case-sensitive).

### PyQt5 import error on launch
```bat
pip install PyQt5 --upgrade
```

### pywin32 / COM error
```bat
pip install pywin32 --upgrade
python Scripts/pywin32_postinstall.py -install
```

---

## License

Internal tool — Canadian Cladding Co., Ltd.  
Not for redistribution.
