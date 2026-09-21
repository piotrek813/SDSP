export default function () {
  return (
    <section class="panel output-panel">
      <h2>Wynik</h2>
      <div class="output-layout">
        <div class="output-summary">
          <span class="output-ratio">
            <b id="output-actual">0</b>
            <span class="output-ratio-sep"> / </span>
            <span id="output-expected">90</span>
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
