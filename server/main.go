// Cadence planner — serves the app on localhost, opens the default browser
// automatically and lives in the system tray (Windows) until quit.
package main

import (
	"flag"
	"fmt"
	_ "embed"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

//go:embed assets/icon.ico
var trayIcon []byte

func main() {
	port := flag.String("port", "", "TCP port to listen on (default 3000)")
	noOpen := flag.Bool("no-open", false, "do not open the browser automatically")
	noTray := flag.Bool("no-tray", false, "run without the tray icon")
	flag.Parse()

	p := *port
	if p == "" && flag.NArg() > 0 {
		p = flag.Arg(0) // start.bat style: sdsp.exe 3000
	}
	if p == "" {
		p = "3000"
	}

	root := appRoot()
	http.Handle("/", http.FileServer(http.Dir(root)))

	url := "http://127.0.0.1:" + p
	ln, err := net.Listen("tcp", "127.0.0.1:"+p)
	if err != nil {
		// most likely an instance is already running — just bring it up
		logf("port %s busy (%v) — opening the running planner", p, err)
		if !*noOpen {
			openBrowser(url)
		}
		return
	}

	srv := &http.Server{}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			logf("server stopped: %v", err)
			os.Exit(1)
		}
	}()
	logf("Cadence planner listening on %s (serving %s)", url, root)

	if !*noOpen {
		go func() {
			time.Sleep(300 * time.Millisecond) // let the server accept first
			openBrowser(url)
		}()
	}

	done := make(chan struct{})
	if *noTray {
		<-done // run until killed
		return
	}
	trayStart(trayCallbacks{
		Icon:   trayIcon,
		URL:    url,
		OnQuit: func() { close(done) },
	})
	<-done
}

// appRoot finds the directory holding index.html: the working directory, the
// folder above the executable (repo root when the exe lives in server/), or
// the executable's own folder.
func appRoot() string {
	if _, err := os.Stat(filepath.Join("index.html")); err == nil {
		return "."
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if resolved, err := filepath.EvalSymlinks(dir); err == nil {
			dir = resolved
		}
		for _, candidate := range []string{
			filepath.Join(dir, ".."),
			dir,
		} {
			if _, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil {
				return candidate
			}
		}
	}
	return "."
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		logf("open browser: %v", err)
	}
}

// logf writes to stderr and — because a -H windowsgui build has no console —
// also appends to sdsp.log next to the working directory.
func logf(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	log.Println(line)
	if f, err := os.OpenFile("sdsp.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		fmt.Fprintln(f, time.Now().Format("2006-01-02 15:04:05"), line)
		f.Close()
	}
}
