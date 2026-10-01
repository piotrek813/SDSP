import { Show } from "solid-js";
import { useMainStore } from "../Context";
import { normalizeOee } from "../services/solvers/common";

export default function () {
  const { state } = useMainStore();

  return (
    <section class="panel">
      <h2>Skoroszyt</h2>
      <Show when={state.parsed !== null}>
        <div id="data-summary" class="data-summary">
          {state.fileName || "workbook"} - {state.parsed?.families.length}{" "}
          families
          {" · "}
          {state.parsed?.codes.length} codes
          {" · "}
          {state.parsed?.shifts.length} shift
          {state.parsed?.shifts.length === 1 ? "" : "s"}
          {" · "}
          {state.parsed?.breaks.length} break
          {state.parsed?.breaks.length === 1 ? "" : "s"}
          {" · "}
          OEE {Math.round(normalizeOee(state.parsed?.settings.oee ?? 0) * 100)}%
        </div>
      </Show>
    </section>
  );
}
