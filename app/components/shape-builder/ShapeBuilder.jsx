import { useState, useMemo, useRef, useEffect, useCallback, useId } from "react";
import {
  Plus, X, RotateCcw, RotateCw, FlipHorizontal2,
  Undo2, Redo2, Pencil, AlertTriangle, ChevronUp, ChevronDown,
  ShoppingCart, HelpCircle,
} from "lucide-react";
import {
  DEFAULT_PART_LENGTH_IN,
  DEFAULT_SHAPE_COLOUR,
  GAUGE_RATES,
  MATERIAL_MARKUP,
  SHAPE_COLOURS,
  priceCustomPart,
  profilePathWithBendRadius,
} from "../../utils/shapeProfile";

/* ------------------------------------------------------------------ *
 * Design tokens
 * ------------------------------------------------------------------ */

const COLOR = {
  profile: "#c5cbd3",
  profileOutline: "#111827",
  accent: "#c8102e",
  witness: "#b0b6bc",
  draw: "#2563eb",
  highlight: "#f59e0b",
};

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#c8102e]";

/* ------------------------------------------------------------------ *
 * Domain constants
 * ------------------------------------------------------------------ */

/** Sheet thickness in inches, keyed by gauge. */
const GAUGE_THICKNESS = {
  16: 0.061, 18: 0.049, 20: 0.038, 22: 0.032, 24: 0.026, 26: 0.021,
};
/** 16–22ga is framing stock; 24–26ga is trim stock. Labels only — markup is 50% for all. */
const FRAMING_GAUGES = new Set(["16", "18", "20", "22"]);
const BEND_COST = 2.5;
const DEFAULT_SHEET_PRICE = { 18: 74.58 };
const FALLBACK_GAUGE = "24";

const DEFAULT_LENGTH = 3;
/**
 * Maximum developed (flat) width — the coil the part is broken from.
 * A profile whose legs sum past this can't be made, so it's enforced
 * rather than merely reported.
 */
const MAX_GIRTH = 48;
/**
 * Minimum on-screen length of a leg, as a fraction of the profile's
 * overall span. A material-thickness fold is a fraction of a percent of
 * a typical part — physically invisible at any line weight — so tight
 * legs are drawn out to this size while their dimensions stay true.
 */
const MIN_VISIBLE_FRACTION = 0.055;
const SNAP_STEP = 45;        // degrees
const HISTORY_LIMIT = 100;

/** Length snap increments, coarsest-first defaults keep dragging calm. */
const SNAP_CHOICES = [
  { label: '1"', value: 1 },
  { label: '¼"', value: 1 / 4 },
  { label: '⅛"', value: 1 / 8 },
  { label: '1/16"', value: 1 / 16 },
];
const DEFAULT_SNAP = 1 / 4;
/**
 * Degrees either side of a 45° step that still land on it. Wide enough
 * that square bends survive a shaky hand; hold Shift to escape it.
 */
const ANGLE_MAGNET = 12;
/**
 * Physical screen pixels a pointer must travel before an edit-drag or a
 * freehand stroke engages. Deliberately in pixels, not inches or a
 * fraction of the drawing: the canvas renders at a fixed pixel size
 * (DRAWING_HEIGHT) regardless of the profile's actual span, so a
 * geometry-relative threshold shrinks to almost nothing on-screen for
 * small parts and barely exists at all on large ones — which is exactly
 * why dragging kept feeling twitchy no matter how the geometry-based
 * numbers were tuned. A physical pixel count is the one thing that
 * actually tracks hand tremor consistently at any zoom level.
 */
const DEAD_ZONE_PX = 10;
const DRAW_COMMIT_PX = 14;

/** Screen pixels per SVG user unit, at whatever zoom the canvas is
 *  currently rendered at — the conversion factor that makes a physical
 *  pixel threshold mean the same thing regardless of profile size. */
const pxScaleOf = (svg) => {
  const ctm = svg?.getScreenCTM?.();
  return ctm ? Math.hypot(ctm.a, ctm.b) || 1 : 1;
};
/**
 * On-screen size of the square drawing. Large enough that a multi-bend
 * profile fills the panel; still clamps on short phones so the length
 * fields beneath stay reachable.
 */
const DRAWING_HEIGHT = "clamp(300px, 56vh, 600px)";

const COMPASS = [
  { arrow: "→", deg: 0 }, { arrow: "↘", deg: 45 },
  { arrow: "↓", deg: 90 }, { arrow: "↙", deg: 135 },
  { arrow: "←", deg: 180 }, { arrow: "↖", deg: 225 },
  { arrow: "↑", deg: 270 }, { arrow: "↗", deg: 315 },
];

/**
 * PARKED — starting shapes, as [relative turn, length] per leg. Unused
 * now that "Start from a shape" has moved to a separate profiles page;
 * kept (rather than deleted) because each one is verified free of
 * self-crossing — the Z and C legs specifically were wrong on a first
 * pass and had to be corrected. Reuse this data when that page is
 * built rather than re-deriving it.
 */
const BUILT_IN_SHAPES = [
  ["L", [[0, 12], [-90, 8]]],
  ["Z", [[0, 8], [-90, 5], [90, 8]]],
  ["U", [[0, 6], [-90, 6], [-90, 6]]],
  ["C", [[90, 1.5], [-90, 6], [-90, 8], [-90, 6], [-90, 1.5]]],
  ["S", [[0, 6], [90, 5], [-90, 6]]],
];

/* ------------------------------------------------------------------ *
 * Geometry — pure, module scope, trivially unit-testable
 * ------------------------------------------------------------------ */

/** Wrap an angle into a readable -180..180 range. */
const normalize = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const toRad = (deg) => (deg * Math.PI) / 180;
const snapAngle = (deg) => normalize(Math.round(deg / SNAP_STEP) * SNAP_STEP);

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a, b) => a.x * b.y - a.y * b.x;
const unitVec = (deg) => ({ x: Math.cos(toRad(deg)), y: Math.sin(toRad(deg)) });

/** Min/max in one pass — avoids Math.min(...arr) blowing the arg limit. */
function extent(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 0];
}

/** True when p1-p2 properly crosses p3-p4. Shared endpoints don't count. */
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/**
 * True when two segments lie on the same line and genuinely overlap.
 * A proper-crossing test alone misses this: segments stacked exactly on
 * top of each other never produce the sign change it looks for.
 */
function segmentsOverlapCollinear(p1, p2, p3, p4, eps = 1e-3) {
  const d = sub(p2, p1);
  const lenSq = d.x * d.x + d.y * d.y;
  if (lenSq < eps) return false;
  if (Math.abs(cross(d, sub(p4, p3))) > eps) return false; // not parallel
  if (Math.abs(cross(d, sub(p3, p1))) > eps) return false; // parallel, offset
  const project = (p) => ((p.x - p1.x) * d.x + (p.y - p1.y) * d.y) / lenSq;
  const lo = Math.max(0, Math.min(project(p3), project(p4)));
  const hi = Math.min(1, Math.max(project(p3), project(p4)));
  return hi - lo > eps;
}

const segmentsInterfere = (a1, a2, b1, b2) =>
  segmentsCross(a1, a2, b1, b2) || segmentsOverlapCollinear(a1, a2, b1, b2);

const nearPoint = (a, b, eps = 1e-3) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= eps;

/** Distance from point p to the closest point on segment a→b. */
function distPointToSegment(p, a, b) {
  const ab = sub(b, a);
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * ab.x), p.y - (a.y + t * ab.y));
}

/**
 * True when an endpoint of one segment lands in the *interior* of the other.
 * Proper-crossing misses this (no sign change), and it's exactly how a dragged
 * vertex punches through a neighbouring flange without "crossing" it.
 */
function endpointPiercesSegment(a1, a2, b1, b2, eps = 1e-3) {
  const interior = (p, a, b) => {
    if (nearPoint(p, a, eps) || nearPoint(p, b, eps)) return false;
    return distPointToSegment(p, a, b) <= eps;
  };
  return (
    interior(a1, b1, b2) ||
    interior(a2, b1, b2) ||
    interior(b1, a1, a2) ||
    interior(b2, a1, a2)
  );
}

const segmentsCollide = (a1, a2, b1, b2) =>
  segmentsInterfere(a1, a2, b1, b2) || endpointPiercesSegment(a1, a2, b1, b2);

/** Absolute heading of each segment, accumulated from relative turns. */
function getDirections(segments) {
  let dir = 0;
  return segments.map((seg, i) => {
    dir = i === 0 ? seg.angle : dir + seg.angle;
    return dir;
  });
}

/** Vertices of the profile, starting at the origin. */
function computePoints(segments) {
  const dirs = getDirections(segments);
  let x = 0, y = 0;
  const pts = [{ x, y }];
  segments.forEach((seg, i) => {
    // A leg awaiting its dimension contributes nothing, so an unfilled
    // field leaves the drawing valid instead of poisoning it with NaN.
    const length = Number.isFinite(seg.length) ? seg.length : 0;
    const u = unitVec(dirs[i]);
    x += length * u.x;
    y += length * u.y;
    pts.push({ x, y });
  });
  return pts;
}

/** Shortest distance between two segments (0 if they collide). */
function segmentDistance(a1, a2, b1, b2) {
  if (segmentsCollide(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegment(a1, b1, b2),
    distPointToSegment(a2, b1, b2),
    distPointToSegment(b1, a1, a2),
    distPointToSegment(b2, a1, a2),
  );
}

/**
 * Every pair of non-adjacent segments that physically collide, or that
 * come closer than `minClearance` (sheet thickness). A return bend is
 * held at ~2× thickness, so a clearance of one thickness never flags a
 * legitimate hem — it only stops flanges from stacking on top of each
 * other. O(n^2) is fine — real profiles are well under 30 bends.
 */
function findSelfIntersections(points, minClearance = 0) {
  const hits = [];
  const limit = Math.max(0, minClearance);
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      const d = segmentDistance(
        points[i],
        points[i + 1],
        points[j],
        points[j + 1],
      );
      // limit=0 → only true contacts (d≈0); otherwise keep a thickness of air.
      if (d <= limit + 1e-9) hits.push([i, j]);
    }
  }
  return hits;
}

/**
 * Smallest gap between non-adjacent edges. Used to keep the drawn stroke
 * thinner than the air between return bends so parallel flanges don't
 * visually merge into one fat bar.
 */
function minNonAdjacentGap(points) {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      const d = segmentDistance(
        points[i],
        points[i + 1],
        points[j],
        points[j + 1],
      );
      if (d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : Infinity;
}

/**
 * A return bend legitimately folds back to nearly touch itself at the
 * fold, so collisions this close to the open end aren't real.
 */
const START_MARGIN = 0.5;
const SIXTEENTH = 1 / 16;
const floorTo = (n, step) => Math.floor(n / step) * step;

/**
 * How far a new segment can travel from the open end in `dirDeg` before
 * it runs into the existing profile. Returns Infinity when the path is
 * clear. Used to stop a leg at the metal in front of it instead of
 * overshooting through it.
 */
function clearRunLength(points, dirDeg, limit) {
  const origin = points[points.length - 1];
  const ray = unitVec(dirDeg);
  let nearest = Infinity;

  // Skip the trailing segment: it shares the origin vertex by definition.
  for (let k = 0; k < points.length - 2; k++) {
    const p = points[k];
    const edge = sub(points[k + 1], p);
    const denom = cross(ray, edge);
    if (Math.abs(denom) < 1e-9) continue; // parallel — never meets

    const toEdge = sub(p, origin);
    const alongRay = cross(toEdge, edge) / denom;
    const alongEdge = cross(toEdge, ray) / denom;

    if (alongRay > START_MARGIN && alongRay <= limit && alongEdge >= 0 && alongEdge <= 1) {
      nearest = Math.min(nearest, alongRay);
    }
  }
  return nearest;
}

/**
 * Longest usable length for a new leg: the preferred value, cut back to
 * whatever clear run actually exists. Clipped values round down to 1/16"
 * so the part never ends up buried in adjacent material.
 */
function fitLength(points, dirDeg, preferred) {
  const clear = clearRunLength(points, dirDeg, preferred);
  if (!Number.isFinite(clear)) return preferred;
  return Math.max(SIXTEENTH, floorTo(clear, SIXTEENTH));
}

/** Intersection of two infinite lines, or null when parallel. */
function intersectLines(a0, ua, b0, ub) {
  const denom = cross(ua, ub);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(b0, a0), ub) / denom;
  return { x: a0.x + ua.x * t, y: a0.y + ua.y * t };
}

