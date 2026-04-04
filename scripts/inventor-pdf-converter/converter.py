"""
Inventor PDF → PNG Converter
- watch: monitor a folder for new/updated PDFs, convert to PNG (default).
- batch: convert every *.pdf already in the folder once, then exit.

Uses PyMuPDF (fitz). Same naming as before: optional PART NAME from PDF text.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

import fitz  # PyMuPDF
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

# Default: Z Bars (override with --pdf-dir / --png-dir or env)
_DEFAULT_PDF = os.environ.get(
    "Z_BARS_PDF_DIR",
    r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\PDF",
)
_DEFAULT_PNG = os.environ.get(
    "Z_BARS_PNG_DIR",
    r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\Z Bars\PNG",
)

DPI = int(os.environ.get("Z_BARS_PNG_DPI", "300"))
PROCESS_DELAY_SEC = float(os.environ.get("Z_BARS_PDF_CONVERT_DELAY", "2"))


def sanitize_filename(text: str) -> str:
    invalid = r'[<>:"/\\|?*]'
    return re.sub(invalid, "_", text).strip()


def extract_part_name(pdf_path: str) -> str | None:
    try:
        doc = fitz.open(pdf_path)
        for page in doc:
            text = page.get_text()
            match = re.search(
                r"PART\s+NAME:\s*(.+?)(?:\n|$)", text, re.IGNORECASE | re.DOTALL
            )
            if match:
                part_name = match.group(1).strip()
                doc.close()
                return sanitize_filename(part_name) if part_name else None
        doc.close()
    except Exception:
        pass
    return None


def convert_pdf_to_png(pdf_path: str, output_path: str) -> bool:
    try:
        doc = fitz.open(pdf_path)
        page = doc[0]
        zoom = DPI / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(output_path)
        doc.close()
        return True
    except Exception as e:
        print(f"  Error converting: {e}")
        return False


def process_pdf(
    pdf_path: str,
    output_folder: Path,
    *,
    skip_if_current: bool = False,
) -> None:
    path = Path(pdf_path)
    if path.suffix.lower() != ".pdf":
        return

    part_number = path.stem
    part_name = extract_part_name(str(path))

    if part_name:
        output_name = f"{part_number} - {part_name}.png"
    else:
        output_name = f"{part_number}.png"

    output_path = output_folder / output_name
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if skip_if_current and output_path.exists():
        try:
            if path.stat().st_mtime <= output_path.stat().st_mtime:
                return
        except OSError:
            pass

    print(f"Converting: {path.name} -> {output_name}")
    if convert_pdf_to_png(str(path), str(output_path)):
        print(f"  Done: {output_path}")
    else:
        print(f"  Failed: {path.name}")


def run_batch(pdf_dir: Path, png_dir: Path) -> None:
    if not pdf_dir.is_dir():
        print(f"PDF folder does not exist: {pdf_dir}")
        sys.exit(1)
    png_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if not pdfs:
        print(f"No PDF files in: {pdf_dir}")
        return
    print(f"Batch: {len(pdfs)} PDF(s) -> {png_dir}")
    for p in pdfs:
        process_pdf(str(p), png_dir, skip_if_current=False)
    print("Batch done.")


def run_initial_scan(pdf_dir: Path, png_dir: Path) -> None:
    """Convert PDFs already on disk before watch starts (watch alone misses these)."""
    if not pdf_dir.is_dir():
        return
    png_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if not pdfs:
        return
    print(
        f"Initial scan: {len(pdfs)} PDF(s) in folder (skipping PNGs already up-to-date)..."
    )
    for p in pdfs:
        try:
            process_pdf(str(p), png_dir, skip_if_current=True)
        except Exception as e:
            print(f"Error processing {p}: {e}")
    print("Initial scan done. Watching for new/changed PDFs...\n")


class PDFHandler(FileSystemEventHandler):
    def __init__(self, output_folder: Path):
        super().__init__()
        self._output_folder = output_folder
        self._pending: dict[str, float] = {}

    def _queue_pdf(self, path: str) -> None:
        if path.lower().endswith(".pdf"):
            self._pending[path] = time.time()

    def on_created(self, event):
        if event.is_directory:
            return
        self._queue_pdf(event.src_path)

    def on_modified(self, event):
        if event.is_directory:
            return
        self._queue_pdf(event.src_path)

    def process_pending(self) -> None:
        now = time.time()
        to_process = []
        for path, created_at in list(self._pending.items()):
            if now - created_at >= PROCESS_DELAY_SEC:
                if os.path.exists(path):
                    to_process.append(path)
                del self._pending[path]
        for path in to_process:
            try:
                process_pdf(path, self._output_folder)
            except Exception as e:
                print(f"Error processing {path}: {e}")


def run_watch(
    watch_path: Path, output_folder: Path, *, no_initial_scan: bool = False
) -> None:
    if not watch_path.exists():
        print(f"Watch folder does not exist: {watch_path}")
        sys.exit(1)

    output_folder.mkdir(parents=True, exist_ok=True)

    if not no_initial_scan:
        run_initial_scan(watch_path, output_folder)

    event_handler = PDFHandler(output_folder)
    observer = Observer()
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()

    print(f"Watching: {watch_path}")
    print(f"Output:   {output_folder}")
    print(f"DPI:      {DPI}")
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            event_handler.process_pending()
            time.sleep(0.5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert Inventor PDF exports to PNG (watch folder or batch)."
    )
    parser.add_argument(
        "mode",
        nargs="?",
        default="watch",
        choices=("watch", "batch"),
        help="watch = monitor folder (default); batch = convert all PDFs once then exit",
    )
    parser.add_argument(
        "--pdf-dir",
        default=_DEFAULT_PDF,
        help="Folder containing PDFs (default: Z Bars\\PDF or Z_BARS_PDF_DIR)",
    )
    parser.add_argument(
        "--png-dir",
        default=_DEFAULT_PNG,
        help="Folder for PNG output (default: Z Bars\\PNG or Z_BARS_PNG_DIR)",
    )
    parser.add_argument(
        "--no-initial-scan",
        action="store_true",
        help="Watch mode only: do not convert PDFs already in the folder at startup",
    )
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    png_dir = Path(args.png_dir)

    if args.mode == "batch":
        run_batch(pdf_dir, png_dir)
    else:
        run_watch(pdf_dir, png_dir, no_initial_scan=args.no_initial_scan)


if __name__ == "__main__":
    main()
