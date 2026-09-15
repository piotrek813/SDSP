package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Holiday is one non-working day.
type Holiday struct {
	Date string `json:"date"` // ISO: YYYY-MM-DD
	Name string `json:"name,omitempty"`
}

// parseHolidays understands two file formats:
//
//  1. JSON — either a bare array [{"date":"2006-01-02","name":"..."}, ...]
//     or {"holidays":[...]}.
//  2. A simple line format for hand editing: one holiday per line,
//     `YYYY-MM-DD;Name` (comma or tab also work as separators, DD.MM.YYYY
//     and DD/MM/YYYY dates are accepted, lines starting with # are comments).
func parseHolidays(data []byte) ([]Holiday, error) {
	text := strings.TrimSpace(strings.TrimPrefix(string(data), "\ufeff"))
	if strings.HasPrefix(text, "[") || strings.HasPrefix(text, "{") {
		return parseHolidaysJSON([]byte(text))
	}
	return parseHolidaysLines(text)
}

func parseHolidaysJSON(data []byte) ([]Holiday, error) {
	var out []Holiday
	if err := json.Unmarshal(data, &out); err != nil {
		var wrapped struct {
			Holidays []Holiday `json:"holidays"`
		}
		if err2 := json.Unmarshal(data, &wrapped); err2 != nil {
			return nil, fmt.Errorf("not a valid holidays file: %v", err)
		}
		out = wrapped.Holidays
	}
	return normalizeHolidays(out), nil
}

func parseHolidaysLines(text string) ([]Holiday, error) {
	var out []Holiday
	for n, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		fields := strings.FieldsFunc(line, func(r rune) bool { return r == ';' || r == ',' || r == '\t' })
		if len(fields) == 0 {
			continue
		}
		date, err := normalizeHolidayDate(fields[0])
		if err != nil {
			return nil, fmt.Errorf("line %d: %v", n+1, err)
		}
		name := ""
		if len(fields) > 1 {
			name = strings.TrimSpace(fields[1])
		}
		out = append(out, Holiday{Date: date, Name: name})
	}
	return normalizeHolidays(out), nil
}

func normalizeHolidayDate(s string) (string, error) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"2006-01-02", "02.01.2006", "02/01/2006", "2006/01/02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02"), nil
		}
	}
	return "", fmt.Errorf("unrecognized date %q (use YYYY-MM-DD)", s)
}

// normalizeHolidays sorts by date and de-duplicates (first name wins).
func normalizeHolidays(in []Holiday) []Holiday {
	seen := map[string]bool{}
	out := make([]Holiday, 0, len(in))
	for _, h := range in {
		date, err := normalizeHolidayDate(h.Date)
		if err != nil || seen[date] {
			continue
		}
		seen[date] = true
		out = append(out, Holiday{Date: date, Name: strings.TrimSpace(h.Name)})
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Date < out[j-1].Date; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
