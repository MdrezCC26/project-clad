/** `YYYY-MM-DD` from `<input type="date">` → local calendar date (avoids UTC off-by-one). */
export function parseYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** Calendar arithmetic in the local timezone of the `Date` (matches `<input type="date">` in that environment). */
export function addCalendarDaysLocal(base: Date, days: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + days,
  );
}

export function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** IANA zone for “today” when enforcing preferred-delivery date rules (Ottawa / Eastern). */
export const PREFERRED_DELIVERY_CALENDAR_TIMEZONE = "America/Toronto";

/** Civil calendar date `YYYY-MM-DD` for an instant in a specific IANA timezone. */
export function getCalendarYmdInTimeZone(
  instant: Date,
  timeZone: string,
): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !mo || !d) return formatYmdLocal(instant);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Add integer days to a civil `YYYY-MM-DD` (overflow rolls month/year; DST-safe). */
export function addDaysToCalendarYmd(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const u = Date.UTC(y, mo - 1, d + days);
  const dt = new Date(u);
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, "0"),
    String(dt.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Minimum `YYYY-MM-DD` for the preferred-delivery **date** field (`<input type="date" min>`).
 * “Today” is the calendar date in {@link PREFERRED_DELIVERY_CALENDAR_TIMEZONE} (Ottawa time).
 * With {@link PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY} = 2, today and tomorrow are before `min`.
 */
export function minPreferredDeliveryYmd(
  leadDays: number,
  from: Date = new Date(),
  timeZone: string = PREFERRED_DELIVERY_CALENDAR_TIMEZONE,
): string {
  const todayYmd = getCalendarYmdInTimeZone(from, timeZone);
  return addDaysToCalendarYmd(todayYmd, leadDays) ?? todayYmd;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True if `ymd` is strictly before `minYmd` (ISO date strings). Empty or invalid `ymd` → false. */
export function isYmdBeforeMin(
  ymd: string | null | undefined,
  minYmd: string,
): boolean {
  const t = ymd?.trim();
  if (!t || !YMD_RE.test(t) || !YMD_RE.test(minYmd)) return false;
  return t < minYmd;
}

/**
 * Calendar days after “today” (Ottawa) before the first selectable date: grey today and tomorrow when 2.
 */
export const PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY = 2;

/** Hourly windows for preferred delivery (Ottawa 7am–4pm). */
export const OTTAWA_DELIVERY_HOUR_WINDOWS = [
  "7am-8am",
  "8am-9am",
  "9am-10am",
  "10am-11am",
  "11am-12pm",
  "12pm-1pm",
  "1pm-2pm",
  "2pm-3pm",
  "3pm-4pm",
] as const;

/** End of each window as minutes from midnight (Ottawa clock on that calendar day). */
const OTTAWA_WINDOW_END_MINUTES: Record<string, number> = {
  "7am-8am": 8 * 60,
  "8am-9am": 9 * 60,
  "9am-10am": 10 * 60,
  "10am-11am": 11 * 60,
  "11am-12pm": 12 * 60,
  "12pm-1pm": 13 * 60,
  "1pm-2pm": 14 * 60,
  "2pm-3pm": 15 * 60,
  "3pm-4pm": 16 * 60,
};

export function isKnownOttawaHourWindow(value: string | null | undefined): boolean {
  return (OTTAWA_DELIVERY_HOUR_WINDOWS as readonly string[]).includes(
    String(value || "").trim(),
  );
}

/** Current clock time in Ottawa as minutes since local midnight on that calendar day. */
export function getOttawaMinutesSinceMidnight(instant: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PREFERRED_DELIVERY_CALENDAR_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * Whether `windowStr` is allowed for `deliveryYmd` (Ottawa civil date) at `instant`.
 * Future days: all standard windows OK. Same Ottawa calendar day: slot end must be after current Ottawa time.
 */
export function isOttawaDeliveryWindowValidForDate(
  windowStr: string,
  deliveryYmd: string,
  instant: Date = new Date(),
): boolean {
  const w = windowStr.trim();
  if (!w || !YMD_RE.test(deliveryYmd)) return true;
  const todayYmd = getCalendarYmdInTimeZone(instant, PREFERRED_DELIVERY_CALENDAR_TIMEZONE);
  if (deliveryYmd > todayYmd) return true;
  if (deliveryYmd < todayYmd) return false;
  const endMin = OTTAWA_WINDOW_END_MINUTES[w];
  if (endMin === undefined) return true;
  return endMin > getOttawaMinutesSinceMidnight(instant);
}

/** Legacy dropdown values → Ottawa 7am–4pm style ranges for display. */
export function normalizeLegacyDeliveryWindow(windowStr: string): string {
  const key = windowStr.trim().toLowerCase();
  const legacy: Record<string, string> = {
    morning: "7am-12pm",
    afternoon: "12pm-4pm",
    evening: "3pm-4pm",
    flexible: "7am-4pm",
  };
  return legacy[key] ?? windowStr.trim();
}

/** Turns `7am-8am` into `7am and 8am` for copy; leaves non-hyphenated values as-is. */
export function formatDeliveryWindowBetween(windowStr: string): string {
  const t = windowStr.trim();
  const idx = t.indexOf("-");
  if (idx > 0 && idx < t.length - 1) {
    const a = t.slice(0, idx).trim();
    const b = t.slice(idx + 1).trim();
    if (a && b) return `${a} and ${b}`;
  }
  return t;
}

/**
 * When both date and window are set: `Delivery Monday, April 8, 2026 between 7am and 8am`.
 * Otherwise `null` (caller hides the line).
 */
export function formatPreferredDeliveryDisplay(
  dateStr: string | null | undefined,
  windowStr: string | null | undefined,
): string | null {
  const d = dateStr?.trim();
  const w = windowStr?.trim();
  if (!d || !w) return null;
  const dt = parseYmdToLocalDate(d);
  if (!dt) return null;
  const dayMonthYear = dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const range = normalizeLegacyDeliveryWindow(w);
  const between = formatDeliveryWindowBetween(range);
  return `Delivery ${dayMonthYear} between ${between}`;
}

function formatLongCalendarDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function parseIsoToDate(iso: string | null | undefined): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Order summary row under the order: preferred window until shipped, then
 * `Delivered - Tuesday, April 14, 2026` for `delivered` or `paid` (per product copy).
 */
export function formatOrderDeliveryFootline(args: {
  orderLifecycleStatus: string;
  paidAt: string | null | undefined;
  completedAt: string | null | undefined;
  scheduledDeliveryDate: string | null | undefined;
  scheduledDeliveryWindow: string | null | undefined;
  fulfillmentMethod?: string | null | undefined;
  /** When the project is store pickup, do not show a delivery window from stale job fields. */
  projectReceiveMode?: "delivery" | "pickup";
}): string | null {
  const ls = args.orderLifecycleStatus;
  const isPickup =
    String(args.fulfillmentMethod || "").trim().toLowerCase() === "pickup";

  if (
    args.projectReceiveMode === "pickup" &&
    ls !== "delivered" &&
    ls !== "paid"
  ) {
    return "In store pickup";
  }

  if (isPickup) {
    if (ls === "delivered" || ls === "paid") {
      let d: Date | null = null;
      if (ls === "paid") {
        d =
          parseIsoToDate(args.paidAt) ??
          parseIsoToDate(args.completedAt) ??
          null;
      } else {
        d =
          parseIsoToDate(args.completedAt) ??
          parseIsoToDate(args.paidAt) ??
          null;
      }
      if (!d && args.scheduledDeliveryDate?.trim()) {
        d = parseYmdToLocalDate(args.scheduledDeliveryDate);
      }
      if (!d) {
        return "Picked up - date not on file";
      }
      return `Picked up - ${formatLongCalendarDate(d)}`;
    }
    const slot = formatPreferredDeliveryDisplay(
      args.scheduledDeliveryDate,
      args.scheduledDeliveryWindow,
    );
    if (slot) {
      return slot.replace(/^Delivery /, "Pickup ");
    }
    return "Store pickup";
  }

  if (ls === "delivered" || ls === "paid") {
    let d: Date | null = null;
    if (ls === "paid") {
      d =
        parseIsoToDate(args.paidAt) ??
        parseIsoToDate(args.completedAt) ??
        null;
    } else {
      d =
        parseIsoToDate(args.completedAt) ??
        parseIsoToDate(args.paidAt) ??
        null;
    }
    if (!d && args.scheduledDeliveryDate?.trim()) {
      d = parseYmdToLocalDate(args.scheduledDeliveryDate);
    }
    if (!d) {
      return "Delivered - date not on file";
    }
    return `Delivered - ${formatLongCalendarDate(d)}`;
  }
  return formatPreferredDeliveryDisplay(
    args.scheduledDeliveryDate,
    args.scheduledDeliveryWindow,
  );
}
