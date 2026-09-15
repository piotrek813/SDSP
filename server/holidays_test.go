package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseHolidaysLines(t *testing.T) {
	got, err := parseHolidays([]byte(
		"# holidays 2026\n" +
			"2026-01-01;New Year\n" +
			"06.01.2026;Epiphany\n" +
			"2026-04-06,Easter Monday\n" +
			"\n" +
			"2026-05-01\n" +
			"2026-01-01;duplicate ignored\n"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 holidays, got %d: %+v", len(got), got)
	}
	if got[0].Date != "2026-01-01" || got[0].Name != "New Year" {
		t.Errorf("first entry wrong: %+v", got[0])
	}
	if got[1].Date != "2026-01-06" || got[1].Name != "Epiphany" { // DD.MM.YYYY accepted + sorted
		t.Errorf("second entry wrong: %+v", got[1])
	}
	if got[3].Name != "" {
		t.Errorf("date-only entry should have empty name: %+v", got[3])
	}
}

func TestParseHolidaysJSON(t *testing.T) {
	for _, body := range []string{
		`[{"date":"2026-01-01","name":"New Year"}]`,
		`{"holidays":[{"date":"2026-01-01","name":"New Year"}]}`,
	} {
		got, err := parseHolidays([]byte(body))
		if err != nil {
			t.Fatalf("parse %s: %v", body, err)
		}
		if len(got) != 1 || got[0].Date != "2026-01-01" || got[0].Name != "New Year" {
			t.Errorf("wrong result: %+v", got)
		}
	}
}

func TestParseHolidaysRejectsBadDates(t *testing.T) {
	if _, err := parseHolidays([]byte("not-a-date;oops")); err == nil {
		t.Fatal("expected an error for an unparseable line")
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := saveSettings(dir, Settings{HolidaysPath: `\\files\planning\holidays.txt`}); err != nil {
		t.Fatalf("save: %v", err)
	}
	got := loadSettings(dir)
	if got.HolidaysPath != `\\files\planning\holidays.txt` {
		t.Errorf("round trip lost the path: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "sdsp-settings.json")); err != nil {
		t.Errorf("settings file missing: %v", err)
	}
}
