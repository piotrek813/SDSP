/*
 * solver-bruteforce.js
 * ---------------------------------------------------------------------------
 * Single-machine, sequence-dependent scheduling — exhaustive (brute force)
 * solver. This file is intentionally dependency-free and side-effect free so
 * it can be:
 *   - imported by the web app          (import { solveBruteForce } from ...)
 *   - imported by Node tests           (node --test test/)
 *   - compared against other solver implementations that honour the same
 *     problem/solution contract (see test/reference-heldkarp.mjs).
 *
 * PROBLEM CONTRACT (plain JSON, nothing else required)
 * ---------------------------------------------------------------------------
 * ctx = {
 *   setup: { "A>B": minutes, ... }   // setup minutes when family A runs
 *                                    // immediately before family B (flat map,
 *                                    // "from>to" keys). Same-family entries
 *                                    // may be 0.
 *   initialFamily: "Start"|null,     // state of the machine before the run;
 *                                    // null = no initial setup charged
 *   calendar: {
 *     startDate: "YYYY-MM-DD",       // first day considered
 *     startAt: "HH:MM"|null,         // earliest clock time work may begin
 *                                    // (null = as soon as the calendar allows)
 *     shifts: [ { name, start: "HH:MM", end: "HH:MM" } ],   // recurring daily,
 *                                    // may wrap midnight (end <= start)
 *     breaks: [ { name, start: "HH:MM", end: "HH:MM" } ],   // recurring daily,
 *                                    // subtracted from shift time
 *     maxDays: 400                   // safety horizon
 *   },
 *   codes: [ { id, code, family, qty, unitMinutes } ]  // unitMinutes = ideal
 *                                                      // time for ONE unit
 *   oee: 0..1                        // a 10 min unit at 0.8 OEE takes
 *                                    // 10 / 0.8 = 12.5 min on the machine
 * }
 *
 * SOLUTION CONTRACT
 * ---------------------------------------------------------------------------
 * { sequence, setupMinutes, runMinutes, evaluated, elapsedMs, optimum }
 *
 * buildSchedule(ctx, sequence?) returns the calendar-elapsed schedule used by
 * the Gantt chart: wall-clock Date objects, work split around breaks/shifts.
 * ---------------------------------------------------------------------------
 */

export const MAX_FAMILIES = 10;

/* ------------------------------------------------------------------ time -- */

/** "6:00" | "06:00" | 0.25 (Excel time) | 360 (minutes) | Date -> minutes. */
export function parseTimeToMinutes(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === "number" && isFinite(value)) {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60) % (24 * 60); // Excel time-of-day
    if (Number.isInteger(value) && value >= 0 && value <= 24) return Math.round(value * 60) % (24 * 60); // hours
    if (Number.isInteger(value) && value <= 1440) return Math.round(value) % (24 * 60); // minutes (idempotent)
    // non-integer >= 1: decimal hours, e.g. 14.5 -> 14:30
    if (value > 0 && value < 24) return Math.round(value * 60) % (24 * 60);
    const frac = value - Math.floor(value);
    return Math.round(frac * 24 * 60) % (24 * 60);
  }
  const m = String(value).trim().match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 24 || min > 59) return null;
  return (h * 60 + min) % (24 * 60);
}

export function minutesToHM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** OEE only dilutes production time: ideal 10 min at 80% -> 12.5 min. */
export function effectiveUnitMinutes(unitMinutes, oee) {
  return unitMinutes / normalizeOee(oee);
}

export function normalizeOee(oee) {
  let o = Number(oee);
  if (!isFinite(o) || o <= 0) o = 1;
  if (o > 1) o = o / 100;                            // people type 80 meaning 80%
  return Math.min(1, Math.max(0.05, o));
}

/* --------------------------------------------------------------- problem -- */

/** Families in first-appearance order across the selected codes. */
export function familyList(codes) {
  const out = [], seen = new Set();
  for (const c of codes || []) {
    if (c.family != null && !seen.has(c.family)) { seen.add(c.family); out.push(c.family); }
  }
  return out;
}

