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

import { Product, ScheduleContext, ScheduleRow } from "../../Types";
import {
  dateAtTime,
  DAY_MS,
  expandWorkIntervals,
  familyList,
  idealRunMinutes,
  normalizeOee,
  parseTimeToMinutes,
  setupBetween,
  SolverOptions,
} from "./common";
import { Ctx } from "../ctx";

export const MAX_FAMILIES = 10;

/* ------------------------------------------------------------------ time -- */

export function minutesToHM(min: number) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return (
    String(Math.floor(m / 60)).padStart(2, "0") +
    ":" +
    String(m % 60).padStart(2, "0")
  );
}

/** OEE only dilutes production time: ideal 10 min at 80% -> 12.5 min. */
export function effectiveUnitMinutes(unitMinutes: number, oee: number) {
  return unitMinutes / normalizeOee(oee);
}

/* --------------------------------------------------------------- problem -- */

/** Total setup minutes charged by walking `sequence` (incl. initial setup). */
export function sequenceSetupMinutes(ctx: Ctx, sequence: string[]) {
  let total = 0,
    prev = ctx.initialFamily || null;
  for (const fam of sequence) {
    total += setupBetween(ctx, prev, fam);
    prev = fam;
  }
  return total;
}

/**
 * Compile a crew-time factor into f(x): how the per-piece time scales with
 * the number of people working. Accepts either a plain multiplier
 * ("0.85" — constant for any crew size) or a formula in x, e.g. "1/x",
 * "1.2/x + 0.3". Unset means NO time impact: f(x) = 1 — the crew size alone
 * must never silently change the plan.
 * Parsed with a tiny recursive-descent parser — no eval.
 */
