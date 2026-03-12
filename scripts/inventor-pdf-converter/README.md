# Inventor PDF → PNG Converter

Watches the PDF folder for new files, converts them to 300 DPI PNG, and saves to a separate output folder with smart naming (`Part# - Part Name.png`).

## Setup

1. **Install Python 3.10+** from [python.org](https://www.python.org/downloads/) (check "Add Python to PATH").
2. Open a terminal in this folder and run:

   ```bash
   pip install -r requirements.txt
   ```

   Or if `pip` isn't in your PATH: `python -m pip install -r requirements.txt`

## Run

```bash
python converter.py
```

Keep the terminal open while you export PDFs from Inventor. Press `Ctrl+C` to stop.

## Config

Edit `converter.py` to change:

- `WATCH_FOLDER` – folder to monitor for PDFs
- `OUTPUT_FOLDER` – where PNGs are saved
- `DPI` – image resolution (default 300)
- `PROCESS_DELAY_SEC` – delay before converting (lets Inventor finish writing)

## Run at Startup (Optional)

Create a shortcut to `pythonw.exe` with this folder as the working directory and `converter.py` as the argument, then add it to your Windows Startup folder to run in the background.
