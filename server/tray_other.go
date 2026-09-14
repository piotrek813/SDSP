//go:build !windows

package main

// trayCallbacks is unused on this platform — the server just runs in the
// foreground and the browser opens automatically.
type trayCallbacks struct {
	Icon   []byte
	URL    string
	OnQuit func()
}

func trayStart(cb trayCallbacks) {}
