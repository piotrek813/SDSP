/*
 * excel.js — reads the planning workbook into the solver's problem contract.
 *
 * Expected sheets (names are matched loosely, order does not matter):
 *   Setup Matrix | Codes | Shifts | Breaks | Settings   (see README)
 *
 * The parser is deliberately forgiving: it sniffs sheet roles by name and by
 * header keywords, accepts times as "HH:MM" text, Excel time fractions or real
 * dates, and OEE as 0.8, 80 or "80%". Anything it has to guess is reported in
 * `warnings` so the UI can surface it honestly.
 *
 * Call init(XLSX) once with the SheetJS namespace before parsing.
 */

import { parseTimeToMinutes } from "./solver-bruteforce.js";

let lib = null; // the XLSX namespace, injected via init()

export function init(XLSXlib) {
  lib = XLSXlib;
}

/* -------------------------------------------------------------- helpers -- */

function norm(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
}

function isNum(v) {
  if (v == null || v === "") return false;
  if (typeof v === "number") return isFinite(v);
  return /^-?\d+([.,]\d+)?$/.test(String(v).trim());
}

function num(v) {
  return typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return lib.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

function isBlankRow(r) {
  return !r || !r.some((c) => c != null && String(c).trim() !== "");
}

/** Locate a sheet by name pattern first, then by header content. */
function findSheet(wb, nameRe, headerTest) {
  for (const name of wb.SheetNames) {
    if (nameRe.test(norm(name))) return name;
  }
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name).slice(0, 12);
    if (rows.some((r) => headerTest(r || []))) return name;
  }
  return null;
}

/** Index of the first row (within `limit`) whose cells match all/any tests. */
function findHeaderRow(rows, tests, mode = "every") {
  const hit = (r, re) => (r || []).some((c) => c != null && re.test(norm(c)));
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] || [];
    const ok = mode === "every" ? tests.every((t) => hit(r, t)) : tests.some((t) => hit(r, t));
    if (ok) return i;
  }
  return -1;
}

const START_ROW_NAMES = new Set([
  "start", "init", "initial", "setup start", "machine start", "from start", "initial state",
]);

const looksLikeSetupHeader = (r) =>
  (r || []).filter((c) => c != null && String(c).trim() !== "" && !isNum(c)).length >= 3;

/** Excel serial / Date / "YYYY-MM-DD" -> "YYYY-MM-DD" (or null). */
export function parseDateValue(v) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v)) return toDateStr(v);
  if (typeof v === "number" && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000)); // Excel epoch (UTC)
    return toDateStr(new Date(d.getTime() + d.getTimezoneOffset() * 60000));
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d) ? null : toDateStr(d);
}

function toDateStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* -------------------------------------------------------------- parsing -- */

export function parseWorkbook(wb) {
  if (!lib) throw new Error("excel.init() was not called");

  const warnings = [];
  const result = {
    codes: [],        // {code, family, unitMinutes, name, defaultQty}
    setup: {},        // "A>B" -> minutes (canonical family spelling)
    families: [],     // all families, matrix order first
    hasStartRow: false,
    settings: { oee: 0.8, startDate: null, initialFamily: null },
    shifts: [],       // {name, start, end} as minutes since midnight
    breaks: [],
    order: [],        // optional [{code, qty}] from an "Order" sheet
    failures: [],     // optional one-off [{date, start, end}] from a "Failures" sheet
    warnings,
    sheetNames: wb.SheetNames.slice(),
  };

  parseSetup(wb, result, warnings);
  parseCodes(wb, result, warnings);
  parseTimesSheets(wb, result, warnings);
  parseSettings(wb, result, warnings);
  parseOrderSheet(wb, result, warnings);
  validate(result, warnings);

  return result;
}

/* --- setup matrix --------------------------------------------------------- */

