"""
Local part registry - assigns next part number and records created parts.
Uses part-registry/part_registry.db (SQLite).
"""
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "part-registry" / "part_registry.db"


def get_next_part_number() -> int | None:
    """Get next available part number. Returns None if registry not available."""
    if not DB_PATH.exists():
        return None
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute(
            "SELECT COALESCE(MAX(partNumber), 0) + 1 FROM PartRegistry"
        )
        next_num = cur.fetchone()[0]
        conn.close()
        return next_num
    except Exception:
        return None


def register_part(
    part_number: int,
    drawing_job_id: str,
    job_item_id: str,
    shape_type: str,
    folder_path: str,
) -> bool:
    """Record a created part in the registry."""
    if not DB_PATH.exists():
        return False
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            """
            INSERT INTO PartRegistry (partNumber, itemId, shapeType, folderPath, status)
            VALUES (?, ?, ?, ?, 'created')
            """,
            (part_number, job_item_id, shape_type, folder_path),
        )
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False
