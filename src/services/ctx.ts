import { TOO_MANY_FAMILIES } from "../errors/solvers";
import { MainStore, Product, ScheduleContext, SolveResult } from "../Types";
import { todayStr } from "../utils/dates";
import { solveHeldKarp } from "./solvers/solver-heldkarp";

export function buildCtx(state: MainStore): Ctx {
  return {
    setup: state.parsed ? state.parsed.setup : {},
    initialFamily: state.initialFamily || null,
    calendar: {
      direction: state.direction,
      startDate: state.startDate || todayStr(),
      startAt: state.startAt || null,
      dueDate:
        state.direction === "backward"
          ? state.dueDate || state.startDate || todayStr()
          : null,
      dueAt: state.direction === "backward" ? state.dueAt || null : null,
      shifts: state.shifts,
      breaks: state.breaks,
      failures: state.failures,
      holidays: state.holidays,
      crew: state.crew,
      crewFactor: state.crewFactor,
      maxDays: 400,
    },
    codes: state.selected.map((s) => ({
      id: s.code,
      code: s.code,
      family: s.family,
      qty: s.qty,
      unitMinutes: s.unitMinutes,
      produced: s.produced,
      name: s.name,
    })),
    oee: state.oee,
  };
}

function optimumCacheKey(state: MainStore, ctx: Ctx) {
  return JSON.stringify({
    setup: ctx.setup,
    initialFamily: ctx.initialFamily,
    fixedFirst: state.fixedFirst || null,
    families: [...new Set(ctx.codes.map((c) => c.family))],
  });
}

export function getOptimum(
  state: MainStore,
  ctx: Ctx,
): [SolveResult, string] | null {
  const key = optimumCacheKey(state, ctx);
  if (state.optCache && state.optCache.key === key)
    return [state.optCache.res, state.optCache.key];
  try {
    const res = solveHeldKarp(ctx, {
      fixedFirst: state.fixedFirst || undefined,
    });

    return [res, key];
  } catch (err) {
    if (!err || err !== TOO_MANY_FAMILIES.code) throw err;
    // stay null: too many families for the DP — plan runs in queue order
  }

  return null;
}

export function queueFromSequence(selected: Product[], sequence: string[]) {
  const out: Product[] = [];
  for (const fam of sequence) {
    for (const c of selected) {
      if (c.family === fam && !out.includes(c)) out.push(c);
    }
  }
  for (const c of selected) if (!out.includes(c)) out.push(c);
  return out;
}

export const sameOrder = (a: Product[], b: Product[]) =>
  a.length === b.length && a.every((c, i) => b[i] === c);

export type Ctx = ScheduleContext;