function parseSetup(wb, result, warnings) {
  const sheet = findSheet(wb, /setup|changeover|matrix/i, looksLikeSetupHeader);
  if (!sheet) {
    throw new Error(
      'No setup matrix found. Add a sheet named "Setup Matrix": family names across the header row and down the first column, changeover minutes in the cells.'
    );
  }
  const rows = sheetRows(wb, sheet).filter((r) => !isBlankRow(r));
  if (!rows.length) throw new Error("The setup matrix sheet is empty.");

  // header row = first row with >= 2 non-numeric cells
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].filter((c) => c != null && !isNum(c)).length >= 2) { headerIdx = i; break; }
  }
  const header = rows[headerIdx];
  // tolerate a label cell in the corner ("From \ To")
  const destStart = isNum(header[1]) || header[1] == null || String(header[1]).trim() === "" ? 0 : 1;
  const destFamilies = header
    .slice(destStart)
    .map((c) => (c == null ? null : String(c).trim()))
    .filter((c) => c && c !== "");

  if (destFamilies.length < 2) {
    throw new Error(
      `The setup matrix needs at least two family columns (found ${destFamilies.length}) on sheet "${sheet}".`
    );
  }

  const familySet = new Set(destFamilies.map(norm));
  const setup = {};
  let hasStartRow = false;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const from = row[0] == null ? "" : String(row[0]).trim();
    if (!from) continue;

    if (START_ROW_NAMES.has(norm(from))) {
      hasStartRow = true;
      destFamilies.forEach((to, j) => {
        const v = row[destStart + j];
        if (isNum(v)) setup[`__start__>${to}`] = num(v);
      });
      continue;
    }
    if (!familySet.has(norm(from))) continue; // stray row — ignore

    destFamilies.forEach((to, j) => {
      const v = row[destStart + j];
      if (isNum(v)) setup[`${from}>${to}`] = num(v);
    });
  }

  result.setup = setup;
  result.hasStartRow = hasStartRow;
  result.families = destFamilies.slice();
}

/* --- codes ---------------------------------------------------------------- */

function parseCodes(wb, result, warnings) {
  const sheet = findSheet(
    wb,
    /code|product|sku|order|item/i,
    (r) =>
      (r || []).some((c) => /code|sku|product|item|part/i.test(norm(c))) &&
      (r || []).some((c) => /famil/i.test(norm(c)))
  );
  if (!sheet) {
    throw new Error(
      'No codes list found. Add a sheet named "Codes" with the columns: Code, Family, Unit time (min).'
    );
  }
  const rows = sheetRows(wb, sheet);
  const headerIdx = findHeaderRow(rows, [/code|sku|product|item|part/i, /famil/i]);
  if (headerIdx < 0) {
    throw new Error(`On sheet "${sheet}": could not find a header row with "Code" and "Family" columns.`);
  }
  const head = rows[headerIdx];
  const colOf = (tests) =>
    head.findIndex((c) => c != null && tests.some((re) => re.test(norm(c))));

  const codeCol = colOf([/^code$/, /^code/, /sku/, /product/, /item/, /part/]);
  const famCol = colOf([/family/, /^fam\b/, /group/]);
  const timeCol = colOf([/unit.*time/, /cycle.*time/, /time.*per.*unit/, /time ?\(?,?min/, /^time/, /^minutes?/, /^min$/]);
  const nameCol = colOf([/description/, /^name$/, /title/]);
  const qtyCol = colOf([/^qty/, /quantity/, /amount/]);

  if (codeCol < 0 || famCol < 0 || timeCol < 0) {
    throw new Error(
      `On sheet "${sheet}": expected columns like "Code", "Family" and "Unit time (min)".`
    );
  }

  const codes = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const code = row[codeCol];
    const family = row[famCol];
    const t = row[timeCol];
    if (code == null || family == null || !isNum(t)) continue;
    const qty = qtyCol >= 0 && isNum(row[qtyCol]) ? num(row[qtyCol]) : null;
    codes.push({
      code: String(code).trim(),
      family: String(family).trim(),
      unitMinutes: num(t),
      name: nameCol >= 0 && row[nameCol] != null ? String(row[nameCol]).trim() : "",
      defaultQty: qty && qty > 0 ? qty : null,
    });
  }
  if (!codes.length) {
    throw new Error(`No usable rows on sheet "${sheet}" — each row needs a code, a family and a unit time.`);
  }
  result.codes = codes;

  // families that appear only in the codes sheet still get a color/row
  const known = new Set(result.families.map(norm));
  for (const c of codes) {
    if (!known.has(norm(c.family))) { known.add(norm(c.family)); result.families.push(c.family); }
  }

  // canonicalise matrix keys to the codes' family spelling (case variants etc.)
  const canon = (name) => result.families.find((f) => norm(f) === norm(name)) || name;
  const fixed = {};
  for (const key of Object.keys(result.setup)) {
    const [a, b] = key.split(">");
    fixed[`${canon(a)}>${canon(b)}`] = result.setup[key];
  }
  result.setup = fixed;
}

