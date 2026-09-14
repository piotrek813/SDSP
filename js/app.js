/*
 * app.js — UI wiring: file → problem → solve → Gantt.
 * State lives for the browser session; nothing is written back to the file.
 */

import {
  buildSchedule,
  buildScheduleFromCodeOrder,
  visitsFromCodeOrder,
  expandWorkIntervals,
  idealRunMinutes,
  normalizeOee,
  setupBetween,
} from "./solver-bruteforce.js";
import { solveHeldKarp } from "./solver-heldkarp.js";
import * as excelParser from "./excel.js";
import { renderGantt, downloadSVGFile, downloadPNGFile, fmtDur } from "./gantt.js";

excelParser.init(window.XLSX);

/* ------------------------------------------------------------- palette -- */

// muted, print-friendly hues — one per family, assigned in matrix order
// (18 entries to match HELD_KARP_MAX_FAMILIES)
const FAMILY_PALETTE = [
  "#3e6b8c", "#7a9e63", "#b5654a", "#8b7ab0", "#4f9e9b",
  "#c99b3f", "#a2597c", "#7d8a2e", "#b07d3f", "#5d7a94",
  "#6d8a4e", "#9e6b8c", "#4e7d8a", "#a8843e", "#7a5e9e",
  "#4e9e7d", "#9e4e5e", "#8a8a4e",
];

/* ----------------------------------------------------------------- state -- */

const state = {
  fileName: null,
  parsed: null,            // excel.parseWorkbook result
  catalog: [],             // all codes from the file
  selected: [],            // {code, family, qty, unitMinutes, name} — THE run order
  mode: "optimal",         // "optimal" = follow the solver, "manual" = user's order
  oee: 0.8,
  startDate: null,
  startAt: "",             // "" = as soon as the calendar allows
  shifts: [],              // {name, start, end} minutes
  breaks: [],
  initialFamily: "",       // "" = none, "__start__" = matrix start row, else family
  fixedFirst: "",          // "" = free optimisation, else family name
  showIdeal: false,
  result: null,            // last solve { opt, sched, idealSched, gapMin, notOptimizable }
  optCache: null,          // { key, res } — optimum only changes with setup/inputs
};

const $ = (id) => document.getElementById(id);
const els = {};
[
  "file-input", "btn-file", "btn-demo", "btn-svg", "btn-png", "btn-export-book",
  "data-summary", "catalog-search", "catalog-list", "selected-list", "selected-empty",
  "oee-range", "oee-number", "loss-value", "loss-note", "loss-bar-ideal", "loss-bar-actual",
  "start-date", "start-time", "shifts-list", "breaks-list", "btn-add-shift", "btn-add-break",
  "initial-family", "fixed-first", "toggle-ideal",
  "seq-chips", "solver-note", "gantt-host", "gantt-empty", "legend",
  "m-finish", "m-makespan", "m-setup", "m-run",
  "banner", "queue-pill", "btn-reoptimise",
].forEach((id) => { els[id] = $(id); });

/* ----------------------------------------------------------------- utils -- */

const minutesToHMInput = (m) =>
  `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;

const hmToMinutes = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  return m ? (+m[1] * 60 + +m[2]) % 1440 : null;
};

const fmtHM = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function familyColors() {
  const map = new Map();
  (state.parsed ? state.parsed.families : []).forEach((f, i) => {
    map.set(f, FAMILY_PALETTE[i % FAMILY_PALETTE.length]);
  });
  return map;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(fn, ms); };
}

/* ------------------------------------------------------------ file input -- */

els["btn-file"].addEventListener("click", () => els["file-input"].click());
els["file-input"].addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) readWorkbook(file).catch(showLoadError);
});

const dropZone = document.querySelector(".drop-zone");
["dragover", "dragenter"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) readWorkbook(file).catch(showLoadError);
});

async function readWorkbook(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const parsed = excelParser.parseWorkbookFromBuffer(buf);
  applyParsed(parsed, file.name);
}

async function loadDemo() {
  const res = await fetch("sample-data/demo-input.xlsx");
  if (!res.ok) throw new Error(`Demo file not available (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const parsed = excelParser.parseWorkbookFromBuffer(buf);
  applyParsed(parsed, "demo-input.xlsx");
}

