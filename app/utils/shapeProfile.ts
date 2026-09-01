/**
 * Shared custom-shape profile model: pricing, URL prefill, SVG thumbs, library hash.
 * Safe for the storefront island bundle (no server-only imports).
 */

import { SHAPE_CALCULATOR_ENABLED } from "./shapeFeature";

export type ShapeLeg = { angle: number; length: number };

export type ShapeProfile = {
  gauge: string;
  color: string;
  legs: ShapeLeg[];
  girth: number;
  bends: number;
  lengthIn: number;
};

/** $/sq in — Canadian Cladding catalogue. */
export const GAUGE_RATES: Record<string, number> = {
  "16": 0.0153819,
  "18": 0.0112875,
  "20": 0.0094479,
  "22": 0.0077833,
  "24": 0.0104167,
  "26": 0.0082458,
};

export const SHAPE_GAUGES = Object.keys(GAUGE_RATES);

/** Brake length used when the builder has no length field. */
export const DEFAULT_PART_LENGTH_IN = 120;
export const SHEET_WIDTH_IN = 48;
export const MATERIAL_MARKUP = 1.5;
export const BEND_COST = 2.5;

export const SHAPE_COLOURS = [
  "Galvanized",
  "Black",
  "White",
  "Charcoal",
  "Brown",
  "Red",
  "Green",
  "Blue",
  "Sand",
  "Cream",
] as const;

export const DEFAULT_SHAPE_COLOUR = "Galvanized";

export const DEFAULT_SHAPE_TEMPLATES: Array<{
  slug: string;
  name: string;
  legs: ShapeLeg[];
}> = [
  { slug: "l", name: "L", legs: [{ angle: 0, length: 12 }, { angle: -90, length: 8 }] },
  { slug: "z", name: "Z", legs: [{ angle: 0, length: 8 }, { angle: -90, length: 5 }, { angle: 90, length: 8 }] },
  { slug: "u", name: "U", legs: [{ angle: 0, length: 6 }, { angle: -90, length: 6 }, { angle: -90, length: 6 }] },
  {
    slug: "c",
    name: "C",
    legs: [
      { angle: 90, length: 1.5 },
      { angle: -90, length: 6 },
      { angle: -90, length: 8 },
      { angle: -90, length: 6 },
      { angle: -90, length: 1.5 },
    ],
  },
  { slug: "s", name: "S", legs: [{ angle: 0, length: 6 }, { angle: 90, length: 5 }, { angle: -90, length: 6 }] },
];

export function girthOf(legs: ShapeLeg[]): number {
  return legs.reduce((sum, s) => sum + (Number.isFinite(s.length) ? s.length : 0), 0);
}

export function formatLength(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

export function priceCustomPart(args: {
  gauge: string;
  girth: number;
  bends: number;
  lengthIn?: number;
}): { ready: boolean; total: number | null } {
  const rate = GAUGE_RATES[args.gauge];
  const girth = args.girth;
  const lengthIn = args.lengthIn && args.lengthIn > 0 ? args.lengthIn : DEFAULT_PART_LENGTH_IN;
  if (!Number.isFinite(rate) || rate <= 0 || !(girth > 0)) {
    return { ready: false, total: null };
  }
  const material = rate * girth * lengthIn * MATERIAL_MARKUP;
  const bendCost = Math.max(0, args.bends) * BEND_COST;
  return { ready: true, total: Math.round((material + bendCost) * 100) / 100 };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

function computePoints(legs: ShapeLeg[]): Array<{ x: number; y: number }> {
  let dir = 0;
  let x = 0;
  let y = 0;
  const pts = [{ x, y }];
  legs.forEach((seg, i) => {
    dir = i === 0 ? seg.angle : dir + seg.angle;
    const length = Number.isFinite(seg.length) ? seg.length : 0;
    x += length * Math.cos(toRad(dir));
    y += length * Math.sin(toRad(dir));
    pts.push({ x, y });
  });
  return pts;
}

function extent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 0];
}

type Pt = { x: number; y: number };

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const d1 = cross(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y);
  const d2 = cross(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y);
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y);
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function segmentsOverlapCollinear(p1: Pt, p2: Pt, p3: Pt, p4: Pt, eps = 1e-3): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < eps) return false;
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  if (Math.abs(cross(dx, dy, p4.x - p3.x, p4.y - p3.y)) > eps) return false;
  if (Math.abs(cross(dx, dy, p3.x - p1.x, p3.y - p1.y)) > eps) return false;
  const project = (p: Pt) => ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
  const lo = Math.max(0, Math.min(project(p3), project(p4)));
  const hi = Math.min(1, Math.max(project(p3), project(p4)));
  return hi - lo > eps;
}

function segmentsCollide(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  if (segmentsCross(a1, a2, b1, b2) || segmentsOverlapCollinear(a1, a2, b1, b2)) {
    return true;
  }
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) <= 1e-3;
  const pierce = (p: Pt, a: Pt, b: Pt) =>
    !near(p, a) && !near(p, b) && distPointToSegment(p, a, b) <= 1e-3;
  return (
    pierce(a1, b1, b2) ||
    pierce(a2, b1, b2) ||
    pierce(b1, a1, a2) ||
    pierce(b2, a1, a2)
  );
}

