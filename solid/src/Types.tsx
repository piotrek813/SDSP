/**
 * Domain model — shared by the solvers, the Excel layer and the UI.
 * Durations and times-of-day are MINUTES (integers); dates are ISO strings
 * ("YYYY-MM-DD"). Times of day may wrap midnight (end <= start).
 */

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

export type Shift = {
  name: string;
  /** minutes since midnight */
  start: number;
  /** minutes since midnight; <= start wraps to the next day */
  end: number;
};

/** Full non-working day (typically loaded from a holidays file). */
export type Holiday = {
  date: string; // ISO
  name?: string;
};

export type CodeRow = {
  id: string;
  code: string;
  family: string;
  qty: number;
  /** ideal time for ONE piece with one worker, in minutes */
  unitMinutes: number;
  /** pieces actually created (filled by the supervisor) */
  produced?: number;
  name?: string;
  defaultQty?: number | null;
};

export type WorkInterval = {
  start: Date;
  end: Date;
};

export type PlanningDirection = "forward" | "backward";

export type CalendarConfig = {
  direction?: PlanningDirection;
  startDate: string; // ISO
  startAt?: string | null; // "HH:MM" | null
  dueDate?: string | null; // backward anchor
  dueAt?: string | null; // "HH:MM" | null
  shifts: Shift[];
  breaks: Break[];
  failures: Failure[];
  holidays: Holiday[];
  /** people working; per-piece time scales by the crew factor */
  crew?: number;
  /** f(crew): per-piece time multiplier — unset/1 = no impact */
  crewFactor?: string | number;
  maxDays?: number;
};

export type ScheduleContext = {
  /** changeover minutes, "from>to" keys (missing cells count as 0) */
  setup: Record<string, number>;
  /** what the machine ran last; null = no initial changeover */
  initialFamily: string | null;
  calendar: CalendarConfig;
  codes: CodeRow[];
  /** 0..1 */
  oee: number;
};

export type ScheduleRow = {
  code: string;
  family: string;
  qty: number;
  /** ideal minutes per piece, one worker */
  unitIdeal: number;
  /** OEE- and crew-adjusted minutes per piece */
  unitEffective: number;
  setupFrom: string | null;
  setupSegments: WorkInterval[];
  runSegments: WorkInterval[];
};

export type ScheduleResult = {
  rows: ScheduleRow[];
  start: Date | null;
  end: Date | null;
  setupMinutes: number;
  runMinutes: number;
};

export type SolveResult = {
  sequence: string[];
  setupMinutes: number;
  runMinutes: number;
  evaluated: number;
  elapsedMs: number;
  optimum: boolean;
};

/** Parsed workbook model (js/excel.ts output). */
/** A code row as parsed from the workbook (no queue fields yet). */
export type ParsedCode = {
  code: string;
  family: string;
  unitMinutes: number;
  name?: string;
  defaultQty?: number | null;
};

export type ParsedWorkbook = {
  codes: ParsedCode[];
  setup: Record<string, number>;
  families: string[];
  hasStartRow: boolean;
  settings: {
    oee: number;
    startDate: string | null;
    initialFamily: string | null;
    direction?: PlanningDirection;
    dueDate?: string | null;
    dueAt?: string | null;
    crew?: number;
    crewFactor?: string;
  };
  shifts: Shift[];
  breaks: Break[];
  failures: Failure[];
  order: OrderRow[];
  warnings: string[];
  sheetNames: string[];
};

export type OrderRow = {
  code: string;
  qty: number | null;
  produced?: number;
};

/** One-off unplanned downtime window (concrete date). */
export type Failure = {
  date: string; // ISO
  start: number;
  end: number;
  comment?: string;
};

export type Break = {
  name: string;
  start: number;
  end: number;
};

export type MainStore = {
  fileName: string | null;
  // file: null, // the File object — kept so "Reload" can re-read it
  fileHandle: FileHandle | null; // FileSystemFileHandle — re-reads fresh content even after the file changed on disk
  isDemo: boolean;
  parsed: ParsedWorkbook | null; // excel.parseWorkbook result
  catalog: Product[]; // all codes from the file
  selected: Product[]; // {code, family, qty, unitMinutes, name} — THE run order
  mode: "optymalna" | "manual"; // "optymalna" = follow the solver, "manual" = user's order
  oee: number;
  startDate: string | null;
  startAt: ""; // "" = as soon as the calendar allows
  direction: PlanningDirection;
  dueDate: null;
  dueAt: ""; // "" = end of the last shift on the due day
  shifts: []; // {name, start, end} minutes
  breaks: Break[];
  failures: Failure[]; // one-off production failures {date, start, end}
  holidays: Holiday[]; // full non-working days [{date, name}] from a file
  holidaysPath: ""; // where that file lives (persisted by the Go server)
  crew: 1; // people working — affects per-piece run time
  crewFactor: "1"; // f(crew): "" or "1" = no time impact; e.g. "1/x"
  initialFamily: ""; // "" = none, "__start__" = matrix start row, else family
  fixedFirst: ""; // "" = free optimisation, else family name
  showIdeal: false;
  result: null; // last solve { opt, sched, idealSched, gapMin, notOptimizable }
  optCache: null; // { key, res } — optimum only changes with setup/inputs
};
