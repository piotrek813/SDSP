/*
 * solver.test.mjs — node --test test/solver.test.mjs
 * ---------------------------------------------------------------------------
 * Tests for js/solver-bruteforce.js plus a cross-check against an independent
 * exact algorithm (Held–Karp DP) on randomized instances. The randomised
 * section is the "compare implementations" harness: any new solver that honours
 * the contract can be added to the SOLVERS list below and will be compared on
 * the same fixtures.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTimeToMinutes,
  minutesToHM,
  normalizeOee,
  effectiveUnitMinutes,
  familyList,
  sequenceSetupMinutes,
  solveBruteForce,
  expandWorkIntervals,
  buildSchedule,
  buildScheduleFromCodeOrder,
  visitsFromCodeOrder,
} from "../js/solver-bruteforce.js";
import { heldKarpOptimum } from "./reference-heldkarp.mjs";

/* --------------------------------------------------------------- helpers -- */

// Deterministic PRNG so failures reproduce.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCtx(seed, nFamilies, opts = {}) {
  const rnd = mulberry32(seed);
  const families = Array.from({ length: nFamilies }, (_, i) => `F${i + 1}`);
  const setup = {};
  for (const a of families)
    for (const b of families)
      setup[`${a}>${b}`] = a === b ? 0 : Math.round(rnd() * 45) + (rnd() < 0.25 ? 0 : 5);
  const codes = [];
  let id = 0;
  for (const f of families) {
    const nCodes = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nCodes; i++) {
      codes.push({
        id: `c${id++}`,
        code: `${f}-P${i}`,
        family: f,
        qty: 1 + Math.floor(rnd() * 20),
        unitMinutes: Math.round((2 + rnd() * 18) * 10) / 10,
      });
    }
  }
  return {
    setup,
    initialFamily: opts.initialFamily === undefined ? "F1" : opts.initialFamily,
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [{ name: "1", start: "06:00", end: "14:00" }],
      breaks: [{ name: "Lunch", start: "12:00", end: "12:30" }],
      maxDays: 400,
    },
    codes,
    oee: 0.8,
  };
}

/* ------------------------------------------------------------ unit tests -- */

test("parseTimeToMinutes handles strings, Excel fractions and Dates", () => {
  assert.equal(parseTimeToMinutes("06:00"), 360);
  assert.equal(parseTimeToMinutes("6:00"), 360);
  assert.equal(parseTimeToMinutes("14:30"), 870);
  assert.equal(parseTimeToMinutes("23:59"), 1439);
  assert.equal(parseTimeToMinutes("24:00"), 0);
  assert.equal(parseTimeToMinutes(0.25), 360);          // Excel 06:00
  assert.equal(parseTimeToMinutes(0.5), 720);
  assert.equal(parseTimeToMinutes(6), 360);             // plain hours
  assert.equal(parseTimeToMinutes(360), 360);           // plain minutes (idempotent)
  assert.equal(parseTimeToMinutes(690), 690);
  assert.equal(parseTimeToMinutes(14.5), 870);          // decimal hours
  assert.equal(parseTimeToMinutes(new Date(2025, 0, 1, 7, 30)), 450);
  assert.equal(parseTimeToMinutes("garbage"), null);
  assert.equal(parseTimeToMinutes(null), null);
  assert.equal(minutesToHM(360), "06:00");
  assert.equal(minutesToHM(1439), "23:59");
});

test("OEE dilutes production time only: 10 min at 80% -> 12.5 min", () => {
  assert.equal(effectiveUnitMinutes(10, 0.8), 12.5);
  assert.equal(effectiveUnitMinutes(10, 80), 12.5);     // percent form
  assert.equal(effectiveUnitMinutes(10, 1), 10);
  assert.equal(effectiveUnitMinutes(10, "0.5"), 20);
  assert.equal(normalizeOee(0), 1);                     // guard: no divide by zero
  assert.equal(normalizeOee(-2), 1);
  assert.equal(normalizeOee(0.8), 0.8);
});

test("familyList preserves first-appearance order and de-duplicates", () => {
  assert.deepEqual(
    familyList([
      { family: "B" }, { family: "A" }, { family: "B" }, { family: "C" },
    ]),
    ["B", "A", "C"]
  );
});

