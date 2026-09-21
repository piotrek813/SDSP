import { FileHandle } from "@tauri-apps/plugin-fs";

export type Product = {
  code: string;
  family: string;
  unitMinutes: number;
  name: string;
  qty: number;
  produced: boolean;
  defaultQty?: number;
};

export type SelectedProduct = Product & { selected: boolean };

export type Break = {};

export type Parsed = {
  families: any[];
  codes: any[];
  shifts: any[];
  breaks: any[];
};

export type MainStore = {
  fileName: string | null;
  // file: null, // the File object — kept so "Reload" can re-read it
  fileHandle: FileHandle | null; // FileSystemFileHandle — re-reads fresh content even after the file changed on disk
  isDemo: boolean;
  parsed: Parsed; // excel.parseWorkbook result
  catalog: Product[]; // all codes from the file
  selected: []; // {code, family, qty, unitMinutes, name} — THE run order
  mode: "optymalna" | "manual"; // "optymalna" = follow the solver, "manual" = user's order
  oee: number;
  startDate: string | null;
  startAt: ""; // "" = as soon as the calendar allows
  direction: "forward" | "backward"; // "forward" from start date, "backward" from due date
  dueDate: null;
  dueAt: ""; // "" = end of the last shift on the due day
  shifts: []; // {name, start, end} minutes
  breaks: [];
  failures: []; // one-off production failures {date, start, end}
  holidays: []; // full non-working days [{date, name}] from a file
  holidaysPath: ""; // where that file lives (persisted by the Go server)
  crew: 1; // people working — affects per-piece run time
  crewFactor: "1"; // f(crew): "" or "1" = no time impact; e.g. "1/x"
  initialFamily: ""; // "" = none, "__start__" = matrix start row, else family
  fixedFirst: ""; // "" = free optimisation, else family name
  showIdeal: false;
  result: null; // last solve { opt, sched, idealSched, gapMin, notOptimizable }
  optCache: null; // { key, res } — optimum only changes with setup/inputs
};
