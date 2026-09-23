import { MainStore, ScheduleContext } from "../Types";
import { todayStr } from "../utils/dates";

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

export type Ctx = ScheduleContext;