test("sequenceSetupMinutes charges initial setup and each transition", () => {
  const ctx = {
    setup: { "Start>A": 30, "A>B": 10, "B>C": 20, "C>A": 5 },
    initialFamily: "Start",
    codes: [],
  };
  assert.equal(sequenceSetupMinutes(ctx, ["A", "B", "C"]), 60);
  // Start->C is missing from the matrix, so it charges 0: 0 + C>A(5) + A>B(10)
  assert.equal(sequenceSetupMinutes(ctx, ["C", "A", "B"]), 15);
  assert.equal(sequenceSetupMinutes({ ...ctx, initialFamily: null }, ["A", "B", "C"]), 30);
});

/* --------------------------------------------------------- solver checks -- */

test("brute force finds the known optimum on a hand-checked 4-family case", () => {
  // Asymmetric matrix crafted so the greedy first choice is suboptimal.
  const ctx = {
    setup: {
      "Start>A": 40, "Start>B": 50, "Start>C": 60, "Start>D": 70,
      "A>B": 5,  "A>C": 45, "A>D": 50,
      "B>A": 35, "B>C": 5,  "B>D": 40,
      "C>A": 30, "C>B": 25, "C>D": 5,
      "D>A": 20, "D>B": 15, "D>C": 10,
    },
    initialFamily: "Start",
    codes: [
      { id: "1", code: "A1", family: "A", qty: 5, unitMinutes: 10 },
      { id: "2", code: "B1", family: "B", qty: 5, unitMinutes: 10 },
      { id: "3", code: "C1", family: "C", qty: 5, unitMinutes: 10 },
      { id: "4", code: "D1", family: "D", qty: 5, unitMinutes: 10 },
    ],
  };
  const res = solveBruteForce(ctx);
  assert.equal(res.optimum, true);
  assert.equal(res.evaluated, 24); // 4!
  // best chain: Start>A(40)+A>B(5)+B>C(5)+C>D(5) = 55
  assert.equal(res.setupMinutes, 55);
  assert.deepEqual(res.sequence, ["A", "B", "C", "D"]);
});

test("brute force agrees with Held-Karp on 200 randomized instances", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const n = 3 + (seed % 6);          // 3..8 families
    const ctx = randomCtx(seed, n);
    const bf = solveBruteForce(ctx);
    const ref = heldKarpOptimum(ctx);
    assert.equal(
      bf.setupMinutes, ref,
      `seed ${seed}: brute force ${bf.setupMinutes} != held-karp ${ref}`
    );
    assert.ok(bf.evaluated > 0);
  }
});

test("Held-Karp agrees with brute force when starting from a matrix Start row", () => {
  const base = randomCtx(11, 5);
  const setup = { ...base.setup };
  for (const f of familyList(base.codes)) setup[`Start>${f}`] = 30;
  const ctx = { ...base, setup, initialFamily: "Start" };
  const bf = solveBruteForce(ctx);
  assert.equal(bf.setupMinutes, heldKarpOptimum(ctx));
  assert.ok(bf.setupMinutes >= 30); // the first family always charges the Start row
});

test("fixedFirst pins the priority family and still optimises the rest", () => {
  const ctx = randomCtx(42, 5);
  const free = solveBruteForce(ctx);
  const pinned = solveBruteForce(ctx, { fixedFirst: "F3" });
  assert.equal(pinned.sequence[0], "F3");
  assert.ok(pinned.setupMinutes >= free.setupMinutes); // priority can cost
  // the tail of the pinned plan must be optimal for the remaining families
  const tailCtx = { ...ctx, initialFamily: "F3" };
  const tailBest = heldKarpOptimum(tailCtx);
  const pinnedTail = sequenceSetupMinutes(
    { setup: ctx.setup, initialFamily: "F3" },
    pinned.sequence.slice(1)
  );
  assert.equal(pinnedTail, tailBest);
});

test("solver rejects more than MAX_FAMILIES families with a clear error", () => {
  const ctx = randomCtx(7, 11);
  assert.throws(() => solveBruteForce(ctx), /permutations/);
});

/* ------------------------------------------------------------- calendar -- */