els["btn-demo"].addEventListener("click", () => loadDemo().catch(showLoadError));

function showLoadError(err) {
  console.error(err);
  banner(`Could not read that workbook: ${err.message}`, true);
}

function applyParsed(parsed, fileName) {
  state.parsed = parsed;
  state.fileName = fileName;
  state.catalog = parsed.codes.map((c) => ({ ...c, id: c.code }));
  state.mode = "optimal";
  state.optCache = null;
  state.oee = normalizeOee(parsed.settings.oee ?? 0.8);
  state.startDate = parsed.settings.startDate || todayStr();
  state.startAt = "";
  state.shifts = (parsed.shifts || []).map((s) => ({ ...s }));
  state.breaks = (parsed.breaks || []).map((s) => ({ ...s }));
  state.initialFamily = parsed.settings.initialFamily || "";
  state.fixedFirst = "";

  // An Order sheet (from "Download workbook") restores the exact queue —
  // order and quantities — and starts in manual mode so the plan is what
  // was saved. Otherwise start with everything selected.
  if (parsed.order && parsed.order.length) {
    state.mode = "manual";
    state.selected = parsed.order
      .map((o) => {
        const c = state.catalog.find((k) => k.code === o.code);
        return c ? {
          code: c.code, family: c.family, unitMinutes: c.unitMinutes,
          name: c.name, qty: o.qty != null && o.qty > 0 ? o.qty : (c.defaultQty || 5),
        } : null;
      })
      .filter(Boolean);
  } else {
    state.mode = "optimal";
    state.selected = state.catalog.map((c) => ({
      code: c.code,
      family: c.family,
      unitMinutes: c.unitMinutes,
      name: c.name,
      qty: c.defaultQty || 5,
    }));
  }

  hideBanner();
  renderDataSummary();
  renderCatalog();
  renderSelected();
  renderCalendarEditors();
  renderSolverOptions();
  syncSessionControls();
  recompute();
}

/** Reflect session state (OEE etc.) into the live controls. */
function syncSessionControls() {
  const pct = Math.round(state.oee * 100);
  els["oee-range"].value = pct;
  els["oee-number"].value = pct;
  els["start-date"].value = state.startDate || "";
  els["start-time"].value = state.startAt || "";
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* --------------------------------------------------------------- panels -- */

function renderDataSummary() {
  const p = state.parsed;
  if (!p) { els["data-summary"].hidden = true; return; }
  els["data-summary"].hidden = false;
  const bits = [
    `${p.families.length} families`,
    `${p.codes.length} codes`,
    `${p.shifts.length} shift${p.shifts.length === 1 ? "" : "s"}`,
    p.breaks.length ? `${p.breaks.length} break${p.breaks.length === 1 ? "" : "s"}` : "no breaks",
    `OEE ${Math.round(normalizeOee(p.settings.oee) * 100)}%`,
  ];
  els["data-summary"].textContent = `${state.fileName || "workbook"} — ${bits.join(" · ")}`;
}

function renderCatalog() {
  const q = (els["catalog-search"].value || "").trim().toLowerCase();
  const colors = familyColors();
  const list = els["catalog-list"];
  list.textContent = "";
  for (const c of state.catalog) {
    if (q && !(`${c.code} ${c.family} ${c.name}`.toLowerCase().includes(q))) continue;
    const row = document.createElement("label");
    row.className = "catalog-row";
    const checked = state.selected.some((s) => s.code === c.code);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = colors.get(c.family) || "#999";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => {
      if (box.checked) {
        state.selected.push({ code: c.code, family: c.family, unitMinutes: c.unitMinutes, name: c.name, qty: c.defaultQty || 5 });
      } else {
        state.selected = state.selected.filter((s) => s.code !== c.code);
      }
      renderSelected();
      scheduleRecompute();
    });
    const label = document.createElement("span");
    label.className = "catalog-label";
    label.textContent = c.code;
    const fam = document.createElement("span");
    fam.className = "catalog-family";
    fam.textContent = c.family;
    row.append(box, chip, label, fam);
    list.appendChild(row);
  }
  if (!state.catalog.length) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "Load a workbook to list its codes.";
    list.appendChild(empty);
  }
}
els["catalog-search"].addEventListener("input", renderCatalog);

