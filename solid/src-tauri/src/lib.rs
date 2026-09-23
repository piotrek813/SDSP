// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod holidays;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