test("expandWorkIntervals merges touching shifts and cuts breaks", () => {
  const ivs = expandWorkIntervals(
    {
      startDate: "2025-01-06",
      shifts: [
        { name: "1", start: "06:00", end: "14:00" },
        { name: "2", start: "14:00", end: "22:00" },
      ],
      breaks: [{ name: "Lunch", start: "12:00", end: "12:30" }],
    },
    2
  );
  // back-to-back shifts form one daily block, split by lunch -> 2 per day
  assert.equal(ivs.length, 4);
  const day1 = ivs.filter((iv) => iv.start.getDate() === 6);
  const minutes = day1.reduce((s, iv) => s + (iv.end - iv.start) / 60000, 0);
  assert.equal(minutes, 16 * 60 - 30); // 16h on the clock minus lunch
  // nothing is ever worked outside the shift window
  assert.ok(ivs.every((iv) => iv.start.getHours() >= 6 && iv.end.getHours() <= 22));
});

test("expandWorkIntervals supports shifts wrapping midnight", () => {
  const ivs = expandWorkIntervals(
    {
      startDate: "2025-01-06",
      shifts: [{ name: "N", start: "22:00", end: "06:00" }],
      breaks: [],
    },
    2
  );
  assert.equal(ivs.length, 2);
  assert.equal(ivs[0].start.getHours(), 22);
  assert.equal(ivs[0].end.getDate(), 7);
  assert.equal((ivs[0].end - ivs[0].start) / 60000, 8 * 60);
});

test("startAt delays the first working instant without losing capacity", () => {
  const cal = {
    startDate: "2025-01-06",
    shifts: [{ name: "1", start: "06:00", end: "14:00" }],
    breaks: [],
  };
  // startAt is honoured by buildSchedule, which trims the first interval
  const codes = [{ id: "1", code: "X1", family: "X", qty: 1, unitMinutes: 60 }];
  const base = buildSchedule({ setup: {}, initialFamily: null, calendar: { ...cal, startAt: null }, codes, oee: 1 }, ["X"]);
  const late = buildSchedule({ setup: {}, initialFamily: null, calendar: { ...cal, startAt: "08:00" }, codes, oee: 1 }, ["X"]);
  assert.equal(base.start.getHours(), 6);
  assert.equal(late.start.getHours(), 8);
  assert.equal((late.end - late.start) / 60000, 60);
});

/* -------------------------------------------------------------- schedule -- */

test("buildSchedule honours OEE, sequence and setup placement", () => {
  const ctx = {
    setup: { "Start>A": 60, "Start>B": 60, "A>B": 30, "B>A": 90 },
    initialFamily: "Start",
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [{ name: "1", start: "06:00", end: "14:00" }],
      breaks: [],
      maxDays: 400,
    },
    codes: [
      { id: "1", code: "A1", family: "A", qty: 4, unitMinutes: 10 },
      { id: "2", code: "B1", family: "B", qty: 4, unitMinutes: 10 },
    ],
    oee: 0.8,
  };
  const res = solveBruteForce(ctx);
  assert.deepEqual(res.sequence, ["A", "B"]); // 60+30 = 90 < 60+90 = 150

  const sched = buildSchedule(ctx, res.sequence);
  const rowA = sched.rows[0];
  const rowB = sched.rows[1];

  // A: 60 min setup (06:00..07:00) + 4 * 12.5 = 50 min run -> 07:00..07:50
  assert.equal(rowA.setupSegments.length, 1);
  assert.equal(rowA.setupSegments[0].start.getHours(), 6);
  let cursor = rowA.setupSegments[0].end;
  assert.equal(cursor.getHours(), 7);            // 07:00
  assert.equal(rowA.runSegments.length, 1);
  cursor = rowA.runSegments[0].end;
  assert.equal(cursor.getHours(), 7);
  assert.equal(cursor.getMinutes(), 50);         // +50 min -> 07:50

  // B starts exactly where A ended, with a 30 min setup
  assert.equal(rowB.setupSegments[0].start.getTime(), rowA.runSegments[0].end.getTime());
  const setupB = (rowB.setupSegments[0].end - rowB.setupSegments[0].start) / 60000;
  const runB = (rowB.runSegments[0].end - rowB.runSegments[0].start) / 60000;
  assert.equal(setupB, 30);
  assert.equal(runB, 50);
});

