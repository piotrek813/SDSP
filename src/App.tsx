import Topbar from "./components/Topbar";
import Banner from "./components/Banner";
import Sidebar from "./components/Sidebar";
import Summary from "./components/Summary";
import Output from "./components/Output";
import { createStore } from "solid-js/store";
import MainContext from "./Context";
import { MainStore } from "./Types";
import { ScheduleProvider } from "./Schedule";
import GanttView from "./components/Gantt/GanttView";
import { todayStr } from "./utils/dates";

function App() {
  const [state, setState] = createStore<MainStore>({
    fileName: null,
    // file: null, // the File object — kept so "Reload" can re-read it
    fileHandle: null, // FileSystemFileHandle — re-reads fresh content even after the file changed on disk
    isDemo: false,
    parsed: null, // excel.parseWorkbook result
    catalog: [], // all codes from the file
    selected: [], // {code, family, qty, unitMinutes, name} — THE run order
    oee: 0.8,
    mode: "optimal",
    startDate: todayStr(),
    startAt: "", // "" = as soon as the calendar allows
    direction: "forward", // "forward" from start date, "backward" from due date
    dueDate: todayStr(),
    dueAt: "", // "" = end of the last shift on the due day
    shifts: [], // {name, start, end} minutes
    breaks: [],
    failures: [], // one-off production failures {date, start, end}
    holidays: [], // full non-working days [{date, name}] from a file
    holidaysPath: "", // where that file lives (persisted by the Go server)
    crew: 1, // people working — affects per-piece run time
    crewFactor: "1", // f(crew): "" or "1" = no time impact; e.g. "1/x"
    initialFamily: "", // "" = none, "__start__" = matrix start row, else family
    fixedFirst: "", // "" = free optimisation, else family name
    showIdeal: false,
    result: null, // last solve { opt, sched, idealSched, gapMin, notOptimizable }
    optCache: null, // { key, res } — optimum only changes with setup/inputs
  });

  return (
    <MainContext.Provider value={{ state, setState }}>
      <ScheduleProvider>
        <Topbar />
        <Banner />
        <main class="layout" id="view-planner">
          <Sidebar />
          <section class="results">
            <Summary />
            <Output />
            <GanttView />
          </section>
        </main>
      </ScheduleProvider>
    </MainContext.Provider>
  );
}

export default App;
