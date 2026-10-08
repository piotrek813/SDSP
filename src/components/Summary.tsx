import { useSchedule } from "../Schedule";
import { fmtDur } from "../utils/dates";

export default function () {
  const { schedule } = useSchedule();

  return (
    <div class="results-head">
      <div class="solver-status">
        <span id="solver-note" class="solver-note">
          Otwórz skoroszyt i wybierz kody, aby zaplanować.
        </span>
        <div
          id="seq-chips"
          class="seq-chips"
          aria-label="Zoptymalizowana sekwencja rodzin"
        ></div>
      </div>
      <div class="metrics">
        <div class="metric">
          <span class="metric-label">Zakończenie</span>
          <span id="m-finish" class="metric-value">
            {schedule().rows.length !== 0
              ? schedule().end.toLocaleString("pl-PL", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">Czas trwania</span>
          <span id="m-makespan" class="metric-value">
            {schedule().rows.length !== 0
              ? fmtDur(
                  (schedule().end.getTime() - schedule().start.getTime()) /
                    60000,
                )
              : "—"}
          </span>
        </div>
        <div class="metric setup">
          <span class="metric-label">Przezbrojenia</span>
          <span id="m-setup" class="metric-value">
            {schedule().rows.length !== 0
              ? fmtDur(schedule().setupMinutes)
              : "-"}
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">Produkcja</span>
          <span id="m-run" class="metric-value">
            {schedule().rows.length !== 0 ? fmtDur(schedule().runMinutes) : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
