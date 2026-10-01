import {
  Accessor,
  createContext,
  createMemo,
  ParentComponent,
  useContext,
} from "solid-js";
import { ScheduleResult, SolveResult } from "./Types";
import { useMainStore } from "./Context";
import {
  buildCtx,
  getOptimum,
  queueFromSequence,
  sameOrder,
} from "./services/ctx";
import { buildScheduleFromCodeOrder } from "./services/solvers/solver-bruteforce";
import { setBanner } from "./components/Banner";

type ScheduleContext = {
  schedule: Accessor<ScheduleResult>;
  idealSchedule: Accessor<ScheduleResult | null>;
  optimum: Accessor<SolveResult | null>;
};

export const ScheduleContext = createContext<ScheduleContext>();
export const useSchedule = () => {
  const context = useContext(ScheduleContext);
  if (!context) {
    throw new Error("useSchedule should be called inside its ContextProvider");
  }

  return context;
};

export const ScheduleProvider: ParentComponent = (props) => {
  const { state, setState } = useMainStore();

  const ctx = createMemo(() => {
    return buildCtx(state);
  });

  const optimum = createMemo(() => {
    try {
      const res = getOptimum(state, ctx());

      if (res === null) return null;

      const [opt, key] = res;

      // Follow the optimiser: in optimal mode the queue mirrors the best sequence.
      // Manual mode never touches the user's order.
      if (state.mode === "optimal" && opt) {
        const wanted = queueFromSequence(state.selected, opt.sequence);
        if (!sameOrder(state.selected, wanted)) {
          setState("selected", wanted);
          setState("optCache", { key, res: opt });
        }
      }

      return opt;
    } catch (err) {
      setBanner(`Calendar problem: ${err.message}`, true);
      return null;
    }
  });

  const schedule = createMemo(() => {
    const sched = buildScheduleFromCodeOrder(ctx(), state.selected);
    return sched;
  });

  const idealSchedule = createMemo(() => {
    return state.showIdeal
      ? buildScheduleFromCodeOrder({ ...ctx(), oee: 1 }, state.selected)
      : null;
  });

  return (
    <ScheduleContext.Provider
      value={{
        schedule,
        idealSchedule,
        optimum,
      }}
    >
      {props.children}
    </ScheduleContext.Provider>
  );
};