test("buildSchedule splits work around a mid-run break", () => {
  const ctx = {
    setup: {},
    initialFamily: null,
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [{ name: "1", start: "06:00", end: "14:00" }],
      breaks: [{ name: "Lunch", start: "12:00", end: "12:30" }],
    },
    codes: [{ id: "1", code: "X1", family: "X", qty: 19, unitMinutes: 20 }],
    oee: 1,
  };
  const sched = buildSchedule(ctx, ["X"]);
  const row = sched.rows[0];
  assert.equal(row.runSegments.length, 2);       // interrupted at lunch
  const s0 = row.runSegments[0], s1 = row.runSegments[1];
  assert.equal(s0.end.getHours(), 12);           // 06:00..12:00 before lunch
  assert.equal(s1.start.getHours(), 12);         // resumes 12:30
  assert.equal(s1.start.getMinutes(), 30);
  assert.equal(s1.end.getMinutes(), 50);         // 20 min remain of 19*20=380
  const total = (s0.end - s0.start) / 60000 + (s1.end - s1.start) / 60000;
  assert.equal(total, 380);                      // break time excluded
});

test("buildSchedule carries work across days when the shift ends", () => {
  const ctx = {
    setup: {},
    initialFamily: null,
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [{ name: "1", start: "06:00", end: "10:00" }],
      breaks: [],
    },
    codes: [{ id: "1", code: "X1", family: "X", qty: 1, unitMinutes: 300 }],
    oee: 1,
  };
  const sched = buildSchedule(ctx, ["X"]);
  const row = sched.rows[0];
  assert.equal(row.runSegments.length, 2);       // 4h day one, 1h day two
  assert.equal(row.runSegments[0].end.getDate(), 6);
  assert.equal(row.runSegments[1].end.getDate(), 7);
});

/* ------------------------------------------------------- code-order plans -- */

const twoFamilyCtx = () => ({
  setup: { "Start>A": 60, "A>B": 30, "B>A": 90 },
  initialFamily: "Start",
  calendar: {
    startDate: "2025-01-06",
    startAt: null,
    shifts: [{ name: "1", start: "06:00", end: "14:00" }],
    breaks: [],
    maxDays: 400,
  },
  codes: [
    { id: "1", code: "A1", family: "A", qty: 4, unitMinutes: 10 },
    { id: "2", code: "A2", family: "A", qty: 2, unitMinutes: 10 },
    { id: "3", code: "B1", family: "B", qty: 4, unitMinutes: 10 },
  ],
  oee: 0.8,
});

test("visitsFromCodeOrder merges consecutive same-family codes", () => {
  const ctx = { codes: [] };
  const visits = visitsFromCodeOrder(null, [
    { code: "A1", family: "A", qty: 1, unitMinutes: 1 },
    { code: "A2", family: "A", qty: 1, unitMinutes: 1 },
    { code: "B1", family: "B", qty: 1, unitMinutes: 1 },
    { code: "A3", family: "A", qty: 1, unitMinutes: 1 },
  ]);
  assert.deepEqual(visits.map((v) => v.family), ["A", "B", "A"]);
  assert.deepEqual(visits.map((v) => v.codes.length), [2, 1, 1]);
});

test("buildSchedule charges a multi-code family's setup exactly once", () => {
  const ctx = twoFamilyCtx();
  const res = solveBruteForce(ctx); // Start>A(60) + A>B(30)
  const sched = buildSchedule(ctx, res.sequence);
  // setup metric must equal the walk cost, not rows × setup
  assert.ok(Math.abs(sched.setupMinutes - res.setupMinutes) < 1e-6);
  // setup bars live on the first row of each family only
  const withSetup = sched.rows.filter((r) => r.setupSegments.length > 0);
  assert.deepEqual(
    withSetup.map((r) => r.code),
    res.sequence.map((f) => f + "1")
  );
});

test("buildScheduleFromCodeOrder honours a family-mixing hand order", () => {
  const ctx = twoFamilyCtx();
  const mixed = [ctx.codes[0], ctx.codes[2], ctx.codes[1]]; // A1, B1, A2
  const sched = buildScheduleFromCodeOrder(ctx, mixed);
  assert.deepEqual(sched.rows.map((r) => r.code), ["A1", "B1", "A2"]);
  // Start>A(60) + A>B(30) + B>A(90) = 180 changeover minutes
  assert.equal(sched.setupMinutes, 180);
  // three visits -> three setup bars
  assert.equal(sched.rows.filter((r) => r.setupSegments.length > 0).length, 3);
  // the hand order is strictly worse than the optimum (90 min)
  const opt = solveBruteForce(ctx);
  assert.ok(sched.setupMinutes > opt.setupMinutes);
  // and the calendar pays for it: more working time lost to changeovers
  assert.ok(sched.end > buildSchedule(ctx, opt.sequence).end);
});

