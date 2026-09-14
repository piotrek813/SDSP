/*
 * solver-heldkarp.js
 * ---------------------------------------------------------------------------
 * Exact single-machine sequence-dependent optimisation via Held–Karp dynamic
 * programming (O(n² · 2ⁿ) states instead of n! permutations).
 *
 * Honours the same problem/solution contract as js/solver-bruteforce.js and
 * is what the app now uses: same result quality (it is exact), but 12+ more
 * families fit in interactive time — the benchmark showed ~1,700× less work
 * at 10 families.
 *
 * The setup matrix is flattened to a typed array once, so the hot loop does
 * plain float math with no string-keyed lookups. Reconstruction walks parent
 * pointers, so the full sequence comes back, not just the cost.
 *
 * Practical limit: HELD_KARP_MAX_FAMILIES = 18 — memory for the DP tables
 * grows like n · 2ⁿ (~45 MB at 18). Beyond that the caller should fall back
 * to running the queue as ordered.
 */

import {
  familyList,
  setupBetween,
  idealRunMinutes,
} from "./solver-bruteforce.js";

export const HELD_KARP_MAX_FAMILIES = 18;

/**
 * opts.fixedFirst — pin a family at position 1 (operator priority), exactly
 * like solveBruteForce: the rest is optimised from the pinned state and the
 * changeover into the pinned family is included in the total.
 */
export function solveHeldKarp(ctx, opts = {}) {
  const codes = ctx.codes || [];
  const families = familyList(codes);
  const n = families.length;
  if (n === 0) {
    return { sequence: [], setupMinutes: 0, runMinutes: 0, evaluated: 0, elapsedMs: 0, optimum: true };
  }
  if (n > HELD_KARP_MAX_FAMILIES) {
    const err = new Error(
      `Held–Karp needs 2^${n} DP states (${n} families); the limit is ${HELD_KARP_MAX_FAMILIES}.`
    );
    err.code = "TOO_MANY_FAMILIES";
    throw err;
  }

  const fixedFirst = opts.fixedFirst && families.includes(opts.fixedFirst) ? opts.fixedFirst : null;
  const rest = families.filter((f) => f !== fixedFirst);
  const pinned = fixedFirst || null;

  const t0 = Date.now();

  // flatten the changeover matrix once — keeps the hot loop string-free
  const m = new Float64Array(rest.length * rest.length);
  for (let i = 0; i < rest.length; i++) {
    for (let j = 0; j < rest.length; j++) {
      m[i * rest.length + j] = setupBetween(ctx, rest[i], rest[j]);
    }
  }

  // the state the DP starts from: a pinned family, or the machine's own state
  const fromState = pinned || ctx.initialFamily || null;
  // cost of entering each family from that starting state
  const enterFrom = pinned ? setupBetween(ctx, ctx.initialFamily || null, pinned) : 0;

  const size = 1 << rest.length;
  const cost = Array.from({ length: rest.length }, () => new Float64Array(size).fill(Infinity));
  const parent = Array.from({ length: rest.length }, () => new Int16Array(size).fill(-1));

  for (let k = 0; k < rest.length; k++) {
    cost[k][1 << k] = setupBetween(ctx, fromState, rest[k]);
  }

  let evaluated = 0;
  for (let mask = 1; mask < size; mask++) {
    for (let k = 0; k < rest.length; k++) {
      const cur = cost[k][mask];
      if (cur === Infinity) continue;
      evaluated++;
      const base = k * rest.length;
      for (let j = 0; j < rest.length; j++) {
        if (mask & (1 << j)) continue;
        const nm = mask | (1 << j);
        const cand = cur + m[base + j];
        if (cand < cost[j][nm]) {
          cost[j][nm] = cand;
          parent[j][nm] = k;
        }
      }
    }
  }

  const full = size - 1;
  let endK = -1;
  let best = Infinity;
  for (let k = 0; k < rest.length; k++) {
    if (cost[k][full] < best) { best = cost[k][full]; endK = k; }
  }

  // walk the parent pointers backwards to rebuild the order
  const tail = [];
  let mask = full, k = endK;
  while (k >= 0) {
    tail.push(rest[k]);
    const p = parent[k][mask];
    mask &= ~(1 << k);
    k = p;
  }
  tail.reverse();

  const sequence = pinned ? [pinned, ...tail] : tail;
  const setupMinutes = (pinned ? enterFrom : 0) + best;

  return {
    sequence,
    setupMinutes,
    runMinutes: idealRunMinutes(codes),
    evaluated,
    elapsedMs: Date.now() - t0,
    optimum: true,
  };
}
