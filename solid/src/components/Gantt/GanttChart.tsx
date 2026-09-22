import { createMemo, createSignal, For, onCleanup } from "solid-js";
import "./Gantt.css";

export default function Gantt(props: GanttProps) {
  const LABEL_W = 180;

  const [now, setNow] = createSignal(Date.now());

  // Move only the marker; don't rebuild the chart.
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const rows = createMemo(() => props.schedule?.rows ?? []);

  const bounds = createMemo(() => {
    const schedule = props.schedule;

    if (!schedule) {
      return { t0: 0, t1: 1 };
    }

    const t0 = props.windowStart
      ? Math.min(props.windowStart.getTime(), schedule.start.getTime())
      : schedule.start.getTime();

    const t1 = Math.max(
      props.windowEnd
        ? Math.max(props.windowEnd.getTime(), schedule.end.getTime())
        : schedule.end.getTime(),
      t0 + 1,
    );

    return { t0, t1 };
  });

  const spanMin = createMemo(() => (bounds().t1 - bounds().t0) / 60000);

  const xPercent = (time: number) => {
    const { t0, t1 } = bounds();
    return ((time - t0) / (t1 - t0)) * 100;
  };

  const colorOf = (family: string) =>
    props.familyColors?.get(family) ?? "#5b7d9e";

  const tickHours = createMemo(() => {
    const steps = [1, 2, 3, 6, 12, 24];
    return steps.find((h) => spanMin() / 60 / h <= 11) ?? 24;
  });

  const days = createMemo(() => {
    const { t0, t1 } = bounds();

    const first = new Date(t0);
    first.setHours(0, 0, 0, 0);

    const result = [];

    for (let tm = first.getTime(); tm <= t1; tm += 86400000) {
      result.push({
        time: tm,
        left: xPercent(tm),
        label: fmtDay(new Date(tm)),
      });
    }

    return result;
  });

  const hours = createMemo(() => {
    const step = tickHours();

    if (step >= 24) return [];

    const { t0, t1 } = bounds();

    const first = new Date(t0);
    first.setMinutes(0, 0, 0);

    const result = [];

    for (let tm = first.getTime(); tm <= t1; tm += step * 3600000) {
      result.push({
        time: tm,
        left: xPercent(tm),
        label: fmtTime(new Date(tm)),
      });
    }

    return result;
  });

  const nowVisible = createMemo(() => {
    const ms = now();
    const { t0, t1 } = bounds();
    return ms >= t0 && ms <= t1;
  });

  const nowLeft = createMemo(() => {
    const { t0, t1 } = bounds();
    const ms = now();

    return Math.min(100, Math.max(0, ((ms - t0) / (t1 - t0)) * 100));
  });

  if (!props.schedule?.rows?.length) {
    return null;
  }

  return (
    <div class="gantt">
      <div class="gantt__header">
        <div class="gantt__title" style={{ "margin-left": `${LABEL_W}px` }}>
          {props.title || "Production schedule"}
        </div>

        {props.subtitle && (
          <div
            class="gantt__subtitle"
            style={{ "margin-left": `${LABEL_W}px` }}
          >
            {props.subtitle}
          </div>
        )}
      </div>

      <div class="gantt__body" style={{ "--label-w": `${LABEL_W}px` }}>
        {/* Time axis */}
        <div class="gantt__axis">
          <div class="gantt__axis-labels">
            {days().map((day) => (
              <div
                class="gantt__day-label"
                style={{
                  left: `${Math.max(day.left, 0)}%`,
                }}
              >
                {day.label}
              </div>
            ))}

            {hours().map((hour) => (
              <div
                class="gantt__hour-label"
                style={{
                  left: `${hour.left}%`,
                }}
              >
                {hour.label}
              </div>
            ))}
          </div>
        </div>

        {/* Plot */}
        <div class="gantt__plot">
          {/* Vertical day grid */}
          <div class="gantt__background">
            {days().map(
              (day, i) =>
                i > 0 && (
                  <div
                    class="gantt__day-line"
                    style={{ left: `${day.left}%` }}
                  />
                ),
            )}

            {hours().map((hour) => (
              <div class="gantt__hour-line" style={{ left: `${hour.left}%` }} />
            ))}

            {/* Non-working intervals */}
            {props.offIntervals?.map((iv) => (
              <IntervalBand
                interval={iv}
                class="gantt__band gantt__band--off"
                xPercent={xPercent}
              />
            ))}

            {/* Holidays */}
            {props.holidayIntervals?.map((iv) => (
              <IntervalBand
                interval={iv}
                class="gantt__band gantt__band--holiday"
                xPercent={xPercent}
              />
            ))}

            {/* Breaks */}
            {props.breakIntervals?.map((iv) => (
              <IntervalBand
                interval={iv}
                class="gantt__band gantt__band--break"
                xPercent={xPercent}
              />
            ))}

            {/* Failures */}
            {props.failIntervals?.map((iv) => (
              <div
                class="gantt__band gantt__band--failure"
                style={intervalStyle(iv, xPercent)}
                title={iv.comment ? `Failure: ${iv.comment}` : undefined}
              />
            ))}
          </div>

          {/* Rows */}
          <div class="gantt__rows">
            <For each={rows()}>
              {(row, rowIndex) => {
                const segments = [...row.setupSegments, ...row.runSegments];

                const firstSeg = segments[0];
                const lastSeg = segments[segments.length - 1];

                const startLabel = firstSeg
                  ? formatRowStart(firstSeg.start, props.schedule.start)
                  : "";

                const xPercentStart = xPercent(firstSeg.start.getTime());
                const showTimeOnLeft = xPercentStart > 4;
                const xPercentValue = showTimeOnLeft
                  ? xPercentStart
                  : xPercent(firstSeg.end.getTime());

                const timeTransform = showTimeOnLeft
                  ? "translate(calc(-100% - 6px), -50%)"
                  : "translate(6px, -50%)";

                return (
                  <div
                    class="gantt__row"
                    class:gantt__row--alternate={rowIndex() % 2 === 1}
                  >
                    {/* Fixed label column */}
                    <div class="gantt__row-label">
                      <div
                        class="gantt__family-chip"
                        style={{
                          background: colorOf(row.family),
                        }}
                      />

                      <div class="gantt__row-text">
                        <div class="gantt__code">
                          {row.code} · {row.qty} pc
                        </div>

                        <div class="gantt__meta">{row.family}</div>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div class="gantt__row-track">
                      {/* Start time */}
                      {firstSeg && (
                        <div
                          class="gantt__start-time"
                          style={{
                            left: `${xPercentValue}%`,
                            transform: timeTransform,
                          }}
                        >
                          {startLabel}
                        </div>
                      )}

                      {/* Ideal schedule */}
                      {props.idealSchedule?.rows?.[rowIndex()] && (
                        <IdealBars
                          row={props.idealSchedule.rows[rowIndex()]}
                          currentWindowStart={bounds().t0}
                          idealScheduleStart={props.idealSchedule.start.getTime()}
                          xPercent={xPercent}
                        />
                      )}

                      {/* Setup */}
                      <For each={row.setupSegments}>
                        {(segment) => (
                          <GanttBar
                            segment={segment}
                            kind="setup"
                            xPercent={xPercent}
                          />
                        )}
                      </For>

                      {/* Run */}
                      <For each={row.runSegments}>
                        {(segment) => (
                          <GanttBar
                            segment={segment}
                            kind="run"
                            color={colorOf(row.family)}
                            xPercent={xPercent}
                          />
                        )}
                      </For>

                      {/* Fallback placement for start label when there's
                        not enough room before the first bar. */}
                      {firstSeg && lastSeg && (
                        <div
                          class="gantt__start-time--fallback"
                          style={{
                            left: `${xPercent(lastSeg.end.getTime())}%`,
                          }}
                        >
                          {startLabel}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Current time */}
          <div
            class="gantt__now"
            class:gantt__now--hidden={!nowVisible()}
            style={{ left: `${nowLeft()}%` }}
          >
            <div class="gantt__now-label">teraz</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bar                                                                         */
/* -------------------------------------------------------------------------- */

type GanttBarProps = {
  segment: Interval;
  kind: string;
  xPercent: XPercentFunction;
  color?: string;
};

function GanttBar(props: GanttBarProps) {
  const duration = () =>
    (props.segment.end.getTime() - props.segment.start.getTime()) / 60000;

  return (
    <div
      class={`gantt__bar gantt__bar--${props.kind}`}
      style={{
        left: `${props.xPercent(props.segment.start.getTime())}%`,
        width: `${Math.max(
          props.xPercent(props.segment.end.getTime()) -
            props.xPercent(props.segment.start.getTime()),
          0.15,
        )}%`,
        ...(props.color ? { background: props.color } : {}),
      }}
      data-kind={props.kind}
    >
      {props.kind === "setup" && duration() > 5.5 && (
        <span class="gantt__bar-label">setup {Math.round(duration())}m</span>
      )}

      {props.kind === "run" && duration() > 5 && (
        <span class="gantt__bar-label">{fmtDur(duration())}</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ideal schedule ghost bars                                                   */
/* -------------------------------------------------------------------------- */

type IdealBarsProps = {
  currentWindowStart: number;
  idealScheduleStart: number;
  segment?: Interval;
  row: ScheduleRow;
  xPercent: XPercentFunction;
};

function IdealBars(props: IdealBarsProps) {
  const shift = props.currentWindowStart - props.idealScheduleStart;

  return (
    <>
      {props.row.runSegments.map((segment) => {
        const start = segment.start.getTime() + shift;
        const end = segment.end.getTime() + shift;

        return (
          <div
            class="gantt__ideal-bar"
            style={{
              left: `${props.xPercent(start)}%`,
              width: `${Math.max(
                props.xPercent(end) - props.xPercent(start),
                0.15,
              )}%`,
            }}
          />
        );
      })}
    </>
  );
}
/* -------------------------------------------------------------------------- */
/* Interval background                                                         */
/* -------------------------------------------------------------------------- */

type IntervalBandProps = {
  class: string;
  interval: Interval;
  xPercent: XPercentFunction;
};

function IntervalBand(props: IntervalBandProps) {
  return (
    <div
      class={props.class}
      style={intervalStyle(props.interval, props.xPercent)}
    />
  );
}

function intervalStyle(interval: Interval, xPercent: (x: number) => number) {
  const left = xPercent(interval.start.getTime());
  const right = xPercent(interval.end.getTime());

  return {
    left: `${left}%`,
    width: `${Math.max(right - left, 0)}%`,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function formatRowStart(date: Date, scheduleStart: Date) {
  const sameDay =
    date.getFullYear() === scheduleStart.getFullYear() &&
    date.getMonth() === scheduleStart.getMonth() &&
    date.getDate() === scheduleStart.getDate();

  if (sameDay) {
    return fmtTime(date);
  }

  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
  })} ${fmtTime(date)}`;
}

function fmtTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDay(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtDur(minutes: number) {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }

  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);

  return m ? `${h}h ${m}m` : `${h}h`;
}