/* --------------------------------------------------------- order (queue) -- */

let dragFromIdx = null;

/** Any user-initiated reorder switches the plan to manual mode. */
function setManual() {
  state.mode = "manual";
  scheduleRecompute();
}

function renderSelected() {
  const list = els["selected-list"];
  list.textContent = "";
  els["selected-empty"].hidden = state.selected.length > 0;

  const setupOf = state.parsed ? state.parsed.setup : {};
  let prevFam = state.initialFamily === "__start__" ? "__start__" : state.initialFamily || null;

  state.selected.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "queue-row";
    li.draggable = true;

    // amber edge + title when this row starts a new family block
    if (s.family !== prevFam) {
      li.classList.add("changeover");
      const cost = setupBetween({ setup: setupOf }, prevFam, s.family);
      li.title = cost
        ? `changeover: +${Math.round(cost)} min into ${s.family}`
        : `starts a new ${s.family} block (0 min changeover)`;
    } else {
      li.title = `runs inside the ${s.family} block`;
    }

    const grip = document.createElement("span");
    grip.className = "queue-grip";
    grip.textContent = "⋮⋮";
    grip.title = "Drag to reorder";

    const up = document.createElement("button");
    up.className = "icon-btn"; up.textContent = "↑"; up.title = "Move earlier";
    up.disabled = i === 0;
    up.addEventListener("click", () => { move(i, -1); });

    const down = document.createElement("button");
    down.className = "icon-btn"; down.textContent = "↓"; down.title = "Move later";
    down.disabled = i === state.selected.length - 1;
    down.addEventListener("click", () => { move(i, +1); });

    const qty = document.createElement("input");
    qty.type = "number"; qty.min = "0"; qty.step = "1"; qty.value = s.qty;
    qty.title = "Quantity";
    qty.addEventListener("change", () => {
      s.qty = Math.max(0, Math.round(+qty.value || 0));
      scheduleRecompute();
    });

    const name = document.createElement("span");
    name.className = "queue-name";
    name.textContent = s.code;

    const fam = document.createElement("span");
    fam.className = "queue-family";
    fam.textContent = s.family;

    const rm = document.createElement("button");
    rm.className = "icon-btn subtle"; rm.textContent = "×"; rm.title = "Remove";
    rm.addEventListener("click", () => {
      state.selected.splice(i, 1);
      renderSelected(); renderCatalog(); scheduleRecompute();
    });

    li.addEventListener("dragstart", (e) => {
      dragFromIdx = i;
      li.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* older engines */ }
      }
    });
    li.addEventListener("dragend", () => {
      dragFromIdx = null;
      li.classList.remove("dragging");
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragFromIdx !== null && dragFromIdx !== i) li.classList.add("drop-target");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drop-target");
      if (dragFromIdx === null || dragFromIdx === i) return;
      const [item] = state.selected.splice(dragFromIdx, 1);
      state.selected.splice(i, 0, item);
      dragFromIdx = null;
      renderSelected();
      setManual();
    });

    li.append(grip, up, down, qty, name, fam, rm);
    list.appendChild(li);
    prevFam = s.family;
  });

  function move(i, dir) {
    const [item] = state.selected.splice(i, 1);
    state.selected.splice(i + dir, 0, item);
    renderSelected();
    setManual();
  }
}

els["btn-reoptimise"].addEventListener("click", () => {
  state.mode = "optimal";
  recompute(); // immediate — no debounce on an explicit click
});

/* --------------------------------------------------------------- calendar -- */

