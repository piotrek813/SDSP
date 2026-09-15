# Cadence — single-machine sequence planner

A dependency-light web app that solves the **single-machine, sequence-dependent
scheduling problem**: given a set of order lines (codes) grouped into product
families, an asymmetric family-to-family changeover (setup) matrix, a shift
calendar with breaks, and an OEE figure, it finds the **best possible family
sequence** and draws the resulting plan as a Gantt chart.

The app optimises with **Held–Karp dynamic programming** (`js/solver-heldkarp.js`):
exact — the same optimum an exhaustive search would find — but O(n²·2ⁿ) instead
of n!, so up to **18 families** solve in interactive time and a 12-family plan
takes ~10 ms. The original **brute-force solver** (`js/solver-bruteforce.js`,
n! permutation enumeration, hard limit 10 families) stays in the tree as the
reference implementation for tests and benchmarks; the calendar engine
(`buildSchedule`, shift/break placement) lives there too.

## Run it

**Windows (non-technical users):** double-click **`start.bat`**. It launches
`server/sdsp.exe`, which lives in the **system tray** (red icon), opens your
default browser at `http://127.0.0.1:3000` automatically and serves the app.
Close the planner from the tray icon (right-click → *Quit*).

- Rebuild the exe after code changes: run **`server/build.bat`** (needs
  [Go](https://go.dev/dl)). It embeds the icon (`server/assets/icon.ico`,
  regenerated with `node tools/make-ico.mjs`) and version info via
  `goversioninfo`, and builds a windowless (`-H windowsgui`) binary.
- Prefer the command line? `server/sdsp.exe --port 3000 --no-open --no-tray`
  runs the same server with flags; `--no-tray` also works on Linux/macOS,
  where the tray is not implemented.
- The server also exposes the planner's tiny API: `GET/POST /api/settings`
  persists configuration (currently the holidays-file location, kept in
  `sdsp-settings.json` next to the app), and `GET/POST /api/holidays` reads
  that file fresh on every call.

During development
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
   changeover — +44 min more than the Held–Karp optimum.”* An
   **edited · +44 min** pill tracks the gap; **Re-optimise** hands control
   back to the solver and restores the best sequence.
5. Play with the session controls — nothing is ever written back to the file:
   - **Planning direction** — *forward* starts as soon as the calendar
     allows; *backward* anchors the plan's finish at a due date and fills
     work backwards from there (jobs finish as late as possible, slack
     appears at the start).
   - **OEE slider** dilutes production time live (10 min at 80 % → 12.5 min);
     the red card quantifies what poor performance costs on this plan.
   - **Shift calendar** (start date, shifts, breaks) reshapes the plan and
     shows how changeovers eat production capacity.
   - **Production failures** — one-off unplanned-downtime windows (date,
     start, end). They pause production like breaks, are drawn in red on the
     chart, and the chart widens so they stay visible even outside the plan.
   - **Priority** pins a family to position 1 and reports the price of that
     constraint versus the free optimum.
   - **Reload** re-reads the workbook from disk so external edits flow in —
     the queue (order + quantities), OEE and failure windows survive; a
     banner reports what was added or removed.
6. **Download workbook** saves the whole session as an `.xlsx` — the original
   setup matrix and catalogue, the current calendar, failure windows, an
   **Order** sheet with the queue exactly as it runs (order + quantities),
   and the session settings. Reloading that file restores the plan, including
   a hand-made sub-optimal order (it opens in manual mode). **SVG** and
   **PNG** export the chart itself.
6. **Download workbook** saves the whole session as an `.xlsx` — the original
   setup matrix and catalogue, the current calendar, an **Order** sheet with
   the queue exactly as it runs (order + quantities), and the session
   settings. Reloading that file restores the plan, including a hand-made
   sub-optimal order (it opens in manual mode). **SVG** and **PNG** export
   the chart itself.

The chart itself: one row per code, family-colored bars, changeovers in
standout red with minute labels, and each row's **start time printed in the
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
| `Failures`     | `Date`, `Start`, `End`                   | optional — one-off unplanned-downtime windows                      |

### The "Start" row in the setup matrix

The optional `Start` row answers one question: *what was the machine running
before the plan begins?* Its cells are the changeover minutes from that
previous state into each family. They are charged once, on top of the plan's
own transitions:

- total setup = `Start → first family` + every changeover *between* the
  families that follow, exactly as in the matrix;
- the solver includes that first changeover in its optimum, so the "Start"
  row can genuinely influence which family should run first;
- with **Machine starts in → "Start" row from matrix** the app uses it;
  **No setup (machine running)** skips it — e.g. when the line is already
  producing the first family, or the previous state is unknown.

### Holidays

Holidays are full non-working days loaded from a file that can live anywhere —
a local folder or a network share. Configure the location in the **Holidays**
panel; the desktop server remembers it (`sdsp-settings.json`) and reads the
file fresh on every plan, so edits on the share apply without restarting.

File format (a sample ships as `sample-data/holidays.txt`): one holiday per
line, `YYYY-MM-DD;Name` — `DD.MM.YYYY` dates, commas/tabs as separators, `#`
comments and a JSON array all work too. Imported holidays pause production
like breaks, render as light-red bands on the chart, and are honored by both
forward and backward planning.

Concretely, in the demo workbook the Start row reads `Lubricant 20,
Primer 25, Sealant 35, Coating 40, Resin 45 …`. A plan that opens on
Lubricant therefore pays 20 min before its first code (the header shows
*machine start ⟶ 20′ setup*); opening on Primer would pay the 25 min from
`Start → Primer` instead. That is why 25 appears when Primer is first — it
is the cell value, not something the solver invents. If the line starts
already clean, fill the Start row with zeros or pick **No setup**.


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
js/solver-heldkarp.js      exact Held–Karp DP solver — what the app runs
js/solver-bruteforce.js    exact permutation solver (reference) + calendar engine
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

- Held–Karp handles up to **18 families** (memory for the DP tables grows like
  n·2ⁿ, ~45 MB at 18). Beyond that the app falls back to running the queue as
  entered and says so. (The brute-force reference stops at 10.)
- Changeovers are calendar-aware but not interruptible mid-setup by design.
- The calendar models a single recurring day pattern — no weekday exceptions
  or holidays yet.
