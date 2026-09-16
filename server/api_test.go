package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHolidaysAPIFlow(t *testing.T) {
	dir := t.TempDir()
	hf := filepath.Join(dir, "holidays.txt")
	if err := os.WriteFile(hf, []byte("2026-01-01;New Year\n06.01.2026;Epiphany"), 0644); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	registerAPI(mux, dir)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	post := func(path, body string) map[string]any {
		resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	get := func(path string) map[string]any {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	// 1. import from the browser: data lands in the settings
	res := post("/api/holidays/import", `{"holidays":[{"date":"2026-05-01","name":"Labour Day"}]}`)
	if res["count"].(float64) != 1 || res["saved"] != true {
		t.Fatalf("import failed: %+v", res)
	}

	// 2. boot with no path: cached holidays still served
	res = get("/api/holidays")
	if res["count"].(float64) != 1 {
		t.Fatalf("cached holidays lost: %+v", res)
	}

	// 3. configure a path: fresh read replaces the cache
	res = post("/api/settings", `{"holidaysPath":"`+hf+`"}`)
	if res["count"].(float64) != 2 {
		t.Fatalf("path load failed: %+v", res)
	}

	// 4. share unreachable: fall back to the last known holidays
	res = post("/api/settings", `{"holidaysPath":"\\\\gone\\holidays.txt"}`)
	if res["error"] == "" || res["count"].(float64) != 2 {
		t.Fatalf("expected cached fallback: %+v", res)
	}
	if got := res["holidays"].([]any); len(got) != 2 {
		t.Errorf("fallback holidays wrong: %+v", got)
	}
}
