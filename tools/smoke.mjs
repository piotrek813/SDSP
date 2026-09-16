/*
 * smoke.mjs — headless end-to-end smoke test of the web app.
 * Loads the page, clicks "Load demo data", pokes the OEE slider and the
 * shift editor, and fails on any console error or missing gantt.
 * Run: node tools/smoke.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const URL = "http://127.0.0.1:5173/index.html";
const SHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "smoke-preview.png");

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,960"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });

const problems = [];
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
});
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle0" });

const title = await page.title();
if (!/Cadence/.test(title)) problems.push(`unexpected title: ${title}`);

// --- load demo data -------------------------------------------------------
await page.click("#btn-demo");
await page.waitForFunction(() => {
  const host = document.getElementById("gantt-host");
  return host && host.querySelector("svg");
}, { timeout: 15000 });

const stats = await page.evaluate(() => {
  const svg = document.querySelector("#gantt-host svg");
  const bars = svg.querySelectorAll("rect").length;
  return {
    solverNote: document.getElementById("solver-note").textContent,
    chips: document.querySelectorAll(".seq-chip").length,
    bars,
    setup: document.getElementById("m-setup").textContent,
    run: document.getElementById("m-run").textContent,
    finish: document.getElementById("m-finish").textContent,
    loss: document.getElementById("loss-value").textContent,
    lossNote: document.getElementById("loss-note").textContent,
    metricSpan: document.getElementById("m-makespan").textContent,
    rows: document.querySelectorAll("#catalog-list .catalog-row").length,
    legend: document.querySelectorAll(".legend-item").length,
  };
});
console.log("demo loaded:", JSON.stringify(stats, null, 2));

// --- workbook download: save dialog writes a valid file --------------------
const saved = await page.evaluate(async () => {
  let captured = null;
  window.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async (data) => { captured = data; },
      close: async () => {},
    }),
  });
  document.getElementById("btn-export-book").click();
  await new Promise((r) => setTimeout(r, 300));
  const bytes = new Uint8Array(await captured.arrayBuffer());
  const wb = XLSX.read(bytes, { type: "array" });
  const settings = Object.fromEntries(
    XLSX.utils.sheet_to_json(wb.Sheets["Settings"]).map((r) => [r.Setting, r.Value])
  );
  return {
    magic: [...bytes.slice(0, 4)],
    names: wb.SheetNames.join(","),
    rows: XLSX.utils.sheet_to_json(wb.Sheets["Order"]).map((r) => [r.Code, r.Qty].join("=")),
    hasFailuresSheet: "Failures" in wb.Sheets,
    direction: settings["Planning direction"],
  };
});
console.log("save dialog:", JSON.stringify(saved));
if (JSON.stringify(saved.magic) !== "[80,75,3,4]") problems.push(`exported file is not an xlsx: ${saved.magic}`);
if (!/Order/.test(saved.names)) problems.push(`exported workbook missing Order sheet: ${saved.names}`);
if (!saved.hasFailuresSheet) problems.push("exported workbook missing Failures sheet");
if (saved.direction !== "Forward") problems.push(`exported planning direction wrong: ${saved.direction}`);
const expectedOrder = await page.$$eval("#selected-list .queue-name", (els) => els.map((e) => e.textContent));
const gotOrder = saved.rows.map((r) => r.split("=")[0]);
if (JSON.stringify(gotOrder) !== JSON.stringify(expectedOrder)) {
  problems.push(`order sheet mismatch: ${gotOrder} vs queue ${expectedOrder}`);
}

// --- holidays import ---------------------------------------------------------
await page.evaluate(() => {
  const content = "# holidays\n2026-12-24;Christmas Eve\n2027-01-01;New Year 2027\n";
  const file = new File([content], "holidays.txt", { type: "text/plain" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById("holidays-file");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise(r => setTimeout(r, 500));
const holidayInfo = await page.evaluate(() => ({
  status: document.getElementById("holidays-status").textContent,
  items: [...document.querySelectorAll("#holidays-list li")].map((li) => li.textContent),
}));
console.log("holiday import:", JSON.stringify(holidayInfo));
if (!/imported/.test(holidayInfo.status)) problems.push(`holiday import status wrong: ${holidayInfo.status}`);
if (holidayInfo.items.length !== 2) problems.push(`holiday list wrong: ${holidayInfo.items}`);

// --- branding essentials ----------------------------------------------------
const brand = await page.evaluate(() => ({
  logoLoaded: (() => { const img = document.querySelector(".brand-logo"); return !!img && img.complete && img.naturalWidth > 0; })(),
  favicon: !!document.querySelector('link[rel="icon"][href="favicon.svg"]'),
  changeoverFill: (() => {
    const bars = [...document.querySelectorAll('#gantt-host svg rect')].filter(r => r.getAttribute('fill') === '#feebed');
    return bars.length;
  })(),
  summaryStyle: (() => {
    const el = document.getElementById("data-summary");
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderColor };
  })(),
}));
console.log("brand:", JSON.stringify(brand));
if (!brand.logoLoaded) problems.push("logo.svg did not load in the header");
if (!brand.favicon) problems.push("favicon.svg link missing");
if (brand.changeoverFill === 0) problems.push("no #feebed changeover bars on the chart");
if (brand.summaryStyle.border !== "rgb(202, 203, 209)") problems.push(`data-summary border wrong: ${brand.summaryStyle.border}`);
await page.screenshot({ path: SHOT.replace(".png", "-initial.png"), fullPage: true });

if (!stats.chips) problems.push("no sequence chips rendered");
if (stats.chips < 7) problems.push(`sequence chips: ${stats.chips} (expected >= 7 visits + machine chip)`);
if (stats.bars < 20) problems.push(`suspiciously few gantt rects: ${stats.bars}`);
if (!/Held–Karp|matches the optimum/.test(stats.solverNote)) problems.push(`solver note wrong: ${stats.solverNote}`);
if (stats.rows !== 18) problems.push(`catalog rows: ${stats.rows} (expected 18)`);

// --- manual reorder: move a code across a family boundary -----------------
const setupOptimal = await page.$eval("#m-setup", (el) => el.textContent);
const pillBefore = await page.$eval("#queue-pill", (el) => el.textContent);
await page.$$eval("#selected-list li", (rows) => {
  const row = rows.find((r) => r.querySelector(".queue-name")?.textContent === "LB-270");
  const down = row.querySelectorAll(".icon-btn")[1]; // up, down, ...
  down.click();
});
await new Promise((r) => setTimeout(r, 400));

const manual = await page.evaluate(() => ({
  note: document.getElementById("solver-note").textContent,
  pill: document.getElementById("queue-pill").textContent,
  pillClass: document.getElementById("queue-pill").className,
  reoptDisabled: document.getElementById("btn-reoptimise").disabled,
  setup: document.getElementById("m-setup").textContent,
  changeoverRows: document.querySelectorAll("#selected-list li.changeover").length,
}));
console.log("manual reorder:", JSON.stringify(manual));
await page.screenshot({ path: SHOT.replace(".png", "-manual.png"), fullPage: true });
if (!/Manual sequence/.test(manual.note)) problems.push(`manual note missing: ${manual.note}`);
if (manual.setup === setupOptimal) problems.push(`manual mix did not change changeover time (still ${setupOptimal})`);
if (manual.pillClass.includes("ok")) problems.push(`pill should be warn after suboptimal edit: ${manual.pillClass}`);
if (manual.reoptDisabled) problems.push("Re-optimise should be enabled after a suboptimal edit");
if (manual.changeoverRows < 4) problems.push(`expected extra changeover markers, got ${manual.changeoverRows}`);

// --- Re-optimise returns to the best sequence ------------------------------
await page.click("#btn-reoptimise");
await new Promise((r) => setTimeout(r, 500));
const reopt = await page.evaluate(() => ({
  note: document.getElementById("solver-note").textContent,
  pill: document.getElementById("queue-pill").textContent,
  setup: document.getElementById("m-setup").textContent,
  firstTwo: [...document.querySelectorAll("#selected-list .queue-name")].slice(0, 2).map((e) => e.textContent),
}));
console.log("after Re-optimise:", JSON.stringify(reopt));
if (!/Held–Karp/.test(reopt.note)) problems.push(`re-optimise note wrong: ${reopt.note}`);
if (reopt.setup !== setupOptimal) problems.push(`re-optimise did not restore optimal changeover (${reopt.setup} vs ${setupOptimal})`);
if (reopt.firstTwo[0] !== "RS-190" || reopt.firstTwo[1] !== "RS-300") {
  problems.push(`queue not restored to optimal head: ${reopt.firstTwo.join(",")}`);
}
void pillBefore;

// --- OEE change -----------------------------------------------------------
const before = await page.$eval("#m-run", (el) => el.textContent);
await page.$eval("#oee-range", (el) => {
  el.value = "100";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
const after = await page.$eval("#m-run", (el) => el.textContent);
if (before === after) problems.push(`OEE change did not alter production time (${before} vs ${after})`);
console.log(`OEE 80% -> 100%: production ${before} -> ${after}`);

// --- priority pin ---------------------------------------------------------
await page.select("#fixed-first", "Resin");
await new Promise((r) => setTimeout(r, 400));
const note = await page.$eval("#solver-note", (el) => el.textContent);
if (!/pinned/.test(note)) problems.push(`pin note missing: ${note}`);
console.log("pinned:", note);

// --- calendar edit --------------------------------------------------------
const spanBefore = await page.$eval("#m-makespan", (el) => el.textContent);
await page.$$eval("#shifts-list .cal-row", (rows) => {
  const endInput = rows[rows.length - 1].querySelectorAll('input[type="time"]')[1];
  endInput.value = "18:00"; // plan finishes ~19:30, so this must push it out
  endInput.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
const spanAfter = await page.$eval("#m-makespan", (el) => el.textContent);
if (spanBefore === spanAfter) problems.push(`calendar edit did not change span (${spanBefore})`);
console.log(`shift end 22:00 -> 18:00: span ${spanBefore} -> ${spanAfter}`);

// --- ghost toggle ---------------------------------------------------------
await page.click("#toggle-ideal");
await new Promise((r) => setTimeout(r, 400));
const ghosts = await page.$$eval("#gantt-host svg rect[stroke-dasharray]", (els) => els.length);
if (!ghosts) problems.push("ghost bars not rendered after toggle");
console.log("ghost bars:", ghosts);

// --- svg export sanity ----------------------------------------------------
const svgOk = await page.evaluate(() => {
  const svg = document.querySelector("#gantt-host svg");
  return !!(svg && svg.getAttribute("width") && svg.querySelector("text"));
});
if (!svgOk) problems.push("svg export precondition failed");

await page.screenshot({ path: SHOT, fullPage: true });
console.log("screenshot: smoke-preview.png");

await browser.close();

if (problems.length) {
  console.error("\nSMOKE FAILURES:");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("\nSMOKE OK");
