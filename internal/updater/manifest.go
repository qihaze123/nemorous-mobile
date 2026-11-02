package updater

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	ManifestName    = "release-manifest.json"
	SignatureName   = "release-manifest.json.sig"
	maxManifestSize = 1 << 20
)

// Asset describes one downloadable binary in a signed release manifest.
type Asset struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Manifest is the signed release description. The signature covers the exact
// manifest bytes, which in turn pin every binary by SHA-256 and size.
type Manifest struct {
	Version string           `json:"version"`
	Assets  map[string]Asset `json:"assets"`
}

// Verify parses and verifies a detached Ed25519 manifest signature.
func Verify(raw, sig []byte, pub ed25519.PublicKey) (Manifest, error) {
	var m Manifest
	if len(pub) != ed25519.PublicKeySize {
		return m, errors.New("update public key is invalid")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil {
		return m, fmt.Errorf("decode manifest signature: %w", err)
	}
	if !ed25519.Verify(pub, raw, decoded) {
		return m, errors.New("更新清单签名无效")
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, fmt.Errorf("parse update manifest: %w", err)
	}
	if strings.TrimSpace(m.Version) == "" || len(m.Assets) == 0 {
		return m, errors.New("更新清单缺少版本或文件")
	}
	for key, a := range m.Assets {
		if a.Name == "" || len(a.SHA256) != 64 || a.Size <= 0 {
			return m, fmt.Errorf("更新清单中的 %s 无效", key)
		}
	}
	return m, nil
}

// AssetKey identifies a build in the manifest, for example darwin/arm64.
func AssetKey(goos, goarch string) string {
	return goos + "/" + goarch
}

// VersionLess reports whether semver-like version a is older than b.
func VersionLess(a, b string) bool {
	as := versionParts(a)
	bs := versionParts(b)
	for i := 0; i < len(as) || i < len(bs); i++ {
		var av, bv int
		if i < len(as) {
			av = as[i]
		}
		if i < len(bs) {
			bv = bs[i]
		}
		if av != bv {
			return av < bv
		}
	}
	return false
}

func versionParts(v string) []int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		n := 0
		for _, r := range part {
			if r < '0' || r > '9' {
				break
			}
			n = n*10 + int(r-'0')
		}
		out = append(out, n)
	}
	return out
}

// SameVersion compares normalized versions without treating v1.2 as newer
// than 1.2.0.
func SameVersion(a, b string) bool {
	as := versionParts(a)
	bs := versionParts(b)
	for i := 0; i < len(as) || i < len(bs); i++ {
		var av, bv int
		if i < len(as) {
			av = as[i]
		}
		if i < len(bs) {
			bv = bs[i]
		}
		if av != bv {
			return false
		}
	}
	return true
}