/**
 * Slide leg `index` sideways by `offset`, keeping every angle fixed.
 *
 * Only the leg and its two neighbours change length: the neighbours
 * stretch to meet the leg's new line, and everything beyond them stays
 * exactly where it was. This is the standard "move edge" behaviour —
 * grabbing the face of a part and shifting it without disturbing the
 * rest of the profile.
 *
 * @returns [{ segIndex, length }] changes, or [] when the move is
 *   impossible (e.g. a neighbour runs parallel and never meets).
 */
function translateSegment(segments, index, offset) {
  const points = computePoints(segments);
  const dirs = getDirections(segments);
  const last = segments.length - 1;
  if (index < 0 || index > last) return [];

  const u = unitVec(dirs[index]);
  const normal = { x: -u.y, y: u.x };
  const moved = {
    x: points[index].x + normal.x * offset,
    y: points[index].y + normal.y * offset,
  };

  // Where the leg's shifted line meets each neighbour's line.
  const head =
    index >= 1
      ? intersectLines(points[index - 1], unitVec(dirs[index - 1]), moved, u)
      : moved;
  if (!head) return [];

  const tail =
    index < last
      ? intersectLines(moved, u, points[index + 1], unitVec(dirs[index + 1]))
      : (() => {
          const len = Number.isFinite(segments[index].length) ? segments[index].length : 0;
          return { x: head.x + u.x * len, y: head.y + u.y * len };
        })();
  if (!tail) return [];

  const changes = [];
  const distance = (from, to) => Math.hypot(to.x - from.x, to.y - from.y);

  if (index >= 1) {
    const prev = unitVec(dirs[index - 1]);
    const reach = sub(head, points[index - 1]);
    // Reject moves that would invert a neighbour through its own start.
    if (reach.x * prev.x + reach.y * prev.y <= 0) return [];
    changes.push({ segIndex: index - 1, length: distance(points[index - 1], head) });
  }

  changes.push({ segIndex: index, length: distance(head, tail) });

  if (index < last) {
    const next = unitVec(dirs[index + 1]);
    const reach = sub(points[index + 2], tail);
    if (reach.x * next.x + reach.y * next.y <= 0) return [];
    changes.push({ segIndex: index + 1, length: distance(tail, points[index + 2]) });
  }

  return changes.filter((c) => c.length > 1e-4);
}

/**
 * A return that folds back at the open end and traces the profile in
 * reverse for `count` legs, held a constant `gap` away — the geometry
 * behind a hem or drip return that hugs the metal it came from.
 *
 * The offset is a genuine parallel polyline: corner vertices come from
 * intersecting adjacent offset lines, so leg lengths shorten or lengthen
 * at bends exactly as they do on a real brake.
 *
 * The fold side is derived from where the profile body actually sits, so
 * a mirrored part folds the mirrored way with no special casing.
 * `sideFlipped` inverts that choice for the other face of the profile.
 *
 * @returns new segments in relative form, or null if the profile is too short.
 */
/**
 * Choose the fold side by outcome, not just geometry: build the return
 * both ways and keep whichever adds no new collisions. The purely local
 * "hug the body" rule breaks down on profiles that already double back,
 * sending the return straight through the part.
 *
 * `sideFlipped` inverts whatever the automatic choice landed on, so the
 * manual toggle still means "the other side".
 */
function buildFollowPath(segments, count, gap, sideFlipped = false) {
  const preferred = buildFollowOnSide(segments, count, gap, false);
  const alternate = buildFollowOnSide(segments, count, gap, true);
  if (!preferred || !alternate) return preferred ?? alternate;

  const baseline = findSelfIntersections(computePoints(segments)).length;
  const added = (path) =>
    findSelfIntersections(computePoints([...segments, ...path])).length - baseline;

  const cleaner = added(preferred) <= added(alternate) ? false : true;
  const useFlipped = sideFlipped ? !cleaner : cleaner;
  return useFlipped ? alternate : preferred;
}

function buildFollowOnSide(segments, count, gap, sideFlipped) {
  const n = segments.length;
  if (count < 1 || count > n) return null;

  const points = computePoints(segments);
  const dirs = getDirections(segments);

  // Walk back from the open end: p[n] → p[n-1] → ... → p[n-count]
  const path = Array.from({ length: count + 1 }, (_, i) => points[n - i]);
  const travelDirs = Array.from({ length: count }, (_, i) =>
    normalize(dirs[n - 1 - i] + 180)
  );

  // Fold toward the side the rest of the profile lives on. With only one
  // leg there's no body to hug, so fall back to the outside of the bend.
  const lastDir = dirs[n - 1];
  const u = unitVec(lastDir);
  let side = 1;
  if (n >= 2) {
    const away = cross(u, sub(points[n - 2], points[n - 1]));
    if (Math.abs(away) > 1e-9) side = -Math.sign(away);
  }
  if (sideFlipped) side = -side;

  // Left normal of each reversed travel direction, flipped to that side.
  const normals = travelDirs.map((deg) => {
    const t = unitVec(deg);
    return { x: -t.y * side, y: t.x * side };
  });

  const shift = (p, m) => ({ x: p.x + m.x * gap, y: p.y + m.y * gap });

  // Offset vertices: endpoints shift straight out, corners come from
  // intersecting the two offset lines that meet there.
  const offsetPts = [shift(path[0], normals[0])];
  for (let i = 1; i < count; i++) {
    const prev = { p: shift(path[i], normals[i - 1]), u: unitVec(travelDirs[i - 1]) };
    const next = { p: shift(path[i], normals[i]), u: unitVec(travelDirs[i]) };
    offsetPts.push(intersectLines(prev.p, prev.u, next.p, next.u) ?? next.p);
  }
  offsetPts.push(shift(path[count], normals[count - 1]));

  // Convert the absolute path into relative turns, starting with the
  // fold itself (open end → first offset vertex).
  const result = [];
  let heading = lastDir;
  const emit = (from, to) => {
    const d = sub(to, from);
    const length = Math.hypot(d.x, d.y);
    if (length < 1e-6) return;
    const absDir = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    result.push({ angle: normalize(absDir - heading), length });
    heading = absDir;
  };

  emit(points[n], offsetPts[0]);
  for (let i = 0; i < count; i++) emit(offsetPts[i], offsetPts[i + 1]);

  return result.length ? result : null;
}

/**
 * Closest direction to `preferredDir` that lets a new segment of
 * `length` leave the open end without colliding with the existing
 * profile. Tries the exact preference first, then the 45° compass
 * ordered by angular distance.
 */
function pickClearDirection(segments, preferredDir, length) {
  const points = computePoints(segments);
  const origin = points[points.length - 1];

  const collides = (end) => {
    const away = sub(end, origin);
    const dist = Math.hypot(away.x, away.y) || 1;
    const margin = Math.min(START_MARGIN, dist * 0.4);
    const start = {
      x: origin.x + (away.x / dist) * margin,
      y: origin.y + (away.y / dist) * margin,
    };
    for (let k = 0; k < points.length - 2; k++) {
      if (segmentsInterfere(start, end, points[k], points[k + 1])) return true;
    }
    return false;
  };

  const endFor = (deg) => {
    const u = unitVec(deg);
    return { x: origin.x + u.x * length, y: origin.y + u.y * length };
  };

  const candidates = [preferredDir, ...COMPASS.map((c) => c.deg)]
    .map(normalize)
    .filter((deg, i, all) => all.findIndex((d) => Math.abs(d - deg) < 0.05) === i)
    .sort(
      (a, b) =>
        Math.abs(normalize(a - preferredDir)) -
        Math.abs(normalize(b - preferredDir))
    );

  return candidates.find((deg) => !collides(endFor(deg))) ?? preferredDir;
}

/**
 * Leader callouts: a short line from each leg out to its label, with an
 * arrowhead where it touches the metal — the drafting convention for
 * "this dimension belongs to that edge".
 *
 * Preferred over dimension lines here because a folded profile puts legs
 * a material thickness apart, and stacked witness lines at that spacing
 * read as noise. A leader only has to point.
 *
 * On a complex, tightly folded profile, a leader built at a fixed
 * distance can land right on top of a different leg of the same part —
 * confusing even though each leader is individually well-formed. Each
 * one is checked against every edge of the actual profile **and** against
 * leaders already placed, then pushed further out (and staggered along its
 * source edge) until its path and label are genuinely clear.
 *
 * `fontSize` must match what the SVG will paint — collision boxes sized
 * from leader offset alone under-estimate the glyphs and labels pile up.
 */
