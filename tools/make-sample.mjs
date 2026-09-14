/*
 * make-sample.mjs — regenerates sample-data/demo-input.xlsx
 * Run: node tools/make-sample.mjs
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The CDN bundle is written for browsers; evaluate it with `exports`/`module`
// hidden so it builds and returns its own XLSX object instead of exporting
// the embedded codepage table.
const src = fs.readFileSync(new URL("../vendor/xlsx.full.min.js", import.meta.url), "utf8");
const XLSX = new Function("exports", "module", "window", src + "\n;return XLSX;")(
  undefined, undefined, undefined
);
XLSX.set_fs(fs); // let the browser bundle write files under Node

const outPath = fileURLToPath(new URL("../sample-data/demo-input.xlsx", import.meta.url));

/* ----------------------------------------------------------- the model -- */

const families = ["Sealant", "Adhesive", "Primer", "Coating", "Cleaner", "Lubricant", "Resin"];

const codes = [
  ["SL-100", "Sealant", 6.0, "Sealant 100 ml"],
  ["SL-220", "Sealant", 7.5, "Sealant 220 ml"],
  ["SL-310", "Sealant", 9.0, "Sealant 310 ml"],
  ["AD-110", "Adhesive", 5.0, "Adhesive standard"],
  ["AD-150", "Adhesive", 6.5, "Adhesive premium"],
  ["AD-240", "Adhesive", 8.0, "Adhesive flex"],
  ["PR-120", "Primer", 4.0, "Primer fast-dry"],
  ["PR-180", "Primer", 5.5, "Primer all-weather"],
  ["PR-260", "Primer", 7.0, "Primer marine"],
  ["CO-130", "Coating", 8.5, "Coating gloss"],
  ["CO-170", "Coating", 10.0, "Coating satin"],
  ["CO-290", "Coating", 12.5, "Coating industrial"],
  ["CL-140", "Cleaner", 3.0, "Cleaner daily"],
  ["CL-280", "Cleaner", 4.5, "Cleaner heavy-duty"],
  ["LB-160", "Lubricant", 5.0, "Lubricant light"],
  ["LB-270", "Lubricant", 6.0, "Lubricant heavy"],
  ["RS-190", "Resin", 11.0, "Resin epoxy"],
  ["RS-300", "Resin", 13.0, "Resin casting"],
];

// asymmetric family-to-family changeover minutes
const raw = {
  "Sealant":   [0, 25, 18, 35, 12, 20, 40],
  "Adhesive":  [22, 0, 15, 30, 12, 18, 35],
  "Primer":    [28, 20, 0, 25, 14, 22, 30],
  "Coating":   [38, 30, 24, 0, 15, 25, 20],
  "Cleaner":   [14, 12, 16, 22, 0, 10, 30],
  "Lubricant": [24, 20, 25, 28, 12, 0, 32],
  "Resin":     [42, 35, 28, 18, 30, 34, 0],
};
const startRow = { Sealant: 35, Adhesive: 30, Primer: 25, Coating: 40, Cleaner: 15, Lubricant: 20, Resin: 45 };

/* ------------------------------------------------------------- the book -- */

const wb = XLSX.utils.book_new();

// Setup matrix: header row = destination families, rows = source families.
const setupAoA = [["From \\ To", ...families]];
for (const f of families) setupAoA.push([f, ...raw[f]]);
setupAoA.push(["Start", ...families.map((f) => startRow[f])]);
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setupAoA), "Setup Matrix");

// Codes
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([["Code", "Family", "Unit time (min)", "Description"], ...codes]),
  "Codes"
);

// Shifts
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["Shift", "Start", "End"],
    ["Morning", "06:00", "14:00"],
    ["Afternoon", "14:00", "22:00"],
  ]),
  "Shifts"
);

// Breaks
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["Break", "Start", "End"],
    ["Lunch", "11:30", "12:00"],
    ["Afternoon break", "18:00", "18:15"],
  ]),
  "Breaks"
);

// Settings
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["Setting", "Value"],
    ["OEE", 0.8],
    ["Start date", "2025-01-06"],
    ["Initial family", "Start"],
  ]),
  "Settings"
);

XLSX.writeFile(wb, outPath, { compression: true });
console.log("wrote", outPath);