function renderCalendarEditors() {
  els["start-date"].value = state.startDate || "";
  els["start-time"].value = state.startAt || "";

  const mkRow = (item, kind, removable) => {
    const row = document.createElement("div");
    row.className = "cal-row";

    const start = document.createElement("input");
    start.type = "time"; start.value = minutesToHMInput(item.start);
    start.title = kind === "shift" ? "Shift start" : "Break start";
    start.addEventListener("change", () => {
      const v = hmToMinutes(start.value);
      if (v != null) { item.start = v; scheduleRecompute(); }
    });

    const end = document.createElement("input");
    end.type = "time"; end.value = minutesToHMInput(item.end);
    end.title = kind === "shift" ? "Shift end" : "Break end";
    end.addEventListener("change", () => {
      const v = hmToMinutes(end.value);
      if (v != null) { item.end = v; scheduleRecompute(); }
    });

    row.append(start, end);

    if (removable) {
      const rm = document.createElement("button");
      rm.className = "icon-btn subtle"; rm.textContent = "×"; rm.title = "Remove";
      rm.addEventListener("click", () => {
        const arr = kind === "shift" ? state.shifts : state.breaks;
        const idx = arr.indexOf(item);
        if (idx >= 0) arr.splice(idx, 1);
        renderCalendarEditors();
        scheduleRecompute();
      });
      row.appendChild(rm);
    }
    return row;
  };

  const shifts = els["shifts-list"];
  shifts.textContent = "";
  state.shifts.forEach((s) => shifts.appendChild(mkRow(s, "shift", true)));

  const breaks = els["breaks-list"];
  breaks.textContent = "";
  state.breaks.forEach((b) => breaks.appendChild(mkRow(b, "break", true)));
  if (!state.breaks.length) {
    const none = document.createElement("p");
    none.className = "cal-none";
    none.textContent = "No breaks defined.";
    breaks.appendChild(none);
  }
}

els["btn-add-shift"].addEventListener("click", () => {
  state.shifts.push({ name: `Shift ${state.shifts.length + 1}`, start: 360, end: 840 });
  renderCalendarEditors();
  scheduleRecompute();
});
els["btn-add-break"].addEventListener("click", () => {
  state.breaks.push({ name: "Break", start: 720, end: 750 });
  renderCalendarEditors();
  scheduleRecompute();
});
els["start-date"].addEventListener("change", () => {
  state.startDate = els["start-date"].value || todayStr();
  scheduleRecompute();
});
els["start-time"].addEventListener("change", () => {
  state.startAt = els["start-time"].value || "";
  scheduleRecompute();
});

/* ------------------------------------------------------------ OEE + loss -- */

els["oee-range"].addEventListener("input", onOeeChange);
els["oee-number"].addEventListener("change", onOeeChange);

function onOeeChange(evt) {
  // trust the control the user actually touched
  const fromRange = +els["oee-range"].value;
  const fromNum = +els["oee-number"].value;
  let pct;
  if (evt && evt.target === els["oee-range"]) pct = fromRange;
  else if (Number.isFinite(fromNum) && fromNum > 0) pct = fromNum;
  else pct = fromRange;
  pct = Math.min(100, Math.max(5, pct));
  els["oee-range"].value = pct;
  els["oee-number"].value = pct;
  state.oee = pct / 100;
  scheduleRecompute();
}

els["toggle-ideal"].addEventListener("change", () => {
  state.showIdeal = els["toggle-ideal"].checked;
  scheduleRecompute();
});

/* ----------------------------------------------------------- solver opts -- */

function renderSolverOptions() {
  const sel = els["initial-family"];
  sel.textContent = "";
  const optNone = document.createElement("option");
  optNone.value = ""; optNone.textContent = "No setup (machine running)";
  sel.appendChild(optNone);
  if (state.parsed && state.parsed.hasStartRow) {
    const o = document.createElement("option");
    o.value = "__start__"; o.textContent = "“Start” row from matrix";
    sel.appendChild(o);
  }
  for (const f of state.parsed ? state.parsed.families : []) {
    const o = document.createElement("option");
    o.value = f; o.textContent = f;
    sel.appendChild(o);
  }
  sel.value = state.initialFamily || "";

  const first = els["fixed-first"];
  first.textContent = "";
  first.appendChild(new Option("Optimise freely", ""));
  for (const f of state.parsed ? state.parsed.families : []) {
    first.appendChild(new Option(`Start with ${f}`, f));
  }
  first.value = state.fixedFirst || "";
}

