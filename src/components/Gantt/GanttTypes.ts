type Interval = {
  start: Date;
  end: Date;
};
type ScheduleRow = {
  code: string;
  family: string;
  qty: number;
  setupSegments: Interval[];
  runSegments: Interval[];
};
type Schedule = {
  start: Date;
  end: Date;
  rows: ScheduleRow[];
};
type GanttProps = {
  schedule: Schedule;
  familyColors?: Map<string, string>;
  offIntervals?: Interval[];
  holidayIntervals?: Interval[];
  breakIntervals?: Interval[];
  failIntervals?: (Interval & { comment?: string })[];
  idealSchedule: Schedule | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  title?: string;
  subtitle?: string;
};

type XPercentFunction = (x: number) => number;
