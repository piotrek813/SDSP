import { batch, createEffect, createSignal, For, JSX, Show } from "solid-js";
import { useMainStore } from "../Context";
import { normalizeOee } from "../services/solver-bruteforce";
import { familyColors } from "../utils/colors";
import { Product } from "../Types";

export default function () {
  const { state, setState } = useMainStore();

  const [colors, setColors] = createSignal(new Map<string, string>());

  createEffect(() => {
    console.log(state.parsed);
    setColors(familyColors(state.parsed ? state.parsed.families : []));
  });

  function toggleProduct(c: Product, evt: any) {
    if (evt.currentTarget.checked) {
      setState("selected", (selected: any) => [
        ...selected,
        {
          code: c.code,
          family: c.family,
          unitMinutes: c.unitMinutes,
          name: c.name,
          qty: c.defaultQty || 5,
          produced: 0,
        },
      ]);
    } else {
      setState("selected", (selected: any) =>
        selected.filter((s: any) => s.code !== c.code),
      );
    }
  }

  return (
    <aside class="sidebar">
      <section class="panel">
        <h2>Skoroszyt</h2>
        <Show when={state.parsed !== null}>
          <div id="data-summary" class="data-summary">
            {state.fileName || "workbook"} - {state.parsed.families.length}{" "}
            families
            {" · "}
            {state.parsed.codes.length} codes
            {" · "}
            {state.parsed.shifts.length} shift
            {state.parsed.shifts.length === 1 ? "" : "s"}
            {" · "}
            {state.parsed.breaks.length} break
            {state.parsed.breaks.length === 1 ? "" : "s"}
            {" · "}
            OEE {Math.round(normalizeOee(state.parsed.settings.oee) * 100)}%
          </div>
        </Show>
      </section>

      <section class="panel" data-views="planner">
        <h2>Kody</h2>
        <input
          id="catalog-search"
          type="search"
          placeholder="Filtruj po kodzie lub rodzinie…"
          autocomplete="off"
        />
        <div id="catalog-list" class="catalog-list" aria-label="Dostępne kody">
          <Show
            when={state.catalog.length}
            fallback={
              <p class="panel-empty">Otwórz skoroszyt, aby wyświetlić kody.</p>
            }
          >
            <For each={state.catalog}>
              {(product) => (
                <label class="catalog-row">
                  <input
                    type="checkbox"
                    checked={state.selected.some(
                      (e: any) => e.code === product.code,
                    )}
                    onChange={[toggleProduct, product]}
                  />
                  <span
                    class="chip"
                    style={{ background: colors().get(product.family) }}
                  ></span>
                  <span class="catalog-label">{product.code}</span>
                  <span class="catalog-family">{product.family}</span>
                </label>
              )}
            </For>
          </Show>
        </div>
      </section>

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
          Przeciągnij lub użyj strzałek, aby ustawić kolejność — mieszanie
          rodzin dodaje przezbrojenia. Pomarańczowa krawędź oznacza
          przezbrojenie.
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
              {(selected) => (
                <li
                  class="queue-row changeover"
                  draggable="true"
                  title="starts a new WYROBY ZE ZWYKŁĄ FLANGĄ 1 block (0 min changeover)"
                >
                  <span class="queue-grip" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <button class="icon-btn" title="Move earlier" disabled>
                    ↑
                  </button>
                  <button class="icon-btn" title="Move later">
                    ↓
                  </button>
                  <input type="number" min="0" step="1" title="Quantity" />
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

      <section class="panel" data-views="planner,production">
        <h2>Kalendarz zmian</h2>
        <label class="field">
          Kierunek planowania
          <select id="direction">
            <option value="forward">W przód — zacznij jak najwcześniej</option>
            <option value="backward">W tył — zakończ na termin</option>
          </select>
        </label>
        <div class="field-row field-anchor-start">
          <label>
            Data startu{" "}
            <input
              id="start-date"
              type="text"
              class="date-input"
              placeholder="dd/mm/rrrr"
              inputmode="numeric"
              autocomplete="off"
            />
          </label>
          <label>
            Nie wcześniej niż <input id="start-time" type="time" />
          </label>
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
            <button id="btn-add-shift" class="btn tiny" type="button">
              Dodaj
            </button>
          </div>
          <div class="cal-cols">
            <span>Start</span>
            <span>Koniec</span>
          </div>
          <div id="shifts-list" class="cal-rows"></div>
        </div>

        <div class="cal-block">
          <div class="cal-head">
            <span>Przerwy</span>
            <button
              id="btn-add-break-planner"
              class="btn tiny add-break-btn"
              type="button"
            >
              Dodaj
            </button>
          </div>
          <div id="breaks-list-planner" class="breaks-container"></div>
        </div>

        <div class="cal-block">
          <div class="cal-head">
            <span>Awarie produkcyjne</span>
            <button
              id="btn-add-failure-planner"
              class="btn tiny add-failure-btn"
              type="button"
            >
              Dodaj
            </button>
          </div>
          <div class="cal-cols cal-cols-failure">
            <span>Data</span>
            <span>Start</span>
            <span>Koniec</span>
          </div>
          <div id="failures-list-planner" class="failures-container"></div>
          <p class="hint">
            Jednorazowy przestój — wstrzymuje produkcję i pokazuje się na
            czerwono na wykresie.
          </p>
        </div>
      </section>

      <section class="panel" data-views="planner,production">
        <h2>Święta</h2>
        <label class="field">
          Plik świąt (dysk lokalny lub sieciowy)
          <input
            id="holidays-path"
            type="text"
            autocomplete="off"
            placeholder="\\serwer\udzial\swieta.txt  ·  C:\plany\swieta.txt"
          />
        </label>
        <div class="field-row">
          <button id="btn-holidays-load" class="btn tiny" type="button">
            Wczytaj ze ścieżki
          </button>
          <label class="btn tiny file-label">
            Importuj plik…
            <input
              id="holidays-file"
              type="file"
              accept=".txt,.csv,.json"
              hidden
            />
          </label>
        </div>
        <p id="holidays-status" class="hint">
          Nie wczytano świąt.
        </p>
        <ul id="holidays-list" class="holidays-list"></ul>
        <p class="hint">
          Jedna data na wiersz: <em>RRRR-MM-DD;Nazwa</em> — działa też JSON.
          Święta wstrzymują produkcję.
        </p>
      </section>

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
            value="80"
            aria-label="OEE w procentach"
          />
          <span class="oee-numwrap">
            <input id="oee-number" type="number" min="5" max="100" value="80" />{" "}
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

      <section class="panel" data-views="planner">
        <h2>Maszyna &amp; sekwencja</h2>
        <label class="field">
          Maszyna zaczyna od
          <select id="initial-family"></select>
        </label>
        <label class="field">
          Priorytet
          <select id="fixed-first"></select>
        </label>
      </section>
    </aside>
  );
}