export function setupBetween(ctx, from, to) {
  if (from == null || to == null) return 0;
  const v = ctx.setup && ctx.setup[`${from}>${to}`];
  return Number.isFinite(+v) ? +v : 0;
}

/** Total setup minutes charged by walking `sequence` (incl. initial setup). */
export function sequenceSetupMinutes(ctx, sequence) {
  let total = 0, prev = ctx.initialFamily || null;
  for (const fam of sequence) {
    total += setupBetween(ctx, prev, fam);
    prev = fam;
  }
  return total;
}

/** Ideal production minutes for the whole plan (OEE-independent). */
export function idealRunMinutes(codes) {
  return (codes || []).reduce((s, c) => s + (c.qty * c.unitMinutes || 0), 0);
}

/* ------------------------------------------------------------- the solver -- */

/**
 * Exhaustive search over all family permutations. Production time is fixed by
 * the order lines, so only setup varies with the sequence — the permutation
 * with the least total setup also finishes earliest on a recurring calendar.
 *
 * opts.fixedFirst — pin a family at position 1 (operator priority). The solver
 * then optimises the rest, and the UI can expose the price of that constraint
 * by comparing against the free optimum.
 */
export function solveBruteForce(ctx, opts = {}) {
  const codes = ctx.codes || [];
  const families = familyList(codes);
  const n = families.length;
  if (n === 0) {
    return { sequence: [], setupMinutes: 0, runMinutes: 0, evaluated: 0, elapsedMs: 0, optimum: true };
  }
  if (n > MAX_FAMILIES) {
    const err = new Error(
      `Brute force needs ${n}! permutations (${n} families); the limit is ${MAX_FAMILIES}.`
    );
    err.code = "TOO_MANY_FAMILIES";
    throw err;
  }

  const fixedFirst = opts.fixedFirst && families.includes(opts.fixedFirst) ? opts.fixedFirst : null;
  const rest = families.filter((f) => f !== fixedFirst);
  const t0 = Date.now();

  let best = null;
  let bestKey = null;
  let evaluated = 0;

  const consider = (seq) => {
    evaluated++;
    const setup = sequenceSetupMinutes(ctx, seq);
    const key = seq.join(">");
    if (
      best === null ||
      setup < best.setupMinutes ||
      (setup === best.setupMinutes && key < bestKey)   // deterministic tie-break
    ) {
      best = { sequence: seq.slice(), setupMinutes: setup };
      bestKey = key;
    }
  };

  // Heap's algorithm over `rest`; a pinned family sits in front.
  const off = fixedFirst ? 1 : 0;
  const seq = new Array(n);
  if (fixedFirst) seq[0] = fixedFirst;
  for (let i = 0; i < rest.length; i++) seq[i + off] = rest[i];
  consider(seq.slice());

  const c = new Array(rest.length).fill(0);
  for (let i = 0; i < rest.length; ) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [seq[j + off], seq[i + off]] = [seq[i + off], seq[j + off]];
      consider(seq.slice());
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }

  return {
    sequence: best.sequence,
    setupMinutes: best.setupMinutes,
    runMinutes: idealRunMinutes(codes),
    evaluated,
    elapsedMs: Date.now() - t0,
    optimum: true,
  };
}

/* -------------------------------------------------------------- calendar -- */

const DAY_MS = 86400000;

