import { onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import {
  holidaysGet,
  holidaysLoad,
  type RustHolidays,
} from "../services/holidays";
import { useMainStore } from "../Context";
import { setBanner } from "./Banner";

export default function () {
  const { state, setState } = useMainStore();

  function setHolidays(holidays: RustHolidays) {
    if (holidays.error) {
      setBanner(holidays.error, true);
    }

    setState("holidays", holidays.holidays);
    setState("holidaysPath", holidays.path);
  }

  onMount(async () => {
    setHolidays(await holidaysGet());
  });

  return (
    <section class="panel" data-views="planner">
      <h2>Święta</h2>
      <label class="field">
        Plik świąt (dysk lokalny lub sieciowy)
        <input
          id="holidays-path"
          type="text"
          disabled
          autocomplete="off"
          value={state.holidaysPath}
        />
      </label>
      <div class="field-row">
        <button
          class="btn tiny file-label"
          onClick={async () => {
            const filePath = await open({
              multiple: false,
              directory: false,
              extensions: [".xlsx", ".xlsm"],
            });

            if (filePath === null) {
              return;
            }

            const holidays = await holidaysLoad(filePath);

            setHolidays(holidays);
          }}
        >
          Importuj plik…
        </button>
        <button
          class="btn tiny file-label"
          onClick={async () => {
            const holidays = await holidaysGet();
            setHolidays(holidays);
          }}
        >
          Odśwież
        </button>
      </div>
      <Show when={state.holidaysPath.length === 0}>
        <p id="holidays-status" class="hint">
          Nie wczytano świąt.
        </p>
      </Show>
      <p class="hint">
        Jedna data na wiersz: <em>RRRR-MM-DD;Nazwa</em> — działa też JSON.
        Święta wstrzymują produkcję.
      </p>
    </section>
  );
}
