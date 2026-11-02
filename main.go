// Command nemorous-mobile serves the Nemorous mobile console: a JSON git API
// plus the embedded mobile web client, in one binary.
package main

import (
	"context"
	"embed"
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
	"nemorous-mobile/internal/updater"
)

//go:embed all:web/dist
var embeddedWeb embed.FS

// updateRepo is injected at release time with:
//
//	-ldflags "-X main.updateRepo=owner/repo"
var updateRepo = ""

func main() {
	workspace := flag.String("workspace", defaultWorkspace(), "多仓工作区目录")
	addr := flag.String("addr", ":8787", "监听地址，例如 :8787")
	token := flag.String("token", envOr("NEMOROUS_TOKEN", ""), "可选的 API Bearer 令牌（脚本使用）；手机通过配对码连接")
	requireHTTPS := flag.Bool("require-https", true, "只接受 HTTPS（本机回环除外）；设为 false 允许局域网 HTTP")
	autoUpdate := flag.Bool("auto-update", true, "自动检查并安装签名更新；更新仓库为空时禁用")
	updateInterval := flag.Duration("update-interval", time.Hour, "自动检查间隔（最小 5m，最大 24h）")
	repo := flag.String("update-repo", updateRepo, "更新仓库 owner/repo；发布构建会自动注入")
	stateDir := flag.String("state", "", "状态目录（配对设备），默认 os.UserConfigDir()/nemorous-mobile")
	webDir := flag.String("web", "", "开发模式：从该目录提供前端静态文件")
	flag.Parse()

	core, err := app.NewWithOptions(*workspace, app.Options{Token: *token, StateDir: *stateDir})
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
		Handler:           logRequests(app.HTTPSOnly(*requireHTTPS, mux)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	exe, _ := os.Executable()
	updater.CleanupOld(exe)
	if *autoUpdate && strings.TrimSpace(*repo) != "" {
		go updateLoop(*repo, exe, *updateInterval)
	} else if *autoUpdate {
		log.Printf("自动更新未启用：未配置 -update-repo")
	}

	code, expires := core.PairCode()
	fmt.Printf("Nemorous Mobile %s\n", app.Version)
	fmt.Printf("工作区: %s（%d 个仓库）\n", core.Root, len(core.Repos()))
	fmt.Printf("配对码: %s（%s 前有效）\n", code, expires.Format("15:04"))
	if *requireHTTPS {
		port := *addr
		if _, p, err := net.SplitHostPort(*addr); err == nil {
			port = p
		}
		fmt.Println("安全: 默认只接受 HTTPS；本机回环除外。手机请通过 Tailscale Serve 或反向代理访问。")
		fmt.Printf("本机调试: http://localhost:%s/?pair=%s\n", port, code)
	} else {
		fmt.Println("注意: 已关闭 HTTPS 强制，局域网 HTTP 可用；不要暴露到公网。")
		for _, u := range urls(*addr, code) {
			fmt.Printf("手机打开: %s\n", u)
		}
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

func webRoot(devDir string) (fs.FS, error) {
	if devDir != "" {
		return os.DirFS(devDir), nil
	}
	return fs.Sub(embeddedWeb, "web/dist")
}

// urls lists the LAN URLs a phone can reach.
func urls(addr, code string) []string {
	port := addr
	if host, p, err := net.SplitHostPort(addr); err == nil {
		if host == "" || host == "0.0.0.0" || host == "::" {
			port = p
			return lanURLs(p, code)
		}
		return []string{fmt.Sprintf("http://%s/?pair=%s", net.JoinHostPort(host, p), code)}
	}
	return []string{fmt.Sprintf("http://localhost%s/?pair=%s", port, code)}
}

func lanURLs(port, code string) []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return []string{fmt.Sprintf("http://localhost:%s/?pair=%s", port, code)}
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
		out = append(out, fmt.Sprintf("http://%s/?pair=%s", net.JoinHostPort(ip.String(), port), code))
	}
	if len(out) == 0 {
		out = append(out, fmt.Sprintf("http://localhost:%s/?pair=%s", port, code))
	}
	return out
}

// staticHandler serves the embedded client with an SPA fallback.
func staticHandler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app.SetSecurityHeaders(w)
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

func updateLoop(repo, exe string, interval time.Duration) {
	const initialDelay = 60 * time.Second
	if interval < 5*time.Minute {
		interval = 5 * time.Minute
	} else if interval > 24*time.Hour {
		interval = 24 * time.Hour
	}
	timer := time.NewTimer(initialDelay)
	defer timer.Stop()
	manager := &updater.Manager{Repo: repo, PublicKey: updater.PublicKey}
	for {
		select {
		case <-timer.C:
		}
		rel, err := manager.Check(context.Background(), app.Version)
		if err != nil {
			log.Printf("检查更新失败: %v", err)
		} else if rel != nil {
			log.Printf("发现新版本 %s，开始下载", rel.Version)
			newPath, err := manager.Download(context.Background(), rel, filepath.Dir(exe))
			if err != nil {
				log.Printf("下载更新失败: %v", err)
			} else if err := updater.ApplyAndRestart(exe, newPath); err != nil {
				log.Printf("安装更新失败: %v", err)
			}
		}
		timer.Reset(interval)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