function dateAtTime(baseDate, dayOffset, minutes) {
  const d = new Date(baseDate.getTime() + dayOffset * DAY_MS);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/**
 * Expand the recurring shift/break calendar into concrete, merged working
 * intervals (Date pairs) starting from `calendar.startDate`. Shifts may wrap
 * midnight (end <= start). Breaks outside any shift are ignored.
 *
 * `calendar.failures` are one-off production-failure windows — concrete
 * datetimes ({date: "YYYY-MM-DD", start, end}), not recurring — and are cut
 * out of the working time just like breaks.
 */
export function expandWorkIntervals(calendar, days) {
  const shifts = (calendar.shifts || [])
    .map((s) => ({ ...s, a: parseTimeToMinutes(s.start), b: parseTimeToMinutes(s.end) }))
    .filter((s) => s.a != null && s.b != null && s.a !== s.b);
  const breaks = (calendar.breaks || [])
    .map((b) => ({ ...b, a: parseTimeToMinutes(b.start), b: parseTimeToMinutes(b.end) }))
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
  const raw = [];

  const subtractWindow = (segs, ws, we) => {
    const next = [];
    for (const [s0, s1] of segs) {
      if (we <= s0 || ws >= s1) { next.push([s0, s1]); continue; }
      if (ws > s0) next.push([s0, new Date(Math.min(s1.getTime(), ws.getTime()))]);
      if (we < s1) next.push([new Date(Math.max(s0.getTime(), we.getTime())), s1]);
    }
    return next;
  };

  for (let d = 0; d < days; d++) {
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
      for (const [fs, fe] of failures) {
        if (fe <= start || fs >= end) continue;
        segs = subtractWindow(segs, fs, fe);
      }
      for (const seg of segs) if (seg[1] > seg[0]) raw.push(seg);
    }
  }

  // merge touching/overlapping intervals
  raw.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const seg of raw) {
    const last = out[out.length - 1];
    if (last && seg[0] <= last[1]) last[1] = new Date(Math.max(last[1].getTime(), seg[1].getTime()));
    else out.push([seg[0], seg[1]]);
  }
  return out.map(([s, e]) => ({ start: s, end: e }));
}

/* --------------------------------------------------------------- schedule -- */

/**
 * Collapse a family sequence into "visits" — consecutive groups of codes
 * sharing a family. Families without codes are skipped (they would otherwise
 * consume calendar time without producing a row).
 */
export function visitsFromSequence(ctx, sequence) {
  const codes = ctx.codes || [];
  const visits = [];
  for (const fam of sequence || []) {
    const famCodes = codes.filter((c) => c.family === fam);
    if (famCodes.length) visits.push({ family: fam, codes: famCodes });
  }
  return visits;
}

/**
 * Collapse an explicit code order (the user's queue) into visits. Consecutive
 * codes of the same family merge into one visit; every family change starts a
 * new one and charges its changeover — this is what makes hand-mixing
 * suboptimal, and possible.
 */
export function visitsFromCodeOrder(ctx, orderedCodes) {
  const visits = [];
  for (const c of orderedCodes || []) {
    if (!c || c.family == null) continue;
    const last = visits[visits.length - 1];
    if (last && last.family === c.family) last.codes.push(c);
    else visits.push({ family: c.family, codes: [c] });
  }
  return visits.filter((v) => v.codes.some((c) => (c.qty || 0) > 0));
}

/**
 * Place visits on the real calendar. Work pauses during breaks, failure
 * windows and between shifts, then resumes in the next working interval.
 * Setup is charged once per visit and attached to the visit's first row.
 *
 * Forward direction (default): work starts as early as the calendar allows,
 * anchored at calendar.startDate (+ optional startAt).
 *
 * Backward direction (calendar.direction === "backward"): the plan's finish is
 * anchored at calendar.dueDate (+ optional dueAt) and work is placed backwards
 * from there — jobs finish as late as possible before the due date, slack
 * appears at the beginning.
 *
 * Returns per-row segment data ready for a Gantt chart:
 *   rows[i] = { code, family, qty, unitIdeal, unitEffective, setupFrom,
 *               setupSegments: [{start,end}], runSegments: [{start,end}] }
 */
function scheduleFromVisits(ctx, visits) {
  const calendar = ctx.calendar || {};
  const engine = calendar.direction === "backward" ? backwardScheduleFromVisits : forwardScheduleFromVisits;
  return engine(ctx, visits);
}

