// Command signrelease builds a signed release manifest for the updater.
//
// The private key is intentionally kept outside the repository. The public key
// is embedded in the binary (internal/updater/keys.go) so an attacker who can
// replace a GitHub release still cannot make a client accept it.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"nemorous-mobile/internal/updater"
)

type asset struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type manifest struct {
	Version string           `json:"version"`
	Assets  map[string]asset `json:"assets"`
}

func main() {
	dir := flag.String("dir", "", "directory containing nemorous-mobile-* binaries")
	version := flag.String("version", "", "release version, for example 0.4.2")
	keyPath := flag.String("key", defaultKeyPath(), "Ed25519 private key file")
	generate := flag.Bool("generate", false, "generate a new private key and print the public key")
	pubout := flag.String("pubout", "", "write the embedded public key to this Go file")
	verify := flag.String("verify", "", "verify a signed manifest directory using the embedded public key")
	flag.Parse()

	if *generate {
		if err := generateKey(*keyPath); err != nil {
			fatalf("%v", err)
		}
		return
	}
	if *pubout != "" {
		if err := writePublicKey(*keyPath, *pubout); err != nil {
			fatalf("%v", err)
		}
		return
	}
	if *verify != "" {
		if err := verifyManifest(*verify); err != nil {
			fatalf("%v", err)
		}
		return
	}
	if *dir == "" || *version == "" {
		fatalf("-dir and -version are required")
	}
	if err := sign(*dir, *version, *keyPath); err != nil {
		fatalf("%v", err)
	}
}

func defaultKeyPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "release.key"
	}
	return filepath.Join(dir, "nemorous-mobile", "release.key")
}

func generateKey(path string) error {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(priv.Seed())+"\n"), 0o600); err != nil {
		return err
	}
	fmt.Printf("private key: %s\n", path)
	fmt.Printf("public key: %s\n", base64.StdEncoding.EncodeToString(pub))
	fmt.Println("Back up the private key; every future release must use the same key.")
	return nil
}

func sign(dir, version, keyPath string) error {
	priv, err := loadKey(keyPath)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	assets := map[string]asset{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "nemorous-mobile-") || strings.HasSuffix(entry.Name(), ".zip") {
			continue
		}
		name := entry.Name()
		platform := strings.TrimPrefix(name, "nemorous-mobile-")
		parts := strings.SplitN(platform, "-", 2)
		if len(parts) != 2 {
			continue
		}
		path := filepath.Join(dir, name)
		sum, size, err := fileHash(path)
		if err != nil {
			return err
		}
		assets[parts[0]+"/"+parts[1]] = asset{Name: name, SHA256: sum, Size: size}
	}
	if len(assets) == 0 {
		return fmt.Errorf("no nemorous-mobile-* binaries in %s", dir)
	}
	keys := make([]string, 0, len(assets))
	for key := range assets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Printf("%s  %s\n", assets[key].SHA256, assets[key].Name)
	}

	body, err := json.MarshalIndent(manifest{Version: version, Assets: assets}, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	sig := ed25519.Sign(priv, body)
	if err := os.WriteFile(filepath.Join(dir, "release-manifest.json"), body, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "release-manifest.json.sig"), []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644); err != nil {
		return err
	}
	fmt.Printf("signed manifest: %s\n", filepath.Join(dir, "release-manifest.json"))
	return nil
}

func writePublicKey(keyPath, outPath string) error {
	priv, err := loadKey(keyPath)
	if err != nil {
		return err
	}
	body := fmt.Sprintf("package updater\n\nimport \"crypto/ed25519\"\n\n// PublicKey is embedded at release time. The matching private key never\n// enters the repository; rotate both together if it is lost.\nvar PublicKey = ed25519.PublicKey{%s}\n", byteList(priv.Public().(ed25519.PublicKey)))
	return os.WriteFile(outPath, []byte(body), 0o644)
}

func byteList(key []byte) string {
	parts := make([]string, len(key))
	for i, b := range key {
		parts[i] = fmt.Sprintf("0x%02x", b)
	}
	return strings.Join(parts, ", ")
}

func verifyManifest(dir string) error {
	raw, err := os.ReadFile(filepath.Join(dir, "release-manifest.json"))
	if err != nil {
		return err
	}
	sig, err := os.ReadFile(filepath.Join(dir, "release-manifest.json.sig"))
	if err != nil {
		return err
	}
	m, err := updater.Verify(raw, sig, updater.PublicKey)
	if err != nil {
		return err
	}
	fmt.Printf("verified manifest %s with %d assets\n", m.Version, len(m.Assets))
	return nil
}

func loadKey(path string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read release key: %w", err)
	}
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
	if err != nil {
		return nil, fmt.Errorf("decode release key: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("release key must be a base64 Ed25519 seed")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

func fileHash(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
