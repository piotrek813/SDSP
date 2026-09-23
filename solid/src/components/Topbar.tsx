import BrandLogo from "../assets/logo.svg";
import { open } from "@tauri-apps/plugin-dialog";
import { open as fsOpen } from "@tauri-apps/plugin-fs";
import { useMainStore } from "../Context";
import { parseWorkbookFromBuffer } from "../services/excel";
import { SetStoreFunction } from "solid-js/store";
import { MainStore } from "../Types";
import { normalizeOee } from "../services/solver-bruteforce";
import { clearBanner } from "./Banner";
import { defaultStartDate } from "../utils/dates";
import { basename } from "../utils/path";
import { onMount } from "solid-js";

function applyParsed(
  setState: SetStoreFunction<MainStore>,
  parsed: any,
  fileName: string,
  isDemo: boolean = false,
) {
  setState(
    (state: MainStore) =>
      ({
        parsed: parsed,
        fileName: fileName,
        fileHandle: isDemo ? null : state.fileHandle,
        isDemo: isDemo,
        catalog: parsed.codes.map((c: any) => ({ ...c, id: c.code })),
        optCache: null,
        oee: normalizeOee(parsed.settings.oee ?? 0.8),
        startDate: defaultStartDate(parsed.settings.startDate),
        startAt: "",
        shifts: (parsed.shifts || []).map((s: any) => ({ ...s })),
        breaks: (parsed.breaks || []).map((s: any) => ({ ...s })),
        failures: (parsed.failures || []).map((s: any) => ({ ...s })),
        holidays: [], // replaced when the holidays file loads
        initialFamily:
          parsed.settings.initialFamily &&
          parsed.settings.initialFamily !== "__start__"
            ? parsed.settings.initialFamily
            : "",
        fixedFirst: "",
        crew: parsed.settings.crew || 1,
        crewFactor: parsed.settings.crewFactor || "1",
        direction:
          parsed.settings.direction === "backward" ? "backward" : "forward",
        dueDate: parsed.settings.dueDate || null,
        dueAt: parsed.settings.dueAt || "",
        mode: parsed.order && parsed.order.length ? "manual" : "optymalna",
        selected: parsed.order
          .map((o: any) => {
            const c = state.catalog.find((k) => k.code === o.code);
            return c
              ? {
                  code: c.code,
                  family: c.family,
                  unitMinutes: c.unitMinutes,
                  name: c.name,
                  qty: o.qty != null && o.qty > 0 ? o.qty : c.defaultQty || 5,
                  produced:
                    o.produced != null && o.produced > 0 ? o.produced : 0,
                }
              : null;
          })
          .filter(Boolean),
      }) satisfies Partial<MainStore>,
  );

  clearBanner();
  // renderCatalog();
  // renderSelected();
  // renderCalendarEditors();
  // renderSolverOptions();
  // syncSessionControls();
  // renderHolidays();
  // // Reload only makes sense for a workbook on disk (the demo is refetched)
  // els["btn-reload"].disabled = !state.file || state.isDemo;
  // els["crew-input"].value = state.crew;
  // els["crew-factor-input"].value = state.crewFactor;
  // recompute();
}

export default function () {
  const { state, setState } = useMainStore();

  onMount(async () => {
    const filePath = "/home/p/Downloads/CS-plan-20260915-1522.xlsx";
    const handle = await fsOpen(filePath, { read: true });

    const stat = await handle.stat();
    const buf = new Uint8Array(stat.size);
    await handle.read(buf);

    const parsed = parseWorkbookFromBuffer(buf);

    applyParsed(setState, parsed, basename(filePath));
    console.log(state);
  });

  async function openWorkbook() {
    const filePath = await open({
      multiple: false,
      directory: false,
      extensions: [".xlsx", ".xlsm"],
    });
    console.log(filePath);

    if (filePath === null) {
      return;
    }

    const handle = await fsOpen(filePath, { read: true });

    const stat = await handle.stat();
    const buf = new Uint8Array(stat.size);
    await handle.read(buf);

    const parsed = parseWorkbookFromBuffer(buf);

    applyParsed(setState, parsed, basename(filePath));
  }

  return (
    <header class="topbar">
      <div class="brand">
        <img src={BrandLogo} alt="Danfoss" class="brand-logo" />
        <span class="brand-sub">Adamiecki — planowanie sekwencji</span>
      </div>
      <div class="topbar-actions">
        <select
          id="view-select"
          class="view-select"
          title="Widok planisty"
          onChange={(evt) => {
            document.body.dataset.view = evt.target.value;
          }}
        >
          <option value="planner">Widok planisty</option>
          <option value="production">Widok produkcji</option>
        </select>
        <span class="divider" aria-hidden="true"></span>
        <button
          onClick={openWorkbook}
          id="btn-file"
          class="btn primary"
          type="button"
        >
          Otwórz skoroszyt…
        </button>
        <input id="file-input" type="file" accept=".xlsx,.xls,.xlsm" hidden />
        <button id="btn-demo" class="btn" type="button">
          Dane demonstracyjne
        </button>
        <button
          id="btn-reload"
          class="btn"
          type="button"
          title="Wczytaj ponownie skoroszyt z dysku — zachowuje kolejkę, ilości i OEE"
          disabled
        >
          Odśwież
        </button>
        <span class="divider" aria-hidden="true"></span>
        <button
          id="btn-export-book"
          class="btn"
          type="button"
          title="Zapisz plan jako skoroszyt (macierz przezbrojeń, kody, kolejność, ustawienia)"
        >
          Pobierz skoroszyt
        </button>
        <button
          id="btn-svg"
          class="btn"
          type="button"
          title="Zapisz wykres jako SVG"
        >
          SVG
        </button>
        <button
          id="btn-png"
          class="btn"
          type="button"
          title="Zapisz wykres jako PNG"
        >
          PNG
        </button>
      </div>
    </header>
  );
}
