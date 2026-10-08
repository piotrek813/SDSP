import { createContext, useContext } from "solid-js";
import { MainStore } from "./Types";
import { SetStoreFunction, type Store } from "solid-js/store";

type MainContext = {
  state: Store<MainStore>;
  setState: SetStoreFunction<MainStore>;
};

const MainContext = createContext<MainContext>();
export const useMainStore = () => {
  const context = useContext(MainContext);
  if (!context) {
    throw new Error("useMainStore should be called inside its ContextProvider");
  }

  return context;
};

export default MainContext;