test("code-order plans split around breaks just like family plans", () => {
  const ctx = {
    setup: { "A>B": 20 },
    initialFamily: null,
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [{ name: "1", start: "06:00", end: "14:00" }],
      breaks: [{ name: "Lunch", start: "12:00", end: "12:30" }],
    },
    codes: [
      { id: "1", code: "A1", family: "A", qty: 19, unitMinutes: 20 },
      { id: "2", code: "B1", family: "B", qty: 2, unitMinutes: 10 },
    ],
    oee: 1,
  };
  const sched = buildScheduleFromCodeOrder(ctx, ctx.codes);
  const rowA = sched.rows[0];
  assert.equal(rowA.runSegments.length, 2); // interrupted by lunch
  const rowB = sched.rows[1];
  // A finishes 12:50 (380 min from 06:00, lunch excluded), B setup 20 -> 13:10
  assert.equal(rowB.setupSegments[0].start.getHours(), 12);
  assert.equal(rowB.setupSegments[0].start.getMinutes(), 50);
});

test("OEE loss is measurable: same plan, slower calendar footprint", () => {
  const codes = [{ id: "1", code: "X1", family: "X", qty: 60, unitMinutes: 10 }];
  const cal = {
    startDate: "2025-01-06",
    shifts: [{ name: "1", start: "06:00", end: "14:00" }],
    breaks: [],
  };
  const perfect = buildSchedule({ setup: {}, initialFamily: null, calendar: cal, codes, oee: 1 }, ["X"]);
  const lossy = buildSchedule({ setup: {}, initialFamily: null, calendar: cal, codes, oee: 0.8 }, ["X"]);
  // working time: 600 min ideal vs 750 min at 80% OEE
  assert.equal(perfect.runMinutes, 600);
  assert.equal(lossy.runMinutes, 750);
  // wall-clock: one 8h shift -> work spills into day two (16h idle in between)
  assert.equal((perfect.end - perfect.start) / 60000, 600 + 16 * 60);
  assert.equal((lossy.end - lossy.start) / 60000, 750 + 16 * 60);
  // exactly 150 min lost to poor performance on this plan
  assert.equal(lossy.runMinutes - perfect.runMinutes, 150);
});

/* ------------------------------------------------- backwards + failures -- */

const twoShiftCtx = () => ({
  setup: { "Start>A": 60, "A>B": 30 },
  initialFamily: "Start",
  calendar: {
    startDate: "2025-01-06",
    startAt: null,
    shifts: [
      { name: "1", start: "06:00", end: "14:00" },
      { name: "2", start: "14:00", end: "22:00" },
    ],
    breaks: [{ name: "Lunch", start: "12:00", end: "12:30" }],
  },
  codes: [
    { id: "1", code: "A1", family: "A", qty: 4, unitMinutes: 10 },
    { id: "2", code: "B1", family: "B", qty: 4, unitMinutes: 10 },
  ],
  oee: 0.8,
});

test("backward planning anchors the finish at the due date", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.direction = "backward";
  ctx.calendar.dueDate = "2025-01-07";
  ctx.calendar.dueAt = "17:00";

  const sched = buildSchedule(ctx, ["A", "B"]);
  assert.equal(sched.end.getHours(), 17);          // finishes exactly at due
  assert.equal(sched.end.getDate(), 7);

  // forward plan of the same sequence has identical working-time blocks,
  // just shifted: same setup + run totals
  const fwd = buildSchedule({ ...ctx, calendar: { ...ctx.calendar, direction: "forward" } }, ["A", "B"]);
  assert.ok(Math.abs(sched.setupMinutes - fwd.setupMinutes) < 1e-6);
  assert.ok(Math.abs(sched.runMinutes - fwd.runMinutes) < 1e-6);
});

test("backward planning keeps the run order and setup placement", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.direction = "backward";
  ctx.calendar.dueDate = "2025-01-07";
  ctx.calendar.dueAt = "17:00";

  const sched = buildSchedule(ctx, ["A", "B"]);
  const rowA = sched.rows[0], rowB = sched.rows[1];
  // A still runs before B, B finishes last (just before due)
  assert.ok(rowA.runSegments[0].start < rowB.runSegments[0].start);
  // B's last segment ends at the anchor
  assert.equal(rowB.runSegments[rowB.runSegments.length - 1].end.getTime(),
    new Date("2025-01-07T17:00:00").getTime());
  // setup bars exist exactly once per visit, on the first row
  assert.deepEqual(
    sched.rows.map((r) => r.setupSegments.length > 0),
    [true, true]
  );
  // every segment sits inside working time (no overlap with the 12:00 lunch)
  for (const row of sched.rows) {
    for (const s of [...row.setupSegments, ...row.runSegments]) {
      const t0 = s.start.getHours() * 60 + s.start.getMinutes();
      const t1 = s.end.getHours() * 60 + s.end.getMinutes();
      const crossesLunch = t0 < 720 && t1 > 720 && s.start.getDate() === s.end.getDate();
      assert.ok(!crossesLunch, "segment crosses lunch break");
    }
  }
});

