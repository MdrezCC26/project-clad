# Inventor Drawing Worker

Polls ProjectClad for pending drawing jobs, drives Inventor to create L/Z/U parts and export PDFs, then updates job status.

## Requirements

- **Windows** with Autodesk Inventor
- **Python 3.10+**
- L-shape (and optionally Z, U) Inventor template(s) with named parameters

## Setup

1. Copy `config.example.env` to `.env` and fill in:

   - `API_BASE_URL` – your app URL (e.g. `https://your-app.fly.dev`)
   - `SHOP` – shop domain (e.g. `projectclad.myshopify.com`)
   - `DRAWING_WORKER_API_KEY` – set in production (from app `DRAWING_WORKER_API_KEY` env)
   - `BASE_FOLDER` – folder containing `PDF` and `MODELS` subfolders (must match converter)
   - `INVENTOR_L_TEMPLATE` – path to your L-shape `.ipt` template

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

## Run

```bash
python worker.py
```

Keep the terminal open. The worker polls every `POLL_INTERVAL` seconds (default 30).

## Implementing the Inventor Driver

Edit `inventor_driver.py` to match your Inventor setup:

1. **Template** – L-shape `.ipt` with parameters: `L1`, `L2`, `A1`, `T1` (thickness)
2. **Create part** – Set parameters, save part to `MODELS/{partNumber}.ipt`
3. **Export PDF** – Create drawing from part (or use iLogic), export to `PDF/{partNumber}.pdf`

The existing PDF→PNG converter will pick up new PDFs in the PDF folder.

## Part Registry

If `part-registry/part_registry.db` exists, the worker assigns sequential part numbers and records them. Run `npx tsx part-registry/init-db.mjs` (or use `init.sql`) to create the DB.

## Run at Startup

Create a shortcut to `pythonw.exe` with `worker.py` as the argument and this folder as the working directory. Add the shortcut to the Windows Startup folder to run the worker in the background.