els["initial-family"].addEventListener("change", () => {
  state.initialFamily = els["initial-family"].value;
  scheduleRecompute();
});
els["fixed-first"].addEventListener("change", () => {
  state.fixedFirst = els["fixed-first"].value;
  scheduleRecompute();
});

/* ---------------------------------------------------------------- banner -- */

function banner(msg, isError) {
  const b = $("banner");
  b.textContent = msg;
  b.hidden = false;
  b.classList.toggle("error", !!isError);
}
function hideBanner() { $("banner").hidden = true; }

/* -------------------------------------------------------------- pipeline -- */

const scheduleRecompute = debounce(recompute, 140);

function buildCtx() {
  return {
    setup: state.parsed ? state.parsed.setup : {},
    initialFamily: state.initialFamily || null,
    calendar: {
      startDate: state.startDate || todayStr(),
      startAt: state.startAt || null,
      shifts: state.shifts,
      breaks: state.breaks,
      maxDays: 400,
    },
    codes: state.selected.map((s) => ({
      id: s.code, code: s.code, family: s.family, qty: s.qty, unitMinutes: s.unitMinutes,
    })),
    oee: state.oee,
  };
}

/** The optimum only changes with the setup matrix, machine state, the set of
 *  families and the pin — not with OEE or quantities. Cache it so dragging
 *  rows and moving sliders never re-runs a 10! search. */
function optimumCacheKey(ctx) {
  return JSON.stringify({
    setup: ctx.setup,
    initialFamily: ctx.initialFamily,
    fixedFirst: state.fixedFirst || null,
    families: [...new Set(ctx.codes.map((c) => c.family))],
  });
}

function getOptimum(ctx) {
  const key = optimumCacheKey(ctx);
  if (state.optCache && state.optCache.key === key) return state.optCache.res;
  let res = null;
  try {
    res = solveHeldKarp(ctx, { fixedFirst: state.fixedFirst || null });
  } catch (err) {
    if (!err || err.code !== "TOO_MANY_FAMILIES") throw err;
    // stay null: too many families for the DP — plan runs in queue order
  }
  state.optCache = { key, res };
  return res;
}

/** Expand a family sequence into the queue: family blocks in solver order,
 *  codes keeping their current relative order inside each block. */
function queueFromSequence(sequence) {
  const out = [];
  for (const fam of sequence) {
    for (const c of state.selected) {
      if (c.family === fam && !out.includes(c)) out.push(c);
    }
  }
  for (const c of state.selected) if (!out.includes(c)) out.push(c);
  return out;
}

const sameOrder = (a, b) => a.length === b.length && a.every((c, i) => b[i] === c);

function recompute() {
  if (!state.parsed || !state.selected.length) {
    showEmpty("Choose codes from the catalogue to build an order queue.");
    resetMetrics();
    return;
  }
  const ctx = buildCtx();

  let opt;
  try {
    opt = getOptimum(ctx);
  } catch (err) {
    showEmpty(`Calendar problem: ${err.message}`);
    return;
  }

  // Follow the optimiser: in optimal mode the queue mirrors the best sequence.
  // Manual mode never touches the user's order.
  if (state.mode === "optimal" && opt) {
    const wanted = queueFromSequence(opt.sequence);
    if (!sameOrder(state.selected, wanted)) {
      state.selected = wanted;
      renderSelected();
    }
  }

  let sched, idealSched;
  try {
    sched = buildScheduleFromCodeOrder(ctx, state.selected);
    idealSched = buildScheduleFromCodeOrder({ ...ctx, oee: 1 }, state.selected);
  } catch (err) {
    showEmpty(`Calendar problem: ${err.message}`);
    return;
  }

  const gapMin = opt ? sched.setupMinutes - opt.setupMinutes : null;
  state.result = { opt, sched, idealSched, gapMin };

  renderSolveStatus();
  renderQueueStatus();
  renderMetrics(sched, idealSched);
  renderSequence();
  renderGanttView(sched, idealSched);
  hideEmpty();
}

