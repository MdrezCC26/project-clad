"""
Inventor PDF → PNG Converter
Watches a folder for new PDFs, converts to 300 DPI PNG, saves with part name in filename.
"""

import os
import re
import time
from pathlib import Path

import fitz  # PyMuPDF
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configuration
WATCH_FOLDER = r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\PDF"
OUTPUT_FOLDER = r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS\PNG"
DPI = 300
PROCESS_DELAY_SEC = 2  # Wait for file to finish writing


def sanitize_filename(text: str) -> str:
    """Remove characters invalid for Windows filenames."""
    invalid = r'[<>:"/\\|?*]'
    return re.sub(invalid, "_", text).strip()


def extract_part_name(pdf_path: str) -> str | None:
    """Extract PART NAME from PDF title block."""
    try:
        doc = fitz.open(pdf_path)
        for page in doc:
            text = page.get_text()
            # Look for "PART NAME: ..." (case insensitive)
            match = re.search(r"PART\s+NAME:\s*(.+?)(?:\n|$)", text, re.IGNORECASE | re.DOTALL)
            if match:
                part_name = match.group(1).strip()
                doc.close()
                return sanitize_filename(part_name) if part_name else None
        doc.close()
    except Exception:
        pass
    return None


def convert_pdf_to_png(pdf_path: str, output_path: str) -> bool:
    """Convert first page of PDF to PNG at specified DPI."""
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


def process_pdf(pdf_path: str) -> None:
    """Convert a PDF to PNG with smart naming."""
    path = Path(pdf_path)
    if path.suffix.lower() != ".pdf":
        return

    part_number = path.stem
    part_name = extract_part_name(str(path))

    if part_name:
        output_name = f"{part_number} - {part_name}.png"
    else:
        output_name = f"{part_number}.png"

    output_path = Path(OUTPUT_FOLDER) / output_name
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Converting: {path.name} -> {output_name}")
    if convert_pdf_to_png(str(path), str(output_path)):
        print(f"  Done: {output_path}")
    else:
        print(f"  Failed: {path.name}")


class PDFHandler(FileSystemEventHandler):
    """Handle new PDF files in the watch folder."""

    def __init__(self):
        super().__init__()
        self._pending: dict[str, float] = {}

    def on_created(self, event):
        if event.is_directory:
            return
        path = event.src_path
        if path.lower().endswith(".pdf"):
            self._pending[path] = time.time()

    def process_pending(self):
        now = time.time()
        to_process = []
        for path, created_at in list(self._pending.items()):
            if now - created_at >= PROCESS_DELAY_SEC:
                if os.path.exists(path):
                    to_process.append(path)
                del self._pending[path]
        for path in to_process:
            try:
                process_pdf(path)
            except Exception as e:
                print(f"Error processing {path}: {e}")


def main():
    watch_path = Path(WATCH_FOLDER)
    if not watch_path.exists():
        print(f"Watch folder does not exist: {WATCH_FOLDER}")
        return

    Path(OUTPUT_FOLDER).mkdir(parents=True, exist_ok=True)

    event_handler = PDFHandler()
    observer = Observer()
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()

    print(f"Watching: {WATCH_FOLDER}")
    print(f"Output:   {OUTPUT_FOLDER}")
    print(f"DPI:      {DPI}")
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            event_handler.process_pending()
            time.sleep(0.5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