/* --- shifts & breaks ------------------------------------------------------ */

function parseTimesSheets(wb, result, warnings) {
  result.shifts = readTimesSheet(wb, /shift|working time|calendar/i, "Shift");
  result.breaks = readTimesSheet(wb, /break|pause|lunch|rest/i, "Break");

  if (!result.shifts.length) {
    warnings.push('No "Shifts" sheet found — assuming one shift, 06:00–14:00.');
    result.shifts = [{ name: "Shift 1", start: 360, end: 840 }];
  }

  parseFailuresSheet(wb, result, warnings);
}

/**
 * Optional "Failures" sheet (Date, Start, End) — one-off unplanned downtime.
 * Dates accept "YYYY-MM-DD" or Excel date values; times as usual.
 */
function parseFailuresSheet(wb, result, warnings) {
  const headerTest = (r) =>
    (r || []).some((c) => /date|day/i.test(norm(c))) &&
    (r || []).some((c) => /start|from|begin/i.test(norm(c))) &&
    (r || []).some((c) => /end|to\b|bis|finish/i.test(norm(c)));
  const sheet = findSheet(wb, /failure|fail|down|unplanned/i, headerTest);
  if (!sheet) return;

  const rows = sheetRows(wb, sheet);
  const headerIdx = findHeaderRow(rows, [/date|day/i, /start|from|begin/i, /end|to\b|finish/i]);
  if (headerIdx < 0) return;

  const head = rows[headerIdx];
  const dateCol = head.findIndex((c) => /date|day/i.test(norm(c)));
  const sCol = head.findIndex((c) => /start|from|begin/i.test(norm(c)));
  const eCol = head.findIndex((c) => /end|to\b|bis|finish/i.test(norm(c)));

  const failures = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = parseDateValue(row[dateCol]);
    const s = parseTimeToMinutes(row[sCol]);
    const e = parseTimeToMinutes(row[eCol]);
    if (!date || s == null || e == null) continue;
    failures.push({ date, start: s, end: e });
  }
  result.failures = failures;
}

function readTimesSheet(wb, nameRe, fallbackName) {
  const headerTest = (r) =>
    (r || []).some((c) => /start|from|begin|von/i.test(norm(c))) &&
    (r || []).some((c) => /end|to\b|bis|finish/i.test(norm(c)));
  const sheet = findSheet(wb, nameRe, headerTest);
  if (!sheet) return [];
  const rows = sheetRows(wb, sheet);
  const headerIdx = findHeaderRow(rows, [/start|from|begin|von/i, /end|to\b|bis|finish/i], "some");
  if (headerIdx < 0) return [];
  const head = rows[headerIdx];
  const nameCol = head.findIndex(
    (c) => c != null && String(c).trim() !== "" && !isNum(c) && !/start|end|from|to\b|bis|von|begin|finish/i.test(norm(c))
  );
  const sCol = head.findIndex((c) => /start|from|begin|von/i.test(norm(c)));
  const eCol = head.findIndex((c) => /end|to\b|bis|finish/i.test(norm(c)));

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const s = parseTimeToMinutes(row[sCol] ?? row[0]);
    const e = parseTimeToMinutes(eCol >= 0 ? row[eCol] : row[1]);
    if (s == null || e == null) continue;
    const label = nameCol >= 0 && row[nameCol] != null ? String(row[nameCol]).trim() : "";
    out.push({ name: label || fallbackName, start: s, end: e });
  }
  return out;
}

