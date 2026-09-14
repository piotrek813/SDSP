# Cadence — single-machine sequence planner

A dependency-light web app that solves the **single-machine, sequence-dependent
scheduling problem**: given a set of order lines (codes) grouped into product
families, an asymmetric family-to-family changeover (setup) matrix, a shift
calendar with breaks, and an OEE figure, it finds the **best possible family
sequence** and draws the resulting plan as a Gantt chart.

The first implementation is a **brute-force solver**: it enumerates *all*
permutations of the product families (up to 10 families → 10! = 3,628,800
sequences) and keeps the one with the least total changeover time. Because
production time is fixed by the order quantities, least setup is also earliest
finish on a recurring calendar.

## Run it

Any static file server from the project root works:

```bash
npm run serve          # python3 -m http.server 5173
# then open http://127.0.0.1:5173/
```

Or `python3 -m http.server 8080`, `npx serve`, an nginx alias — anything that
serves `index.html` with its relative paths intact. No build step.

## Workflow

1. **Open workbook…** (or drop an `.xlsx`, or *Load demo data*).
2. Tick codes in the **Codes** panel; they land in the **Order queue** — that
   list *is* the execution order, not a suggestion.
3. The solver runs automatically. The header shows how many sequences were
   evaluated, the run order with per-changeover minutes, and the finish time /
   span / changeover / production metrics.
4. **Take over manually** — drag rows (or use the arrows) to any order you
   like, mixing families freely. Each family change gets an amber edge in the
   queue and its changeover cost in the chips; the plan re-schedules live and
   the header reports the price, e.g. *“Manual sequence · 2 h 52 min
   changeover — +44 min more than the best of 5,040 sequences.”* An
   **edited · +44 min** pill tracks the gap; **Re-optimise** hands control
   back to the solver and restores the best sequence.
5. Play with the session controls — nothing is ever written back to the file:
   - **OEE slider** dilutes production time live (10 min at 80 % → 12.5 min);
     the red card quantifies what poor performance costs on this plan.
   - **Shift calendar** (start date, shifts, breaks) reshapes the plan and
     shows how changeovers eat production capacity.
   - **Priority** pins a family to position 1 and reports the price of that
     constraint versus the free optimum.
6. **Download workbook** saves the whole session as an `.xlsx` — the original
   setup matrix and catalogue, the current calendar, an **Order** sheet with
   the queue exactly as it runs (order + quantities), and the session
   settings. Reloading that file restores the plan, including a hand-made
   sub-optimal order (it opens in manual mode). **SVG** and **PNG** export
   the chart itself.

The chart itself: one row per code, family-colored bars, changeovers in
standout amber with minute labels, and each row's **start time printed in the
empty space before its first bar** — with the weekday when a row begins on a
later day — so the plan reads without hovering. Breaks are hatched, off-shift
time shaded, and a dashed ghost shows the 100 %-OEE plan when enabled.

## Workbook format

Five sheets, matched loosely by name — order doesn't matter, extra sheets are
ignored. See `sample-data/demo-input.xlsx`, regenerate it with `npm run sample`.

| Sheet          | Columns                                  | Notes                                              |
| -------------- | ---------------------------------------- | -------------------------------------------------- |
| `Setup Matrix` | `From \ To`, then one column per family  | minutes; add a `Start` row for the machine's initial state |
| `Codes`        | `Code`, `Family`, `Unit time (min)`, …   | optional `Description`, `Qty` (default quantity)   |
| `Shifts`       | `Start`, `End`                           | `HH:MM` text, Excel time, or plain hours; may wrap midnight |
| `Breaks`       | `Start`, `End`                           | subtracted from shifts                             |
| `Order`        | `Code`, `Qty`                            | optional — restores a saved queue (written by "Download workbook") |
| `Settings`     | `Setting`, `Value`                       | `OEE` (0.8, 80 or “80 %”), `Start date`, `Initial family` (`None` = running) |

## The solver contract (for comparing implementations)

`js/solver-bruteforce.js` is standalone, side-effect-free ES module — usable in
the browser and under `node --test`:

