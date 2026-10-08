import { createMemo, createSignal, For, Show } from "solid-js";
import { useMainStore } from "../Context";
import { familyColors } from "../utils/colors";
import { Product } from "../Types";

export default function () {
  const { state, setState } = useMainStore();

  const colors = createMemo(() =>
    familyColors(state.parsed ? state.parsed.families : []),
  );
  const [query, setQuery] = createSignal("");

  const catalog = createMemo(() =>
    state.catalog.filter((c) =>
      `${c.code} ${c.family} ${c.name}`.toLowerCase().includes(query()),
    ),
  );

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
    <section class="panel" data-views="planner">
      <h2>Kody</h2>
      <input
        id="catalog-search"
        type="search"
        placeholder="Filtruj po kodzie lub rodzinie…"
        autocomplete="off"
        value={query()}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div id="catalog-list" class="catalog-list" aria-label="Dostępne kody">
        <Show
          when={catalog().length}
          fallback={
            <p class="panel-empty">Otwórz skoroszyt, aby wyświetlić kody.</p>
          }
        >
          <For each={catalog()}>
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
  );
}
