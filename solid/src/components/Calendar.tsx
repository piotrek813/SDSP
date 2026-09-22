export default function () {
  return (
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
          Jednorazowy przestój — wstrzymuje produkcję i pokazuje się na czerwono
          na wykresie.
        </p>
      </div>
    </section>
  );
}