function scheduleMetrics(rows) {
  const segMinutes = (segments) =>
    segments.reduce((a, x) => a + (x.end.getTime() - x.start.getTime()) / 60000, 0);
  const started = rows
    .flatMap((r) => [...r.setupSegments, ...r.runSegments])
    .reduce((min, s) => (s.start < min ? s.start : min), new Date(8640000000000000));
  const ended = rows
    .flatMap((r) => [...r.setupSegments, ...r.runSegments])
    .reduce((max, s) => (s.end > max ? s.end : max), new Date(-8640000000000000));
  return {
    rows,
    start: rows.length ? started : null,
    end: rows.length ? ended : null,
    setupMinutes: rows.reduce((s, r) => s + segMinutes(r.setupSegments), 0),
    runMinutes: rows.reduce((s, r) => s + segMinutes(r.runSegments), 0),
  };
}

function forwardScheduleFromVisits(ctx, visits) {
  const calendar = ctx.calendar || {};
  const oee = normalizeOee(ctx.oee);
  const maxDays = calendar.maxDays || 400;

  let intervals = expandWorkIntervals(calendar, Math.min(maxDays, 60));

  // Respect an optional earliest start time on the first day.
  const startAt = calendar.startAt ? parseTimeToMinutes(calendar.startAt) : null;
  if (startAt != null && intervals.length) {
    const first = intervals[0];
    const limit = dateAtTime(new Date(calendar.startDate + "T00:00:00"), 0, startAt);
    if (limit > first.start && limit < first.end) first.start = limit;
    if (first.start >= first.end) intervals.shift();
  }

  let intervalIdx = 0;

  const take = (minutesNeeded, sink) => {
    let remaining = minutesNeeded;
    let guard = 0;
    while (remaining > 1e-9) {
      if (++guard > 20000) throw new Error("Could not fit the plan on the calendar — check shifts.");
      if (intervalIdx >= intervals.length) {
        // extend the horizon and keep going
        const more = expandWorkIntervals(calendar, Math.min(maxDays, intervals.length + 90))
          .filter((iv) => iv.end > intervals[intervals.length - 1].end);
        if (!more.length) throw new Error("Calendar horizon exhausted — check the shift definition.");
        intervals = intervals.concat(more);
        continue;
      }
      const iv = intervals[intervalIdx];
      if (iv.start >= iv.end) { intervalIdx++; continue; }
      const avail = (iv.end.getTime() - iv.start.getTime()) / 60000;
      const slice = Math.min(avail, remaining);
      const segEnd = new Date(iv.start.getTime() + slice * 60000);
      sink.push({ start: new Date(iv.start), end: segEnd });
      remaining -= slice;
      iv.start = segEnd;
      if (iv.start >= iv.end) intervalIdx++;
    }
  };

  const rows = [];
  let prevFamily = ctx.initialFamily || null;

  for (const visit of visits) {
    const fam = visit.family;

    const setupMin = setupBetween(ctx, prevFamily, fam);
    const setupSegments = [];
    if (setupMin > 0) take(setupMin, setupSegments);

    visit.codes.forEach((c, idx) => {
      const runSegments = [];
      const minutes = (c.qty || 0) * effectiveUnitMinutes(c.unitMinutes, oee);
      if (minutes > 0) take(minutes, runSegments);
      rows.push({
        code: c.code,
        family: fam,
        qty: c.qty,
        unitIdeal: c.unitMinutes,
        unitEffective: effectiveUnitMinutes(c.unitMinutes, oee),
        setupFrom: prevFamily,
        setupSegments: idx === 0 ? setupSegments : [],
        runSegments,
      });
    });
    prevFamily = fam;
  }

  return scheduleMetrics(rows);
}

