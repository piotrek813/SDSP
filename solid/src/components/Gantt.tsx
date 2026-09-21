export default function () {
  return (
    <div class="gantt-card">
      <div id="gantt-host" class="gantt-host"></div>
      <div id="gantt-empty" class="gantt-empty">
        <p>Brak planu.</p>
        <p class="hint">
          Otwórz skoroszyt (lub wczytaj dane demo), wybierz kody, a najlepsza
          sekwencja pojawi się tutaj.
        </p>
      </div>
      <div id="legend" class="legend" hidden></div>
    </div>
  );
}
