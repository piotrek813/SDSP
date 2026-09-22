import { For, Show } from "solid-js";
import { useMainStore } from "../Context";
import { produce } from "solid-js/store";

export default function () {
  const { state, setState } = useMainStore();

  function move([i, dir]: [number, -1 | 1]) {
    // TODO fix this
    // TODO add drag n drop
    setState(
      "selected",
      produce((selected) => {
        const [item] = selected.splice(i, 1);
        return selected.splice(i + dir, 0, item);
      }),
    );
  }

  function handleQuantityChange(idx: number, evt: any) {
    setState(
      "selected",
      idx,
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
            class="mode-pill ok"
            title="Status kolejności wykonania"
          >
            optymalna
          </span>
          <button
            id="btn-reoptimise"
            class="btn tiny"
            type="button"
            disabled
            title="Ponownie uruchom optymalizację i zastąp kolejność najlepszą sekwencją"
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
            {(selected, idx) => (
              <li
                classList={{
                  "queue-row": true,
                  changeover:
                    idx() > 0 &&
                    state.selected[idx() - 1].family !== selected.family,
                }}
                draggable="true"
                // title="starts a new WYROBY ZE ZWYKŁĄ FLANGĄ 1 block (0 min changeover)"
              >
                <span class="queue-grip" title="Drag to reorder">
                  ⋮⋮
                </span>
                <button
                  class="icon-btn"
                  title="Move earlier"
                  disabled={idx() === 0}
                  onClick={[move, [idx(), 1]]}
                >
                  ↑
                </button>
                <button
                  class="icon-btn"
                  title="Move later"
                  disabled={idx() === state.selected.length - 1}
                  onClick={[move, [idx(), -1]]}
                >
                  ↓
                </button>
                <input
                  type="number"
                  min="0"
                  step="1"
                  title="Quantity"
                  value={selected.qty}
                  onChange={[handleQuantityChange, idx()]}
                />
                <div class="queue-code-family-wrapper">
                  <span class="queue-name">{selected.code}</span>
                  <span class="queue-family">{selected.family}</span>
                </div>
                <button class="icon-btn subtle" title="Remove">
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
