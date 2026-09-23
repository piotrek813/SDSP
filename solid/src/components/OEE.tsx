import { useMainStore } from "../Context";

export default function () {
  const { state, setState } = useMainStore();

  return (
    <section class="panel" data-views="planner">
      <h2>Wydajność (ta sesja)</h2>
      <div class="loss-card">
        <span class="loss-label">Straty przez niską wydajność</span>
        <span id="loss-value" class="loss-value">
          —
        </span>
        <div class="loss-bars">
          <div class="loss-bar ideal" id="loss-bar-ideal"></div>
          <div class="loss-bar actual" id="loss-bar-actual"></div>
        </div>
        <span id="loss-note" class="hint"></span>
      </div>
      <div class="oee-row">
        <span class="oee-label">OEE</span>
        <input
          id="oee-range"
          type="range"
          min="40"
          max="100"
          step="1"
          value={state.oee}
          onChange={(evt) => {
            setState("oee", Number(evt.currentTarget.value));
          }}
          aria-label="OEE w procentach"
        />
        <span class="oee-numwrap">
          <input id="oee-number" type="number" min="5" max="100" value="80" /> %
        </span>
      </div>
      <div class="oee-row">
        <span class="oee-label">Obsada</span>
        <input
          id="crew-input"
          type="number"
          min="1"
          max="50"
          step="1"
          value="1"
        />
        <span class="oee-label">Współczynnik f(obsada)</span>
        <input
          id="crew-factor-input"
          type="text"
          value="1"
          title="Mnożnik czasu na sztukę w zależności od liczby osób x — np. 1/x lub 1.2/x + 0.3"
        />
      </div>
      <span id="crew-hint" class="hint"></span>
      <label class="check">
        <input id="toggle-ideal" type="checkbox" />
        Pokaż plan przy 100% OEE jako ducha
      </label>
    </section>
  );
}
