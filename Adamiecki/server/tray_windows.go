//go:build windows

package main

import (
	"github.com/getlantern/systray"
)

type trayCallbacks struct {
	Icon   []byte
	URL    string
	OnQuit func()
}

// trayStart runs the tray icon until the user picks Quit.
func trayStart(cb trayCallbacks) {
	systray.Run(func() {
		systray.SetIcon(cb.Icon)
		systray.SetTooltip("Cadence — single-machine sequence planner")
		mOpen := systray.AddMenuItem("Open planner in browser", "Opens "+cb.URL)
		mOpen.Enable()
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Stop the planner and remove the tray icon")

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					openBrowser(cb.URL)
				case <-mQuit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, func() {
		if cb.OnQuit != nil {
			cb.OnQuit()
		}
	})
}