```js
import { solveBruteForce, buildSchedule } from "./js/solver-bruteforce.js";

const result = solveBruteForce(ctx, { fixedFirst: null });
// → { sequence, setupMinutes, runMinutes, evaluated, elapsedMs, optimum }

const schedule = buildSchedule(ctx, result.sequence);
// → { rows: [{ code, family, qty, setupSegments, runSegments, … }], start, end,
//     setupMinutes, runMinutes }
```

`ctx` is the plain-JSON problem documented in the module header: `setup`
(`"A>B" → minutes`), optional `initialFamily`, a `calendar`
(`startDate`, `startAt`, `shifts`, `breaks`), `codes`
(`{ code, family, qty, unitMinutes }`) and `oee`.

A second exact algorithm — **Held–Karp dynamic programming** — lives in
`test/reference-heldkarp.mjs` purely as an independent referee.

## Tests

```bash
npm test          # node --test
node tools/smoke.mjs   # headless end-to-end test (needs Chromium + the server on :5173)
```

The unit suite covers time parsing (including the Excel numeric forms), OEE
normalisation, the changeover walk, the calendar expansion (midnight-wrapping
shifts, break cuts, `startAt`), schedule placement (break splits, day rollover,
OEE loss), and — the headline check — **the brute force agreeing with Held–Karp
on 200 randomized instances**. To benchmark a different solver, make it honour
the same contract and add it to the comparison set in `test/solver.test.mjs`.

## Layout

```
index.html                 the app shell
css/styles.css             the visual language
js/solver-bruteforce.js    exact permutation solver + calendar engine
js/excel.js                workbook → problem model
js/gantt.js                SVG chart + SVG/PNG export
js/app.js                  state and UI wiring
test/                      unit + reference + integration tests
tools/make-sample.mjs      regenerates the demo workbook
tools/smoke.mjs            headless browser smoke test
tools/benchmark.mjs        multi-solver benchmark with verification
vendor/xlsx.full.min.js    SheetJS (Apache-2.0), the only vendored dependency
```

## Benchmarking solvers

```bash
npm run benchmark                       # 4..10 families
node tools/benchmark.mjs --max=13       # let heuristics scale past 10!
node tools/benchmark.mjs --instances=5 --seed=42 --budget=5
```

The runner (`tools/benchmark.mjs`) executes **every registered solver on
identical seeded instances** and verifies exact solvers against the Held–Karp
reference (exit code 1 on any mismatch). For each participant it reports
min/median time, average gap to the optimum, how often it hit the optimum, and
its evaluation count. Results land in `benchmark-results/` as JSON (machines)
and CSV (spreadsheets) so runs are comparable over time.

Registering a new solver is a three-line change in the `SOLVERS` array:

```js
const SOLVERS = [
  { name: "brute-force", exact: true,  fn: (ctx) => solveBruteForce(ctx) },
  { name: "held-karp",   exact: true,  fn: (ctx) => ({ setupMinutes: heldKarpOptimum(ctx) }) },
  { name: "greedy+2opt", exact: false, fn: greedy2optSolve },
  { name: "my-solver",   exact: false, fn: mySolver },   // ← add yours here
];
```

A naive `greedy+2opt` heuristic ships in the file as a worked example (and as a
baseline to beat — on random instances it lands ~16 % above the optimum).
Solvers that refuse a size (like brute force beyond 10 families) or exceed the
per-instance time budget are gracefully sat out of larger sizes and reported.

Sample output (this machine, defaults):

```
n= 8  brute-force    49 ms  ·  held-karp   0.49 ms  ·  greedy+2opt   0.36 ms
n= 9  brute-force   474 ms  ·  held-karp   1.21 ms  ·  greedy+2opt   0.27 ms
n=10  brute-force  5216 ms  ·  held-karp   3.02 ms  ·  greedy+2opt   0.39 ms
```

## Known limits

- The exhaustive search stops at **10 families** (≈3.6 M permutations, seconds).
  Beyond that the app falls back to running the queue as entered and says so.
- Changeovers are calendar-aware but not interruptible mid-setup by design.
- The calendar models a single recurring day pattern — no weekday exceptions
  or holidays yet.
