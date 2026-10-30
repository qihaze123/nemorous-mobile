// Command nemorous-mobile serves the Nemorous mobile console: a JSON git API
// plus the embedded mobile web client, in one binary.
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"nemorous-mobile/internal/app"
)

//go:embed all:web/dist
var embeddedWeb embed.FS

func main() {
	workspace := flag.String("workspace", defaultWorkspace(), "多仓工作区目录")
	addr := flag.String("addr", ":8787", "监听地址，例如 :8787")
	token := flag.String("token", "", "访问令牌；留空则自动生成并保存")
	webDir := flag.String("web", "", "开发模式：从该目录提供前端静态文件")
	flag.Parse()

	tok, err := resolveToken(*token)
	if err != nil {
		log.Fatal(err)
	}
	core, err := app.New(*workspace, tok)
	if err != nil {
		log.Fatal(err)
	}

	web, err := webRoot(*webDir)
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", core.APIHandler())
	mux.Handle("/", staticHandler(web))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	fmt.Printf("Nemorous Mobile %s\n", app.Version)
	fmt.Printf("工作区: %s（%d 个仓库）\n", core.Root, len(core.Repos()))
	fmt.Printf("令牌:   %s\n", tok)
	for _, u := range urls(*addr, tok) {
		fmt.Printf("手机打开: %s\n", u)
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func defaultWorkspace() string {
	if v := os.Getenv("NEMOROUS_WORKSPACE"); v != "" {
		return v
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

// resolveToken picks the CLI/env token, then the saved pairing token, then a
// fresh one persisted with 0600 permissions.
func resolveToken(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	if v := os.Getenv("NEMOROUS_TOKEN"); v != "" {
		return v, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	file := filepath.Join(dir, "nemorous-mobile", "token")
	if data, err := os.ReadFile(file); err == nil {
		if t := strings.TrimSpace(string(data)); t != "" {
			return t, nil
		}
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(file, []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	return token, nil
}

func webRoot(devDir string) (fs.FS, error) {
	if devDir != "" {
		return os.DirFS(devDir), nil
	}
	return fs.Sub(embeddedWeb, "web/dist")
}

// urls lists the LAN URLs a phone can reach.
func urls(addr, token string) []string {
	port := addr
	if host, p, err := net.SplitHostPort(addr); err == nil {
		if host == "" || host == "0.0.0.0" || host == "::" {
			port = p
			return lanURLs(p, token)
		}
		return []string{fmt.Sprintf("http://%s/?token=%s", net.JoinHostPort(host, p), token)}
	}
	return []string{fmt.Sprintf("http://localhost%s/?token=%s", port, token)}
}

func lanURLs(port, token string) []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return []string{fmt.Sprintf("http://localhost:%s/?token=%s", port, token)}
	}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		ip := ipnet.IP.To4()
		if ip == nil {
			continue
		}
		out = append(out, fmt.Sprintf("http://%s/?token=%s", net.JoinHostPort(ip.String(), port), token))
	}
	if len(out) == 0 {
		out = append(out, fmt.Sprintf("http://localhost:%s/?token=%s", port, token))
	}
	return out
}

// staticHandler serves the embedded client with an SPA fallback.
func staticHandler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		name := strings.TrimPrefix(clean, "/")
		if name == "" {
			name = "index.html"
		}
		if !serveFile(w, r, fsys, name) {
			if !serveFile(w, r, fsys, "index.html") {
				http.NotFound(w, r)
			}
		}
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	if err != nil || info.IsDir() {
		return false
	}
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return false
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), strings.NewReader(string(data)))
	return true
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			start := time.Now()
			next.ServeHTTP(w, r)
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
			return
		}
		next.ServeHTTP(w, r)
	})
}
