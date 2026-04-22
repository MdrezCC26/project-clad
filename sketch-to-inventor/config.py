"""Configuration for sketch-to-inventor."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── AI vision ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")

# ── Defaults ──────────────────────────────────────────────────────────────────
DEFAULT_LENGTH_INCHES: float = 120.0   # 10 ft — common cladding stock length
DEFAULT_OUTPUT_DIR: Path = Path("./output")

# ── Inventor COM enum values ──────────────────────────────────────────────────
K_PART_DOC = 12290
K_DRAWING_DOC = 12292
K_IMPERIAL = 7174
K_SHEET_METAL_SUBTYPE = "{9C464203-9BAE-11D3-8BAD-0060B0CE6BB4}"

# ViewOrientationTypeEnum
K_FRONT_VIEW = 10764
K_RIGHT_VIEW = 10769
K_ISO_TOP_RIGHT = 10770

# DrawingViewStyleEnum
K_HIDDEN_LINE_REMOVED = 32259
K_SHADED = 32260

# DimensionOrientationEnum
K_ALIGNED_DIM = 0
K_HORIZONTAL_DIM = 1
K_VERTICAL_DIM = 2

INCHES_TO_CM = 2.54
