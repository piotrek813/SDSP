import {
  batch,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { useMainStore } from "../Context";
import { produce } from "solid-js/store";
import { fmtDur } from "../utils/dates";
import { useSchedule } from "../Schedule";

export default function () {
  const { state, setState } = useMainStore();
  const { schedule, optimum } = useSchedule();
  const [dragFromIndex, setDragFromIndex] = createSignal<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null);

  const gapMin = createMemo(() => {
    const opt = optimum();

    const gapMin =
      opt !== null ? schedule().setupMinutes - opt.setupMinutes : null;

    return gapMin ?? 0;
  });

  const isScheduleTimeDifferent = () => gapMin() > 1e-6;

  function move([code, dir]: [string, -1 | 1]) {
    batch(() => {
      setState("mode", "manual");

      setState(
        "selected",
        produce((selected) => {
          const idx = selected.findIndex((e) => e.code === code);

          if (idx === -1) return;

          const nextIdx = idx + dir;

          if (nextIdx < 0 || nextIdx >= selected.length) return;

          [selected[idx], selected[nextIdx]] = [
            selected[nextIdx],
            selected[idx],
          ];
        }),
      );
    });
  }

  function handleQuantityChange(code: string, evt: any) {
    setState(
      "selected",
      (e) => e.code === code,
      "qty",
      Math.max(0, Math.round(evt.currentTarget.value || 0)),
    );
  }

  return (
    <section class="panel" data-views="planner">
      <div class="panel-head">
        <h2>Kolejka zleceń</h2>
        <span class="queue-tools">
          <span
            id="queue-pill"
            classList={{
              "mode-pill": true,
              ok: state.mode === "optimal" || !isScheduleTimeDifferent(),
              warn: isScheduleTimeDifferent(),
            }}
            title="Status kolejności wykonania"
          >
            <Switch fallback={"edited · matches optimum"}>
              <Match when={state.mode === "optimal"}>optymalna</Match>

              <Match when={state.mode === "optimal"}>optymalna</Match>

              <Match when={isScheduleTimeDifferent()}>
                edited · +{fmtDur(gapMin())}
              </Match>
            </Switch>
          </span>
          <button
            id="btn-reoptimise"
            class="btn tiny"
            type="button"
            title="Ponownie uruchom optymalizację i zastąp kolejność najlepszą sekwencją"
            disabled={state.mode === "optimal" || !isScheduleTimeDifferent()}
            onClick={() => setState("mode", "optimal")}
          >
            Optymalizuj
          </button>
        </span>
      </div>
      <p class="hint">
        Przeciągnij lub użyj strzałek, aby ustawić kolejność — mieszanie rodzin
        dodaje przezbrojenia. Pomarańczowa krawędź oznacza przezbrojenie.
      </p>
      <Show
        when={state.selected.length}
        fallback={
          <p id="selected-empty" class="hint" hidden>
            Brak zleceń — zaznacz kody powyżej.
          </p>
        }
      >
        <ul id="selected-list" class="queue-list">
          <For each={state.selected}>
            {(selected, idx) => {
              return (
                <li
                  classList={{
                    "queue-row": true,
                    changeover:
                      idx() > 0 &&
                      state.selected[idx() - 1].family !== selected.family,
                    dragging: idx() === dragFromIndex(),
                    "drop-target-top":
                      dragOverIndex() !== null &&
                      dragFromIndex() !== null &&
                      dragOverIndex()! === idx() &&
                      dragFromIndex() !== idx() &&
                      dragFromIndex()! > idx(),
                    "drop-target-bottom":
                      dragOverIndex() !== null &&
                      dragFromIndex() !== null &&
                      dragOverIndex()! === idx() &&
                      dragFromIndex() !== idx() &&
                      dragFromIndex()! < idx(),
                  }}
                  draggable="true"
                  // title="starts a new WYROBY ZE ZWYKŁĄ FLANGĄ 1 block (0 min changeover)"
                  on:dragover={(evt) => {
                    evt.preventDefault();
                    setDragOverIndex(idx());
                  }}
                  on:dragleave={() => {
                    setDragOverIndex(null);
                  }}
                  on:drop={(evt: any) => {
                    evt.preventDefault();

                    evt.preventDefault();
                    const dragFromIndexValue = dragFromIndex();
                    if (
                      dragFromIndexValue === null ||
                      dragFromIndexValue === idx()
                    )
                      return;
                    batch(() => {
                      setState(
                        "selected",
                        produce((selected) => {
                          const from = dragFromIndex();
                          const to = dragOverIndex();

                          if (from === null) return;
                          if (to === null) return;

                          [selected[from], selected[to]] = [
                            selected[to],
                            selected[from],
                          ];
                          return selected;
                        }),
                      );
                      setDragFromIndex(null);
                      setDragOverIndex(null);

                      setState("mode", "manual");
                    });
                  }}
                  on:dragend={() => {
                    setDragFromIndex(null);
                  }}
                  on:dragstart={(evt: any) => {
                    setDragFromIndex(idx());
                    if (evt.dataTransfer) {
                      evt.dataTransfer.effectAllowed = "move";
                      try {
                        evt.dataTransfer.setData("text/plain", String(idx()));
                      } catch {
                        /* older engines */
                      }
                    }
                  }}
                >
                  <span class="queue-grip" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <button
                    class="icon-btn"
                    title="Move earlier"
                    disabled={idx() === 0}
                    onClick={[move, [selected.code, -1]]}
                  >
                    ↑
                  </button>
                  <button
                    class="icon-btn"
                    title="Move later"
                    disabled={idx() === state.selected.length - 1}
                    onClick={[move, [selected.code, 1]]}
                  >
                    ↓
                  </button>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    title="Quantity"
                    value={selected.qty}
                    onChange={[handleQuantityChange, selected.code]}
                  />
                  <div class="queue-code-family-wrapper">
                    <span class="queue-name">{selected.code}</span>
                    <span class="queue-family">{selected.family}</span>
                  </div>
                  <button
                    class="icon-btn subtle"
                    title="Remove"
                    onClick={() => {
                      setState(
                        "selected",
                        state.selected.filter((e) => e.code !== selected.code),
                      );
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
}
