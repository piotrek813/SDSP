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



  const size = 1 << rest.length;
  // startCost[j][mask] = min changeover cost of a path that STARTS at
  // rest[j] and visits exactly the families in mask (j included). Built by
  // removing the first hop: startCost[j][mask] =
  //   min over t in mask\{j} of ( m[j][t] + startCost[t][mask \ {j}] ).
  // completion[j][mask] = min changeover cost of a path that starts at
  // rest[j], visits exactly the families in mask (j included) and ends
  // anywhere. Recurrence removes the FIRST hop:
  //   completion[j][mask] = min over t in mask\{j} of ( m[j][t] + completion[t][mask\{t}] )
  const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  const completion = Array.from({ length: rest.length }, () => new Float64Array(size).fill(Infinity));

  for (let k = 0; k < rest.length; k++) completion[k][1 << k] = 0;

  let evaluated = 0;
  const maskOrder = [];
  for (let mask = 1; mask < size; mask++) maskOrder.push(mask);
  maskOrder.sort((a, b) => popcount(a) - popcount(b));
  for (const mask of maskOrder) {
    if (popcount(mask) < 2) continue;
    for (let j = 0; j < rest.length; j++) {
      if (!(mask & (1 << j))) continue;
      let best = Infinity;
      for (let t = 0; t < rest.length; t++) {
        if (t === j || !(mask & (1 << t))) continue;
        const sub = completion[t][mask & ~(1 << j)];
        if (sub === Infinity) continue;
        evaluated++;
        const cand = m[j * rest.length + t] + sub;
        if (cand < best) best = cand;
      }
      completion[j][mask] = best;
    }
  }

  const full = size - 1;

  // Deterministic reconstruction: walk the sequence from the start, at each
  // step choosing the family whose entry cost + exact optimal completion is
  // smallest (ties broken by family name). Exact lookahead makes the greedy
  // walk optimal, and name tie-breaking makes it stable regardless of the
  // order families happen to be enumerated in.
  const sequence = [];
  let remaining = full;
  let cur = -1; // -1 = the machine's starting state
  for (let step = 0; step < rest.length; step++) {
    let pick = -1, pickCost = Infinity;
    for (let j = 0; j < rest.length; j++) {
      if (!(remaining & (1 << j))) continue;
      // first greedy step enters from the machine state (or the pinned family)
      const enter = cur === -1
        ? setupBetween(ctx, pinned || ctx.initialFamily || null, rest[j])
        : m[cur * rest.length + j];
      if (enter === Infinity) continue;
      const total = enter + completion[j][remaining];
      if (total < pickCost - 1e-9 || (Math.abs(total - pickCost) <= 1e-9 && (pick === -1 || rest[j] < rest[pick]))) {
        pick = j; pickCost = total;
      }
    }
    if (pick === -1) throw new Error("Held–Karp reconstruction failed — please report this plan.");
    sequence.push(rest[pick]);
    remaining &= ~(1 << pick);
    cur = pick;
  }
  const fullSequence = pinned ? [pinned, ...sequence] : sequence;
  const setupMinutes = fullSequence.reduce(
    (sum, fam, i) => sum + setupBetween(ctx, i === 0 ? (ctx.initialFamily || null) : fullSequence[i - 1], fam),
    0
  );

  return {
    sequence: fullSequence,
    setupMinutes,
    runMinutes: idealRunMinutes(codes),
    evaluated,
    elapsedMs: Date.now() - t0,
    optimum: true,
  };
}