function segmentDistance(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  if (segmentsCollide(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegment(a1, b1, b2),
    distPointToSegment(a2, b1, b2),
    distPointToSegment(b1, a1, a2),
    distPointToSegment(b2, a1, a2),
  );
}

/** Tightest air gap between non-adjacent edges — drives stroke/fillet caps. */
export function minNonAdjacentGap(points: Pt[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 2; j < points.length - 1; j += 1) {
      const d = segmentDistance(points[i], points[i + 1], points[j], points[j + 1]);
      if (d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : Infinity;
}

/**
 * SVG path for a polyline with formed (filleted) bends.
 *
 * Sharp corners read as a CAD sketch; a small circular fillet at each vertex
 * is what a brake actually leaves behind. Radius is clamped per corner so a
 * short hem never collapses into a blob.
 */
export function profilePathWithBendRadius(
  points: Array<{ x: number; y: number }>,
  radius: number,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2 || !(radius > 0)) {
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
  }

  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (inLen < 1e-9 || outLen < 1e-9) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    const ux = (curr.x - prev.x) / inLen;
    const uy = (curr.y - prev.y) / inLen;
    const vx = (next.x - curr.x) / outLen;
    const vy = (next.y - curr.y) / outLen;
    const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const absTurn = Math.abs(turn);
    // Flat or hairpin: a fillet would either be invisible or a full semicircle.
    if (absTurn < 0.08 || Math.PI - absTurn < 0.08) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    /*
     * Fillet trim along each leg is r / tan(θ/2). Cap r so that trim never
     * exceeds ~42% of either leg — without the tan factor, acute bends during
     * a drag overshoot the vertices and SVG draws a giant semicircle.
     */
    const halfTan = Math.tan(absTurn / 2);
    const maxR = Math.min(inLen, outLen) * 0.42 * halfTan;
    const r = Math.min(radius, maxR);
    if (!(r > 1e-6) || !(halfTan > 1e-9)) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    /* Distance from the sharp corner to where the arc meets each leg. */
    const trim = r / halfTan;
    const start = { x: curr.x - ux * trim, y: curr.y - uy * trim };
    const end = { x: curr.x + vx * trim, y: curr.y + vy * trim };
    const sweep = turn > 0 ? 1 : 0;
    parts.push(`L ${start.x} ${start.y}`);
    parts.push(`A ${r} ${r} 0 0 ${sweep} ${end.x} ${end.y}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}

/** Compact SVG of the bent profile for library / template cards and order thumbs. */
export function profileToSvg(legs: ShapeLeg[], size = 320): string {
  const usable = legs.filter((l) => Number.isFinite(l.length) && l.length > 0);
  if (!usable.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"></svg>`;
  }
  const truePoints = computePoints(usable);
  const trueXs = truePoints.map((p) => p.x);
  const trueYs = truePoints.map((p) => p.y);
  const [tMinX, tMaxX] = extent(trueXs);
  const [tMinY, tMaxY] = extent(trueYs);
  const trueSpan = Math.max(tMaxX - tMinX, tMaxY - tMinY, 1);
  /*
   * Material-thickness returns are invisible at card scale. Floor short
   * legs for the drawing only — labels/girth still use the real values.
   */
  const floor = Math.max(trueSpan * 0.055, 0.4);
  const drawLegs = usable.map((l) => ({
    angle: l.angle,
    length: l.length > 0 && l.length < floor ? floor : l.length,
  }));
  const points = computePoints(drawLegs);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX] = extent(xs);
  const [minY, maxY] = extent(ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = span * 0.18;
  const vb = Math.max(span + pad * 2, 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const gap = minNonAdjacentGap(points);
  /* Fillet + stroke must stay thinner than the tightest face gap. */
  const bendRadius = Math.min(
    span * 0.028,
    Number.isFinite(gap) && gap > 1e-6 ? gap * 0.35 : span * 0.028,
  );
  const d = profilePathWithBendRadius(points, bendRadius);
  const desired = vb * 0.0055 + 0.018;
  const maxStroke =
    Number.isFinite(gap) && gap > 1e-6 ? gap * 0.22 : desired;
  const outline = Math.min(desired * 1.55, Math.max(maxStroke, desired * 0.14));
  const body = outline * (1.05 / 1.55);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - vb / 2} ${cy - vb / 2} ${vb} ${vb}" width="${size}" height="${size}" role="img" aria-label="Sheet metal profile"><path d="${d}" fill="none" stroke="#111827" stroke-width="${outline}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#c5cbd3" stroke-width="${body}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function profileSvgDataUri(legs: ShapeLeg[]): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(profileToSvg(legs, 240))}`;
}

export function geometryHash(legs: ShapeLeg[]): string {
  const key = legs
    .map(
      (l) =>
        `${Math.round((Number(l.angle) || 0) * 100) / 100}:${Math.round((Number(l.length) || 0) * 1000) / 1000}`,
    )
    .join("|");
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return `${key.length}:${(h >>> 0).toString(16)}:${key.slice(0, 80)}`;
}

export function profileToSearchParams(args: {
  legs: ShapeLeg[];
  gauge?: string;
  color?: string;
}): URLSearchParams {
  const q = new URLSearchParams();
  if (args.gauge) q.set("gauge", args.gauge);
  if (args.color) q.set("color", args.color);
  args.legs.forEach((leg, i) => {
    const n = i + 1;
    if (Number.isFinite(leg.length)) q.set(`L${n}`, formatLength(leg.length));
    if (Number.isFinite(leg.angle)) q.set(`A${n}`, String(leg.angle));
  });
  return q;
}

export function shapeBuilderPath(args: {
  legs: ShapeLeg[];
  gauge?: string;
  color?: string;
}): string {
  if (!SHAPE_CALCULATOR_ENABLED) {
    return "/apps/project-clad/projects";
  }
  const q = profileToSearchParams(args);
  const qs = q.toString();
  return qs
    ? `/apps/project-clad/shape-builder?${qs}`
    : "/apps/project-clad/shape-builder";
}

export function legsFromSearchParams(params: URLSearchParams): ShapeLeg[] {
  const legs: ShapeLeg[] = [];
  for (let i = 1; i <= 48; i += 1) {
    const lRaw = params.get(`L${i}`) ?? params.get(`l${i}`);
    if (lRaw == null || lRaw.trim() === "") break;
    const length = Number(lRaw);
    const aRaw = params.get(`A${i}`) ?? params.get(`a${i}`);
    const angle = aRaw != null && aRaw.trim() !== "" ? Number(aRaw) : i === 1 ? 0 : -90;
    legs.push({
      angle: Number.isFinite(angle) ? angle : 0,
      length: Number.isFinite(length) ? length : 0,
    });
  }
  return legs;
}

export function profileFromSearchParams(params: URLSearchParams): {
  legs: ShapeLeg[];
  gauge: string;
  color: string;
} {
  return {
    legs: legsFromSearchParams(params),
    gauge: (params.get("gauge") || params.get("Gauge") || "").trim(),
    color: (params.get("color") || params.get("Color") || params.get("colour") || "").trim(),
  };
}

export type LineProperty = { name: string; value: string };

export function legsFromLineProperties(properties: LineProperty[] | null | undefined): ShapeLeg[] {
  if (!properties?.length) return [];
  const map = new Map<string, string>();
  for (const p of properties) {
    map.set(p.name.trim().toLowerCase().replace(/[\s_-]+/g, "_"), (p.value || "").trim());
  }
  const legs: ShapeLeg[] = [];
  for (let i = 1; i <= 48; i += 1) {
    const lRaw = map.get(`l${i}`);
    if (lRaw == null || lRaw === "") break;
    const length = Number(lRaw);
    const aRaw = map.get(`a${i}`);
    const angle = aRaw != null && aRaw !== "" ? Number(aRaw) : i === 1 ? 0 : -90;
    legs.push({
      angle: Number.isFinite(angle) ? angle : 0,
      length: Number.isFinite(length) ? length : 0,
    });
  }
  return legs;
}

export function isShapeBuilderLine(properties: LineProperty[] | null | undefined): boolean {
  if (!properties?.length) return false;
  const map = new Map(
    properties.map((p) => [
      p.name.trim().toLowerCase().replace(/[\s_-]+/g, "_"),
      (p.value || "").trim(),
    ]),
  );
  if ((map.get("shape_type") || "").toLowerCase() === "custom") return true;
  if (map.has("girth") && map.has("l1")) return true;
  return legsFromLineProperties(properties).length >= 2;
}

/** Builder URL that reopens an ordered custom line, or null when the line is not a custom shape. */
export function shapeBuilderEditPath(
  properties: LineProperty[] | null | undefined,
): string | null {
  if (!SHAPE_CALCULATOR_ENABLED) return null;
  if (!properties?.length || !isShapeBuilderLine(properties)) return null;
  const valueOf = (pattern: RegExp) =>
    properties.find((p) => pattern.test(p.name.trim()))?.value || undefined;
  return shapeBuilderPath({
    legs: legsFromLineProperties(properties),
    gauge: valueOf(/^gauge$/i),
    color: valueOf(/^(color|colour)$/i),
  });
}

export function cartPropertiesFromProfile(payload: {
  gauge: string;
  color: string;
  girth: number;
  bends: number;
  lengthIn?: number;
  legs: ShapeLeg[];
  price?: number | null;
}): Record<string, string> {
  const props: Record<string, string> = {
    shape_type: "custom",
    Gauge: String(payload.gauge),
    Color: payload.color || DEFAULT_SHAPE_COLOUR,
    Girth: formatLength(payload.girth),
    Bends: String(payload.bends),
    Length: String(payload.lengthIn || DEFAULT_PART_LENGTH_IN),
  };
  payload.legs.forEach((leg, i) => {
    props[`L${i + 1}`] = formatLength(leg.length);
    props[`A${i + 1}`] = String(leg.angle);
  });
  if (payload.price != null && Number.isFinite(payload.price)) {
    props._unit_price = payload.price.toFixed(2);
  }
  return props;
}