function buildLeaders(segments, points, dirs, baseOffset, fontSize, maxReach) {
  const TOUCH_GAP = Math.max(fontSize * 0.25, 0.08);
  const SHOULDER = 0.35;
  const MAX_ESCALATIONS = 10;
  /* Glyph metrics for the real on-canvas font, plus padding so labels
   * don't visually kiss — kept tight so callouts don't inflate the camera. */
  const LABEL_EM = fontSize;
  const LABEL_PAD = fontSize * 0.35;
  const MIN_LABEL_GAP = fontSize * 1.05;
  const reachCap = Math.max(maxReach || baseOffset * 1.8, baseOffset);

  const edges = [];
  for (let k = 0; k < points.length - 1; k++) edges.push([points[k], points[k + 1]]);

  const placed = [];

  const labelBoxOf = ({ tip, away, text }) => {
    const width = Math.max(text.length, 6) * LABEL_EM * CHAR_WIDTH_EM;
    const height = LABEL_EM * 1.45;
    const labelX = tip.x + away * fontSize * 0.35;
    const labelY = tip.y;
    const x0 = away > 0 ? labelX : labelX - width;
    return {
      x0: x0 - LABEL_PAD,
      y0: labelY - height / 2 - LABEL_PAD,
      x1: x0 + width + LABEL_PAD,
      y1: labelY + height / 2 + LABEL_PAD,
      label: { x: labelX, y: labelY },
    };
  };

  const boxesOverlap = (a, b) =>
    !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);

  /** True when two leader polylines cross or run nearly on top of each other. */
  const pathsTooClose = (a, b) => {
    const segsA = [
      [a.touch, a.elbow],
      [a.elbow, a.tip],
    ];
    const segsB = [
      [b.touch, b.elbow],
      [b.elbow, b.tip],
    ];
    for (const [p1, p2] of segsA) {
      for (const [q1, q2] of segsB) {
        if (segmentsInterfere(p1, p2, q1, q2)) return true;
        if (segmentDistance(p1, p2, q1, q2) < fontSize * 0.55) return true;
      }
    }
    const tipDist = Math.hypot(a.tip.x - b.tip.x, a.tip.y - b.tip.y);
    const elbowDist = Math.hypot(a.elbow.x - b.elbow.x, a.elbow.y - b.elbow.y);
    if (tipDist < MIN_LABEL_GAP || elbowDist < MIN_LABEL_GAP) return true;
    return false;
  };

  /* Longer legs first so short hems dodge around the major callouts. */
  const order = segments
    .map((seg, i) => ({ i, len: Number.isFinite(seg.length) ? seg.length : 0 }))
    .sort((a, b) => b.len - a.len || a.i - b.i);

  const results = new Array(segments.length);

  for (const { i } of order) {
    const seg = segments[i];
    const a = points[i];
    const b = points[i + 1];
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along = { x: (b.x - a.x) / edgeLen, y: (b.y - a.y) / edgeLen };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const perp = { x: -Math.sin(toRad(dirs[i])), y: Math.cos(toRad(dirs[i])) };
    const text = `L${i + 1} · ${formatLength(seg.length)}"`;

    /*
     * Prefer the side that opens into free space. On a tight return the
     * two parallel flanges otherwise both spit leaders into the same
     * narrow corridor and the callouts look like they're merging.
     */
    let preferredSide = -1;
    {
      let best = Infinity;
      for (let k = 0; k < edges.length; k++) {
        if (k === i || Math.abs(k - i) === 1) continue;
        const [e0, e1] = edges[k];
        const d = segmentDistance(a, b, e0, e1);
        if (d >= best) continue;
        best = d;
        const otherMid = { x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 };
        const signed =
          (otherMid.x - mid.x) * perp.x + (otherMid.y - mid.y) * perp.y;
        preferredSide = signed >= 0 ? -1 : 1;
      }
    }

    const buildAt = (tier, side) => {
      // Cap reach so escalation can't park a label outside the camera and
      // leave a stranded pink stub with no text (the viewBox used to clip it).
      const reachMag = Math.min(baseOffset * (0.55 + tier * 0.28), reachCap);
      const reach = side * reachMag;
      const stagger =
        ((tier % 2 === 0 ? 1 : -1) * Math.ceil(tier / 2) * 0.16) * edgeLen;
      const clamped = Math.max(-edgeLen * 0.38, Math.min(edgeLen * 0.38, stagger));
      const anchor = {
        x: mid.x + along.x * clamped,
        y: mid.y + along.y * clamped,
      };
      const touch = {
        x: anchor.x + perp.x * TOUCH_GAP * Math.sign(reach || side),
        y: anchor.y + perp.y * TOUCH_GAP * Math.sign(reach || side),
      };
      const elbow = {
        x: anchor.x + perp.x * reach,
        y: anchor.y + perp.y * reach,
      };
      const away = elbow.x >= anchor.x ? 1 : -1;
      const yStack =
        ((tier % 2 === 0 ? 1 : -1) * Math.ceil(tier / 2)) * fontSize * 0.95;
      const tip = {
        x: elbow.x + away * Math.min(baseOffset * (SHOULDER + tier * 0.06), reachCap * 0.7),
        y: elbow.y + yStack,
      };
      return { touch, elbow, tip, away, text };
    };

    const collidesWithPart = (candidate) => {
      const legs = [
        [candidate.touch, candidate.elbow],
        [candidate.elbow, candidate.tip],
      ];
      for (const [p1, p2] of legs) {
        for (let k = 0; k < edges.length; k++) {
          if (k === i) continue;
          if (segmentsInterfere(p1, p2, edges[k][0], edges[k][1])) return true;
          if (segmentDistance(p1, p2, edges[k][0], edges[k][1]) < fontSize * 0.4) {
            return true;
          }
        }
      }
      const box = labelBoxOf(candidate);
      // Label sitting on the metal itself.
      for (let k = 0; k < edges.length; k++) {
        if (k === i) continue;
        const [e0, e1] = edges[k];
        const samples = [
          { x: box.x0, y: box.y0 },
          { x: box.x1, y: box.y0 },
          { x: box.x0, y: box.y1 },
          { x: box.x1, y: box.y1 },
          { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
        ];
        for (const p of samples) {
          if (distPointToSegment(p, e0, e1) < fontSize * 0.35) return true;
        }
      }
      return false;
    };

    const collidesWithPlaced = (candidate) => {
      const box = labelBoxOf(candidate);
      for (const other of placed) {
        if (pathsTooClose(candidate, other)) return true;
        if (boxesOverlap(box, other.box)) return true;
      }
      return false;
    };

    const isClear = (c) => !collidesWithPart(c) && !collidesWithPlaced(c);

    let candidate = null;
    search: for (let tier = 0; tier <= MAX_ESCALATIONS; tier += 1) {
      for (const side of [preferredSide, -preferredSide]) {
        const trial = buildAt(tier, side);
        if (isClear(trial)) {
          candidate = trial;
          break search;
        }
      }
    }
    // Prefer a slightly-overlapping close label over a far-away orphan line.
    if (!candidate) candidate = buildAt(0, preferredSide);

    const box = labelBoxOf(candidate);
    placed.push({ ...candidate, box });

    results[i] = {
      index: i,
      anchor: mid,
      path: [candidate.touch, candidate.elbow, candidate.tip],
      label: box.label,
      textAnchor: candidate.away > 0 ? "start" : "end",
      away: candidate.away,
      length: seg.length,
      text,
    };
  }

  return results.filter(Boolean);
}

/** Bold sans-serif average glyph width, as a fraction of font-size —
 *  used to estimate label extent since there's no text-measurement API
 *  available at layout time (the SVG hasn't rendered yet). */
const CHAR_WIDTH_EM = 0.62;

const STICKY_DRAWING_ID = "shape-builder-drawing-panel";

const STICKY_GAP_PX = 12; // breathing room between chrome and the card

/**
 * Brings a newly-added card fully into view. Native `focus()` scrolling
 * only cares about the length input, so the angle compass at the bottom
 * of the tile gets clipped by the viewport. Prefer showing the whole
 * card; if it cannot fit under sticky chrome, pin the bottom in view.
 */
function scrollCardUnderStickyDrawing(el) {
  if (!el) return;
  const panel = document.getElementById(STICKY_DRAWING_ID);
  const panelSticky =
    panel && getComputedStyle(panel).position === "sticky";
  const header = document.querySelector(
    ".project-clad-header--fullbleed, .cc-app-header",
  );
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const topObstacle =
    panelSticky && panel
      ? Math.max(headerBottom, panel.getBoundingClientRect().bottom)
      : Math.max(0, headerBottom);

  const rect = el.getBoundingClientRect();
  const bottomLimit = window.innerHeight - STICKY_GAP_PX;
  const topLimit = topObstacle + STICKY_GAP_PX;
  const room = bottomLimit - topLimit;

  let delta = 0;
  if (rect.height > room || rect.bottom > bottomLimit) {
    delta = rect.bottom - bottomLimit;
  } else if (rect.top < topLimit) {
    delta = rect.top - topLimit;
  }
  if (Math.abs(delta) > 1) {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }
}

/* ------------------------------------------------------------------ *
 * Segment model
 * ------------------------------------------------------------------ */

let segmentSeq = 0;
const nextId = (prefix) => `${prefix}-${++segmentSeq}`;

const createSegment = (angle, length) => ({ id: nextId("seg"), angle, length });

/** A fresh profile: one leg, pointing along the starting direction, awaiting its length. */
const createBlankProfile = () => [createSegment(0, undefined)];

export function itemsFromLegs(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return createBlankProfile();
  return legs.map((leg) => createSegment(leg.angle, leg.length));
}

/**
 * A follow group is stored as a single marker, not as baked legs. Its
 * geometry is re-derived from whatever precedes it on every expansion,
 * so flipping, rotating or re-dimensioning the profile upstream keeps
 * the return correct instead of stranding stale lengths.
 */
const createFollowMarker = (count) => ({
  id: nextId("follow"),
  kind: "follow",
  count,
  sideFlipped: false,
  /**
   * Per-leg manual values, keyed by leg index: `{ angle?, length? }`.
   * Anything absent stays derived from the profile being followed.
   */
  overrides: {},
});

const isFollow = (item) => item.kind === "follow";

/**
 * Flatten authored items into concrete geometry.
 * @returns {{ concrete, rows }} where `rows` maps each authored item to
 *   the slice of concrete segments it produced.
 */
function expandProfile(items, gap) {
  const concrete = [];
  const rows = items.map((item) => {
    const start = concrete.length;
    if (isFollow(item)) {
      const path = buildFollowPath(concrete, item.count, gap, item.sideFlipped) ?? [];
      path.forEach((leg, i) => {
        const manual = item.overrides?.[i] ?? {};
        const hasAngle = Number.isFinite(manual.angle);
        const hasLength = Number.isFinite(manual.length);
        concrete.push({
          ...leg,
          angle: hasAngle ? manual.angle : leg.angle,
          length: hasLength ? manual.length : leg.length,
          angleOverridden: hasAngle,
          lengthOverridden: hasLength,
          id: `${item.id}-${i}`,
          derivedFrom: item.id,
        });
      });
    } else {
      concrete.push(item);
    }
    return { item, start, length: concrete.length - start };
  });
  return { concrete, rows };
}

/* -- pure item updaters: used both to commit and to test a candidate -- */

const withLengths = (items, entries) =>
  items.map((item, i) => {
    const mine = entries.filter((e) => e.authoredIndex === i);
    if (!mine.length) return item;
    if (isFollow(item)) {
      const overrides = { ...item.overrides };
      mine.forEach((e) => {
        overrides[e.legIndex] = { ...overrides[e.legIndex], length: e.length };
      });
      return { ...item, overrides };
    }
    return { ...item, length: mine[0].length };
  });

const withPolar = (items, idx, angle, length) =>
  items.map((item, i) => (i === idx ? { ...item, angle, length } : item));

const withFollowPolar = (items, idx, leg, angle, length) =>
  items.map((item, i) =>
    i === idx
      ? { ...item, overrides: { ...item.overrides, [leg]: { angle, length } } }
      : item
  );

/** Developed width: what gets sheared off the coil before bending. */
const girthOf = (segments) =>
  segments.reduce((sum, s) => sum + (Number.isFinite(s.length) ? s.length : 0), 0);

// Two decimal places everywhere a length is displayed — three was
// making dimension labels on complex profiles noticeably harder to
// read. Underlying values keep full precision; only the display string
// rounds.
const formatLength = (n) =>
  Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";

/* ------------------------------------------------------------------ *
 * History — coalescing keeps typing from flooding the undo stack
 * ------------------------------------------------------------------ */