export function compileCrewFactor(spec: any) {
  if (spec == null || spec === "" || spec === 1) return () => 1;
  if (typeof spec === "number") {
    if (!isFinite(spec) || spec <= 0) return () => 1;
    return () => spec;
  }
  const clean = String(spec).trim().toLowerCase().replace(/\s+/g, "");
  if (/^\d+(?:\.\d+)?$/.test(clean)) {
    const m = parseFloat(clean);
    return () => m;
  }
  const tokens = clean.match(/x|\d+(?:\.\d+)?|[+\-*/()]/g);
  if (!tokens || tokens.join("") !== clean) {
    throw new Error(`Cannot parse crew factor "${spec}"`);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr() {
    let fn = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = term();
      const left = fn; // capture: fn gets reassigned below
      fn = op === "+" ? (x) => left(x) + rhs(x) : (x) => left(x) - rhs(x);
    }
    return fn;
  }
  function term() {
    let fn = factor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = factor();
      const left = fn;
      fn = op === "*" ? (x) => left(x) * rhs(x) : (x) => left(x) / rhs(x);
    }
    return fn;
  }
  function factor(): (x: number) => number {
    const t = next();
    if (t === "x") return (x) => x;
    if (t === "(") {
      const inner = expr();
      if (next() !== ")") throw new Error(`Cannot parse crew factor "${spec}"`);
      return inner;
    }
    if (t === "-") {
      const inner = factor();
      return (x) => -inner(x);
    }
    if (t === "+") return factor();
    if (/^\d/.test(t)) {
      const n = parseFloat(t);
      return () => n;
    }
    throw new Error(`Cannot parse crew factor "${spec}"`);
  }

  const fn = expr();
  if (pos !== tokens.length)
    throw new Error(`Cannot parse crew factor "${spec}"`);
  return (x: number) => {
    const v = fn(Number(x) || 1);
    return isFinite(v) && v > 0 ? v : 1 / (Number(x) || 1); // sane fallback
  };
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
export function solveBruteForce(
  ctx: ScheduleContext,
  opts: SolverOptions = {},
) {
  const codes = ctx.codes || [];
  const families = familyList(codes);
  const n = families.length;
  if (n === 0) {
    return {
      sequence: [],
      setupMinutes: 0,
      runMinutes: 0,
      evaluated: 0,
      elapsedMs: 0,
      optimum: true,
    };
  }
  if (n > MAX_FAMILIES) {
    const err = new Error(
      `Brute force needs ${n}! permutations (${n} families); the limit is ${MAX_FAMILIES}.`,
    );
    throw err;
  }

  const fixedFirst =
    opts.fixedFirst && families.includes(opts.fixedFirst)
      ? opts.fixedFirst
      : null;
  const rest = families.filter((f) => f !== fixedFirst);
  const t0 = Date.now();

  let best: { sequence: string[]; setupMinutes: number } | null = null;
  let bestKey: string | null = null;
  let evaluated = 0;

  const consider = (seq: string[]) => {
    evaluated++;
    const setup = sequenceSetupMinutes(ctx, seq);
    const key = seq.join(">");
    if (
      best === null ||
      setup < best.setupMinutes ||
      (setup === best.setupMinutes && key < bestKey!) // deterministic tie-break
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
  for (let i = 0; i < rest.length;) {
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
    sequence: best!.sequence,
    setupMinutes: best!.setupMinutes,
    runMinutes: idealRunMinutes(codes),
    evaluated,
    elapsedMs: Date.now() - t0,
    optimum: true,
  };
}

/* --------------------------------------------------------------- schedule -- */

/**
 * Collapse a family sequence into "visits" — consecutive groups of codes
 * sharing a family. Families without codes are skipped (they would otherwise
 * consume calendar time without producing a row).
 */
export function visitsFromSequence(ctx: Ctx, sequence: string[]): Visit[] {
  const codes = ctx.codes || [];
  const visits = [];
  for (const fam of sequence || []) {
    const famCodes = codes.filter((c) => c.family === fam);
    if (famCodes.length) visits.push({ family: fam, codes: famCodes });
  }
  return visits;
}

type Visit = {
  family: string;
  codes: Product[];
};

/**
 * Collapse an explicit code order (the user's queue) into visits. Consecutive
 * codes of the same family merge into one visit; every family change starts a
 * new one and charges its changeover — this is what makes hand-mixing
 * suboptimal, and possible.
 */
export function visitsFromCodeOrder(_: Ctx, orderedCodes: Product[]) {
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
function scheduleFromVisits(ctx: Ctx, visits: Visit[]) {
  const calendar = ctx.calendar || {};
  const engine =
    calendar.direction === "backward"
      ? backwardScheduleFromVisits
      : forwardScheduleFromVisits;
  return engine(ctx, visits);
}

function scheduleMetrics(rows: ScheduleRow[]) {
  const segMinutes = (segments: Interval[]) =>
    segments.reduce(
      (a, x) => a + (x.end.getTime() - x.start.getTime()) / 60000,
      0,
    );
  const started = rows
    .flatMap((r) => [...r.setupSegments, ...r.runSegments])
    .reduce(
      (min, s) => (s.start < min ? s.start : min),
      new Date(8640000000000000),
    );
  const ended = rows
    .flatMap((r) => [...r.setupSegments, ...r.runSegments])
    .reduce(
      (max, s) => (s.end > max ? s.end : max),
      new Date(-8640000000000000),
    );
  return {
    rows,
    start: started,
    end: ended,
    setupMinutes: rows.reduce((s, r) => s + segMinutes(r.setupSegments), 0),
    runMinutes: rows.reduce((s, r) => s + segMinutes(r.runSegments), 0),
  };
}

function forwardScheduleFromVisits(ctx: Ctx, visits: Visit[]) {
  const calendar = ctx.calendar || {};
  const oee = normalizeOee(ctx.oee);
  const maxDays = calendar.maxDays || 400;
  const crew = Math.max(1, Math.round(Number(calendar.crew) || 1));
  const crewF = compileCrewFactor(calendar.crewFactor);

  let intervals = expandWorkIntervals(calendar, Math.min(maxDays, 60));

  // Respect an optional earliest start time on the first day.
  const startAt = calendar.startAt
    ? parseTimeToMinutes(calendar.startAt)
    : null;
  if (startAt != null && intervals.length) {
    const first = intervals[0];
    const limit = dateAtTime(
      new Date(calendar.startDate + "T00:00:00"),
      0,
      startAt,
    );
    if (limit > first.start && limit < first.end) first.start = limit;
    if (first.start >= first.end) intervals.shift();
  }

  let intervalIdx = 0;

  const take = (minutesNeeded: number, sink: Interval[]) => {
    let remaining = minutesNeeded;
    let guard = 0;
    while (remaining > 1e-9) {
      if (++guard > 20000)
        throw new Error(
          "Could not fit the plan on the calendar — check shifts.",
        );
      if (intervalIdx >= intervals.length) {
        // extend the horizon and keep going
        const more = expandWorkIntervals(
          calendar,
          Math.min(maxDays, intervals.length + 90),
        ).filter((iv) => iv.end > intervals[intervals.length - 1].end);
        if (!more.length)
          throw new Error(
            "Calendar horizon exhausted — check the shift definition.",
          );
        intervals = intervals.concat(more);
        continue;
      }
      const iv = intervals[intervalIdx];
      if (iv.start >= iv.end) {
        intervalIdx++;
        continue;
      }
      const avail = (iv.end.getTime() - iv.start.getTime()) / 60000;
      const slice = Math.min(avail, remaining);
      const segEnd = new Date(iv.start.getTime() + slice * 60000);
      sink.push({ start: new Date(iv.start), end: segEnd });
      remaining -= slice;
      iv.start = segEnd;
      if (iv.start >= iv.end) intervalIdx++;
    }
  };

  const rows: ScheduleRow[] = [];
  let prevFamily = ctx.initialFamily || null;

  for (const visit of visits) {
    const fam = visit.family;

    const setupMin = setupBetween(ctx, prevFamily, fam);
    const setupSegments: Interval[] = [];
    if (setupMin > 0) take(setupMin, setupSegments);

    visit.codes.forEach((c, idx) => {
      const runSegments: Interval[] = [];
      const unitEffective =
        effectiveUnitMinutes(c.unitMinutes, oee) * crewF(crew);
      const minutes = (c.qty || 0) * unitEffective;
      if (minutes > 0) take(minutes, runSegments);
      rows.push({
        code: c.code,
        family: fam,
        qty: c.qty,
        unitIdeal: c.unitMinutes,
        unitEffective,
        setupFrom: prevFamily,
        setupSegments: idx === 0 ? setupSegments : [],
        runSegments,
      });
    });
    prevFamily = fam;
  }

  return scheduleMetrics(rows);
}

function backwardScheduleFromVisits(ctx: Ctx, visits: Visit[]) {
  const calendar = ctx.calendar || {};
  const oee = normalizeOee(ctx.oee);
  const crew = Math.max(1, Math.round(Number(calendar.crew) || 1));
  const crewF = compileCrewFactor(calendar.crewFactor);
  if (!calendar.dueDate) throw new Error("Backward planning needs a due date.");

  const dueBase = new Date(calendar.dueDate + "T00:00:00");
  const backDays = Math.min(calendar.maxDays || 400, 360);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const origin = new Date(dueBase.getTime() - backDays * DAY_MS);
  const originStr = `${origin.getFullYear()}-${pad2(origin.getMonth() + 1)}-${pad2(origin.getDate())}`;

  let intervals = expandWorkIntervals(
    { ...calendar, startDate: originStr },
    backDays + 1,
  );

  // Anchor: the given due time, or — when absent — the end of the last
  // working interval on the due day.
  const dueAt = calendar.dueAt ? parseTimeToMinutes(calendar.dueAt) : null;
  if (dueAt != null) {
    const anchor = dateAtTime(dueBase, 0, dueAt);
    intervals = intervals
      .map((iv) => ({
        start: iv.start,
        end: iv.end > anchor ? anchor : iv.end,
      }))
      .filter((iv) => iv.end > iv.start);
  } else {
    intervals = intervals.filter(
      (iv) => iv.end <= new Date(dueBase.getTime() + DAY_MS),
    );
    if (!intervals.length)
      throw new Error(
        "No working time on or before the due date — check the shifts.",
      );
  }
  if (!intervals.length)
    throw new Error(
      "No working time before the due date — check the shift definition.",
    );

  // walk the working time backwards: last interval first, consuming from ends
  const reversed = intervals.slice().reverse();
  let idx = 0;

  const takeBack = (minutesNeeded: number, sink: Interval[]) => {
    let remaining = minutesNeeded;
    let guard = 0;
    while (remaining > 1e-9) {
      if (++guard > 20000)
        throw new Error(
          "Could not fit the plan before the due date — check shifts.",
        );
      if (idx >= reversed.length) {
        throw new Error(
          "Not enough working time before the due date — the plan does not fit.",
        );
      }
      const iv = reversed[idx];
      if (iv.end <= iv.start) {
        idx++;
        continue;
      }
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
      const runSegments: Interval[] = [];
      const minutes =
        (c.qty || 0) * effectiveUnitMinutes(c.unitMinutes, oee) * crewF(crew);
      if (minutes > 0) takeBack(minutes, runSegments);
      placements.set(c, runSegments);
    }
    const setupMin = setupBetween(
      ctx,
      i > 0 ? visits[i - 1].family : ctx.initialFamily || null,
      visit.family,
    );
    const setupSegments: Interval[] = [];
    if (setupMin > 0) takeBack(setupMin, setupSegments);
    setupByVisit.set(visit, setupSegments);
  }

  // assemble rows in chronological order, segments back to chronological
  const rows: ScheduleRow[] = [];
  let prevFamily = ctx.initialFamily || null;
  for (const visit of visits) {
    const setupSegments = (setupByVisit.get(visit) || []).slice().reverse();
    visit.codes.forEach((c: Product, idx: number) => {
      const unitEffective =
        effectiveUnitMinutes(c.unitMinutes, oee) * crewF(crew);
      rows.push({
        code: c.code,
        family: visit.family,
        qty: c.qty,
        unitIdeal: c.unitMinutes,
        unitEffective,
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
export function buildSchedule(ctx: Ctx, sequence: string[]) {
  return scheduleFromVisits(ctx, visitsFromSequence(ctx, sequence));
}

/** Schedule for an explicit, possibly family-mixing code order. */
export function buildScheduleFromCodeOrder(ctx: Ctx, orderedCodes: Product[]) {
  return scheduleFromVisits(ctx, visitsFromCodeOrder(ctx, orderedCodes));
}
