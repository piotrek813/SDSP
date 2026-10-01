import { Index } from "solid-js";
import { useMainStore } from "../Context";

export default function () {
  const { state, setState } = useMainStore();

  return (
    <section class="panel" data-views="planner">
      <h2>Maszyna &amp; sekwencja</h2>
      <label class="field">
        Maszyna zaczyna od
        <select
          id="initial-family"
          onChange={(evt) => setState("initialFamily", evt.currentTarget.value)}
        >
          <option value="">Brak przezbrojenia (maszyna pracuje)</option>
          <Index each={state.parsed?.families ?? []}>
            {(fam) => <option value={fam()}>{fam()}</option>}
          </Index>
        </select>
      </label>
      <label class="field">
        Priorytet
        <select
          id="fixed-first"
          onChange={(evt) => setState("fixedFirst", evt.currentTarget.value)}
        >
          <option value="">Optymalizacja swobodna</option>
          <Index each={state.parsed?.families ?? []}>
            {(fam) => <option value={fam()}>Zacznij od {fam()}</option>}
          </Index>
        </select>
      </label>
    </section>
  );
}
