"""Data models for sheet metal profile geometry and material properties."""

from dataclasses import dataclass
from typing import Optional

# Manufacturer's Standard Gauge for Sheet Steel — thickness in inches
GAUGE_THICKNESS_IN: dict[int, float] = {
    10: 0.1345, 11: 0.1196, 12: 0.1046, 13: 0.0897, 14: 0.0747,
    15: 0.0673, 16: 0.0598, 17: 0.0538, 18: 0.0478, 19: 0.0418,
    20: 0.0359, 21: 0.0329, 22: 0.0299, 23: 0.0269, 24: 0.0239,
    25: 0.0209, 26: 0.0179,
}

INCHES_TO_CM = 2.54  # Inventor internal unit is centimeters


@dataclass
class Segment:
    """One straight-line leg of the profile."""
    direction: str   # "right" | "left" | "up" | "down"
    length: float    # inches

    @property
    def dx(self) -> float:
        return {"right": 1, "left": -1}.get(self.direction, 0) * self.length

    @property
    def dy(self) -> float:
        return {"up": 1, "down": -1}.get(self.direction, 0) * self.length

    @property
    def is_horizontal(self) -> bool:
        return self.direction in ("right", "left")


@dataclass
class SketchData:
    """Everything extracted from a single order-form sketch."""
    gauge: int
    colour: str
    quantity: int
    painted_side: str           # "Inside" | "Outside"
    segments: list[Segment]
    length: Optional[float] = None   # extrusion / run length (inches)
    job_location: str = ""
    date: str = ""
    job_name: str = ""
    order_number: str = ""
    ordered_by: str = ""

    # --- derived properties ---------------------------------------------------

    @property
    def thickness_in(self) -> float:
        return GAUGE_THICKNESS_IN.get(self.gauge, 0.0598)

    @property
    def thickness_cm(self) -> float:
        return self.thickness_in * INCHES_TO_CM

    @property
    def inside_radius_in(self) -> float:
        """Inside bend radius = 1× material thickness."""
        return self.thickness_in

    @property
    def inside_radius_cm(self) -> float:
        return self.inside_radius_in * INCHES_TO_CM

    @property
    def outside_radius_in(self) -> float:
        """Outside bend radius = 2× material thickness."""
        return 2.0 * self.thickness_in

    # --- coordinate helpers ---------------------------------------------------

    def profile_points_cm(self) -> list[tuple[float, float]]:
        """Return profile vertices in centimeters for Inventor."""
        pts: list[tuple[float, float]] = [(0.0, 0.0)]
        for seg in self.segments:
            x, y = pts[-1]
            pts.append((x + seg.dx * INCHES_TO_CM, y + seg.dy * INCHES_TO_CM))
        return pts

    def profile_points_in(self) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = [(0.0, 0.0)]
        for seg in self.segments:
            x, y = pts[-1]
            pts.append((x + seg.dx, y + seg.dy))
        return pts
