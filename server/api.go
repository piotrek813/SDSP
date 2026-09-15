package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
)

// The desktop server exposes a tiny API so the planner can read a holidays
// file from anywhere on disk (local drive or network share) and remember the
// file's location between runs.
//
//   GET  /api/settings   -> {"holidaysPath": "..."}
//   POST /api/settings   <- {"holidaysPath": "..."}   (persists it)
//   GET  /api/holidays   -> {"path","count","holidays":[...],"error"}
//   POST /api/holidays   <- {"holidaysPath": "..."}   (persist + read in one call)

var (
	settingsMu  sync.Mutex
	settingsCfg = Settings{}
)

func registerAPI(root string) {
	settingsCfg = loadSettings(root)

	http.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]any{"holidaysPath": settingsCfg.HolidaysPath})
		case http.MethodPost:
			var body struct {
				HolidaysPath string `json:"holidaysPath"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			settingsMu.Lock()
			settingsCfg.HolidaysPath = body.HolidaysPath
			err := saveSettings(root, settingsCfg)
			path := settingsCfg.HolidaysPath
			settingsMu.Unlock()
			if err != nil {
				writeJSON(w, map[string]any{"path": path, "count": 0, "holidays": []Holiday{}, "error": "could not save settings: " + err.Error()})
				return
			}
			writeJSON(w, holidaysPayload(root, path))
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	http.HandleFunc("/api/holidays", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var body struct {
				HolidaysPath string `json:"holidaysPath"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.HolidaysPath != "" {
				settingsMu.Lock()
				settingsCfg.HolidaysPath = body.HolidaysPath
				_ = saveSettings(root, settingsCfg)
				path := settingsCfg.HolidaysPath
				settingsMu.Unlock()
				writeJSON(w, holidaysPayload(root, path))
				return
			}
		}
		settingsMu.Lock()
		path := settingsCfg.HolidaysPath
		settingsMu.Unlock()
		writeJSON(w, holidaysPayload(root, path))
	})
}

// holidaysPayload reads the configured file fresh on every call, so edits made
// on a network share flow in without restarting the planner.
func holidaysPayload(root, path string) map[string]any {
	if path == "" {
		return map[string]any{"path": "", "count": 0, "holidays": []Holiday{}, "error": "no holidays file configured"}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]any{"path": path, "count": 0, "holidays": []Holiday{}, "error": "cannot read file: " + err.Error()}
	}
	holidays, err := parseHolidays(data)
	if err != nil {
		return map[string]any{"path": path, "count": 0, "holidays": []Holiday{}, "error": err.Error()}
	}
	return map[string]any{"path": path, "count": len(holidays), "holidays": holidays, "error": ""}
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
