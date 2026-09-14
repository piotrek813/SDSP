#!/usr/bin/env node
/*
 * tools/benchmark.mjs — run every registered solver on identical instances.
 *
 * Participants implement the solver contract from js/solver-bruteforce.js:
 * given ctx (setup, initialFamily, calendar, codes, oee) they return
 * { sequence?, setupMinutes, evaluated?, elapsedMs? }. Exact solvers are
 * verified against the Held–Karp reference; heuristics are scored by their
 * gap to that optimum.
 *
 * Results are printed as tables and written to benchmark-results/
 * (JSON for machines, CSV for spreadsheets) so runs can be compared over time.
 *
 * Usage:
 *   node tools/benchmark.mjs                          # 4..10 families
 *   node tools/benchmark.mjs --min=3 --max=13         # heuristics scale past 10
 *   node tools/benchmark.mjs --instances=5 --reps=3 --seed=7
 *   node tools/benchmark.mjs --budget=5               # s per instance before a
 *                                                     # solver sits larger sizes out
 *
 * Adding a solver = one entry in SOLVERS below. Nothing else.
 */

import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  solveBruteForce,
  familyList,
  sequenceSetupMinutes,
  setupBetween,
} from "../js/solver-bruteforce.js";
import { heldKarpOptimum } from "../test/reference-heldkarp.mjs";

/* --------------------------------------------------------------- options -- */

const flag = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const num = (k, d) => (flag[k] === undefined || flag[k] === true ? d : Number(flag[k]));

const MIN_N = num("min", 4);
const MAX_N = num("max", 10);
const INSTANCES = Math.max(1, num("instances", 3));
const BASE_SEED = num("seed", 20250101);
const STOP_BUDGET_MS = num("budget", 15) * 1000;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "benchmark-results");

/* ----------------------------------------------------------------- models -- */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random asymmetric instance with a machine "Start" row, like the demo file. */
function makeInstance(seed, nFamilies) {
  const rnd = mulberry32(seed);
  const families = Array.from({ length: nFamilies }, (_, i) => `F${i + 1}`);
  const setup = {};
  for (const a of families) {
    for (const b of families) {
      if (a === b) { setup[`${a}>${b}`] = 0; continue; }
      setup[`${a}>${b}`] = rnd() < 0.2 ? 0 : Math.round(rnd() * 45) + 5;
    }
  }
  for (const f of families) setup[`Start>${f}`] = 25 + Math.round(rnd() * 25);

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
    initialFamily: "Start",
    calendar: {
      startDate: "2025-01-06",
      startAt: null,
      shifts: [
        { name: "Morning", start: "06:00", end: "14:00" },
        { name: "Afternoon", start: "14:00", end: "22:00" },
      ],
      breaks: [{ name: "Lunch", start: "11:30", end: "12:00" }],
      maxDays: 400,
    },
    codes,
    oee: 0.8,
  };
}

/** Greedy nearest-neighbour + relocate/2-opt local search (sample heuristic). */
function greedy2optSolve(ctx) {
  const t0 = performance.now();
  let evaluated = 0;
  const cost = (seq) => { evaluated++; return sequenceSetupMinutes(ctx, seq); };

  const remaining = new Set(familyList(ctx.codes));
  const seq = [];
  let prev = ctx.initialFamily || null;
  while (remaining.size) {
    let best = null, bestC = Infinity;
    for (const f of remaining) {
      const c = setupBetween(ctx, prev, f);
      if (c < bestC || (c === bestC && best != null && f < best)) { best = f; bestC = c; }
    }
    seq.push(best);
    remaining.delete(best);
    prev = best;
  }
  let bestCost = cost(seq);

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length; i++) {           // relocate one family
      for (let j = 0; j < seq.length; j++) {
        if (i === j) continue;
        const cand = seq.slice();
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x);
        const c = cost(cand);
        if (c < bestCost - 1e-9) { seq.splice(0, seq.length, ...cand); bestCost = c; improved = true; }
      }
    }
    for (let i = 0; i < seq.length - 1; i++) {       // reverse a segment
      for (let j = i + 1; j < seq.length; j++) {
        const cand = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
        const c = cost(cand);
        if (c < bestCost - 1e-9) { seq.splice(0, seq.length, ...cand); bestCost = c; improved = true; }
      }
    }
  }
  return { sequence: seq, setupMinutes: bestCost, evaluated, elapsedMs: performance.now() - t0, optimum: false };
}

