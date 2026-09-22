export default function () {
  return (
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
  );
}
