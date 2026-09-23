//! Holidays — the piece the old Go desktop server (sdsp.exe) exposed over
//! HTTP, now folded into the Tauri app as Rust commands.
//!
//! A holidays file can live anywhere on disk (local drive or network share);
//! its path is persisted in the app's config dir so it flows in on every
//! start. The file is read fresh on every call, so edits made on the share
//! appear without restarting the planner. When the file cannot be read or
//! parsed, the last known good holidays are returned instead of nothing.
//!
//! Mirrors the former `/api/holidays` endpoints:
//!   GET  /api/holidays          -> holidays_get
//!   POST /api/holidays          -> holidays_load (persist path + read)
//!   POST /api/holidays/import   -> holidays_import (persist parsed holidays)

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// One non-working day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holiday {
    /// ISO date: YYYY-MM-DD
    pub date: String,
    #[serde(default)]
    pub name: String,
}

/// What the server used to persist between runs — kept in the same format
/// (sdsp-settings.json, camelCase keys) so an existing setup survives.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    holidays_path: String,
    /// Last known good holidays, used when the file is unreachable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    holidays: Vec<Holiday>,
}

/// Session state: the last successfully parsed holidays.
pub struct HolidaysState {
    cached: Mutex<Vec<Holiday>>,
}

impl HolidaysState {
    pub fn new() -> Self {
        Self {
            cached: Mutex::new(Vec::new()),
        }
    }

