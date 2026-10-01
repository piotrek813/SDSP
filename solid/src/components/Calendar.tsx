import { For, Show } from "solid-js";
import { useMainStore } from "../Context";
import { Failure, PlanningDirection } from "../Types";
import {
  hmToMinutes,
  minutesToHMInput,
  plDate,
  todayStr,
} from "../utils/dates";

const filterFailures = (fe: Failure, f: Failure) =>
  f.date !== fe.date &&
  f.start !== fe.start &&
  f.end !== fe.end &&
  f.comment !== fe.comment;

export default function () {
  const { state, setState } = useMainStore();

  return (
    <section class="panel" data-views="planner,production">
      <h2>Kalendarz zmian</h2>
      <label class="field" data-views="planner">
        Kierunek planowania
        <select
          id="direction"
          value={state.direction}
          onChange={(evt) =>
            setState("direction", evt.currentTarget.value as PlanningDirection)
          }
        >
          <option value="forward">W przód — zacznij jak najwcześniej</option>
          <option value="backward">W tył — zakończ na termin</option>
        </select>
      </label>
      <div class="field-row field-anchor-start" data-views="planner">
        <Show
          when={state.direction === "backward"}
          fallback={
            <>
              <label>
                Data startu{" "}
                <input
                  value={plDate.fromISO(state.startDate)}
                  onChange={(evt) => {
                    const iso = plDate.toISO(evt.currentTarget.value);
                    if (iso) setState("startDate", iso);
                  }}
                  id="start-date"
                  type="text"
                  class="date-input"
                  placeholder="dd/mm/rrrr"
                  inputmode="numeric"
                  autocomplete="off"
                />
              </label>
              <label>
                Nie wcześniej niż{" "}
                <input
                  id="start-time"
                  type="time"
                  value={state.startAt}
                  onChange={(evt) => {
                    setState("startAt", evt.currentTarget.value);
                  }}
                />
              </label>
            </>
          }
        >
          <div class="field-row field-anchor-due">
            <label>
              Data terminu{" "}
              <input
                value={plDate.fromISO(state.dueDate)}
                onChange={(evt) => {
                  const iso = plDate.toISO(evt.currentTarget.value);
                  if (iso) setState("dueDate", iso);
                }}
                id="due-date"
                type="text"
                class="date-input"
                placeholder="dd/mm/rrrr"
                inputmode="numeric"
                autocomplete="off"
              />
            </label>
            <label>
              Zakończ do{" "}
              <input
                id="due-time"
                type="time"
                value={state.dueAt}
                onChange={(evt) => {
                  setState("dueAt", evt.currentTarget.value);
                }}
              />
            </label>
          </div>
        </Show>
      </div>
      <div class="field-row field-anchor-due" hidden>
        <label>
          Data terminu{" "}
          <input
            id="due-date"
            type="text"
            class="date-input"
            placeholder="dd/mm/rrrr"
            inputmode="numeric"
            autocomplete="off"
          />
        </label>
        <label>
          Zakończ do <input id="due-time" type="time" />
        </label>
      </div>

      <div class="cal-block">
        <div class="cal-head">
          <span>Zmiany</span>
          <button
            id="btn-add-shift"
            class="btn tiny"
            type="button"
            onClick={() => {
              setState("shifts", state.shifts.length, {
                name: `Shift ${state.shifts.length + 1}`,
                start: 360,
                end: 840,
              });
            }}
          >
            Dodaj
          </button>
        </div>
        <div class="cal-cols">
          <span>Start</span>
          <span>Koniec</span>
        </div>
        <div id="shifts-list" class="cal-rows">
          <For each={state.shifts}>
            {(shift) => (
              <div class="cal-row">
                <input
                  type="time"
                  title="Początek zmiany"
                  value={minutesToHMInput(shift.start)}
                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState(
                      "shifts",
                      (s) => s.name === shift.name,
                      "start",
                      v,
                    );
                  }}
                />
                <input
                  type="time"
                  title="Koniec zmiany"
                  value={minutesToHMInput(shift.end)}
                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState("shifts", (s) => s.name === shift.name, "end", v);
                  }}
                />
                <button
                  class="icon-btn subtle"
                  title="Remove"
                  onClick={() => {
                    setState("shifts", (prev) =>
                      prev.filter((e) => e.name !== shift.name),
                    );
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="cal-block">
        <div class="cal-head">
          <span>Przerwy</span>
          <button
            id="btn-add-break-planner"
            class="btn tiny add-break-btn"
            type="button"
            onClick={() => {
              setState("breaks", state.breaks.length, {
                name: `Break ${state.breaks.length + 1}`,
                start: 720,
                end: 750,
              });
            }}
          >
            Dodaj
          </button>
        </div>
        <div id="breaks-list-planner" class="breaks-container">
          <For each={state.breaks}>
            {(b) => (
              <div class="cal-row">
                <input
                  type="time"
                  title="Początek przerwy"
                  value={minutesToHMInput(b.start)}
                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState("shifts", (s) => s.name === b.name, "start", v);
                  }}
                />
                <input
                  type="time"
                  title="Koniec przerwy"
                  value={minutesToHMInput(b.end)}

                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState("shifts", (s) => s.name === b.name, "end", v);
                  }}
                />
                <button
                  class="icon-btn subtle"
                  title="Remove"
                  onClick={() => {
                    setState("breaks", (prev) =>
                      prev.filter((e) => e.name !== b.name),
                    );
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="cal-block">
        <div class="cal-head">
          <span>Awarie produkcyjne</span>
          <button
            id="btn-add-failure-planner"
            class="btn tiny add-failure-btn"
            type="button"
            onClick={() => {
              setState("failures", state.failures.length, {
                date: state.startDate || todayStr(),
                start: 540, // 09:00
                end: 660, // 11:00 — a plausible 2 h breakdown
                comment: "",
              });
            }}
          >
            Dodaj
          </button>
        </div>
        <div class="cal-cols cal-cols-failure">
          <span>Data</span>
          <span>Start</span>
          <span>Koniec</span>
        </div>
        <div id="failures-list-planner" class="failures-container">
          <For each={state.failures}>
            {(failure) => (
              <div class="cal-row failure">
                <input
                  type="text"
                  class="date-input"
                  placeholder="dd/mm/yyyy"
                  inputmode="numeric"
                  autocomplete="off"
                  title="Data awarii"
                  value={plDate.fromISO(failure.date)}
                  onChange={(evt) => {
                    const iso = plDate.toISO(evt.currentTarget.value);
                    if (iso)
                      setState(
                        "failures",
                        (f) => filterFailures(f, failure),
                        "date",
                        iso,
                      );
                  }}
                />
                <input
                  type="time"
                  title="Początek awarii"
                  value={minutesToHMInput(failure.start)}
                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState(
                      "failures",
                      (e) => filterFailures(e, failure),
                      "start",
                      v,
                    );
                  }}
                />
                <input
                  type="time"
                  title="Koniec awarii"
                  value={minutesToHMInput(failure.end)}
                  onChange={(evt) => {
                    const v = hmToMinutes(evt.currentTarget.value);

                    if (v === null) return;

                    setState(
                      "failures",
                      (e) => filterFailures(e, failure),
                      "end",
                      v,
                    );
                  }}
                />
                <input
                  type="text"
                  class="comment-input"
                  placeholder="co się zepsuło?"
                  title="Komentarz awarii"
                  value={failure.comment}
                  onChange={(evt) => {
                    setState(
                      "failures",
                      (e) => filterFailures(e, failure),
                      "comment",
                      evt.currentTarget.value,
                    );
                  }}
                />
                <button
                  class="icon-btn subtle"
                  title="Remove"
                  onClick={() => {
                    setState(
                      "failures",
                      state.failures.filter((e) => filterFailures(e, failure)),
                    );
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
        <p class="hint">
          Jednorazowy przestój — wstrzymuje produkcję i pokazuje się na czerwono
          na wykresie.
        </p>
      </div>
    </section>
  );
}