test("backward planning without dueAt finishes at the shift end", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.direction = "backward";
  ctx.calendar.dueDate = "2025-01-07"; // no dueAt

  const sched = buildSchedule(ctx, ["A", "B"]);
  // due day's last shift ends 22:00 — the plan finishes exactly there
  assert.equal(sched.end.getHours(), 22);
  assert.equal(sched.end.getDate(), 7);
});

test("failure windows pause work like breaks but are one-off", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.failures = [
    { date: "2025-01-06", start: "09:00", end: "11:00" }, // 2h breakdown on Monday
  ];

  const sched = buildSchedule(ctx, ["A", "B"]);
  // nothing may run inside the failure window
  for (const row of sched.rows) {
    for (const s of [...row.setupSegments, ...row.runSegments]) {
      const f0 = new Date("2025-01-06T09:00:00");
      const f1 = new Date("2025-01-06T11:00:00");
      const overlaps = s.start < f1 && s.end > f0;
      assert.ok(!overlaps, `segment overlaps failure window: ${s.start}..${s.end}`);
    }
  }
  // the failure pushes the plan later than without it
  const clean = buildSchedule({ ...ctx, calendar: { ...ctx.calendar, failures: [] } }, ["A", "B"]);
  assert.ok(sched.end > clean.end);
  // the failure window itself is a hole, not work: identical working minutes
  assert.ok(Math.abs(sched.runMinutes - clean.runMinutes) < 1e-6);
});

test("expandWorkIntervals cuts one-off failures from the shift grid", () => {
  const ivs = expandWorkIntervals({
    startDate: "2025-01-06",
    shifts: [{ name: "1", start: "06:00", end: "14:00" }],
    breaks: [],
    failures: [{ date: "2025-01-06", start: "08:00", end: "10:00" }],
  }, 1);
  assert.deepEqual(ivs.map((iv) => [iv.start.getHours(), iv.end.getHours()]), [[6, 8], [10, 14]]);
});

/* ------------------------------------------------------------- holidays -- */

test("holidays are full non-working days", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.holidays = [
    { date: "2025-01-06", name: "Epiphany" },
    { date: "2026-12-25" },               // outside the plan — ignored
  ];

  const sched = buildSchedule(ctx, ["A", "B"]);
  // the whole first day is skipped: work starts on Jan 7
  assert.equal(sched.start.getDate(), 7);
  assert.equal(sched.start.getHours(), 6);
  for (const row of sched.rows) {
    for (const s of [...row.setupSegments, ...row.runSegments]) {
      assert.ok(s.start.getDate() !== 6, "work placed on a holiday");
    }
  }
  // same working minutes as the forward plan without the holiday
  const clean = buildSchedule({ ...ctx, calendar: { ...ctx.calendar, holidays: [] } }, ["A", "B"]);
  assert.ok(Math.abs(sched.runMinutes - clean.runMinutes) < 1e-6);
  assert.ok(Math.abs(sched.setupMinutes - clean.setupMinutes) < 1e-6);
});

test("holidays also work with backwards planning", () => {
  const ctx = twoShiftCtx();
  ctx.calendar.direction = "backward";
  ctx.calendar.dueDate = "2025-01-07";
  ctx.calendar.dueAt = "16:00";
  ctx.calendar.holidays = [{ date: "2025-01-06", name: "Epiphany" }];

  const sched = buildSchedule(ctx, ["A", "B"]);
  // with Jan 6 gone, everything must fit into Jan 7 before 16:00
  assert.equal(sched.end.getDate(), 7);
  assert.equal(sched.end.getHours(), 16);
  for (const row of sched.rows) {
    for (const s of [...row.setupSegments, ...row.runSegments]) {
      assert.ok(s.start.getDate() === 7, "work placed on a holiday");
    }
  }
});
