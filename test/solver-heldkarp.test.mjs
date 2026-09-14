/*
 * solver-heldkarp.test.mjs — the app's production solver.
 * Verifies the reconstructed sequence (not just the cost) against the
 * brute-force reference on randomized instances, plus pinning and limits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { solveBruteForce, familyList, sequenceSetupMinutes } from "../js/solver-bruteforce.js";
import { solveHeldKarp, HELD_KARP_MAX_FAMILIES } from "../js/solver-heldkarp.js";

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCtx(seed, nFamilies, initialFamily = "F1") {
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
  return { setup, initialFamily, calendar: {}, codes, oee: 0.8 };
}

test("Held–Karp sequence matches the brute-force optimum on 200 instances", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const n = 3 + (seed % 6); // 3..8 families
    const ctx = randomCtx(seed, n);
    const bf = solveBruteForce(ctx);
    const hk = solveHeldKarp(ctx);

    assert.equal(hk.optimum, true);
    assert.equal(hk.setupMinutes, bf.setupMinutes, `seed ${seed}`);
    // the reconstructed sequence must actually walk to the claimed cost
    const walked = sequenceSetupMinutes(ctx, hk.sequence);
    assert.equal(walked, hk.setupMinutes, `seed ${seed}: sequence walk != claimed cost`);
    // and it must visit every family exactly once
    assert.deepEqual([...new Set(hk.sequence)].sort(), familyList(ctx.codes).slice().sort());
  }
});

test("Held–Karp handles the Start-row initial state like the brute force", () => {
  const ctx = randomCtx(5, 5);
  const setup = { ...ctx.setup };
  for (const f of familyList(ctx.codes)) setup[`Start>${f}`] = 30;
  const withStart = { ...ctx, setup, initialFamily: "Start" };
  const bf = solveBruteForce(withStart);
  const hk = solveHeldKarp(withStart);
  assert.equal(hk.setupMinutes, bf.setupMinutes);
  assert.ok(hk.setupMinutes >= 30);
  assert.equal(sequenceSetupMinutes(withStart, hk.sequence), hk.setupMinutes);
});

test("fixedFirst pins the family and the tail stays optimal", () => {
  const ctx = randomCtx(42, 6);
  const free = solveHeldKarp(ctx);
  const pinned = solveHeldKarp(ctx, { fixedFirst: "F4" });

  assert.equal(pinned.sequence[0], "F4");
  assert.ok(pinned.setupMinutes >= free.setupMinutes);

  // the pinned total must equal the walk of the returned sequence
  assert.equal(sequenceSetupMinutes(ctx, pinned.sequence), pinned.setupMinutes);
  // and the tail must be optimal from the pinned state (compare against
  // the free solver re-run with the pinned family as the machine state)
  const tailCtx = { ...ctx, initialFamily: "F4", codes: ctx.codes.filter((c) => c.family !== "F4") };
  const tailBest = solveHeldKarp(tailCtx);
  const walkedTail = sequenceSetupMinutes(
    { setup: ctx.setup, initialFamily: "F4" },
    pinned.sequence.slice(1)
  );
  assert.equal(walkedTail, tailBest.setupMinutes);
});

test("no-initial-state instances agree with the brute force", () => {
  for (const seed of [1, 2, 3, 7, 11]) {
    const ctx = randomCtx(seed, 5, null);
    assert.equal(solveHeldKarp(ctx).setupMinutes, solveBruteForce(ctx).setupMinutes);
  }
});

test("Held–Karp scales past the brute-force limit", () => {
  const ctx = randomCtx(9, 12); // 11! permutations — far out of reach for brute force
  const t0 = Date.now();
  const hk = solveHeldKarp(ctx);
  const ms = Date.now() - t0;
  assert.equal(hk.sequence.length, 12);
  assert.equal(sequenceSetupMinutes(ctx, hk.sequence), hk.setupMinutes);
  assert.ok(ms < 5000, `n=12 took ${ms} ms`);
});

test("Held–Karp refuses sizes beyond its memory-safe cap", () => {
  const ctx = randomCtx(3, HELD_KARP_MAX_FAMILIES + 1);
  assert.throws(() => solveHeldKarp(ctx), /DP states/);
});