/* --- settings ------------------------------------------------------------- */

function parseSettings(wb, result, warnings) {
  const headerTest = (r) =>
    (r || []).some((c) => /setting|parameter|key/i.test(norm(c)));
  const sheet = findSheet(wb, /setting|config|param|global/i, headerTest);
  if (!sheet) {
    warnings.push('No "Settings" sheet found — using OEE 80% and today as the start date.');
    return;
  }
  const rows = sheetRows(wb, sheet).filter((r) => !isBlankRow(r));
  for (const row of rows) {
    if (row.length < 2) continue;
    const k = norm(row[0]);
    const v = row[1];
    if (v == null || String(v).trim() === "") continue;

    if (/(^|\s)oee|efficiency|performance/.test(k)) {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", "").replace(",", "."));
      if (isFinite(n) && n > 0) result.settings.oee = n > 1 ? n / 100 : n;
    } else if (/start/.test(k) && /date|day|from|week/.test(k)) {
      result.settings.startDate = parseDateValue(v);
    } else if (/initial|current|machine/.test(k) && /famil|state|setup|changeover/.test(k)) {
      const s = String(v).trim();
      // explicit "None" keeps the machine running (no initial setup)
      result.settings.initialFamily = /^(none|no setup|running|none \(.*\))$/i.test(s) ? "" : s;
    }
  }
  // a settings value that names the matrix's start row resolves to "__start__"
  if (result.settings.initialFamily) {
    const v = norm(result.settings.initialFamily);
    if (START_ROW_NAMES.has(v) || v === "__start__") result.settings.initialFamily = "__start__";
  }
  if (result.settings.initialFamily == null && result.hasStartRow) {
    result.settings.initialFamily = "__start__";
  }
}

/* --- order (optional) ------------------------------------------------------ */

/**
 * Optional "Order" sheet (Code, Qty) — written by the app's "Download
 * workbook". If present it defines the initial queue order and quantities;
 * codes not listed stay unselected.
 */
function parseOrderSheet(wb, result, warnings) {
  const headerTest = (r) =>
    (r || []).some((c) => /^code|sku|product|item/i.test(norm(c))) &&
    (r || []).some((c) => /^qty|quantity|amount/i.test(norm(c)));
  const sheet = findSheet(wb, /order|queue/i, headerTest);
  if (!sheet) return;

  const rows = sheetRows(wb, sheet);
  const headerIdx = findHeaderRow(rows, [/^code|sku|product|item/i, /^qty|quantity/i]);
  if (headerIdx < 0) return;

  const head = rows[headerIdx];
  const codeCol = head.findIndex((c) => /^code|sku|product|item/i.test(norm(c)));
  const qtyCol = head.findIndex((c) => /^qty|quantity|amount/i.test(norm(c)));

  const order = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const code = row[codeCol];
    if (code == null || String(code).trim() === "") continue;
    const qty = qtyCol >= 0 && isNum(row[qtyCol]) ? num(row[qtyCol]) : null;
    order.push({ code: String(code).trim(), qty });
  }

  if (!order.length) {
    warnings.push('The "Order" sheet has no usable rows — the queue starts empty.');
  }
  result.order = order;
}

/* --- validation ----------------------------------------------------------- */

function validate(result, warnings) {
  const known = new Set(result.families.map(norm));
  const unknown = [...new Set(result.codes.filter((c) => !known.has(norm(c.family))).map((c) => c.family))];
  if (unknown.length) {
    warnings.push(
      `No setup column for family: ${unknown.join(", ")} — changeovers touching it are treated as 0.`
    );
  }
  const dup = {};
  for (const c of result.codes) dup[c.code] = (dup[c.code] || 0) + 1;
  const dups = Object.keys(dup).filter((k) => dup[k] > 1);
  if (dups.length) warnings.push(`Duplicate code rows ignored after the first: ${dups.join(", ")}`);
}

/** Test convenience: parse raw bytes of an .xlsx file. */
export function parseWorkbookFromBuffer(buf) {
  const wb = lib.read(buf, { type: "array", cellDates: true });
  return parseWorkbook(wb);
}