function showEmpty(msg) {
  els["gantt-host"].textContent = "";
  els["gantt-empty"].hidden = false;
  els["gantt-empty"].textContent = msg;
  els.legend.hidden = true;
}

function hideEmpty() {
  els["gantt-empty"].hidden = true;
  els["legend"].hidden = false;
}

/* --------------------------------------------------------------- outputs -- */

function renderSolveStatus() {
  const { opt, sched, gapMin } = state.result || {};
  if (!sched) return;
  let head;
  if (!opt) {
    head = "Not optimised — too many families for exact sequencing; running in queue order.";
  } else if (state.mode === "manual") {
    head = gapMin > 1e-6
      ? `Manual sequence · ${fmtDur(sched.setupMinutes)} changeover — +${fmtDur(gapMin)} more than the optimum (Held–Karp)`
      : `Manual sequence · matches the optimum (${fmtDur(sched.setupMinutes)} changeover)`;
  } else {
    head = `Optimal — Held–Karp DP · ${opt.evaluated.toLocaleString()} states · ${opt.elapsedMs} ms${state.fixedFirst ? ` · ${state.fixedFirst} pinned first` : ""}`;
  }
  $("solver-note").textContent = head;
}

function renderQueueStatus() {
  const { opt, gapMin } = state.result || {};
  const pill = els["queue-pill"];
  const btn = els["btn-reoptimise"];
  if (!pill) return;

  if (!opt) {
    pill.textContent = "too many families";
    pill.className = "mode-pill warn";
    btn.disabled = true;
    return;
  }
  if (state.mode === "optimal") {
    pill.textContent = "optimal";
    pill.className = "mode-pill ok";
    btn.disabled = true;
  } else if (gapMin > 1e-6) {
    pill.textContent = `edited · +${fmtDur(gapMin)}`;
    pill.className = "mode-pill warn";
    btn.disabled = false;
  } else {
    pill.textContent = "edited · matches optimum";
    pill.className = "mode-pill ok";
    btn.disabled = true;   // nothing to gain
  }
}

function resetMetrics() {
  for (const id of ["m-finish", "m-makespan", "m-setup", "m-run"]) $(id).textContent = "—";
  els["loss-value"].textContent = "—";
  els["loss-note"].textContent = "";
}

function renderMetrics(sched, idealSched) {
  $("m-finish").textContent = sched.end
    ? sched.end.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
  $("m-makespan").textContent = sched.start && sched.end ? fmtDur((sched.end - sched.start) / 60000) : "—";
  $("m-setup").textContent = fmtDur(sched.setupMinutes);
  $("m-run").textContent = fmtDur(sched.runMinutes);

  const idealRun = idealRunMinutes(state.selected.map((s) => ({ qty: s.qty, unitMinutes: s.unitMinutes })));
  const lost = sched.runMinutes - idealRun;
  $("loss-value").textContent = fmtDur(Math.max(0, lost));
  const pct = state.oee > 0 ? Math.round((1 / state.oee - 1) * 100) : 0;
  $("loss-note").textContent = state.oee >= 0.999
    ? "No loss — running at 100% OEE."
    : `Production takes ${pct}% longer than it would at 100% OEE.`;
  $("loss-bar-actual").style.width = `${Math.min(100, (sched.runMinutes / Math.max(idealRun, 1)) * 50)}%`;
  $("loss-bar-ideal").style.width = "50%";
}

/** Family chips read from the actual run order — a hand-mixed queue shows
 *  repeated families with the changeover each transition costs. */
