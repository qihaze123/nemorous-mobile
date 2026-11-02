package app

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// apiRatePerMinute is deliberately generous: a normal mobile session opens a
// handful of endpoints and a Git operation is one request. The limit is meant
// to stop scripted floods, not to shape interactive use.
const (
	apiRatePerMinute = 600
	apiBurst         = 120
)

type rateBucket struct {
	tokens float64
	last   time.Time
}

// rateLimiter is a per-session / per-IP token bucket. It uses the session
// cookie when present so devices behind one reverse proxy do not share a
// budget; unpaired requests fall back to the client IP.
type rateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*rateBucket
	perSecond float64
	burst     float64
	lastSweep time.Time
}

func newRateLimiter(perMinute, burst int) *rateLimiter {
	return &rateLimiter{
		buckets:   map[string]*rateBucket{},
		perSecond: float64(perMinute) / 60,
		burst:     float64(burst),
	}
}

func (l *rateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.lastSweep.IsZero() || now.Sub(l.lastSweep) > 10*time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
		l.lastSweep = now
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &rateBucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.perSecond
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "ip:" + clientIP(r)
		if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
			key = "session:" + hashSession(c.Value)
		}
		if !l.allow(key, time.Now()) {
			w.Header().Set("Retry-After", "1")
			writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// HTTPSOnly rejects non-TLS requests from outside the machine. Loopback stays
// available for local debugging and for Tailscale Serve / a same-host reverse
// proxy, which terminate TLS and forward to 127.0.0.1.
func HTTPSOnly(enabled bool, next http.Handler) http.Handler {
	if !enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSecureRequest(r) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "默认只接受 HTTPS。请通过 Tailscale Serve 或反向代理访问；本机调试可使用 http://localhost。", http.StatusUpgradeRequired)
	})
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return true
		}
	}
	return false
}
