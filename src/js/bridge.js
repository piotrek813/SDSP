/*
 * bridge.js — the thin wall between the UI and the Tauri shell.
 *
 * Everything that used to go over HTTP to the old desktop server (sdsp.exe)
 * — demo data, the holidays API, file saves — now calls Rust commands via
 * the global `window.__TAURI__` (tauri.conf.json sets withGlobalTauri).
 *
 * All helpers degrade gracefully when the app runs in a plain browser
 * (`isTauri()` false): the callers either show a hint or fall back to the
 * browser-only path (e.g. the session-only holiday import).
 */

const tauri = () =>
  (typeof window !== "undefined" && window.__TAURI__ && window.__TAURI__.core) || null;

/** True when running inside the Tauri webview. */
export const isTauri = () => !!tauri();

async function invoke(command, args) {
  const core = tauri();
  if (!core) throw new Error("Ta funkcja wymaga aplikacji desktopowej (Tauri).");
  return core.invoke(command, args);
}

/* ----------------------------------------------------------- demo data -- */

/** The bundled demo workbook as bytes (Rust embeds and base64-encodes it). */
export async function readDemoWorkbook() {
  const encoded = await invoke("demo_workbook");
  return base64ToBytes(encoded);
}

/* ------------------------------------------------------------- holidays -- */

/** Persisted path + parsed holidays (payload: {path, count, holidays, error}). */
export const holidaysGet = () => invoke("holidays_get");

/** Persist a holidays file path and read it. */
export const holidaysLoad = (path) => invoke("holidays_load", { path });

/** Push browser-parsed holidays so they survive restarts. */
export const holidaysImport = (holidays) => invoke("holidays_import", { holidays });

/* ---------------------------------------------------------- file saves -- */

/**
 * Native "Save as…" dialog + write, for anything a blob download used to do.
 * request: { suggestedName, svg?, base64?, filterName?, extensions? }
 * Resolves to { path } or null when the user cancelled.
 */
export const saveFileDialog = (request) => invoke("save_file_dialog", { request });

/* -------------------------------------------------------------- codecs -- */

export function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Blob → base64 (PNG export and the workbook fallback go through Rust). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Nie udało się odczytać danych pliku."));
    reader.readAsDataURL(blob);
  });
}
