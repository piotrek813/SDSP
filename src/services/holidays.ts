import { invoke } from "@tauri-apps/api/core";
import { Holiday } from "../Types";

export type RustHolidays = { holidays: Holiday[]; path: string; error: string };

export const holidaysGet = (): Promise<RustHolidays> => invoke("holidays_get");
export const holidaysLoad = (path: string): Promise<RustHolidays> =>
  invoke("holidays_load", { path });
