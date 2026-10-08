import { createMemo } from "solid-js";
import { useMainStore } from "../Context";
import { useSchedule } from "../Schedule";
import { compileCrewFactor } from "../services/solvers/solver-bruteforce";
import { idealRunMinutes } from "../services/solvers/common";
import { fmtDur } from "../utils/dates";

export default function () {
  const { state, setState } = useMainStore();
  const { schedule } = useSchedule();

  const oee = () => state.oee * 100;

  function setOEE(evt: any) {
    setState("oee", Number(evt.currentTarget.value / 100));
  }

  const crewIdealRun = createMemo(() => {
    const crewF = compileCrewFactor(state.crewFactor)(state.crew);
    const idealRun = idealRunMinutes(
      state.selected.map((s) => ({ qty: s.qty, unitMinutes: s.unitMinutes })),
    );
    return idealRun * crewF;
  });

  const lost = createMemo(() => {
    const lost = schedule().runMinutes - crewIdealRun();
    const dur = Math.max(0, lost);

    if (dur === 0) {
      return "—";
    }

    return fmtDur(dur);
  });

  return (
    <section class="panel" data-views="planner">
      <h2>Wydajność (ta sesja)</h2>
      <div class="loss-card">
        <span class="loss-label">Straty przez niską wydajność</span>
        <span id="loss-value" class="loss-value">
          {lost()}
        </span>
        <div class="loss-bars">
          <div class="loss-bar ideal" id="loss-bar-ideal"></div>
          <div
            class="loss-bar actual"
            id="loss-bar-actual"
            style={{
              width: `${Math.min(
                100,
                (schedule().runMinutes / Math.max(crewIdealRun(), 1)) * 50,
              )}%`,
            }}
          ></div>
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
          value={oee()}
          onChange={setOEE}
          aria-label="OEE w procentach"
        />
        <span class="oee-numwrap">
          <input
            id="oee-number"
            type="number"
            min="5"
            max="100"
            value={oee()}
            onChange={setOEE}
          />{" "}
          %
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
          value={state.crew}
          onChange={(evt) => setState("crew", Number(evt.currentTarget.value))}
        />
        <span class="oee-label">Współczynnik f(obsada)</span>
        <input
          id="crew-factor-input"
          type="text"
          value={state.crewFactor}
          title="Mnożnik czasu na sztukę w zależności od liczby osób x — np. 1/x lub 1.2/x + 0.3"
          onChange={(evt) => setState("crewFactor", evt.currentTarget.value)}
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