function renderSequence() {
  const colors = familyColors();
  const host = $("seq-chips");
  host.textContent = "";
  if (!state.selected.length) return;

  const initial = state.initialFamily === "__start__" ? "__start__" : state.initialFamily || null;
  if (initial) {
    const chip = document.createElement("span");
    chip.className = "seq-chip machine";
    chip.textContent = initial === "__start__" ? "machine start" : `in ${initial}`;
    host.appendChild(chip);
  }

  const setupOf = state.parsed ? state.parsed.setup : {};
  let prev = initial;
  for (const visit of visitsFromCodeOrder(null, state.selected)) {
    if (prev) {
      const setup = setupBetween({ setup: state.parsed ? state.parsed.setup : {} }, prev, visit.family);
      const arrow = document.createElement("span");
      arrow.className = "seq-arrow";
      arrow.textContent = `⟶ ${setup ? Math.round(setup) + "′ setup" : "0′"}`;
      arrow.classList.toggle("costly", setup > 0);
      host.appendChild(arrow);
    }
    const chip = document.createElement("span");
    chip.className = "seq-chip";
    chip.style.setProperty("--chip", colors.get(visit.family) || "#888");
    chip.textContent = visit.family;
    host.appendChild(chip);
    prev = visit.family;
  }
}

function renderGanttView(sched, idealSched) {
  const colors = familyColors();
  const off = computeOffIntervals(sched);

  const title = `Sequence plan — ${state.fileName || ""}`.trim();
  const oeePct = Math.round(state.oee * 100);
  const orderNote = state.mode === "manual"
    ? "manual order"
    : state.fixedFirst ? `${state.fixedFirst} pinned first` : "sequence optimised (brute force)";
  const subtitle = [
    `OEE ${oeePct}%`,
    `changeover ${fmtDur(sched.setupMinutes)}`,
    `production ${fmtDur(sched.runMinutes)}`,
    sched.start ? `starts ${sched.start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${fmtHM(sched.start)}` : null,
    orderNote,
  ].filter(Boolean).join(" · ");

  renderGantt(els["gantt-host"], sched, {
    familyColors: colors,
    offIntervals: off,
    breakIntervals: expandBreakIntervals(sched),
    idealSchedule: state.showIdeal ? idealSched : null,
    oee: state.oee,
    title, subtitle,
  });
  renderLegend(colors);
}

/** Non-working complement of the shift calendar inside the schedule window. */
function computeOffIntervals(sched) {
  if (!sched.start || !sched.end) return [];
  const from = sched.start.getTime(), to = sched.end.getTime();
  const days = Math.ceil((from ? (sched.end - sched.start) / 86400000 : 0) + 2);
  const cal = {
    startDate: state.startDate || todayStr(),
    shifts: state.shifts, breaks: [],
  };
  const work = expandWorkIntervals(cal, Math.min(400, Math.max(days, 3)));
  const off = [];
  let prev = from;
  for (const iv of work) {
    if (iv.start > prev) off.push({ start: new Date(prev), end: iv.start });
    prev = Math.max(prev, iv.end);
  }
  if (prev < to) off.push({ start: new Date(prev), end: new Date(to) });
  return off.filter((o) => o.end.getTime() > o.start.getTime());
}

/** Daily break occurrences across the schedule window (for hatching). */
function expandBreakIntervals(sched) {
  if (!sched.start || !sched.end) return [];
  const out = [];
  const first = new Date(sched.start); first.setHours(0, 0, 0, 0);
  const days = Math.ceil((sched.end - first) / 86400000) + 1;
  for (let d = 0; d < Math.min(days, 60); d++) {
    for (const b of state.breaks) {
      const base = new Date(first.getTime() + d * 86400000);
      const s = new Date(base); s.setMinutes(b.start, 0, 0);
      const e = new Date(base); e.setMinutes(b.end, 0, 0);
      if (b.end <= b.start) e.setDate(e.getDate() + 1);
      if (e > sched.start && s < sched.end) out.push({ start: s, end: e });
    }
  }
  return out;
}

