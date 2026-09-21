use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

mod holidays;

// The demo workbook is bundled into the binary — no HTTP fetch, no asset
// resolution, works identically in dev and in the packaged app.
const DEMO_WORKBOOK: &[u8] = include_bytes!("../../src/sample-data/demo-input.xlsx");

/// Data for `save_file_dialog`: an SVG string or base64-encoded binary plus
/// the filename the dialog should suggest.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    suggested_name: String,
    /// UTF-8 text payload (e.g. the serialized Gantt SVG).
    #[serde(default)]
    svg: Option<String>,
    /// Binary payload, base64-encoded (e.g. PNG bytes or an .xlsx blob).
    #[serde(default)]
    base64: Option<String>,
    /// Optional dialog filter: human name, e.g. "SVG image".
    #[serde(default)]
    filter_name: Option<String>,
    /// Optional dialog filter extensions, e.g. ["xlsx"]; derived from the
    /// suggested name when omitted.
    #[serde(default)]
    extensions: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedFile {
    path: String,
}

/// The bundled demo workbook, base64-encoded to keep the IPC payload compact.
#[tauri::command]
fn demo_workbook() -> String {
    BASE64.encode(DEMO_WORKBOOK)
}

/// Native "Save as…" dialog (tauri-plugin-dialog) plus the actual write.
///
/// Blob-URL downloads (`<a download>`) don't work in the Tauri webview, so
/// chart and workbook exports call this instead. Returns the chosen path, or
/// `None` when the user cancelled the dialog.
///
/// Runs as an async command so `blocking_save_file` never executes on the
/// main thread (it would deadlock there).
#[tauri::command]
async fn save_file_dialog(app: AppHandle, request: SaveFileRequest) -> Result<Option<SavedFile>, String> {
    let bytes = if let Some(svg) = &request.svg {
        svg.clone().into_bytes()
    } else if let Some(encoded) = &request.base64 {
        BASE64.decode(encoded)
            .map_err(|e| format!("nieprawidłowe dane do zapisu: {e}"))?
    } else {
        return Err("nothing to save — pass svg or base64".into());
    };

    let exts: Vec<String> = request.extensions.unwrap_or_else(|| {
        let from_name = std::path::Path::new(&request.suggested_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if from_name.is_empty() { vec!["dat".into()] } else { vec![from_name] }
    });
    let filter_name = request
        .filter_name
        .unwrap_or_else(|| format!("{} files", exts[0].to_uppercase()));
    let ext_refs: Vec<&str> = exts.iter().map(String::as_str).collect();

    let chosen = app
        .dialog()
        .file()
        .add_filter(filter_name, &ext_refs)
        .set_file_name(&request.suggested_name)
        .blocking_save_file();

    let Some(path) = chosen else {
        return Ok(None); // user closed the dialog
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, &bytes).map_err(|e| format!("nie można zapisać {}: {e}", path.display()))?;
    Ok(Some(SavedFile { path: path.display().to_string() }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(holidays::HolidaysState::new())
        .invoke_handler(tauri::generate_handler![
            demo_workbook,
            save_file_dialog,
            holidays::holidays_get,
            holidays::holidays_load,
            holidays::holidays_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
