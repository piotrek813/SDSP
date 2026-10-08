import { createMemo, For } from "solid-js";
import { useMainStore } from "../Context";
import { sum } from "../utils/arrays";

export default function () {
  const { state, setState } = useMainStore();
  const expected = createMemo(() => sum(state.selected, "qty"));
  const produced = createMemo(() => sum(state.selected, "produced"));

  return (
    <section class="panel output-panel">
      <h2>Wynik</h2>
      <div class="output-layout">
        <div class="output-summary">
          <span class="output-ratio">
            <b id="output-actual">{produced()}</b>
            <span class="output-ratio-sep"> / </span>
            <span id="output-expected">{expected()}</span>
            <span class="output-unit"> szt</span>
          </span>
          <div class="output-progress">
            <div
              class="output-progress-fill"
              id="output-progress-fill"
              style={{
                width: `${(produced() / expected()) * 100}%`,
              }}
            ></div>
          </div>
          <span class="output-sub" id="output-expected-sub"></span>
        </div>
        <div class="output-breakdown" id="output-breakdown">
          <For each={state.selected}>
            {(selected, idx) => (
              <div class="ob-row">
                <div class="ob-head">
                  <span
                    class="ob-name"
                    title={`${selected.code} - ${selected.family}`}
                  >
                    {selected.code}
                  </span>
                  <input
                    type="number"
                    class="ob-input"
                    min="0"
                    max={selected.qty}
                    step="1"
                    title="Pieces created for this order"
                    value={selected.produced}
                    onChange={(evt) => {
                      console.log(evt);

                      if (evt.currentTarget === null) return;

                      const value =
                        Number(evt.currentTarget.value) > selected.qty
                          ? selected.qty
                          : Number(evt.currentTarget.value);

                      setState("selected", idx(), "produced", value);
                    }}
                  />
                  <span class="ob-qty">/ {selected.qty} szt</span>
                </div>
                <div class="ob-bar">
                  <div
                    class="ob-bar-fill"
                    style={{
                      width: `${(selected.produced / selected.qty) * 100}%`,
                    }}
                  ></div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
