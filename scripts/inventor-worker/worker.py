"""
ProjectClad Inventor Drawing Worker
Polls the API for pending drawing jobs, drives Inventor to create parts/PDFs,
updates status, and optionally assigns part numbers from the local registry.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load .env from script directory
load_dotenv(Path(__file__).resolve().parent / ".env")

from inventor_driver import create_and_export
from part_registry import get_next_part_number, register_part

API_BASE = os.environ.get("API_BASE_URL", "http://localhost:3000").rstrip("/")
SHOP = os.environ.get("SHOP", "")
API_KEY = os.environ.get("DRAWING_WORKER_API_KEY", "")
BASE_FOLDER = os.environ.get("BASE_FOLDER", r"C:\Users\Micha\Desktop\Canadian Cladding\DRAWINGS & MODELS")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))

DRAWING_JOBS_URL = f"{API_BASE}/apps/project-clad/api/drawing-jobs"
PDF_FOLDER = Path(BASE_FOLDER) / "PDF"


def fetch_pending_jobs() -> list[dict]:
    """Fetch pending drawing jobs from the API."""
    params = {"shop": SHOP, "limit": 10}
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"

    try:
        r = requests.get(DRAWING_JOBS_URL, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data.get("jobs", [])
    except requests.RequestException as e:
        print(f"  API error: {e}")
        return []


def patch_job(job_id: str, status: str, part_number: str | None = None, error_msg: str | None = None) -> bool:
    """Update drawing job status via PATCH."""
    params = {"shop": SHOP}
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"

    payload = {"id": job_id, "status": status}
    if part_number is not None:
        payload["partNumber"] = str(part_number)
    if error_msg is not None:
        payload["errorMsg"] = error_msg[:500]

    try:
        r = requests.patch(DRAWING_JOBS_URL, params=params, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"  PATCH error: {e}")
        return False


def process_job(job: dict) -> None:
    """Process a single drawing job."""
    job_id = job["id"]
    job_item_id = job.get("jobItemId", "")
    shape_type = job.get("shapeType", "L")
    l1 = float(job.get("l1", 0))
    l2 = float(job.get("l2", 0))
    l3 = job.get("l3")
    a1 = job.get("a1")
    gauge = int(job.get("gauge", 16))
    thickness = job.get("thicknessInches")
    if thickness is not None:
        thickness = float(thickness)

    print(f"  Processing {job_id} ({shape_type} L1={l1} L2={l2} gauge={gauge})")

    # Mark as processing
    patch_job(job_id, "processing")

    # Get next part number from registry, or use hash of job id as fallback
    part_num = get_next_part_number()
    if part_num is None:
        part_num = abs(hash(job_id)) % 10**8

    PDF_FOLDER.mkdir(parents=True, exist_ok=True)
    ok, result = create_and_export(
        shape_type=shape_type,
        l1=l1,
        l2=l2,
        l3=l3,
        a1=a1,
        gauge=gauge,
        thickness_inches=thickness,
        output_pdf_folder=str(PDF_FOLDER),
        part_number=part_num,
    )

    if ok:
        register_part(part_num, job_id, job_item_id, shape_type, str(PDF_FOLDER))
        patch_job(job_id, "completed", part_number=str(part_num))
        print(f"  -> Completed part #{part_num}")
    else:
        patch_job(job_id, "failed", error_msg=result)
        print(f"  -> Failed: {result}")


def main() -> None:
    if not SHOP or ".myshopify.com" not in SHOP:
        print("Set SHOP in .env (e.g. projectclad.myshopify.com)")
        sys.exit(1)

    print(f"Worker started: {SHOP}")
    print(f"API: {API_BASE}")
    print(f"PDF folder: {PDF_FOLDER}")
    print(f"Poll every {POLL_INTERVAL}s. Ctrl+C to stop.\n")

    while True:
        jobs = fetch_pending_jobs()
        if jobs:
            print(f"Found {len(jobs)} job(s)")
            for job in jobs:
                try:
                    process_job(job)
                except Exception as e:
                    print(f"  Error: {e}")
                    patch_job(job["id"], "failed", error_msg=str(e))

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
