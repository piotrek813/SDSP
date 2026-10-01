use base64::{engine::general_purpose, Engine as _};
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod holidays;

// The demo workbook is bundled into the binary — no HTTP fetch, no asset
// resolution, works identically in dev and in the packaged app.
const DEMO_WORKBOOK: &[u8] = include_bytes!("../../src/sample-data/demo-input.xlsx");

/// The bundled demo workbook, base64-encoded to keep the IPC payload compact.
#[tauri::command]
fn demo_workbook() -> String {
    general_purpose::STANDARD.encode(DEMO_WORKBOOK)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(holidays::HolidaysState::new())
        .invoke_handler(tauri::generate_handler![
            holidays::holidays_get,
            holidays::holidays_load,
            holidays::holidays_import,
            demo_workbook
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
