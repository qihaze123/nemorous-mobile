package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	// updateAPITimeout bounds release metadata and manifest requests.
	updateAPITimeout = 45 * time.Second
	maxBinarySize    = 256 << 20
)

// Release is a verified update ready to download.
type Release struct {
	Version  string
	Manifest Manifest
	Asset    Asset
	URL      string
}

// Manager checks signed GitHub releases and downloads pinned binaries.
type Manager struct {
	Repo      string
	PublicKey ed25519.PublicKey
	// ReleaseBase overrides the download base for tests. Production uses the
	// /releases/latest/download/ path, avoiding unauthenticated API rate limits.
	ReleaseBase string
	Client      *http.Client
}

// Check downloads the latest signed manifest and returns a newer build for
// this OS/architecture. It returns nil when the latest release is not newer.
func (m *Manager) Check(ctx context.Context, current string) (*Release, error) {
	if strings.TrimSpace(m.Repo) == "" {
		return nil, errors.New("未配置更新仓库")
	}
	base := strings.TrimRight(m.ReleaseBase, "/")
	if base == "" {
		base = "https://github.com/" + strings.Trim(m.Repo, "/") + "/releases/latest/download"
	}
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: updateAPITimeout}
	}
	raw, err := getBytes(ctx, client, base+"/"+ManifestName, maxManifestSize)
	if err != nil {
		return nil, err
	}
	sig, err := getBytes(ctx, client, base+"/"+SignatureName, maxManifestSize)
	if err != nil {
		return nil, err
	}
	manifest, err := Verify(raw, sig, m.PublicKey)
	if err != nil {
		return nil, err
	}
	if !VersionLess(current, manifest.Version) {
		return nil, nil
	}
	key := AssetKey(runtime.GOOS, runtime.GOARCH)
	a, ok := manifest.Assets[key]
	if !ok {
		return nil, fmt.Errorf("该版本没有 %s 构建", key)
	}
	return &Release{
		Version:  manifest.Version,
		Manifest: manifest,
		Asset:    a,
		URL:      base + "/" + a.Name,
	}, nil
}

// Download writes the verified binary into dir. The directory must be on the
// same filesystem as the running executable for the final atomic rename.
func (m *Manager) Download(ctx context.Context, rel *Release, dir string) (string, error) {
	if rel == nil {
		return "", errors.New("没有可下载的更新")
	}
	if rel.Asset.Size <= 0 || rel.Asset.Size > maxBinarySize {
		return "", errors.New("更新文件大小异常")
	}
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rel.URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "nemorous-mobile-updater")
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载更新失败: HTTP %d", res.StatusCode)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, ".nemorous-update-*")
	if err != nil {
		return "", err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(res.Body, rel.Asset.Size+1))
	closeErr := f.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if n != rel.Asset.Size {
		return "", fmt.Errorf("更新文件大小不符: 期望 %d，实际 %d", rel.Asset.Size, n)
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(sum, rel.Asset.SHA256) {
		return "", errors.New("更新文件 SHA-256 校验失败")
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		return "", err
	}
	ok = true
	return tmp, nil
}

func getBytes(ctx context.Context, client *http.Client, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nemorous-mobile-updater")
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("更新请求失败: HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("更新响应过大")
	}
	return data, nil
}

// CleanupOld removes the .old binary left by a successful self-update.
func CleanupOld(exePath string) {
	if exePath != "" {
		_ = os.Remove(filepath.Clean(exePath) + ".old")
	}
}
