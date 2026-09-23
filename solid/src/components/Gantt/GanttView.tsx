import { createMemo, Show } from "solid-js";
import { useMainStore } from "../../Context";
import { expandWorkIntervals } from "../../services/solver-bruteforce";
import { MainStore } from "../../Types";
import { fmtDur, fmtHM, toLocalDateStr } from "../../utils/dates";
import GanttChart from "../Gantt/GanttChart";
import Legend from "./Legend";
import { familyColors } from "../../utils/colors";
import { useSchedule } from "../../Schedule";

function expandHolidayIntervals(state: MainStore, sched: Schedule) {
  if (!sched.start || !sched.end) return [];
  const out = [];
  for (const h of state.holidays) {
    if (!h.date) continue;
    const base = new Date(h.date + "T00:00:00");
    if (isNaN(base.getTime())) continue;
    const s = new Date(base);
    s.setHours(0, 0, 0, 0);
    const e = new Date(base.getTime() + 86400000);
    if (e > sched.start && s < sched.end) out.push({ start: s, end: e });
  }
  return out;
}

function expandBreakIntervals(
  state: MainStore,
  sched: Schedule,
  windowStart: Date | null,
  windowEnd: Date | null,
) {
  if (!sched.start || !sched.end) return [];
  const w0 = windowStart
    ? Math.min(windowStart.getTime(), sched.start.getTime())
    : sched.start.getTime();
  const w1 = windowEnd
    ? Math.max(windowEnd.getTime(), sched.end.getTime())
    : sched.end.getTime();
  const out = [];
  const first = new Date(w0);
  first.setHours(0, 0, 0, 0);
  const days = Math.ceil((w1 - first.getTime()) / 86400000) + 1;
  for (let d = 0; d < Math.min(days, 60); d++) {
    for (const b of state.breaks) {
      const base = new Date(first.getTime() + d * 86400000);
      const s = new Date(base);
      s.setMinutes(b.start, 0, 0);
      const e = new Date(base);
      e.setMinutes(b.end, 0, 0);
      if (b.end <= b.start) e.setDate(e.getDate() + 1);
      if (e.getTime() > w0 && s.getTime() < w1) out.push({ start: s, end: e });
    }
  }
  return out;
}

/** One-off production-failure windows (unclipped — the chart window widens
 *  to include them). */
function expandFailureIntervals(state: MainStore, sched: Schedule) {
  if (!sched.start || !sched.end) return [];
  const out = [];
  for (const f of state.failures) {
    if (!f.date) continue;
    const base = new Date(f.date + "T00:00:00");
    if (isNaN(base.getTime())) continue;
    const s = new Date(base);
    s.setMinutes(f.start, 0, 0);
    const e = new Date(base);
    e.setMinutes(f.end, 0, 0);
    if (f.end <= f.start) e.setDate(e.getDate() + 1);
    out.push({ start: s, end: e });
  }
  return out;
}

function computeOffIntervals(
  state: MainStore,
  sched: Schedule,
  windowStart: Date | null,
  windowEnd: Date | null,
) {
  if (!sched.start || !sched.end) return [];
  const from = sched.start.getTime(),
    to = sched.end.getTime();
  const win0 = windowStart ? Math.min(windowStart.getTime(), from) : from;
  const win1 = windowEnd ? Math.max(windowEnd.getTime(), to) : to;
  // the calendar may reach before the plan (backward plans, failure windows) —
  // anchor the expansion at the chart window itself
  const gridStart = new Date(win0);
  gridStart.setHours(0, 0, 0, 0);
  const days = Math.ceil((win1 - gridStart.getTime()) / 86400000) + 2;
  const cal = {
    startDate: toLocalDateStr(gridStart),
    shifts: state.shifts,
    breaks: [],
    failures: [],
    holidays: state.holidays,
  };
  const work = expandWorkIntervals(cal, Math.min(400, Math.max(days, 3)));
  const off = [];
  let prev = win0;
  for (const iv of work) {
    if (iv.start.getTime() > prev)
      off.push({ start: new Date(prev), end: iv.start });
    prev = Math.max(prev, iv.end.getTime());
  }
  if (prev < win1) off.push({ start: new Date(prev), end: new Date(win1) });
  return off.filter((o) => o.end.getTime() > o.start.getTime());
}

