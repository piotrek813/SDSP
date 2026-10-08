import { CalendarConfig, Product } from "../../Types";
import { Ctx } from "../ctx";

/** Families in first-appearance order across the selected codes. */
export function familyList(codes: Product[]) {
  const out = [],
    seen = new Set();
  for (const c of codes || []) {
    if (c.family != null && !seen.has(c.family)) {
      seen.add(c.family);
      out.push(c.family);
    }
  }
  return out;
}

export function setupBetween(ctx: Ctx, from: string | null, to: string | null) {
  if (from == null || to == null) return 0;
  const v = ctx.setup && ctx.setup[`${from}>${to}`];
  return Number.isFinite(+v) ? +v : 0;
}

/** Ideal production minutes for the whole plan (OEE-independent). */
export function idealRunMinutes(codes: Pick<Product, "qty" | "unitMinutes">[]) {
  return (codes || []).reduce((s, c) => s + (c.qty * c.unitMinutes || 0), 0);
}

export type SolverOptions = {
  fixedFirst?: string;
};

/** "6:00" | "06:00" | 0.25 (Excel time) | 360 (minutes) | Date -> minutes. */
export function parseTimeToMinutes(value: Date | string | number) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw Error("parseTimeToMinutes invalid date");
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === "number" && isFinite(value)) {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60) % (24 * 60); // Excel time-of-day
    if (Number.isInteger(value) && value >= 0 && value <= 24)
      return Math.round(value * 60) % (24 * 60); // hours
    if (Number.isInteger(value) && value <= 1440)
      return Math.round(value) % (24 * 60); // minutes (idempotent)
    // non-integer >= 1: decimal hours, e.g. 14.5 -> 14:30
    if (value > 0 && value < 24) return Math.round(value * 60) % (24 * 60);
    const frac = value - Math.floor(value);
    return Math.round(frac * 24 * 60) % (24 * 60);
  }
  const m = String(value)
    .trim()
    .match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
  if (!m) throw Error("Invalid date format. String date should be HH:MM");
  const h = +m[1],
    min = +m[2];
  if (h > 24 || min > 59)
    throw Error(
      "parseTimeToMinutes. Invalid time format HH:MM HH > 24 or MM > 59",
    );
  return (h * 60 + min) % (24 * 60);
}

/**
 * Expand the recurring shift/break calendar into concrete, merged working
 * intervals (Date pairs) starting from `calendar.startDate`. Shifts may wrap
 * midnight (end <= start). Breaks outside any shift are ignored.
 *
 * `calendar.failures` are one-off production-failure windows — concrete
 * datetimes ({date: "YYYY-MM-DD", start, end}), not recurring — and are cut
 * out of the working time just like breaks.
 *
 * `calendar.holidays` are full non-working days ([{date: "YYYY-MM-DD", name}],
 * typically loaded from a file via the desktop server) — no work is placed on
 * those days at all.
 */
export function expandWorkIntervals(calendar: CalendarConfig, days: number) {
  const shifts = (calendar.shifts || [])
    .map((s) => ({
      ...s,
      a: parseTimeToMinutes(s.start),
      b: parseTimeToMinutes(s.end),
    }))
    .filter((s) => s.a != null && s.b != null && s.a !== s.b);
  const breaks = (calendar.breaks || [])
    .map((b) => ({
      ...b,
      a: parseTimeToMinutes(b.start),
      b: parseTimeToMinutes(b.end),
    }))
    .filter((b) => b.a != null && b.b != null && b.a !== b.b);
  // one-off failure windows: concrete Date pairs
  const failures = (calendar.failures || [])
    .map((f) => {
      if (!f || !f.date) return null;
      const a = parseTimeToMinutes(f.start);
      const b = parseTimeToMinutes(f.end);
      if (a == null || b == null || a === b) return null;
      const day = new Date(f.date + "T00:00:00");
      return [dateAtTime(day, 0, a), dateAtTime(day, b <= a ? 1 : 0, b)];
    })
    .filter(Boolean);

  const base = new Date(calendar.startDate + "T00:00:00");
  const raw: Date[][] = [];

  // full non-working days (holidays)
  const holidaySet = new Set(
    (calendar.holidays || [])
      .map((h) => (typeof h === "string" ? h : h && h.date))
      .filter(Boolean),
  );

  const subtractWindow = (segs: Date[][], ws: Date, we: Date) => {
    const next = [];
    for (const [s0, s1] of segs) {
      if (we <= s0 || ws >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (ws > s0)
        next.push([s0, new Date(Math.min(s1.getTime(), ws.getTime()))]);
      if (we < s1)
        next.push([new Date(Math.max(s0.getTime(), we.getTime())), s1]);
    }
    return next;
  };

  for (let d = 0; d < days; d++) {
    const dayStart = new Date(base.getTime() + d * DAY_MS);
    const dayISO = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
    if (holidaySet.has(dayISO)) continue; // public holiday: no work at all

    for (const s of shifts) {
      const start = dateAtTime(base, d, s.a);
      const end = dateAtTime(base, s.b <= s.a ? d + 1 : d, s.b);

      // subtract recurring breaks …
      let segs = [[start, end]];
      for (const b of breaks) {
        const bs = dateAtTime(base, d, b.a);
        const be = dateAtTime(base, b.b <= b.a ? d + 1 : d, b.b);
        if (be <= bs) continue;
        segs = subtractWindow(segs, bs, be);
      }
      // … and any one-off failure windows overlapping this shift
      for (const [fs, fe] of failures ?? []) {
        if (fe <= start || fs >= end) continue;
        segs = subtractWindow(segs, fs, fe);
      }
      for (const seg of segs) if (seg[1] > seg[0]) raw.push(seg);
    }
  }

  // merge touching/overlapping intervals
  raw.sort(
    (x, y) =>
      x[0].getTime() - y[0].getTime() || x[1].getTime() - y[1].getTime(),
  );
  const out = [];
  for (const seg of raw) {
    const last = out[out.length - 1];
    if (last && seg[0] <= last[1])
      last[1] = new Date(Math.max(last[1].getTime(), seg[1].getTime()));
    else out.push([seg[0], seg[1]]);
  }
  return out.map(([s, e]) => ({ start: s, end: e }));
}

/* -------------------------------------------------------------- calendar -- */

export const DAY_MS = 86400000;

export function dateAtTime(baseDate: Date, dayOffset: number, minutes: number) {
  const d = new Date(baseDate.getTime() + dayOffset * DAY_MS);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export function normalizeOee(oee: number) {
  let o = Number(oee);
  if (!isFinite(o) || o <= 0) o = 1;
  if (o > 1) o = o / 100; // people type 80 meaning 80%
  return Math.min(1, Math.max(0.05, o));
}
