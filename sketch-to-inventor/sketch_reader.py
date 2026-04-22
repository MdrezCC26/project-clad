"""Extract profile geometry + metadata from a hand-sketch photo using AI vision."""

import base64
import json
from pathlib import Path

from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL
from geometry import Segment, SketchData

_SYSTEM_PROMPT = """\
You are an expert at reading hand-drawn sheet metal profile sketches on
Canadian Cladding order forms.

The form contains these fields:
  Gauge        – integer (e.g. 16)
  Colour       – string  (e.g. Galvanized)
  Quantity     – integer
  Painted Side – "Inside" or "Outside" (one is circled or marked)
  Job Location, Date, Job Name, Order Number, Ordered by

The large grid area holds a hand-drawn **cross-section profile** made of
connected straight line segments.  Each segment has a **dimension number**
written next to it indicating its length in inches.

Trace the profile from one end to the other.  For each segment record:
  direction – one of "right", "left", "up", "down" (viewer's perspective)
  length    – the dimension number (inches)

Return **only** valid JSON (no markdown fences, no commentary):
{
  "gauge": <int>,
  "colour": "<str>",
  "quantity": <int>,
  "painted_side": "Inside" or "Outside",
  "job_location": "<str>",
  "date": "<str>",
  "job_name": "<str>",
  "order_number": "<str>",
  "ordered_by": "<str>",
  "segments": [
    {"direction": "<right|left|up|down>", "length": <number>}
  ],
  "length": <number or null>
}
If the extrusion / run length is not on the form, set "length" to null.
"""

_MIME = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}


def _encode(path: Path) -> tuple[str, str]:
    b64 = base64.b64encode(path.read_bytes()).decode()
    mime = _MIME.get(path.suffix.lower().lstrip("."), "jpeg")
    return b64, mime


def read_sketch(image_path: str | Path) -> SketchData:
    """Use GPT-4o vision to interpret a sketch photo."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(image_path)

    b64, mime = _encode(image_path)
    client = OpenAI(api_key=OPENAI_API_KEY)

    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Read this sketch and return the JSON."},
                    {"type": "image_url", "image_url": {"url": f"data:image/{mime};base64,{b64}"}},
                ],
            },
        ],
        temperature=0.0,
        max_tokens=1024,
    )

    raw = resp.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    return _parse(json.loads(raw))


def read_json(json_path: str | Path) -> SketchData:
    """Load profile data from a hand-written or previously-saved JSON file."""
    with open(json_path) as fh:
        return _parse(json.load(fh))


def _parse(d: dict) -> SketchData:
    segments = [Segment(direction=s["direction"], length=float(s["length"])) for s in d["segments"]]
    return SketchData(
        gauge=int(d["gauge"]),
        colour=str(d.get("colour") or d.get("color", "")),
        quantity=int(d.get("quantity", 1)),
        painted_side=str(d.get("painted_side", "Outside")),
        segments=segments,
        length=d.get("length"),
        job_location=str(d.get("job_location", "")),
        date=str(d.get("date", "")),
        job_name=str(d.get("job_name", "")),
        order_number=str(d.get("order_number", "")),
        ordered_by=str(d.get("ordered_by", "")),
    )