function useHistory(initial, limit = HISTORY_LIMIT) {
  const [state, setState] = useState({
    entries: [initial],
    index: 0,
    coalesceKey: null,
  });

  const present = state.entries[state.index];

  /**
   * @param coalesceKey  Consecutive commits sharing a key (e.g. typing in
   *   one field) replace the top entry instead of stacking new ones, so
   *   undo reverts a whole edit rather than one character.
   */
  const commit = useCallback(
    (updater, coalesceKey = null) => {
      setState((prev) => {
        const current = prev.entries[prev.index];
        const next = typeof updater === "function" ? updater(current) : updater;
        if (next === current) return prev;

        const kept = prev.entries.slice(0, prev.index + 1);

        if (coalesceKey !== null && coalesceKey === prev.coalesceKey) {
          kept[prev.index] = next;
          return { entries: kept, index: prev.index, coalesceKey };
        }

        const entries = [...kept, next];
        const overflow = Math.max(0, entries.length - limit);
        return {
          entries: entries.slice(overflow),
          index: entries.length - 1 - overflow,
          coalesceKey,
        };
      });
    },
    [limit]
  );

  const step = useCallback((delta) => {
    setState((prev) => ({
      ...prev,
      index: Math.min(prev.entries.length - 1, Math.max(0, prev.index + delta)),
      coalesceKey: null, // next edit starts a fresh entry
    }));
  }, []);

  return {
    present,
    commit,
    undo: useCallback(() => step(-1), [step]),
    redo: useCallback(() => step(1), [step]),
    canUndo: state.index > 0,
    canRedo: state.index < state.entries.length - 1,
  };
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

function Panel({ children, className = "" }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-gray-200 p-4 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Content for the tutorial. Kept as data (icon + title + body) rather
 * than hand-written JSX per row, so adding or reordering a topic is a
 * one-line change instead of touching markup. Each entry mirrors an
 * actual control in the app, using the same icon where one exists, so
 * the tutorial reads as a guide to what's on screen rather than a
 * generic how-to.
 */
const TUTORIAL_SECTIONS = [
  {
    icon: null,
    title: "1. Pick a gauge",
    body: "Everything else depends on this. Material thickness sets how tight a return bend or hem can fold, so nothing else unlocks until a gauge is selected.",
  },
  {
    icon: Plus,
    title: "2. Add a length",
    body: 'Tap "Add L" to add the next segment. It turns 90° off the piece before it by default, and it won\'t let a new length cross back over metal that\'s already there.',
  },
  {
    icon: null,
    title: "3. Set the exact length and angle",
    body: "Type an exact value into either field, or nudge the angle one degree at a time with the ▲▼ stepper next to it.",
  },
  {
    icon: RotateCw,
    title: "4. Quick angle tools",
    body: 'Rotate turns a segment 90° at a time. "⊥" snaps it to a true right angle off the piece before it. Flip mirrors that bend — and everything after it — to the other side. The compass grid below snaps straight to an exact direction, 0° to 315°.',
  },
  {
    icon: Pencil,
    title: "5. Draw it by hand",
    body: "Tap the pencil above the drawing, then drag on the canvas to sketch a segment — it snaps to the nearest 45° as you go. Lift your finger to commit it.",
  },
  {
    icon: null,
    title: "6. Edit right on the drawing",
    body: "Grab a point to stretch that segment — length and angle both follow your finger. Grab a line to slide it sideways without changing its angle. Hold Shift while dragging for finer control.",
  },
  {
    icon: FlipHorizontal2,
    title: "7. Follow profile",
    body: 'Add several segments at once instead of one at a time. Tap "Follow profile" and choose 1, 2, or 3 lengths — it folds the open end back and traces that many lengths in reverse, one material thickness away, which is the standard hem or return bend. Flip which side it folds toward, or type your own lengths once it\'s added.',
  },
  {
    icon: Undo2,
    title: "8. Undo, redo, reset",
    body: 'Every change can be undone. Reset, next to Gauge, clears the profile back to a single blank segment if you want to start over completely.',
  },
  {
    icon: ShoppingCart,
    title: "9. Add to cart",
    body: "Once the profile is complete and clear of warnings, add it to your cart.",
  },
];

function TutorialModal({ onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-heading"
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: 60 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "85vh" }}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl
          flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 id="tutorial-heading" className="text-lg font-black text-black">
            How the builder works
          </h2>
          <IconButton label="Close tutorial" onClick={onClose} className="w-9 h-9">
            <X size={18} />
          </IconButton>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {TUTORIAL_SECTIONS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <div
                className="shrink-0 w-9 h-9 rounded-xl border border-gray-200
                  flex items-center justify-center text-gray-600"
              >
                {Icon ? <Icon size={17} /> : <span className="text-lg leading-none">⊥</span>}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800">{title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            style={{ backgroundColor: COLOR.accent, color: "#fff" }}
            className={`w-full rounded-xl py-3 font-bold active:scale-[0.99]
              transition ${FOCUS_RING}`}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, active, children, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Active-state color is inline, not a class: an arbitrary-value
      // background can silently fail to compile depending on the host
      // build, leaving white text with nothing behind it. A style prop
      // can't be dropped that way.
      style={
        active
          ? { backgroundColor: COLOR.accent, borderColor: COLOR.accent, color: "#fff" }
          : undefined
      }
      className={`shrink-0 flex items-center justify-center rounded-xl border
        transition-colors disabled:opacity-30 ${FOCUS_RING}
        ${active
          ? ""
          : "border-gray-300 text-gray-600 hover:bg-gray-50 active:bg-gray-100"}
        ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Vertical +/- pair for nudging a value. Native number spinners are tiny
 * and hidden on most mobile browsers, so angles get an explicit control
 * sized for a fingertip.
 */
function Stepper({ onStep, label, step = 1 }) {
  return (
    <div className="shrink-0 w-11 h-11 flex flex-col rounded-xl border
      border-gray-300 overflow-hidden">
      {[
        { dir: 1, Icon: ChevronUp, word: "Increase" },
        { dir: -1, Icon: ChevronDown, word: "Decrease" },
      ].map(({ dir, Icon, word }) => (
        <button
          key={dir}
          type="button"
          aria-label={`${word} ${label} by ${step}°`}
          onClick={() => onStep(dir * step)}
          className={`flex-1 flex items-center justify-center text-gray-600
            hover:bg-gray-50 active:bg-gray-100 transition-colors ${FOCUS_RING}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

/**
 * Numeric input that keeps its own draft string. Without this, clearing
 * the field yields Number("") === 0 and the shape collapses mid-typing;
 * partial input like "1." yields NaN and blanks the drawing.
 */
function NumberField({
  id, value, onChange, onFocus, onBlur,
  min = -Infinity, step = "any", placeholder, className = "", inputRef,
}) {
  const [draft, setDraft] = useState(() => formatLength(value));
  const [editing, setEditing] = useState(false);

  // Adopt external changes (undo, presets, gauge) only while idle.
  useEffect(() => {
    if (!editing) setDraft(formatLength(value));
  }, [value, editing]);

  return (
    <input
      ref={inputRef}
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed) && parsed >= min) {
          onChange(parsed);
        }
      }}
      onFocus={() => {
        setEditing(true);
        onFocus?.();
      }}
      onBlur={() => {
        setEditing(false);
        setDraft(formatLength(value)); // discard partial input
        onBlur?.();
      }}
      className={`border border-gray-300 rounded-xl px-4 py-3 text-gray-800
        transition-shadow ${FOCUS_RING} ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

function ProfileDrawing({
  view, drawMode, preview, highlight, onHighlight, svgRef, pointerHandlers,
  onBeginDrag, dragging,
}) {
  const { viewBox, points, leaders, stroke, strokeBody, strokeOutline, fontSize, description, bendRadius } = view;
  const [hoveredHandle, setHoveredHandle] = useState(null);
  const outlineW = strokeOutline ?? stroke * 1.55;
  const bodyW = strokeBody ?? stroke * 1.05;

  const profilePath = useMemo(
    () => profilePathWithBendRadius(points, bendRadius ?? 0),
    [points, bendRadius],
  );

  const showVertexDot = (i) => {
    if (dragging?.kind === "vertex" && dragging.segIndex + 1 === i) return true;
    if (hoveredHandle?.kind === "vertex" && hoveredHandle.index === i) return true;
    if (
      hoveredHandle?.kind === "line" &&
      (hoveredHandle.index === i || hoveredHandle.index + 1 === i)
    ) {
      return true;
    }
    if (highlight != null && (i === highlight || i === highlight + 1)) return true;
    return false;
  };

  // The panel's height comes entirely from this SVG, so it is sized with
  // inline styles rather than utility classes that could be stripped at
  // build time.
  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      role="img"
      aria-label={description}
      className="select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "block",
        margin: "0 auto",
        height: DRAWING_HEIGHT,
        aspectRatio: "1 / 1",
        maxWidth: "100%",
        touchAction: drawMode ? "none" : "auto",
        cursor: drawMode ? "crosshair" : "default",
        overflow: "visible",
      }}
      {...pointerHandlers}
    >
      {/*
        Sheet-metal look: a light grey body with a thin black outline. Drawn as two strokes
        of the same path (dark under, grey over) so the formed fillet stays crisp. Widths are
        capped by the tightest face gap so return bends keep a visible air gap.
      */}
      <path
        d={profilePath}
        fill="none"
        stroke={COLOR.profileOutline}
        strokeWidth={outlineW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={profilePath}
        fill="none"
        stroke={COLOR.profile}
        strokeWidth={bodyW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* highlighted segment, mirrored from the list below */}
      {highlight != null && points[highlight + 1] && (
        <line
          x1={points[highlight].x}
          y1={points[highlight].y}
          x2={points[highlight + 1].x}
          y2={points[highlight + 1].y}
          stroke={COLOR.highlight}
          strokeWidth={stroke * 2.2}
          strokeLinecap="round"
          opacity={0.85}
        />
      )}

      {/*
        Vertex dots stay hidden until the pointer is near them (or a drag is
        already under way). Always-on red nodes fought the formed-metal look
        and made the drawing feel like a diagram rather than a part.
      */}
      {points.map((p, i) =>
        showVertexDot(i) ? (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r={stroke * 1.4}
            fill={COLOR.accent}
            style={{ pointerEvents: "none" }}
          />
        ) : null,
      )}

      {leaders.map((l) => {
        if (!l?.path?.[0] || !l.label) return null;
        const color = highlight === l.index ? COLOR.highlight : COLOR.accent;
        const touch = l.path[0];
        const elbow = l.path[1] ?? l.path[0];
        const tip = l.path[2] ?? elbow;
        // Degenerate / zero-length leaders paint as a stray pink tick.
        if (
          !Number.isFinite(touch.x) ||
          !Number.isFinite(tip.x) ||
          !Number.isFinite(l.label.x) ||
          !Number.isFinite(l.label.y)
        ) {
          return null;
        }
        const dx = touch.x - elbow.x;
        const dy = touch.y - elbow.y;
        const len = Math.hypot(dx, dy) || 1;
        /* Arrow points at the metal (tip at `touch`, base back along the leader). */
        const ah = Math.max(stroke * 2.4, fontSize * 0.55);
        const aw = ah * 0.55;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const base = { x: touch.x - ux * ah, y: touch.y - uy * ah };
        const arrowPoints = [
          `${touch.x},${touch.y}`,
          `${base.x + px * aw},${base.y + py * aw}`,
          `${base.x - px * aw},${base.y - py * aw}`,
        ].join(" ");
        /* Line stops at the arrow base so the stroke doesn't punch through the tip. */
        const linePoints = [base, elbow, tip]
          .map((p) => `${p.x},${p.y}`)
          .join(" ");
        return (
          <g
            key={l.index}
            onPointerEnter={() => onHighlight(l.index)}
            onPointerLeave={() => onHighlight(null)}
            style={{ cursor: "pointer" }}
          >
            <polyline
              points={linePoints}
              fill="none"
              stroke={color}
              strokeWidth={stroke * 0.35}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polygon points={arrowPoints} fill={color} stroke="none" />
            <text
              x={l.label.x}
              y={l.label.y}
              fontSize={fontSize}
              fontWeight="600"
              fill={color}
              textAnchor={l.textAnchor}
              dominantBaseline="middle"
            >
              {l.text}
            </text>
          </g>
        );
      })}

      {/* Drag layer: fat invisible targets so touch has something to grab. */}
      {!drawMode && (
        <g>
          {/* L1 is the fixed starting point — set numerically only, so it
              gets no drag handles, and neither does the vertex that would
              edit it. */}
          {points.slice(0, -1).map((p, i) =>
            i === 0 ? null : (
              <line
                key={`grab-line-${i}`}
                x1={p.x} y1={p.y}
                x2={points[i + 1].x} y2={points[i + 1].y}
                stroke="transparent"
                strokeWidth={stroke * 7}
                strokeLinecap="round"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={onBeginDrag("line", i)}
                onPointerEnter={() => {
                  onHighlight(i);
                  setHoveredHandle({ kind: "line", index: i });
                }}
                onPointerLeave={() => {
                  onHighlight(null);
                  setHoveredHandle(null);
                }}
              />
            )
          )}
          {points.map((p, i) =>
            i <= 1 ? null : (
              <circle
                key={`grab-pt-${i}`}
                cx={p.x} cy={p.y}
                r={stroke * 5}
                fill="transparent"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={onBeginDrag("vertex", i)}
                onPointerEnter={() => setHoveredHandle({ kind: "vertex", index: i })}
                onPointerLeave={() => setHoveredHandle(null)}
              />
            )
          )}
        </g>
      )}

      {/* Emphasise the handle in play. */}
      {dragging?.kind === "vertex" && points[dragging.segIndex + 1] && (
        <circle
          cx={points[dragging.segIndex + 1].x}
          cy={points[dragging.segIndex + 1].y}
          r={stroke * 3}
          fill="none"
          stroke={COLOR.highlight}
          strokeWidth={stroke * 0.6}
        />
      )}

      {preview.length > 1 && (
        <>
          <polyline
            points={preview.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={COLOR.draw}
            strokeWidth={stroke * 1.1}
            strokeDasharray={`${stroke * 2} ${stroke * 1.4}`}
            strokeLinecap="round"
          />
          {preview.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={stroke * 0.9} fill={COLOR.draw} />
          ))}
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Segment editor row
 * ------------------------------------------------------------------ */

function SegmentCard({
  segment, index, authoredIndex, canRemove,
  actions, onFocusField, onBlurField, onHighlight, highlighted,
  focusRequest, onFocusConsumed,
}) {
  const uid = useId();
  const angleId = `${uid}-angle`;
  const lengthId = `${uid}-length`;
  const angleLabel =
    index === 0 ? "Starting direction (°)" : `A${index} — turn before L${index + 1} (°)`;

  // A just-added segment docks under the sticky drawing (card top flush
  // against the panel, per the reference screenshot) and grabs focus on
  // its length field — the natural next thing to type. Card and input
  // are separate refs: aligning to the input alone would leave the
  // card's own "L2 length (in)" label hidden behind the panel.
  const cardRef = useRef(null);
  const lengthInputRef = useRef(null);
  useEffect(() => {
    if (focusRequest !== segment.id) return;
    lengthInputRef.current?.focus({ preventScroll: true });
    const card = cardRef.current;
    requestAnimationFrame(() => scrollCardUnderStickyDrawing(card));
    onFocusConsumed();
  }, [focusRequest, segment.id, onFocusConsumed]);

  return (
    <div
      ref={cardRef}
      onPointerEnter={() => onHighlight(index)}
      onPointerLeave={() => onHighlight(null)}
      className={`bg-white rounded-2xl shadow-sm border p-4 transition-colors ${
        highlighted ? "border-[#f59e0b]" : "border-gray-200"
      }`}
    >
      <div className="flex items-end gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <label htmlFor={lengthId} className="block text-sm font-bold text-gray-700 mb-2">
            L{index + 1} length (in)
            {index === 0 && (
              <span className="ml-1 font-normal text-gray-400">· starting point</span>
            )}
          </label>
          <NumberField
            id={lengthId}
            inputRef={lengthInputRef}
            value={segment.length}
            min={0}
            placeholder="Length"
            onChange={(v) => actions.setLength(authoredIndex, v)}
            onFocus={() => onFocusField(`L${index + 1} length (in)`)}
            onBlur={onBlurField}
            className="w-full"
          />
        </div>
        {canRemove && (
          <IconButton
            label={`Remove segment L${index + 1}`}
            onClick={() => actions.remove(authoredIndex)}
            className="mb-1 w-11 h-11"
          >
            <X size={18} />
          </IconButton>
        )}
      </div>

      <div className="mb-3">
        <label htmlFor={angleId} className="block text-sm font-bold text-gray-700 mb-2">
          {angleLabel}
        </label>
        <div className="flex gap-2">
          <NumberField
            id={angleId}
            value={segment.angle}
            onChange={(v) => actions.setAngle(authoredIndex, normalize(v))}
            onFocus={() => onFocusField(angleLabel)}
            onBlur={onBlurField}
            className="flex-1 min-w-0"
          />
          <Stepper
            label={`angle for L${index + 1}`}
            onStep={(delta) =>
              actions.setAngle(authoredIndex, normalize(segment.angle + delta))
            }
          />
          <IconButton
            label="Rotate this segment 90°"
            onClick={() => actions.rotate(authoredIndex)}
            className="w-11 h-11"
          >
            <RotateCw size={18} />
          </IconButton>
          {index > 0 && (
            <IconButton
              label="Snap to a true 90° off the previous segment"
              onClick={() => actions.perpendicular(authoredIndex)}
              className="w-11 h-11 text-lg font-bold"
            >
              ⊥
            </IconButton>
          )}
          <IconButton
            label="Mirror this bend and everything after it"
            onClick={() => actions.flip(authoredIndex)}
            className="w-11 h-11"
          >
            <FlipHorizontal2 size={18} />
          </IconButton>
        </div>

        <div className="grid grid-cols-4 gap-1.5 mt-3">
          {COMPASS.map(({ arrow, deg }) => (
            <button
              key={deg}
              type="button"
              onClick={() => actions.snapTo(authoredIndex, deg)}
              aria-label={`Point segment ${index + 1} at ${deg} degrees`}
              className={`rounded-lg border border-gray-200 text-gray-600 text-xs
                font-semibold py-1.5 hover:bg-gray-50 active:bg-gray-100
                transition-colors ${FOCUS_RING}`}
            >
              {arrow} {deg}°
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/**
 * A follow group renders as one card. Its legs are geometry, not data —
 * shown read-only so it's clear they track the profile rather than
 * holding independent values.
 */
function FollowCard({
  item, legs, firstLabel, authoredIndex, actions,
  onFocusField, onBlurField, onHighlight, highlighted,
  focusRequest, onFocusConsumed,
}) {
  const hasOverrides = Object.values(item.overrides ?? {}).some(
    (o) => Number.isFinite(o?.angle) || Number.isFinite(o?.length)
  );

  // Same docking behaviour as a plain segment: card top flush under the
  // sticky drawing, focus on the first leg's length field.
  const cardRef = useRef(null);
  const firstLegRef = useRef(null);
  useEffect(() => {
    if (focusRequest !== `${item.id}:0`) return;
    firstLegRef.current?.focus({ preventScroll: true });
    const card = cardRef.current;
    requestAnimationFrame(() => scrollCardUnderStickyDrawing(card));
    onFocusConsumed();
  }, [focusRequest, item.id, onFocusConsumed]);

  return (
    <div
      ref={cardRef}
      onPointerEnter={() => onHighlight(firstLabel - 1)}
      onPointerLeave={() => onHighlight(null)}
      className={`bg-white rounded-2xl shadow-sm border p-4 transition-colors ${
        highlighted ? "border-[#f59e0b]" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <span className="text-sm font-bold text-gray-700">Follow profile</span>
          <p className="text-xs text-gray-400 mt-0.5">
            Tracks the profile until you set a value by hand.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <IconButton
            label="Follow the other side of the profile"
            onClick={() => actions.toggleFollowSide(authoredIndex)}
            active={item.sideFlipped}
            className="w-9 h-9"
          >
            <FlipHorizontal2 size={16} />
          </IconButton>
          <IconButton
            label="Remove follow group"
            onClick={() => actions.remove(authoredIndex)}
            className="w-9 h-9"
          >
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div
        role="group"
        aria-label="Lengths to follow"
        className="flex gap-1.5 mb-3"
      >
        {[1, 2, 3].map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => actions.setFollowCount(authoredIndex, count)}
            aria-pressed={item.count === count}
            aria-label={`Follow ${count} length${count === 1 ? "" : "s"}`}
            className={`w-9 h-8 rounded-lg border-2 text-sm font-bold transition-colors
              ${item.count === count
                ? "border-[#c8102e] bg-red-50 text-[#c8102e]"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"}
              ${FOCUS_RING}`}
          >
            {count}
          </button>
        ))}
      </div>

      {legs.length === 0 ? (
        <p className="text-xs text-gray-400">Profile too short to follow.</p>
      ) : (
        <div className="space-y-2">
          {legs.map((leg, i) => (
            <div key={leg.id} className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600 w-14 shrink-0">
                L{firstLabel + i}
                <span
                  className={`ml-1 font-normal ${
                    leg.angleOverridden ? "text-[#c8102e]" : "text-gray-400"
                  }`}
                  title={leg.angleOverridden ? "Angle set by hand" : "Angle from profile"}
                >
                  {Math.round(leg.angle)}°
                </span>
              </span>
              <NumberField
                value={leg.length}
                min={0}
                inputRef={i === 0 ? firstLegRef : undefined}
                onChange={(v) => actions.setFollowLength(authoredIndex, i, v)}
                onFocus={() => onFocusField(`L${firstLabel + i} length (in)`)}
                onBlur={onBlurField}
                className={`flex-1 min-w-0 !py-2 text-sm ${
                  leg.lengthOverridden ? "border-[#c8102e]" : ""
                }`}
              />
              <Stepper
                label={`angle for L${firstLabel + i}`}
                onStep={(delta) =>
                  actions.setFollowAngle(authoredIndex, i, normalize(leg.angle + delta))
                }
              />
            </div>
          ))}
          {hasOverrides && (
            <button
              type="button"
              onClick={() => actions.clearFollowOverrides(authoredIndex)}
              className={`text-xs text-gray-400 flex items-center gap-1
                hover:text-gray-600 rounded ${FOCUS_RING}`}
            >
              <RotateCcw size={12} /> reset to profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

export default function ShapeBuilder({
  initialSheetPrices, onSheetPricesChange,
  initialLegs = [],
  initialGauge = "",
  initialColor = "",
  /**
   * NOTE FOR THE CURSOR BUILD — Add to Cart.
   *
   * This component has no product/variant/cart context, so it can't
   * call Shopify directly. `onAddToCart` receives a plain payload
   * (gauge, color, girth, segments, bend count, computed price)
   * and the parent turns that into Shopify line properties + library publish.
   */
  onAddToCart,
  // Sheet cost and markup are business numbers, not something a
  // storefront customer should see or edit — set them in the admin and
  // pass them down as initialSheetPrices there. Off by default so any
  // existing storefront embed stays hidden without a prop change.
  showPricing = false,
} = {}) {
  const {
    present: items, commit, undo, redo, canUndo, canRedo,
  } = useHistory(itemsFromLegs(initialLegs));

  const [gauge, setGauge] = useState(
    initialGauge || (Array.isArray(initialLegs) && initialLegs.length ? "24" : ""),
  );
  const [color, setColor] = useState(initialColor || DEFAULT_SHAPE_COLOUR);
  const [sheetPrices, setSheetPrices] = useState(
    initialSheetPrices ?? DEFAULT_SHEET_PRICE
  );
  const [bendOverride, setBendOverride] = useState(null);
  /** How many of this profile go into the cart in one click. */
  const [quantity, setQuantity] = useState(1);
  const updateSheetPrice = useCallback(
    (ga, price) => {
      setSheetPrices((prev) => {
        const next = { ...prev, [ga]: price };
        onSheetPricesChange?.(next);
        return next;
      });
    },
    [onSheetPricesChange]
  );
  const [, setActiveField] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);

  // Which field should grab focus once it's on screen. A plain segment's
  // key is its id; a follow group's first leg is `${item.id}:0`. Cleared
  // by the row that consumes it, so it never re-fires on an unrelated
  // re-render.
  const [focusRequest, setFocusRequest] = useState(null);
  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);
  const [highlight, setHighlight] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drag, setDrag] = useState(null);
  const [snapStep, setSnapStep] = useState(DEFAULT_SNAP);

  // Ref, not state: engaging mid-gesture must not trigger a re-render.
  const dragEngaged = useRef(false);
  const [draw, setDraw] = useState(null);
  const svgRef = useRef(null);

  // Always holds the latest computed view, independent of render order —
  // lets gesture-start handlers (declared above where `view` is computed)
  // read a fresh snapshot without needing `view` in their dependency
  // arrays, which would recreate them on every geometry change.
  const viewRef = useRef(null);
  // Camera snapshot taken the instant a gesture begins. While a drag or
  // freehand stroke is in progress we render with THIS instead of the
  // live view, so editing a line only edits the line — it never
  // recenters or rescales the canvas out from under your finger.
  const frozenCamera = useRef(null);

  const hasGauge = Boolean(gauge);
  const thickness = GAUGE_THICKNESS[gauge || FALLBACK_GAUGE];
  const isFraming = FRAMING_GAUGES.has(gauge);
  const stubLength = thickness * 2;

  // Follow groups re-derive here, so upstream edits can never strand
  // stale return legs.
  const { concrete: segments, rows } = useMemo(
    () => expandProfile(items, stubLength),
    [items, stubLength]
  );
  const points = useMemo(() => computePoints(segments), [segments]);
  const dirs = useMemo(() => getDirections(segments), [segments]);

  /** Overall size of the profile — used to scale drag thresholds. */
  const viewSpan = useMemo(() => {
    const [minX, maxX] = extent(points.map((p) => p.x));
    const [minY, maxY] = extent(points.map((p) => p.y));
    return Math.max(maxX - minX, maxY - minY, 1);
  }, [points]);

  /* ---------------- mutations ---------------- */

  const actions = useMemo(() => {
    // All indices below address the authored `items` list, not the
    // expanded geometry — a follow group is one addressable thing.
    const mapAt = (idx, fn) => (list) =>
      list.map((item, i) => (i === idx ? fn(item) : item));

    /** Absolute heading entering the authored item at `idx`. */
    const headingBefore = (list, idx) => {
      const { concrete, rows: r } = expandProfile(list, stubLength);
      const start = r[idx]?.start ?? concrete.length;
      if (start === 0) return 0;
      return getDirections(concrete)[start - 1];
    };

    return {
      setAngle: (idx, angle) =>
        commit(mapAt(idx, (s) => ({ ...s, angle })), `angle:${idx}`),

      setLength: (idx, length) =>
        commit(mapAt(idx, (s) => ({ ...s, length })), `length:${idx}`),

      /** Angle and length together — one history entry per drag. */
      setPolar: (idx, angle, length) =>
        commit((list) => withPolar(list, idx, angle, length), `polar:${idx}`),

      /**
       * Several lengths at once. A lateral drag touches up to three legs,
       * which must land as a single history entry.
       * @param entries [{ authoredIndex, legIndex, length }]
       */
      setLengths: (entries, key) =>
        commit((list) => withLengths(list, entries), key),

      rotate: (idx) =>
        commit(mapAt(idx, (s) => ({ ...s, angle: normalize(s.angle + 90) }))),

      perpendicular: (idx) =>
        commit(mapAt(idx, (s) => ({ ...s, angle: s.angle > 0 ? -90 : 90 }))),

      setFollowCount: (idx, count) =>
        commit(mapAt(idx, (s) => ({ ...s, count }))),

      toggleFollowSide: (idx) =>
        commit(mapAt(idx, (s) => ({ ...s, sideFlipped: !s.sideFlipped }))),

      setFollowLength: (idx, leg, length) =>
        commit(
          mapAt(idx, (s) => ({
            ...s,
            overrides: { ...s.overrides, [leg]: { ...s.overrides?.[leg], length } },
          })),
          `follow:${idx}:${leg}`
        ),

      setFollowAngle: (idx, leg, angle) =>
        commit(
          mapAt(idx, (s) => ({
            ...s,
            overrides: { ...s.overrides, [leg]: { ...s.overrides?.[leg], angle } },
          })),
          `followAngle:${idx}:${leg}`
        ),

      /** Pin both angle and length on one followed leg — used by dragging. */
      setFollowPolar: (idx, leg, angle, length) =>
        commit(
          (list) => withFollowPolar(list, idx, leg, angle, length),
          `followPolar:${idx}:${leg}`
        ),

      /** Drop manual lengths and let the group track the profile again. */
      clearFollowOverrides: (idx) =>
        commit(mapAt(idx, (s) => ({ ...s, overrides: {} }))),

      remove: (idx) => commit((list) => list.filter((_, i) => i !== idx)),

      /** Clear the profile back to a single blank leg. Leaves gauge alone. */
      reset: () => commit(createBlankProfile()),

      // Derived inside the updater — reading render-scope state here
      // would go stale under batched updates.
      snapTo: (idx, target) =>
        commit((list) =>
          mapAt(idx, (s) => ({
            ...s,
            angle: normalize(target - headingBefore(list, idx)),
          }))(list)
        ),

      /**
       * Mirror this bend and everything downstream. Authored segments are
       * reflected explicitly; follow groups need no handling — they
       * re-derive from the mirrored profile on the next expansion, which
       * is exactly what makes them behave as one item.
       */
      flip: (idx) =>
        commit((list) => {
          const { concrete, rows: r } = expandProfile(list, stubLength);
          const d = getDirections(concrete);
          const axis = r[idx].start > 0 ? d[r[idx].start - 1] : 0;

          const out = list.slice(0, idx);
          let heading = axis;
          for (let i = idx; i < list.length; i += 1) {
            const item = list[i];
            if (isFollow(item)) {
              out.push(item);
              const grown = expandProfile(out, stubLength).concrete;
              const gd = getDirections(grown);
              heading = gd.length ? gd[gd.length - 1] : heading;
            } else {
              const absolute = normalize(2 * axis - d[r[i].start]);
              out.push({ ...item, angle: normalize(absolute - heading) });
              heading = absolute;
            }
          }
          return out;
        }),

      /**
       * Turn 90° off the previous leg — the overwhelmingly common bend.
       * Both hands are tried so the new leg folds toward open space
       * rather than back into the profile; only if neither is clear does
       * pickClearDirection widen the search.
       */
      // Build the new segment synchronously from the current items,
      // then commit it — NOT the other way around. A `commit` updater
      // runs during React's render phase, not inline at the call site,
      // so anything assigned from inside one (like a "here's the id I
      // just created" variable) is read back before it's ever set. This
      // is why the previous version silently requested focus on `null`.
      addSegment: () => {
        const expanded = expandProfile(items, stubLength).concrete;
        const d = getDirections(expanded);
        const heading = d[d.length - 1];

        const points = computePoints(expanded);
        const origin = points[points.length - 1];
        const isClear = (dir) => {
          const u = unitVec(dir);
          const end = {
            x: origin.x + u.x * DEFAULT_LENGTH,
            y: origin.y + u.y * DEFAULT_LENGTH,
          };
          for (let k = 0; k < points.length - 2; k += 1) {
            if (segmentsInterfere(origin, end, points[k], points[k + 1])) return false;
          }
          return true;
        };

        const right = normalize(heading + 90);
        const left = normalize(heading - 90);
        const preferred = isClear(right) ? right : isClear(left) ? left : right;
        const target = pickClearDirection(expanded, preferred, DEFAULT_LENGTH);
        const remaining = MAX_GIRTH - girthOf(expanded);
        if (remaining < 1 / 16) return; // no coil left to bend

        const length = Math.min(
          fitLength(computePoints(expanded), target, DEFAULT_LENGTH),
          remaining
        );
        const seg = createSegment(normalize(target - heading), length);
        frozenCamera.current = null;
        commit((list) => [...list, seg]);
        setFocusRequest(seg.id);
      },

      /** Append a follow group; its legs stay derived, never baked. */
      followProfile: (count) => {
        const marker = createFollowMarker(count);
        commit((list) => [...list, marker]);
        setFocusRequest(`${marker.id}:0`);
      },
    };
  }, [commit, stubLength, setFocusRequest, items]);

  /* ---------------- freehand drawing ---------------- */

  /** Which authored item owns each concrete segment. */
  const ownerOf = useMemo(() => {
    const map = [];
    rows.forEach((row, authoredIndex) => {
      for (let k = 0; k < row.length; k += 1) {
        map[row.start + k] = {
          authoredIndex,
          derived: isFollow(row.item),
          legIndex: k,
        };
      }
    });
    return map;
  }, [rows]);

  const toSvgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  /**
   * Direct manipulation. A vertex stretches the leg behind it — length
   * and direction follow the pointer. A line only slides along its own
   * axis, so grabbing the middle of a leg changes its length without
   * disturbing its angle.
   */
  const beginDrag = useCallback(
    (kind, index) => (e) => {
      if (drawMode) return;
      const segIndex = kind === "vertex" ? index - 1 : index;
      if (segIndex <= 0) return; // L1 is numeric-entry only
      e.stopPropagation();
      const p = toSvgPoint(e);
      if (!p) return;
      svgRef.current.setPointerCapture(e.pointerId);
      dragEngaged.current = false;
      frozenCamera.current = viewRef.current;
      setDrag({
        kind,
        segIndex,
        origin: p,
        pxScale: pxScaleOf(svgRef.current),
        startLength: segments[segIndex]?.length ?? 0,
        baseSegments: segments,
        baseItems: items,
        // Editing an already-invalid profile stays possible: a drag is
        // only refused if it makes the collision count worse.
        baseIssues: findSelfIntersections(
          computePoints(segments),
          thickness * 0.9,
        ).length,
      });
    },
    [drawMode, segments, items, toSvgPoint, thickness]
  );

  const applyDrag = useCallback(
    (pointer, precise = false) => {
      const { kind, segIndex, origin, pxScale, startLength, baseSegments, baseItems, baseIssues } = drag;
      const owner = ownerOf[segIndex];
      if (!owner) return;

      // Ignore the first small movement so a tap or a shaky finger can't
      // nudge the sketch. Once past the threshold the drag stays engaged.
      // Measured in real screen pixels via the captured zoom scale, so it
      // means the same physical distance whether the profile is 4" or 48".
      const travel = sub(pointer, origin);
      if (!dragEngaged.current) {
        if (Math.hypot(travel.x, travel.y) < DEAD_ZONE_PX / pxScale) return;
        dragEngaged.current = true;
      }

      // Shift = fine control: finest snap, no angle magnet.
      const step = precise ? 1 / 16 : snapStep;
      const magnet = precise ? 0 : ANGLE_MAGNET;
      const round = (n) => Math.max(step, Math.round(n / step) * step);

      // One thickness of clearance: flanges may hug a hem, never occupy
      // the same space. Legitimate follow returns sit at ~2× thickness.
      const clearance = thickness * 0.9;

      const probe = (candidate) => {
        const { concrete } = expandProfile(candidate, stubLength);
        const hits = findSelfIntersections(computePoints(concrete), clearance);
        if (hits.length > baseIssues) return false;
        const girth = girthOf(concrete);
        if (girth > MAX_GIRTH && girth > girthOf(baseSegments)) return false;
        return true;
      };

      /**
       * Metal can't pass through itself. Binary-search the largest fraction
       * of the intended move that stays clear so a fast drag can't jump
       * through a flange in one pointer frame and land "valid" on the
       * far side.
       */
      const commitClamped = (atFraction) => {
        if (probe(atFraction(1))) {
          commit(() => atFraction(1), `drag:${kind}:${segIndex}`);
          return;
        }
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (probe(atFraction(mid))) lo = mid;
          else hi = mid;
        }
        if (lo > 1e-3) commit(() => atFraction(lo * 0.98), `drag:${kind}:${segIndex}`);
      };

      // Sliding a line: project the drag onto the leg's normal and shift
      // the whole edge sideways, letting its neighbours take up the slack.
      if (kind === "line") {
        const baseDirs = getDirections(baseSegments);
        const u = unitVec(baseDirs[segIndex]);
        const normal = { x: -u.y, y: u.x };
        const moved = sub(pointer, origin);
        const offset = moved.x * normal.x + moved.y * normal.y;

        const entriesForOffset = (off) => {
          const changes = translateSegment(baseSegments, segIndex, off);
          if (!changes.length || changes.some((c) => c.segIndex === 0)) return null;
          const entries = changes
            .map(({ segIndex: si, length: len }) => {
              const target = ownerOf[si];
              if (!target) return null;
              return {
                authoredIndex: target.authoredIndex,
                legIndex: target.legIndex,
                length: round(len),
              };
            })
            .filter(Boolean);
          return entries.length ? entries : null;
        };

        // Sliding L2 would normally stretch L1 to meet it; since L1 is
        // fixed, the move has no valid solution and is refused outright.
        if (!entriesForOffset(offset)) return;

        commitClamped((t) => {
          const entries = entriesForOffset(offset * t);
          return entries ? withLengths(baseItems, entries) : baseItems;
        });
        return;
      }

      // Stretching a vertex: aim the leg at the pointer. Followed legs
      // behave identically — the drag simply pins that leg, overriding
      // the angle it would otherwise inherit from the profile.
      const baseDirs = getDirections(baseSegments);
      const basePts = computePoints(baseSegments);
      const anchor = basePts[segIndex];
      const reach = sub(pointer, anchor);
      const distance = Math.hypot(reach.x, reach.y);
      if (distance < 1e-3) return;

      let absolute = (Math.atan2(reach.y, reach.x) * 180) / Math.PI;
      const snapped = snapAngle(absolute);
      // Magnet so square bends stay square through a drag.
      if (Math.abs(normalize(snapped - absolute)) < magnet) absolute = snapped;

      const heading = segIndex > 0 ? baseDirs[segIndex - 1] : 0;
      const startAbs = baseDirs[segIndex];
      const startLen = Number.isFinite(baseSegments[segIndex]?.length)
        ? baseSegments[segIndex].length
        : startLength;
      const targetLen = round(distance);
      const deltaAbs = normalize(absolute - startAbs);

      commitClamped((t) => {
        const absDir = startAbs + deltaAbs * t;
        const len = Math.max(step, startLen + (targetLen - startLen) * t);
        const angle = normalize(absDir - heading);
        return owner.derived
          ? withFollowPolar(baseItems, owner.authoredIndex, owner.legIndex, angle, len)
          : withPolar(baseItems, owner.authoredIndex, angle, len);
      });
    },
    [drag, ownerOf, stubLength, thickness, commit, snapStep]
  );

  const pointerHandlers = useMemo(
    () => ({
      onPointerDown: (e) => {
        if (!drawMode) return;
        const p = toSvgPoint(e);
        if (!p) return;
        svgRef.current.setPointerCapture(e.pointerId);
        frozenCamera.current = viewRef.current;
        setDraw({ pointer: p, pxScale: pxScaleOf(svgRef.current) });
      },
      onPointerMove: (e) => {
        const p = toSvgPoint(e);
        if (!p) return;
        if (drag) {
          applyDrag(p, e.shiftKey);
          return;
        }
        // Merge, don't replace — dropping pxScale here would silently
        // fall back to a scale of 1, turning the pixel-based thresholds
        // into SVG-unit thresholds instead: 14px meant to be a fingertip's
        // worth of travel would instead demand dragging nearly across
        // the whole canvas before anything registered.
        if (drawMode && draw) setDraw((prev) => ({ ...prev, pointer: p }));
      },
      onPointerUp: () => {
        if (drag) {
          dragEngaged.current = false;
          frozenCamera.current = null;
          setDrag(null);
          return;
        }
        if (!drawMode || !draw) return;
        const origin = points[points.length - 1];
        const delta = sub(draw.pointer, origin);
        const dist = Math.hypot(delta.x, delta.y);
        const commitDist = DRAW_COMMIT_PX / (draw.pxScale || 1);

        if (dist >= commitDist) {
          const length = Math.round(dist * 4) / 4; // nearest quarter inch
          const wanted = snapAngle((Math.atan2(delta.y, delta.x) * 180) / Math.PI);
          const target = pickClearDirection(segments, wanted, length);
          const prevDir = dirs.length ? dirs[dirs.length - 1] : 0;
          commit((list) => [...list, createSegment(normalize(target - prevDir), length)]);
        }
        frozenCamera.current = null;
        setDraw(null);
      },
      onPointerCancel: () => {
        frozenCamera.current = null;
        setDrag(null);
        setDraw(null);
      },
    }),
    [drawMode, draw, drag, applyDrag, points, dirs, segments, commit, toSvgPoint]
  );

  const preview = useMemo(() => {
    if (!draw) return [];
    const start = points[points.length - 1];
    const delta = sub(draw.pointer, start);
    const dist = Math.hypot(delta.x, delta.y);
    if (dist < DRAW_COMMIT_PX / (draw.pxScale || 1)) return [];
    const u = unitVec(snapAngle((Math.atan2(delta.y, delta.x) * 180) / Math.PI));
    return [start, { x: start.x + u.x * dist, y: start.y + u.y * dist }];
  }, [draw, points]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDraw(null);
        setDrawMode(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ---------------- derived view model ---------------- */

  const view = useMemo(() => {
    const span = viewSpan;

    // Draw tight folds at a legible size. Geometry only — every
    // dimension below still reports the real value.
    //
    // A follow group must be re-derived at the enlarged gap rather than
    // having its stub stretched: the corner shortenings that keep the
    // return parallel are a function of the gap, so scaling one without
    // the other opens the fold while leaving the legs their true length,
    // and the parallel spacing visibly stops matching.
    const floor = span * Math.max(MIN_VISIBLE_FRACTION, 0.06);
    // Always on — a material-thickness fold is a fraction of a percent
    // of a typical part and is physically invisible at any line weight
    // otherwise, so this isn't optional the way a display toggle is.
    const drawGap = Math.max(stubLength, floor, thickness * 8);
    const regenerated =
      drawGap !== stubLength && items.some(isFollow)
        ? expandProfile(items, drawGap).concrete
        : segments;

    // Any remaining short leg (e.g. a hand-typed hem) still gets floored.
    const needsFloor = regenerated.some((s) => s.length > 0 && s.length < floor);
    const drawSegments = needsFloor
      ? regenerated.map((s) =>
          Number.isFinite(s.length) && s.length > 0
            ? { ...s, length: Math.max(s.length, floor) }
            : s
        )
      : regenerated;

    const exaggerated = drawSegments !== segments;
    const drawPoints = exaggerated ? computePoints(drawSegments) : points;

    // Camera centres on the metal. Compute span/font first so leader
    // collision boxes match the glyphs that will actually paint.
    const metalXs = [...drawPoints.map((p) => p.x), ...preview.map((p) => p.x)];
    const metalYs = [...drawPoints.map((p) => p.y), ...preview.map((p) => p.y)];
    const [mMinX, mMaxX] = extent(metalXs);
    const [mMinY, mMaxY] = extent(metalYs);
    const cx = (mMinX + mMaxX) / 2;
    const cy = (mMinY + mMaxY) / 2;
    const metalSpan = Math.max(mMaxX - mMinX, mMaxY - mMinY, 1);
    /* Compact type + short leaders so the metal owns the square. */
    const fontSize = metalSpan * 0.026 + 0.1;
    const baseOffset = Math.max(metalSpan * 0.055, fontSize * 2.4, 0.45);
    const maxReach = metalSpan * 0.2;
    const leaders = buildLeaders(
      segments,
      drawPoints,
      dirs,
      baseOffset,
      fontSize,
      maxReach,
    );

    /*
     * Camera is metal-first: a thin halo around the part. Annotations may
     * expand that slightly, but never enough to leave the profile floating
     * in empty space (previously ~1.8× metal → ~30% fill).
     */
    const pad = metalSpan * 0.06;
    const annotationXs = [
      ...leaders.flatMap((l) => [...l.path.map((p) => p.x), l.label.x]),
    ];
    const annotationYs = [
      ...leaders.flatMap((l) => [...l.path.map((p) => p.y), l.label.y]),
    ];
    leaders.forEach((l) => {
      const width = l.text.length * fontSize * CHAR_WIDTH_EM;
      annotationXs.push(l.label.x + l.away * width * 0.85);
      annotationYs.push(l.label.y - fontSize * 0.55, l.label.y + fontSize * 0.55);
    });
    const [aMinX, aMaxX] = extent(annotationXs.length ? annotationXs : metalXs);
    const [aMinY, aMaxY] = extent(annotationYs.length ? annotationYs : metalYs);

    const annotPad = fontSize * 0.45;
    const neededHalf = Math.max(
      metalSpan / 2 + pad,
      cx - Math.min(mMinX, aMinX) + annotPad,
      Math.max(mMaxX, aMaxX) - cx + annotPad,
      cy - Math.min(mMinY, aMinY) + annotPad,
      Math.max(mMaxY, aMaxY) - cy + annotPad,
    );
    // Hard ceiling: metal stays ≥ ~78% of the square.
    const size = Math.min(Math.max(neededHalf * 2, 1), metalSpan * 1.28);
    /*
     * Bend radius tracks gauge (thicker stock forms a larger radius) but also
     * stays readable on tiny drawings: never smaller than ~3% of the metal span,
     * never larger than a short hem can absorb — and never thicker than the
     * tightest face gap, or acute returns melt into a blob.
     */
    const gap = minNonAdjacentGap(drawPoints);
    const bendRadius = Math.min(
      Math.max(thickness * 1.35, metalSpan * 0.028),
      Number.isFinite(gap) && gap > 1e-6 ? gap * 0.35 : Infinity,
    );
    const desiredStroke = metalSpan * 0.006 + 0.03;
    /*
     * Cap the drawn thickness so a material-gap return still shows daylight
     * between the two flanges. Without this, a 0.08" fold under a 0.15"
     * stroke reads as one merged bar.
     */
    const maxStroke =
      Number.isFinite(gap) && gap > 1e-6 ? gap * 0.22 : desiredStroke;
    const strokeOutline = Math.min(
      desiredStroke * 1.55,
      Math.max(maxStroke, desiredStroke * 0.14),
    );
    const strokeBody = strokeOutline * (1.05 / 1.55);

    return {
      viewBox: `${cx - size / 2} ${cy - size / 2} ${size} ${size}`,
      points: drawPoints,
      leaders,
      exaggerated,
      bendRadius,
      stroke: strokeOutline,
      strokeOutline,
      strokeBody,
      fontSize,
      description: `Sheet metal profile with ${segments.length} segment${
        segments.length === 1 ? "" : "s"
      }, ${segments.map((s, i) => `L${i + 1} ${formatLength(s.length)} inches`).join(", ")}.`,
    };
  }, [segments, points, dirs, preview, viewSpan, items, stubLength, thickness]);

  viewRef.current = view;

  // While a gesture is active, keep the camera (viewBox + the strokes/
  // text sized from it) pinned to what it was when the gesture began.
  // Geometry stays live — a drag still visibly stretches or slides the
  // line in real time — only the window you're viewing it through stops
  // moving. Without this, a growing freehand stroke keeps enlarging the
  // auto-fit bounds every frame, so the camera continuously zooms out
  // and the whole part visibly shrinks away while you're mid-drag.
  const activeView =
    (draw || drag) && frozenCamera.current
      ? {
          ...view,
          viewBox: frozenCamera.current.viewBox,
          stroke: frozenCamera.current.stroke,
          strokeOutline: frozenCamera.current.strokeOutline ?? frozenCamera.current.stroke,
          strokeBody: frozenCamera.current.strokeBody,
          fontSize: frozenCamera.current.fontSize,
          // Keep fillet size pinned too — a live recompute mid-drag can
          // briefly see a huge free-space gap and inflate the corner into
          // a balloon before the next frame settles.
          bendRadius: frozenCamera.current.bendRadius ?? view.bendRadius,
        }
      : view;

  const girth = useMemo(() => girthOf(segments), [segments]);

  /** Catalogue price: shown as "price each" and stamped on the cart line. */
  const pricing = useMemo(() => {
    const bends = bendOverride ?? Math.max(0, segments.length - 1);
    if (!hasGauge || girth <= 0) return { ready: false, isFraming, bends, total: null };
    const quoted = priceCustomPart({ gauge, girth, bends, lengthIn: DEFAULT_PART_LENGTH_IN });
    const rate = GAUGE_RATES[gauge];
    const sheetPrice = Number.isFinite(rate) ? rate * 48 * DEFAULT_PART_LENGTH_IN : sheetPrices[gauge];
    return {
      ready: quoted.ready,
      isFraming,
      markup: MATERIAL_MARKUP - 1,
      piecesPerSheet: Math.max(1, Math.floor(MAX_GIRTH / girth)),
      bends,
      sheetPrice,
      total: quoted.total,
      bendCost: bends * BEND_COST,
      material: quoted.ready && quoted.total != null ? quoted.total - bends * BEND_COST : null,
    };
  }, [hasGauge, girth, gauge, sheetPrices, bendOverride, segments.length, isFraming]);

  /** Girth each follow count would produce — drives the disabled states. */
  const followGirth = useMemo(
    () =>
      [1, 2, 3].map(
        (count) =>
          girthOf(
            expandProfile([...items, createFollowMarker(count)], stubLength).concrete
          )
      ),
    [items, stubLength]
  );

  const issues = useMemo(() => {
    const list = [];
    if (girth > MAX_GIRTH) {
      list.push(
        `Girth ${formatLength(girth)}" exceeds the ${MAX_GIRTH}" coil by ` +
          `${formatLength(girth - MAX_GIRTH)}".`
      );
    }
    const collisions = findSelfIntersections(points, thickness * 0.9);
    if (collisions.length) {
      list.push(
        `${collisions.length} overlap${collisions.length === 1 ? "" : "s"} detected ` +
          `(${collisions.map(([i, j]) => `L${i + 1}/L${j + 1}`).join(", ")}) — ` +
          `metal can't pass through itself.`
      );
    }
    return list;
  }, [segments, points, girth, thickness]);

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-screen w-full bg-[#eef1f4] flex justify-center py-6 px-3">
      <div className="w-full max-w-md lg:max-w-6xl">
        <header className="text-center mb-5">
          <h1 className="text-2xl font-black tracking-tight text-black">
            Custom Shape Builder
          </h1>
          <button
            type="button"
            onClick={() => setShowTutorial(true)}
            className={`text-sm text-blue-600 hover:text-blue-700 underline
              underline-offset-2 mt-1 inline-flex items-center gap-1
              rounded ${FOCUS_RING}`}
          >
            <HelpCircle size={14} className="shrink-0" />
            Build your profile segment by segment, click here for a tutorial.
          </button>
        </header>

        {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

        {/* One column on mobile; on desktop the drawing sits beside the
            controls, so the profile and its dimensions stay in view. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">

        {/* Setup — the gauge gates everything else, since material
            thickness drives return bends and therefore the geometry. */}
        <div className="lg:col-start-2 lg:row-start-1">
        <Panel className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="gauge" className="block text-sm font-bold text-gray-700">
              Gauge
            </label>
            <button
              type="button"
              onClick={actions.reset}
              title="Clear the profile back to a single blank leg"
              className={`text-xs text-gray-400 flex items-center gap-1
                hover:text-gray-600 rounded ${FOCUS_RING}`}
            >
              <RotateCcw size={12} /> reset
            </button>
          </div>
          <div className="relative">
            {/* Native select arrows render inconsistently (and
                sometimes badly) across browsers, so the built-in one is
                suppressed and a real icon is drawn in its place —
                appearance: none in style, not just a class, since a
                utility class alone doesn't reliably win against a form
                control's native styling in every browser. */}
            <select
              id="gauge"
              value={gauge}
              onChange={(e) => setGauge(e.target.value)}
              style={{ WebkitAppearance: "none", MozAppearance: "none", appearance: "none" }}
              className={`w-full border border-gray-300 rounded-xl pl-4 pr-10 py-3
                text-gray-800 bg-white ${FOCUS_RING}`}
            >
              <option value="">Please select...</option>
              {Object.entries(GAUGE_THICKNESS).map(([ga, thick]) => (
                <option key={ga} value={ga}>
                  {ga} gauge · {thick}"
                </option>
              ))}
            </select>
            <ChevronDown
              size={18}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
          </div>
          <label htmlFor="finish-color" className="block text-sm font-bold text-gray-700 mb-2 mt-4">
            Color
          </label>
          <div className="relative">
            <select
              id="finish-color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ WebkitAppearance: "none", MozAppearance: "none", appearance: "none" }}
              className={`w-full border border-gray-300 rounded-xl pl-4 pr-10 py-3
                text-gray-800 bg-white ${FOCUS_RING}`}
            >
              {SHAPE_COLOURS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={18}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
          </div>
        </Panel>
        </div>

        {hasGauge && (
        <>
        {/* Drawing — stays pinned while the controls scroll past it.
            The sticky element is the grid item itself: wrapping it in a
            content-height div would leave it nowhere to travel. */}
        <div id={STICKY_DRAWING_ID} className="sticky top-2 z-20 lg:col-start-1 lg:row-start-1
          lg:row-span-2 lg:self-start bg-white rounded-2xl shadow-md
          border border-gray-200 p-2 sm:p-3 mb-4 overflow-visible">
          <ProfileDrawing
            view={activeView}
            drawMode={drawMode}
            preview={preview}
            highlight={highlight}
            onHighlight={setHighlight}
            svgRef={svgRef}
            pointerHandlers={pointerHandlers}
            onBeginDrag={beginDrag}
            dragging={drag}
          />

          <div className="flex justify-center gap-1 mt-2">
            <IconButton
              label="Draw mode: drag to sketch a segment"
              active={drawMode}
              onClick={() => {
                setDrawMode((m) => !m);
                setDraw(null);
              }}
              className="w-10 h-10 !rounded-full"
            >
              <Pencil size={17} />
            </IconButton>
            <IconButton
              label="Undo"
              onClick={undo}
              disabled={!canUndo}
              className="w-10 h-10 !rounded-full"
            >
              <Undo2 size={17} />
            </IconButton>
            <IconButton
              label="Redo"
              onClick={redo}
              disabled={!canRedo}
              className="w-10 h-10 !rounded-full"
            >
              <Redo2 size={17} />
            </IconButton>
          </div>

          <p className="text-xs text-center text-gray-400 mt-1.5">
            {drawMode
              ? "Drag to aim a segment (snaps to 45°), lift to end it. Esc to exit."
              : drag
              ? drag.kind === "vertex"
                ? "Stretching — hold Shift for fine control"
                : "Sliding the edge — hold Shift for fine control"
              : `${segments.length} bend${segments.length === 1 ? "" : "s"}`}
          </p>

          {!drawMode && (
            <div className="mt-2">
              <div className="flex justify-between text-[11px] font-semibold mb-1">
                <span className="text-gray-500">Girth</span>
                <span className={girth > MAX_GIRTH ? "text-[#c8102e]" : "text-gray-500"}>
                  {formatLength(girth)}" / {MAX_GIRTH}"
                </span>
              </div>
              <div
                className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
                role="meter"
                aria-valuenow={Math.round(girth)}
                aria-valuemin={0}
                aria-valuemax={MAX_GIRTH}
                aria-label="Girth used"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-200 ${
                    girth > MAX_GIRTH ? "bg-[#c8102e]" : "bg-gray-800"
                  }`}
                  style={{ width: `${Math.min(100, (girth / MAX_GIRTH) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {activeView.exaggerated && !drawMode && (
            <p className="text-[11px] text-center text-amber-600 mt-1">
              NOT TO SCALE · dimensions are true
            </p>
          )}
        </div>

        {/* Editing */}
        <div className="lg:col-start-2 lg:row-start-2">

        {showPricing && (
        <Panel className="mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm font-bold text-gray-700">Pricing</span>
            <span className="text-xs text-gray-400">
              {formatLength(girth)}" girth · {gauge}ga ·{" "}
              {isFraming ? "framing" : "trim"} rate
            </span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <label htmlFor="sheet-price" className="text-xs font-semibold text-gray-600 shrink-0">
              {gauge}ga sheet price
            </label>
            <span className="text-xs text-gray-400 shrink-0">$</span>
            <NumberField
              id="sheet-price"
              value={sheetPrices[gauge]}
              min={0}
              placeholder="not set"
              onChange={(v) => updateSheetPrice(gauge, v)}
              onFocus={() => setActiveField(`${gauge}ga sheet price`)}
              onBlur={() => setActiveField(null)}
              className="flex-1 min-w-0 !py-2 text-sm"
            />
            <span className="text-xs text-gray-400 shrink-0">/ 48×120</span>
          </div>

          {!pricing?.ready ? (
            <p className="text-xs text-amber-600">
              Enter the {gauge}ga sheet price above to price this part.
            </p>
          ) : (
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between text-gray-500">
                <dt>Pieces per sheet</dt>
                <dd>{pricing.piecesPerSheet}</dd>
              </div>
              <div className="flex justify-between text-gray-500">
                <dt>Material ({Math.round(pricing.markup * 100)}% markup)</dt>
                <dd>${pricing.material.toFixed(2)}</dd>
              </div>
              <div className="flex items-center justify-between text-gray-500 gap-2">
                <dt className="flex items-center gap-1.5">
                  Bends
                  <input
                    type="number"
                    min={0}
                    value={pricing.bends}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBendOverride(Number.isFinite(v) && v >= 0 ? v : null);
                    }}
                    aria-label="Bend count"
                    className={`w-14 border border-gray-300 rounded-lg px-2 py-1
                      text-xs text-gray-700 ${FOCUS_RING}`}
                  />
                  <span>× ${BEND_COST.toFixed(2)}</span>
                </dt>
                <dd>${pricing.bendCost.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-1.5
                border-t border-gray-100">
                <dt>Total</dt>
                <dd>${pricing.total.toFixed(2)}</dd>
              </div>
              <p className="text-[11px] text-gray-400 pt-0.5">
                Material only — delivery is a separate line item.
              </p>
            </dl>
          )}
        </Panel>
        )}

        {issues.length > 0 && (
          <div
            role="status"
            className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3"
          >
            <div className="flex gap-2 text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <ul className="text-xs space-y-1">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="space-y-3 mb-4">
          {rows.map((row, i) =>
            isFollow(row.item) ? (
              <FollowCard
                key={row.item.id}
                item={row.item}
                legs={segments.slice(row.start, row.start + row.length)}
                firstLabel={row.start + 1}
                authoredIndex={i}
                actions={actions}
                highlighted={highlight === row.start}
                onHighlight={setHighlight}
                onFocusField={setActiveField}
                onBlurField={() => setActiveField(null)}
                focusRequest={focusRequest}
                onFocusConsumed={clearFocusRequest}
              />
            ) : (
              <SegmentCard
                key={row.item.id}
                segment={row.item}
                index={row.start}
                authoredIndex={i}
                canRemove={items.length > 1}
                actions={actions}
                highlighted={highlight === row.start}
                onHighlight={setHighlight}
                onFocusField={setActiveField}
                onBlurField={() => setActiveField(null)}
                focusRequest={focusRequest}
                onFocusConsumed={clearFocusRequest}
              />
            )
          )}
        </div>

        <button
          type="button"
          onClick={actions.addSegment}
          disabled={girth >= MAX_GIRTH}
          title={
            girth >= MAX_GIRTH
              ? `No coil left — girth is already ${formatLength(girth)}" of ${MAX_GIRTH}"`
              : undefined
          }
          className={`w-full bg-black text-white font-bold rounded-2xl py-4 flex
            items-center justify-center gap-2 active:scale-[0.99]
            transition mb-3 disabled:opacity-30 disabled:pointer-events-none
            ${FOCUS_RING}`}
        >
          <Plus size={20} />
          Add L{segments.length + 1}
        </button>

        <Panel className="mb-4 !p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-bold text-gray-700">Follow profile</span>
              <p className="text-[11px] leading-snug text-gray-400">
                Folds the open end back over {formatLength(stubLength)}" — pick how
                many lengths to trace.
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {[1, 2, 3].map((count) => {
                const wouldBeGirth = followGirth[count - 1];
                const tooLong = wouldBeGirth > MAX_GIRTH;
                const disabled = count > segments.length || tooLong;
                return (
                  <button
                    key={count}
                    type="button"
                    disabled={disabled}
                    onClick={() => actions.followProfile(count)}
                    aria-label={`Follow profile back along ${count} length${
                      count === 1 ? "" : "s"
                    }`}
                    title={
                      count > segments.length
                        ? `Needs at least ${count} segments`
                        : tooLong
                        ? `Would need ${formatLength(wouldBeGirth)}" girth — over the ${MAX_GIRTH}" coil`
                        : `Trace back along the last ${count} length${
                            count === 1 ? "" : "s"
                          }`
                    }
                    className={`w-9 h-9 rounded-lg border-2 border-black bg-white
                      text-sm font-bold text-black active:scale-[0.98] transition
                      disabled:opacity-30 disabled:pointer-events-none ${FOCUS_RING}`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel className="mb-3 !p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Price each
              </span>
              <p className="text-xl font-extrabold text-gray-900 leading-tight">
                {pricing?.ready ? `$${pricing.total.toFixed(2)}` : "—"}
              </p>
              <p className="text-[11px] leading-snug text-gray-400">
                {formatLength(girth)}" girth × {DEFAULT_PART_LENGTH_IN}" long
                {pricing?.ready ? ` · ${pricing.bends} bends` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-semibold text-gray-500">Qty</span>
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className={`w-9 h-9 rounded-lg border-2 border-black bg-white
                  text-sm font-bold text-black active:scale-[0.98] transition ${FOCUS_RING}`}
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Quantity"
                value={quantity}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10);
                  setQuantity(Number.isFinite(next) && next > 0 ? Math.min(999, next) : 1);
                }}
                className={`w-12 h-9 rounded-lg border-2 border-gray-200 text-center
                  text-sm font-bold text-gray-900 ${FOCUS_RING}`}
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(999, q + 1))}
                className={`w-9 h-9 rounded-lg border-2 border-black bg-white
                  text-sm font-bold text-black active:scale-[0.98] transition ${FOCUS_RING}`}
              >
                +
              </button>
            </div>
          </div>
        </Panel>

        <button
          type="button"
          onClick={() =>
            onAddToCart?.({
              gauge,
              color,
              girth,
              lengthIn: DEFAULT_PART_LENGTH_IN,
              segments: segments.map(({ angle, length }) => ({ angle, length })),
              bends: pricing?.bends ?? Math.max(0, segments.length - 1),
              price: pricing?.total ?? null,
              quantity,
            })
          }
          disabled={!onAddToCart || issues.length > 0}
          title={
            !onAddToCart
              ? "Wire up onAddToCart to enable this"
              : issues.length > 0
              ? "Resolve the warnings above before adding to cart"
              : undefined
          }
          className={`w-full rounded-2xl py-4 font-bold flex items-center
            justify-center gap-2 active:scale-[0.99] transition
            disabled:opacity-30 disabled:pointer-events-none ${FOCUS_RING}`}
          style={{ backgroundColor: COLOR.accent, color: "#fff" }}
        >
          <ShoppingCart size={20} />
          Add to Cart
        </button>
        </div>
        </>
        )}

        </div>
      </div>
    </div>
  );
}
