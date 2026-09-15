package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings is the small piece of configuration the desktop server persists
// between runs (currently: where the holidays file lives).
type Settings struct {
	HolidaysPath string `json:"holidaysPath"`
}

func settingsFile(root string) string {
	return filepath.Join(root, "sdsp-settings.json")
}

func loadSettings(root string) Settings {
	s := Settings{}
	data, err := os.ReadFile(settingsFile(root))
	if err == nil {
		_ = json.Unmarshal(data, &s)
	}
	return s
}

func saveSettings(root string, s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsFile(root), data, 0644)
}