/* -------------------------------------------------------------- registry -- */

const SOLVERS = [
  { name: "brute-force", exact: true, fn: (ctx) => solveBruteForce(ctx) },
  { name: "held-karp", exact: true, fn: (ctx) => ({ setupMinutes: heldKarpOptimum(ctx), optimum: true }) },
  { name: "greedy+2opt", exact: false, fn: greedy2optSolve },
];

/* --------------------------------------------------------------- harness -- */

const rows = [];
const solverState = new Map(SOLVERS.map((s) => [s.name, { stopped: false, stoppedAt: null }]));
const mismatches = [];

const repsFor = (n) => (n <= 6 ? 5 : n <= 8 ? 2 : 1);
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log("Cadence solver benchmark");
console.log(
  `sizes ${MIN_N}..${MAX_N} families · ${INSTANCES} instance(s) per size · ` +
  `seed base ${BASE_SEED} · budget ${Math.round(STOP_BUDGET_MS / 1000)} s per instance\n`
);

for (let n = MIN_N; n <= MAX_N; n++) {
  for (let inst = 0; inst < INSTANCES; inst++) {
    const seed = BASE_SEED + n * 1000 + inst;
    const ctx = makeInstance(seed, n);
    const bestKnown = heldKarpOptimum(ctx); // independent referee for every participant

    for (const solver of SOLVERS) {
      const st = solverState.get(solver.name);
      if (st.stopped) continue;

      const reps = repsFor(n);
      let res, err = null;
      const times = [];
      try {
        for (let r = 0; r < reps; r++) {
          const t0 = performance.now();
          res = solver.fn(ctx);
          times.push(performance.now() - t0);
        }
      } catch (e) {
        err = e;
      }

      if (err || !res || !Number.isFinite(+res.setupMinutes)) {
        const tooMany = err && err.code === "TOO_MANY_FAMILIES";
        rows.push({
          solver: solver.name, n, instance: inst, seed,
          setupMinutes: null, bestKnown, gapPct: null,
          timeMs: null, medianMs: null, evaluated: null,
          optimal: false, exact: solver.exact,
          note: tooMany ? `gave up: ${err.message}` : `error: ${err ? err.message : "no result"}`,
        });
        if (tooMany) { st.stopped = true; st.stoppedAt = n; }
        continue;
      }

      const gapPct = ((res.setupMinutes - bestKnown) / Math.max(bestKnown, 1e-9)) * 100;
      rows.push({
        solver: solver.name, n, instance: inst, seed,
        setupMinutes: res.setupMinutes,
        bestKnown,
        gapPct,
        timeMs: Math.min(...times),
        medianMs: median(times),
        evaluated: res.evaluated ?? null,
        optimal: res.setupMinutes <= bestKnown + 1e-6,
        exact: solver.exact,
        note: null,
      });
      if (solver.exact && gapPct > 1e-6) mismatches.push(rows[rows.length - 1]);

      if (median(times) > STOP_BUDGET_MS) {
        st.stopped = true;
        st.stoppedAt = n;
      }
    }
  }

  // progress line for this size (one number per solver, median across instances)
  const perSolver = [];
  for (const solver of SOLVERS) {
    const list = rows.filter((r) => r.n === n && r.solver === solver.name);
    if (!list.length) continue;
    const med = median(list.map((r) => r.medianMs));
    perSolver.push(`${solver.name} ${med == null ? "gave up" : fmtMs(med)}`);
  }
  console.log(`n=${String(n).padStart(2)}  ${perSolver.join("  ·  ")}`);
}

/* ---------------------------------------------------------------- report -- */

