import { createMemo } from "solid-js";
import { useMainStore } from "../Context";
import { sum } from "../utils/arrays";

export default function () {
  const { state } = useMainStore();
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
            <div class="output-progress-fill" id="output-progress-fill"></div>
          </div>
          <span class="output-sub" id="output-expected-sub"></span>
        </div>
        <div class="output-breakdown" id="output-breakdown"></div>
      </div>
    </section>
  );
}