function backwardScheduleFromVisits(ctx, visits) {
  const calendar = ctx.calendar || {};
  const oee = normalizeOee(ctx.oee);
  if (!calendar.dueDate) throw new Error("Backward planning needs a due date.");

  const dueBase = new Date(calendar.dueDate + "T00:00:00");
  const backDays = Math.min(calendar.maxDays || 400, 360);

  const pad2 = (n) => String(n).padStart(2, "0");
  const origin = new Date(dueBase.getTime() - backDays * DAY_MS);
  const originStr = `${origin.getFullYear()}-${pad2(origin.getMonth() + 1)}-${pad2(origin.getDate())}`;

  let intervals = expandWorkIntervals({ ...calendar, startDate: originStr }, backDays + 1);

  // Anchor: the given due time, or — when absent — the end of the last
  // working interval on the due day.
  const dueAt = calendar.dueAt ? parseTimeToMinutes(calendar.dueAt) : null;
  if (dueAt != null) {
    const anchor = dateAtTime(dueBase, 0, dueAt);
    intervals = intervals
      .map((iv) => ({ start: iv.start, end: iv.end > anchor ? anchor : iv.end }))
      .filter((iv) => iv.end > iv.start);
  } else {
    intervals = intervals.filter((iv) => iv.end <= new Date(dueBase.getTime() + DAY_MS));
    if (!intervals.length) throw new Error("No working time on or before the due date — check the shifts.");
  }
  if (!intervals.length) throw new Error("No working time before the due date — check the shift definition.");

  // walk the working time backwards: last interval first, consuming from ends
  const reversed = intervals.slice().reverse();
  let idx = 0;

  const takeBack = (minutesNeeded, sink) => {
    let remaining = minutesNeeded;
    let guard = 0;
    while (remaining > 1e-9) {
      if (++guard > 20000) throw new Error("Could not fit the plan before the due date — check shifts.");
      if (idx >= reversed.length) {
        throw new Error("Not enough working time before the due date — the plan does not fit.");
      }
      const iv = reversed[idx];
      if (iv.end <= iv.start) { idx++; continue; }
      const avail = (iv.end.getTime() - iv.start.getTime()) / 60000;
      const slice = Math.min(avail, remaining);
      const segStart = new Date(iv.end.getTime() - slice * 60000);
      sink.push({ start: segStart, end: new Date(iv.end) });
      remaining -= slice;
      iv.end = segStart;
      if (iv.end <= iv.start) idx++;
    }
  };

  // Place from the end of the plan backwards: last visit consumes time first,
  // then its setup, then the previous visit, and so on. The first visit in
  // the sequence therefore runs first chronologically — same run order, just
  // anchored at the due date.
  const placements = new Map(); // code object -> run segments (reverse order)
  const setupByVisit = new Map();
  for (let i = visits.length - 1; i >= 0; i--) {
    const visit = visits[i];
    for (const c of visit.codes.slice().reverse()) {
      const runSegments = [];
      const minutes = (c.qty || 0) * effectiveUnitMinutes(c.unitMinutes, oee);
      if (minutes > 0) takeBack(minutes, runSegments);
      placements.set(c, runSegments);
    }
    const setupMin = setupBetween(
      ctx,
      i > 0 ? visits[i - 1].family : (ctx.initialFamily || null),
      visit.family
    );
    const setupSegments = [];
    if (setupMin > 0) takeBack(setupMin, setupSegments);
    setupByVisit.set(visit, setupSegments);
  }

  // assemble rows in chronological order, segments back to chronological
  const rows = [];
  let prevFamily = ctx.initialFamily || null;
  for (const visit of visits) {
    const setupSegments = (setupByVisit.get(visit) || []).slice().reverse();
    visit.codes.forEach((c, idx) => {
      rows.push({
        code: c.code,
        family: visit.family,
        qty: c.qty,
        unitIdeal: c.unitMinutes,
        unitEffective: effectiveUnitMinutes(c.unitMinutes, oee),
        setupFrom: prevFamily,
        setupSegments: idx === 0 ? setupSegments : [],
        runSegments: (placements.get(c) || []).slice().reverse(),
      });
    });
    prevFamily = visit.family;
  }

  return scheduleMetrics(rows);
}

/** Schedule for a solver family sequence (codes within a family keep file order). */
export function buildSchedule(ctx, sequence) {
  return scheduleFromVisits(ctx, visitsFromSequence(ctx, sequence));
}

/** Schedule for an explicit, possibly family-mixing code order. */
export function buildScheduleFromCodeOrder(ctx, orderedCodes) {
  return scheduleFromVisits(ctx, visitsFromCodeOrder(ctx, orderedCodes));
}