function fmtMs(v) { return v == null ? "    —   " : `${v.toFixed(v < 10 ? 2 : 0).padStart(6)} ms`; }
function fmtGap(v) { return v == null ? "   —  " : `${v.toFixed(1).padStart(5)}%`; }

const bySize = new Map();
for (const r of rows) {
  if (!bySize.has(r.n)) bySize.set(r.n, new Map());
  const m = bySize.get(r.n);
  if (!m.has(r.solver)) m.set(r.solver, []);
  m.get(r.solver).push(r);
}

console.log("\nPer size (median of timed runs)");
console.log("  n  solver                  min       med      avg gap   optimal   evaluated");
for (const n of [...bySize.keys()].sort((a, b) => a - b)) {
  for (const solver of SOLVERS) {
    const list = bySize.get(n).get(solver.name);
    if (!list || !list.length) continue;
    const med = median(list.map((r) => r.medianMs));
    const avgGap = list.reduce((s, r) => s + r.gapPct, 0) / list.length;
    const opt = list.filter((r) => r.optimal).length;
    const evaluated = list.every((r) => r.evaluated == null) ? "—" : list.map((r) => r.evaluated).join("/");
    console.log(
      `${String(n).padStart(3)}  ${solver.name.padEnd(22)}` +
      `${fmtMs(Math.min(...list.map((r) => r.timeMs)))}  ${fmtMs(med)}` +
      `  ${fmtGap(avgGap)}    ${String(opt).padStart(3)}/${list.length}` +
      `  ${String(evaluated).padStart(10)}`
    );
  }
}

console.log("\nTotals across all sizes");
console.log("  solver                  total time    median     avg gap   optimal   verified");
for (const solver of SOLVERS) {
  const list = rows.filter((r) => r.solver === solver.name);
  if (!list.length) { console.log(`  ${solver.name.padEnd(22)}  (no runs)`); continue; }
  const totalMs = list.reduce((s, r) => s + (r.medianMs ?? 0), 0);
  const avgGap = list.reduce((s, r) => s + r.gapPct, 0) / list.length;
  const opt = list.filter((r) => r.optimal).length;
  const verified = solver.exact ? (list.length - mismatches.filter((m) => m.solver === solver.name).length) : null;
  console.log(
    `  ${solver.name.padEnd(22)} ${(totalMs / 1000).toFixed(2).padStart(7)} s  ` +
    `${fmtMs(median(list.map((r) => r.medianMs)))}  ` +
    `${fmtGap(avgGap)}   ${String(opt).padStart(3)}/${String(list.length)}     ` +
    (verified == null ? "n/a (heuristic)" : `${verified}/${list.length} vs held-karp`)
  );
}

/* ---------------------------------------------------------------- export -- */

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = path.join(OUT_DIR, `bench-${ts}`);

  const json = {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      options: { MIN_N, MAX_N, INSTANCES, BASE_SEED, budgetSeconds: STOP_BUDGET_MS / 1000 },
    },
    rows,
  };
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));

  const csv = [
    "solver,n,instance,seed,setupMinutes,bestKnown,gapPct,timeMs,medianMs,evaluated,optimal,exact,note",
    ...rows.map((r) =>
      [r.solver, r.n, r.instance, r.seed, r.setupMinutes, r.bestKnown,
        r.gapPct?.toFixed(3) ?? "", r.timeMs?.toFixed(3) ?? "", r.medianMs?.toFixed(3) ?? "",
        r.evaluated ?? "", r.optimal, r.exact, r.note ?? ""].join(",")
    ),
  ].join("\n");
  writeFileSync(`${base}.csv`, csv);

  console.log(`\nresults: ${base}.json / .csv`);
} catch (e) {
  console.log(`\n(results not written: ${e.message})`);
}

if (mismatches.length) {
  console.error("\nEXACT-SOLVER MISMATCHES (must be zero):");
  for (const m of mismatches) {
    console.error(` - ${m.solver} n=${m.n} instance=${m.instance}: got ${m.setupMinutes}, optimum ${m.bestKnown}`);
  }
  process.exit(1);
}
console.log("all exact solvers verified against the held-karp reference");