    fn cache(&self) -> MutexGuard<'_, Vec<Holiday>> {
        self.cached.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The JSON shape the frontend consumes (same keys the HTTP API returned).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidaysPayload {
    path: String,
    count: usize,
    holidays: Vec<Holiday>,
    error: String,
    /// "saved" — the list came from persisted settings, not from the file.
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'static str>,
}

fn payload_ok(path: &str, holidays: Vec<Holiday>, source: Option<&'static str>) -> HolidaysPayload {
    HolidaysPayload {
        count: holidays.len(),
        holidays,
        path: path.to_string(),
        error: String::new(),
        source,
    }
}

fn payload_error(
    path: &str,
    error: String,
    holidays: Vec<Holiday>,
    source: Option<&'static str>,
) -> HolidaysPayload {
    HolidaysPayload {
        count: holidays.len(),
        holidays,
        path: path.to_string(),
        error,
        source,
    }
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("sdsp-settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

/// Read the configured file fresh and fall back to the last known good
/// holidays when the file is missing, unreadable or malformed.
fn holidays_payload(app: &AppHandle, state: &HolidaysState, path: &str) -> HolidaysPayload {
    let cached = state.cache().clone();

    if path.is_empty() {
        if !cached.is_empty() {
            return payload_ok(path, cached, Some("saved"));
        }
        return payload_error(path, "no holidays file configured".into(), Vec::new(), None);
    }

    let data = match fs::read(path) {
        Ok(data) => data,
        Err(err) => {
            let msg = format!("cannot read file: {err}");
            if !cached.is_empty() {
                return payload_error(
                    path,
                    format!("{msg} — showing the last known holidays"),
                    cached,
                    Some("saved"),
                );
            }
            return payload_error(path, msg, Vec::new(), None);
        }
    };

    match parse_holidays(&data) {
        Ok(holidays) => {
            *state.cache() = holidays.clone();
            let mut settings = load_settings(app);
            settings.holidays = holidays.clone();
            let _ = save_settings(app, &settings);
            payload_ok(path, holidays, None)
        }
        Err(err) => {
            if !cached.is_empty() {
                return payload_error(
                    path,
                    format!("{err} — showing the last known holidays"),
                    cached,
                    Some("saved"),
                );
            }
            payload_error(path, err, Vec::new(), None)
        }
    }
}

/// Startup call: path + parsed holidays from the persisted settings.
#[tauri::command]
pub fn holidays_get(app: AppHandle, state: State<HolidaysState>) -> HolidaysPayload {
    let path = load_settings(&app).holidays_path;
    holidays_payload(&app, state.inner(), &path)
}

/// "Wczytaj ze ścieżki": persist the path and read the file in one call.
#[tauri::command]
pub fn holidays_load(app: AppHandle, state: State<HolidaysState>, path: String) -> HolidaysPayload {
    let mut settings = load_settings(&app);
    settings.holidays_path = path.clone();
    if let Err(err) = save_settings(&app, &settings) {
        return payload_error(
            &path,
            format!("could not save settings: {err}"),
            Vec::new(),
            None,
        );
    }
    holidays_payload(&app, state.inner(), &path)
}

/// "Importuj plik…": the browser-parsed holidays are pushed here so they
/// survive restarts even without a shared path.
#[tauri::command]
pub fn holidays_import(
    app: AppHandle,
    state: State<HolidaysState>,
    holidays: Vec<Holiday>,
) -> HolidaysPayload {
    let holidays = normalize_holidays(holidays);
    let mut settings = load_settings(&app);
    settings.holidays = holidays.clone();
    settings.holidays_path = String::new(); // imported data becomes the source
    match save_settings(&app, &settings) {
        Ok(()) => {
            *state.cache() = holidays.clone();
            payload_ok("", holidays, None)
        }
        Err(err) => payload_error(
            "",
            format!("could not save settings: {err}"),
            Vec::new(),
            None,
        ),
    }
}

/* --------------------------------------------------------------- parsing -- */

/// Understands two file formats, like the Go parser did:
///
///  1. JSON — a bare array [{"date":"YYYY-MM-DD","name":"..."}, ...] or
///     {"holidays":[...]}.
///  2. A simple line format for hand editing: one holiday per line,
///     `YYYY-MM-DD;Name` (comma or tab also work as separators, DD.MM.YYYY
///     and DD/MM/YYYY dates are accepted, `#`/`//` lines are comments).
pub fn parse_holidays(data: &[u8]) -> Result<Vec<Holiday>, String> {
    let text = String::from_utf8_lossy(data);
    let text = text.trim_start_matches('\u{feff}').trim();
    if text.starts_with('[') || text.starts_with('{') {
        parse_holidays_json(text)
    } else {
        parse_holidays_lines(text)
    }
}

fn parse_holidays_json(text: &str) -> Result<Vec<Holiday>, String> {
    if let Ok(list) = serde_json::from_str::<Vec<Holiday>>(text) {
        return Ok(normalize_holidays(list));
    }
    #[derive(Deserialize)]
    struct Wrapped {
        #[serde(default)]
        holidays: Vec<Holiday>,
    }
    if let Ok(wrapped) = serde_json::from_str::<Wrapped>(text) {
        return Ok(normalize_holidays(wrapped.holidays));
    }
    Err("not a valid holidays file".into())
}

fn parse_holidays_lines(text: &str) -> Result<Vec<Holiday>, String> {
    let mut out = Vec::new();
    for (n, raw) in text.split('\n').enumerate() {
        let line = raw.trim_end_matches('\r').trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let fields: Vec<&str> = line
            .split([';', ',', '\t'])
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .collect();
        if fields.is_empty() {
            continue;
        }
        let date = normalize_date(fields[0]).map_err(|e| format!("line {}: {e}", n + 1))?;
        let name = fields.get(1).copied().unwrap_or("").trim().to_string();
        out.push(Holiday { date, name });
    }
    Ok(normalize_holidays(out))
}

/// Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY and YYYY/MM/DD (the layouts the
/// Go parser understood) and returns a validated ISO date.
pub fn normalize_date(input: &str) -> Result<String, String> {
    let s = input.trim();
    let parts: Vec<&str> = if s.contains('-') {
        s.split('-').collect()
    } else if s.contains('.') {
        s.split('.').collect()
    } else if s.contains('/') {
        s.split('/').collect()
    } else {
        Vec::new()
    };
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
        return Err(format!("unrecognized date {input:?} (use YYYY-MM-DD)"));
    }

    // '-' means Y-M-D; '.' means D.M.Y; '/' is tried both ways (D/M/Y first,
    // like the Go layouts, then Y/M/D).
    let orders: &[&[usize]] = if s.contains('-') {
        &[&[0, 1, 2]]
    } else if s.contains('.') {
        &[&[2, 1, 0]]
    } else {
        &[&[2, 1, 0], &[0, 1, 2]]
    };

    for order in orders {
        let (y, m, d) = (parts[order[0]], parts[order[1]], parts[order[2]]);
        if let Some(iso) = build_iso(y, m, d) {
            return Ok(iso);
        }
    }
    Err(format!("unrecognized date {input:?} (use YYYY-MM-DD)"))
}

fn build_iso(year: &str, month: &str, day: &str) -> Option<String> {
    if year.len() != 4 || year.bytes().any(|b| !b.is_ascii_digit()) {
        return None;
    }
    let valid_int = |s: &str, max: u32| -> Option<u32> {
        if s.is_empty() || s.len() > 2 || s.bytes().any(|b| !b.is_ascii_digit()) {
            return None;
        }
        s.parse::<u32>().ok().filter(|v| (1..=max).contains(v))
    };
    let m = valid_int(month, 12)?;
    let d = valid_int(day, days_in_month(year.parse().ok()?, m))?;
    Some(format!("{year}-{m:02}-{d:02}"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Sorts by date and de-duplicates (first name wins) — same as the Go helper.
pub fn normalize_holidays(list: Vec<Holiday>) -> Vec<Holiday> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(list.len());
    for h in list {
        let date = match normalize_date(&h.date) {
            Ok(date) => date,
            Err(_) => continue,
        };
        if !seen.insert(date.clone()) {
            continue;
        }
        out.push(Holiday {
            date,
            name: h.name.trim().to_string(),
        });
    }
    out.sort_by(|a, b| a.date.cmp(&b.date));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_line_format() {
        let text = "# comment\n2026-01-01;Nowy Rok\n6.04.2026;Poniedziałek Wielkanocny\n// remark\n\n2026-05-01;;\n";
        let out = parse_holidays(text.as_bytes()).unwrap();
        assert_eq!(
            out,
            vec![
                Holiday {
                    date: "2026-01-01".into(),
                    name: "Nowy Rok".into()
                },
                Holiday {
                    date: "2026-04-06".into(),
                    name: "Poniedziałek Wielkanocny".into()
                },
                Holiday {
                    date: "2026-05-01".into(),
                    name: String::new()
                },
            ]
        );
    }

    #[test]
    fn parses_json_wrapped() {
        let json = r#"{"holidays":[{"date":"2026-12-25","name":"Boże Narodzenie"}]}"#;
        let out = parse_holidays(json.as_bytes()).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Boże Narodzenie");
    }

    #[test]
    fn dedupes_and_sorts() {
        let out = normalize_holidays(vec![
            Holiday {
                date: "2026-05-03".into(),
                name: "Święto Konstytucji".into(),
            },
            Holiday {
                date: "2026-05-01".into(),
                name: "Pierwsze wygrywa".into(),
            },
            Holiday {
                date: "01.05.2026".into(),
                name: "duplikat".into(),
            },
            Holiday {
                date: "nie--data".into(),
                name: "odrzucone".into(),
            },
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].date, "2026-05-01");
        assert_eq!(out[0].name, "Pierwsze wygrywa");
        assert_eq!(out[1].date, "2026-05-03");
    }

    #[test]
    fn rejects_bad_dates_with_line_number() {
        let err = parse_holidays(b"2026-01-01\n32.01.2026").unwrap_err();
        assert!(err.contains("line 2"), "got: {err}");
    }

    #[test]
    fn leap_years() {
        assert_eq!(normalize_date("29.02.2024").unwrap(), "2024-02-29");
        assert!(normalize_date("29.02.2025").is_err());
    }

    #[test]
    fn slash_dates_work_both_ways() {
        assert_eq!(normalize_date("25/12/2026").unwrap(), "2026-12-25");
        assert_eq!(normalize_date("2026/12/25").unwrap(), "2026-12-25");
    }
}

