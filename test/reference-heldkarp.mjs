/*
 * reference-heldkarp.mjs
 * ---------------------------------------------------------------------------
 * Independent exact solver (Held–Karp dynamic programming, O(n^2 * 2^n)) for
 * the same problem contract as js/solver-bruteforce.js. It exists so tests can
 * verify the brute-force permutation search against a completely different
 * algorithm — and so future heuristics have a second reference to be compared
 * against. Not used by the web app.
 */

import { familyList, setupBetween, idealRunMinutes } from "../js/solver-bruteforce.js";

/**
 * Returns the optimal total setup minutes (number) for the given ctx.
 * Throws for n > 20 (2^20 states) — tests stay far below that.
 */
export function heldKarpOptimum(ctx) {
  const families = familyList(ctx.codes);
  const n = families.length;
  if (n === 0) return 0;
  if (n > 20) throw new Error("Held-Karp reference limited to 20 families");

  const idx = new Map(families.map((f, i) => [f, i]));

  // Machine state before the first family: a real family, a matrix start row
  // (any other name, e.g. "Start"), or nothing. Must match the walk the
  // brute force performs in sequenceSetupMinutes().
  const from0 = ctx.initialFamily != null
    ? (idx.has(ctx.initialFamily) ? families[idx.get(ctx.initialFamily)] : ctx.initialFamily)
    : null;

  // cost[k][mask] = min setup to have visited mask, ending at family k
  const size = 1 << n;
  const cost = Array.from({ length: n }, () => new Float64Array(size).fill(Infinity));

  for (let k = 0; k < n; k++) {
    cost[k][1 << k] = setupBetween(ctx, from0, families[k]);
  }
  for (let mask = 1; mask < size; mask++) {
    for (let k = 0; k < n; k++) {
      const cur = cost[k][mask];
      if (!(mask & (1 << k)) || cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const nm = mask | (1 << j);
        const cand = cur + setupBetween(ctx, families[k], families[j]);
        if (cand < cost[j][nm]) cost[j][nm] = cand;
      }
    }
  }

  const full = size - 1;
  let best = Infinity;
  for (let k = 0; k < n; k++) best = Math.min(best, cost[k][full]);
  return best;
}

/** Convenience: full solution object mirroring the brute-force shape. */
export function heldKarpSolve(ctx) {
  return {
    sequence: null, // DP above returns cost only; the brute force owns order
    setupMinutes: heldKarpOptimum(ctx),
    runMinutes: idealRunMinutes(ctx.codes),
    optimum: true,
    reference: "held-karp",
  };
}
