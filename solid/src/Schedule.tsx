import {
  Accessor,
  createContext,
  createMemo,
  ParentComponent,
  useContext,
} from "solid-js";
import { ScheduleResult } from "./Types";
import { buildScheduleFromCodeOrder } from "./services/solver-bruteforce";
import { useMainStore } from "./Context";
import { buildCtx } from "./services/ctx";

type ScheduleContext = {
  schedule: Accessor<ScheduleResult>;
  idealSchedule: Accessor<ScheduleResult | null>;
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
  const { state } = useMainStore();

  const ctx = createMemo(() => {
    return buildCtx(state);
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
        schedule: schedule,
        idealSchedule: idealSchedule,
      }}
    >
      {props.children}
    </ScheduleContext.Provider>
  );
};