export default function () {
  const { state } = useMainStore();
  const { schedule, idealSchedule } = useSchedule();

  const colors = createMemo(() =>
    familyColors(state.parsed ? state.parsed.families : []),
  );

  const fails = createMemo(() => {
    return expandFailureIntervals(state, schedule());
  });

  const windowStart = createMemo(() => {
    if (fails().length === 0) {
      return null;
    }

    return new Date(Math.min(...fails().map((f) => f.start.getTime())));
  });

  const windowEnd = createMemo(() => {
    if (fails().length === 0) {
      return null;
    }

    return new Date(Math.max(...fails().map((f) => f.end.getTime())));
  });

  const off = createMemo(() => {
    return computeOffIntervals(state, schedule(), windowStart(), windowEnd());
  });

  const breaks = createMemo(() => {
    return expandBreakIntervals(state, schedule(), windowStart(), windowEnd());
  });

  const holidays = createMemo(() => {
    return expandHolidayIntervals(state, schedule());
  });

  const subtitle = createMemo(() => {
    const oeePct = Math.round(state.oee * 100);

    const orderNote =
      state.mode === "manual"
        ? "manual order"
        : state.fixedFirst
          ? `${state.fixedFirst} pinned first`
          : `sequence optimised (Held–Karp${state.direction === "backward" ? ", backward" : ""})`;
    const anchorNote =
      state.direction === "backward"
        ? schedule().end
          ? `due ${schedule().end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtHM(schedule().end)}`
          : null
        : schedule().start
          ? `starts ${schedule().start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtHM(schedule().start)}`
          : null;

    return [
      `OEE ${oeePct}%`,
      `changeover ${fmtDur(schedule().setupMinutes)}`,
      `production ${fmtDur(schedule().runMinutes)}`,
      anchorNote,
      orderNote,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const title = createMemo(() =>
    `Sequence plan — ${state.fileName || ""}`.trim(),
  );

  // function renderGanttView(sched, idealSched) {
  //   const title = `Sequence plan — ${state.fileName || ""}`.trim();
  //   const orderNote =
  //     state.mode === "manual"
  //       ? "manual order"
  //       : state.fixedFirst
  //         ? `${state.fixedFirst} pinned first`
  //         : `sequence optimised (Held–Karp${state.direction === "backward" ? ", backward" : ""})`;
  //   const anchorNote =
  //     state.direction === "backward"
  //       ? sched.end
  //         ? `due ${sched.end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtHM(sched.end)}`
  //         : null
  //       : sched.start
  //         ? `starts ${sched.start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtHM(sched.start)}`
  //         : null;
  //
  //   renderGantt(els["gantt-host"], sched, {
  //     familyColors: colors(),
  //     offIntervals: off(),
  //     breakIntervals:
  //     failIntervals: fails(),
  //     holidayIntervals: expandHolidayIntervals(sched),
  //     windowStart,
  //     windowEnd,
  //     idealSchedule: state.showIdeal ? idealSched : null,
  //     oee: state.oee,
  //     title,
  //     subtitle,
  //   });
  //   renderLegend(colors);
  // }

  return (
    <div class="gantt-card">
      <div id="gantt-host" class="gantt-host"></div>
      <Show
        when={state.selected.length !== 0}
        fallback={
          <div id="gantt-empty" class="gantt-empty">
            <p>Brak planu.</p>
            <p class="hint">
              Otwórz skoroszyt (lub wczytaj dane demo), wybierz kody, a
              najlepsza sekwencja pojawi się tutaj.
            </p>
          </div>
        }
      >
        <GanttChart
          schedule={schedule()}
          familyColors={colors()}
          offIntervals={off()}
          breakIntervals={breaks()}
          holidayIntervals={holidays()}
          failIntervals={fails()}
          idealSchedule={idealSchedule()}
          windowStart={windowStart()}
          windowEnd={windowEnd()}
          title={title()}
          subtitle={subtitle()}
        />
        <Legend />
      </Show>
    </div>
  );
}
