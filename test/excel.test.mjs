/*
 * excel.test.mjs — parses the real sample workbook and checks the handoff
 * into the solver. Run: node --test test/excel.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Same bootstrap as tools/make-sample.mjs: hide `exports`/`module` so the
// browser bundle returns its own XLSX object.
const src = fs.readFileSync(
  new URL("../vendor/xlsx.full.min.js", import.meta.url), "utf8"
);
const XLSX = new Function("exports", "module", "window", src + "\n;return XLSX;")(
  undefined, undefined, undefined
);
XLSX.set_fs(fs);

const { init, parseWorkbookFromBuffer } = await import("../js/excel.js");
init(XLSX);

const { buildSchedule, solveBruteForce, sequenceSetupMinutes } = await import(
  "../js/solver-bruteforce.js"
);

const buf = new Uint8Array(
  fs.readFileSync(new URL("../sample-data/demo-input.xlsx", import.meta.url))
);

test("sample workbook parses into the expected model", () => {
  const p = parseWorkbookFromBuffer(buf);

  assert.equal(p.families.length, 7);
  assert.equal(p.codes.length, 18);
  assert.equal(p.codes[0].code, "SL-100");
  assert.equal(p.codes[0].unitMinutes, 6);

  // asymmetric matrix entries survived
  assert.equal(p.setup["Sealant>Adhesive"], 25);
  assert.equal(p.setup["Resin>Coating"], 18);

  // start row captured under the reserved key, settings resolved to it
  assert.equal(p.hasStartRow, true);
  assert.equal(p.setup["__start__>Coating"], 40);
  assert.equal(p.settings.initialFamily, "__start__");
  assert.equal(p.settings.oee, 0.8);
  assert.equal(p.settings.startDate, "2025-01-06");

  assert.deepEqual(p.shifts, [
    { name: "Morning", start: 360, end: 840 },
    { name: "Afternoon", start: 840, end: 1320 },
  ]);
  assert.equal(p.breaks.length, 2);
  assert.deepEqual(p.warnings, []);
});

test("parsed workbook drives a complete solve + schedule", () => {
  const p = parseWorkbookFromBuffer(buf);
  const ctx = {
    setup: p.setup,
    initialFamily: p.settings.initialFamily,
    calendar: {
      startDate: p.settings.startDate,
      startAt: null,
      shifts: p.shifts,
      breaks: p.breaks,
      maxDays: 400,
    },
    codes: p.codes.map((c) => ({
      id: c.code, code: c.code, family: c.family, qty: 5, unitMinutes: c.unitMinutes,
    })),
    oee: p.settings.oee,
  };

  const res = solveBruteForce(ctx);
  assert.equal(res.optimum, true);
  assert.equal(res.sequence.length, 7);
  // initial setup from the Start row must be included in the optimum
  assert.ok(res.setupMinutes > 0);

  const sched = buildSchedule(ctx, res.sequence);
  assert.equal(sched.rows.length, 18);
  assert.ok(sched.setupMinutes >= res.setupMinutes - 1e-6);
  assert.ok(sched.runMinutes > 0);
  // first row carries a setup (machine starts in the "Start" state)
  assert.ok(sched.rows.some((r) => r.setupSegments.length > 0));
});

test("percent-form OEE from a text cell is normalised", () => {
  const p = parseWorkbookFromBuffer(buf);
  assert.equal(p.settings.oee, 0.8);
});

test("an exported workbook round-trips order, quantities and settings", () => {
  // simulate "Download workbook": build the book the app writes
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["From \\ To", "A", "B"],
    ["A", 0, 20],
    ["B", 15, 0],
    ["Start", 40, 35],
  ]), "Setup Matrix");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Code", "Family", "Unit time (min)", "Description"],
    ["A1", "A", 10, ""],
    ["B1", "B", 12, ""],
    ["A2", "A", 8, ""],
  ]), "Codes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Shift", "Start", "End"],
    ["Shift 1", "06:00", "14:00"],
  ]), "Shifts");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Break", "Start", "End"],
    ["Break 1", "12:00", "12:30"],
  ]), "Breaks");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Code", "Qty"],
    ["B1", 7],
    ["A2", 3],
    ["A1", 1],
  ]), "Order");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Setting", "Value"],
    ["OEE", 0.65],
    ["Start date", "2025-02-10"],
    ["Initial family", "None"],
  ]), "Settings");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const p = parseWorkbookFromBuffer(new Uint8Array(out));

  // order sheet preserves sequence and quantities
  assert.deepEqual(p.order, [
    { code: "B1", qty: 7 },
    { code: "A2", qty: 3 },
    { code: "A1", qty: 1 },
  ]);
  assert.equal(p.settings.oee, 0.65);
  assert.equal(p.settings.startDate, "2025-02-10");
  // explicit "None" keeps the machine running instead of falling back to Start
  assert.equal(p.settings.initialFamily, "");
  // the Start row is still available as an option
  assert.equal(p.hasStartRow, true);
  assert.equal(p.setup["__start__>B"], 35);
});