function renderLegend(colors) {
  const host = els.legend;
  host.textContent = "";
  const add = (label, swatchHtml, cls) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = `legend-swatch ${cls || ""}`;
    if (swatchHtml) sw.innerHTML = swatchHtml;
    else sw.style.background = label.color;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(label.text || label));
    host.appendChild(item);
  };
  for (const [fam, color] of colors) {
    if (!state.selected.some((s) => s.family === fam)) continue;
    add({ color, text: fam });
  }
  add({ text: "Changeover", color: "#e07f2a" });
  add({ text: "Break", swatchHtml: '<span class="hatch"></span>' });
  add({ text: "Off shift", color: "#f0ede6" });
  if (state.showIdeal) add({ text: "100% OEE", swatchHtml: '<span class="ghost"></span>' });
}

/* ---------------------------------------------------------------- exports -- */

/** Rebuild a portable workbook from the live session: original setup matrix
 *  and catalogue, the current queue as an Order sheet, and session settings.
 *  Reloading it restores quantities, order and OEE. */
function buildWorkbook() {
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const p = state.parsed;
  const families = p.families;

  // Setup Matrix — original values, session spelling
  const setupAoA = [["From \\ To", ...families]];
  for (const from of [...families, ...(p.hasStartRow ? ["Start"] : [])]) {
    setupAoA.push([
      from,
      ...families.map((to) => (p.setup[`${from}>${to}`] ?? "")),
    ]);
  }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(setupAoA), "Setup Matrix");

  // Codes — the full catalogue
  X.utils.book_append_sheet(
    wb,
    X.utils.aoa_to_sheet([
      ["Code", "Family", "Unit time (min)", "Description"],
      ...state.catalog.map((c) => [c.code, c.family, c.unitMinutes, c.name || ""]),
    ]),
    "Codes"
  );

  // Shifts & breaks (session calendar; names are regenerated on load)
  X.utils.book_append_sheet(
    wb,
    X.utils.aoa_to_sheet([
      ["Shift", "Start", "End"],
      ...state.shifts.map((s, i) => [`Shift ${i + 1}`, minutesToHMInput(s.start), minutesToHMInput(s.end)]),
    ]),
    "Shifts"
  );
  X.utils.book_append_sheet(
    wb,
    X.utils.aoa_to_sheet([
      ["Break", "Start", "End"],
      ...state.breaks.map((b, i) => [`Break ${i + 1}`, minutesToHMInput(b.start), minutesToHMInput(b.end)]),
    ]),
    "Breaks"
  );

  // Order — the queue as it will run, so a manual plan survives a round trip
  X.utils.book_append_sheet(
    wb,
    X.utils.aoa_to_sheet([
      ["Code", "Qty"],
      ...state.selected.map((s) => [s.code, s.qty]),
    ]),
    "Order"
  );

  // Settings — session values
  X.utils.book_append_sheet(
    wb,
    X.utils.aoa_to_sheet([
      ["Setting", "Value"],
      ["OEE", state.oee],
      ["Start date", state.startDate || todayStr()],
      ["Initial family", state.initialFamily === "" ? "None" : state.initialFamily === "__start__" ? "Start" : state.initialFamily],
    ]),
    "Settings"
  );

  return wb;
}

els["btn-export-book"].addEventListener("click", () => {
  if (!state.parsed) { banner("Load a workbook first — there is nothing to download yet.", true); return; }
  const X = window.XLSX;
  const out = X.write(buildWorkbook(), { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `sequence-plan-${stamp()}.xlsx`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

els["btn-svg"].addEventListener("click", () => {
  const svg = els["gantt-host"].querySelector("svg");
  if (svg) downloadSVGFile(svg, `sequence-plan-${stamp()}.svg`);
});

els["btn-png"].addEventListener("click", () => {
  const svg = els["gantt-host"].querySelector("svg");
  if (svg) downloadPNGFile(svg, `sequence-plan-${stamp()}.png`, 2);
});

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ boot -- */

renderCatalog();
renderSelected();
renderCalendarEditors();
renderSolverOptions();
els["start-date"].value = todayStr();
els["oee-range"].value = 80;
els["oee-number"].value = 80;
