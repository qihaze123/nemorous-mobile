package app

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "nemorous_session"
	sessionMaxAge = 365 * 24 * 60 * 60
	maxPairFails  = 8
)

type deviceRecord struct {
	Device
	Hash string `json:"hash"`
}

type deviceFile struct {
	Devices []deviceRecord `json:"devices"`
}

// deviceStore persists paired sessions as sha256(token) so a leaked file does
// not expose usable cookies.
type deviceStore struct {
	mu     sync.Mutex
	path   string
	byHash map[string]*deviceRecord
	byID   map[string]*deviceRecord
}

func newDeviceStore(dir string) (*deviceStore, error) {
	s := &deviceStore{
		path:   filepath.Join(dir, "devices.json"),
		byHash: map[string]*deviceRecord{},
		byID:   map[string]*deviceRecord{},
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var file deviceFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("读取设备列表失败: %w", err)
	}
	for i := range file.Devices {
		rec := file.Devices[i]
		if rec.Hash == "" || rec.ID == "" {
			continue
		}
		s.byHash[rec.Hash] = &rec
		s.byID[rec.ID] = &rec
	}
	return s, nil
}

func (s *deviceStore) saveLocked() error {
	file := deviceFile{Devices: make([]deviceRecord, 0, len(s.byID))}
	for _, rec := range s.byID {
		file.Devices = append(file.Devices, *rec)
	}
	sort.Slice(file.Devices, func(i, j int) bool { return file.Devices[i].CreatedAt > file.Devices[j].CreatedAt })
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func randomBytes(n int) []byte {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return buf
}

func hashSession(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *deviceStore) create(name string) (Device, string, error) {
	token := base64.RawURLEncoding.EncodeToString(randomBytes(32))
	now := time.Now().Unix()
	dev := Device{ID: hex.EncodeToString(randomBytes(6)), Name: name, CreatedAt: now, LastSeenAt: now}
	rec := &deviceRecord{Device: dev, Hash: hashSession(token)}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byHash[rec.Hash] = rec
	s.byID[rec.ID] = rec
	if err := s.saveLocked(); err != nil {
		delete(s.byHash, rec.Hash)
		delete(s.byID, rec.ID)
		return Device{}, "", err
	}
	return dev, token, nil
}

func (s *deviceStore) lookup(token string) (Device, bool) {
	if token == "" {
		return Device{}, false
	}
	hash := hashSession(token)
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byHash[hash]
	if !ok {
		return Device{}, false
	}
	now := time.Now().Unix()
	if now-rec.LastSeenAt > 60 {
		rec.LastSeenAt = now
		_ = s.saveLocked()
	}
	return rec.Device, true
}

func (s *deviceStore) list() []Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Device, 0, len(s.byID))
	for _, rec := range s.byID {
		out = append(out, rec.Device)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

func (s *deviceStore) revoke(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return false
	}
	delete(s.byID, id)
	delete(s.byHash, rec.Hash)
	_ = s.saveLocked()
	return true
}

// pairStore holds the short-lived pairing code and a per-IP failure budget.
type pairStore struct {
	mu       sync.Mutex
	code     string
	expires  time.Time
	ttl      time.Duration
	failures map[string][]time.Time
}

func newPairStore(code string, ttl time.Duration) (*pairStore, error) {
	if code == "" {
		code = newPairCode()
	} else if len(code) != 6 {
		return nil, errors.New("配对码必须是 6 位数字")
	}
	p := &pairStore{ttl: ttl, failures: map[string][]time.Time{}}
	p.mu.Lock()
	p.code = code
	p.expires = time.Now().Add(ttl)
	p.mu.Unlock()
	return p, nil
}

func newPairCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func (p *pairStore) ensureLocked(now time.Time) {
	if p.code == "" {
		p.code = newPairCode()
		p.expires = now.Add(p.ttl)
		return
	}
	if now.After(p.expires) {
		p.code = newPairCode()
		p.expires = now.Add(p.ttl)
		log.Printf("配对码已更新: %s（%s 前有效）", p.code, p.expires.Format("15:04"))
	}
}

func (p *pairStore) current() (string, time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ensureLocked(time.Now())
	return p.code, p.expires
}

// verify checks the code with a per-IP budget so six digits cannot be brute
// forced. It returns a user-facing reason on failure.
func (p *pairStore) verify(code, ip string) (bool, string) {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ensureLocked(now)
	windowStart := now.Add(-time.Minute)
	recent := p.failures[ip][:0]
	for _, t := range p.failures[ip] {
		if t.After(windowStart) {
			recent = append(recent, t)
		}
	}
	p.failures[ip] = recent
	if len(recent) >= maxPairFails {
		return false, "尝试次数过多，请一分钟后再试"
	}
	if subtle.ConstantTimeCompare([]byte(code), []byte(p.code)) != 1 {
		p.failures[ip] = append(recent, now)
		return false, "配对码不正确"
	}
	delete(p.failures, ip)
	return true, ""
}

// authInfo describes how a request authenticated.
type authInfo struct {
	Device *Device
	Cookie bool
}

// authenticate accepts a paired-device cookie or the optional API token.
func (a *App) authenticate(r *http.Request) (authInfo, bool) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if dev, ok := a.devices.lookup(c.Value); ok {
			return authInfo{Device: &dev, Cookie: true}, true
		}
	}
	if a.Token != "" {
		got := ""
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			got = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(a.Token)) == 1 && got != "" {
			return authInfo{}, true
		}
	}
	return authInfo{}, false
}

func (a *App) currentDeviceID(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if dev, ok := a.devices.lookup(c.Value); ok {
			return dev.ID
		}
	}
	return ""
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   sessionMaxAge,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   -1,
	})
}

// sameOrigin protects cookie-authenticated writes from cross-site requests.
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func sanitizeDeviceName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if runes := []rune(name); len(runes) > 40 {
		name = string(runes[:40])
	}
	if name == "" {
		return "未命名设备"
	}
	return name
}

/* ---------- pairing and device handlers ---------- */

func (a *App) handlePair(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	ok, reason := a.pairs.verify(strings.TrimSpace(req.Code), clientIP(r))
	if !ok {
		writeError(w, http.StatusUnauthorized, reason)
		return
	}
	dev, token, err := a.devices.create(sanitizeDeviceName(req.Name))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "无法保存设备")
		return
	}
	setSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, PairResponse{Device: dev})
}

func (a *App) handlePairCode(w http.ResponseWriter, r *http.Request) {
	code, expires := a.pairs.current()
	writeJSON(w, http.StatusOK, PairCodeResponse{Code: code, ExpiresAt: expires.Unix()})
}

func (a *App) handleDevices(w http.ResponseWriter, r *http.Request) {
	current := a.currentDeviceID(r)
	devices := a.devices.list()
	for i := range devices {
		devices[i].Current = devices[i].ID == current
	}
	writeJSON(w, http.StatusOK, DevicesResponse{Devices: devices, CurrentID: current})
}

func (a *App) handleRevokeDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	current := a.currentDeviceID(r)
	if !a.devices.revoke(id) {
		writeError(w, http.StatusNotFound, "设备不存在")
		return
	}
	if id == current {
		clearSessionCookie(w, r)
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
