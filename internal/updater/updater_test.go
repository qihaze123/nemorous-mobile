package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
)

func TestVersionOrdering(t *testing.T) {
	if !VersionLess("0.4.1", "0.4.2") {
		t.Fatal("0.4.1 should be older than 0.4.2")
	}
	if VersionLess("0.4.2", "0.4.2") {
		t.Fatal("same version must not be newer")
	}
	if !SameVersion("v0.4.2", "0.4.2.0") {
		t.Fatal("normalized versions should match")
	}
}

func TestVerifyRejectsTampering(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"version":"0.4.2","assets":{"darwin/arm64":{"name":"x","sha256":"` + repeatHex(64) + `","size":1}}}`)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, raw))
	if _, err := Verify(raw, []byte(sig), pub); err != nil {
		t.Fatalf("valid manifest: %v", err)
	}
	tampered := append([]byte(nil), raw...)
	tampered[len(tampered)-2] = '2'
	if _, err := Verify(tampered, []byte(sig), pub); err == nil {
		t.Fatal("tampered manifest was accepted")
	}
}

func repeatHex(n int) string {
	out := make([]byte, n)
	for i := range out {
		out[i] = 'a'
	}
	return string(out)
}

func TestCheckAndDownloadSignedRelease(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	binary := []byte("signed update binary")
	sum := sha256.Sum256(binary)
	key := AssetKey(runtime.GOOS, runtime.GOARCH)
	manifest := Manifest{
		Version: "0.4.2",
		Assets: map[string]Asset{
			key: {Name: "nemorous-mobile-test", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(binary))},
		},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, raw))

	mux := http.NewServeMux()
	mux.HandleFunc("/latest/"+ManifestName, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) })
	mux.HandleFunc("/latest/"+SignatureName, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(sig)) })
	mux.HandleFunc("/latest/nemorous-mobile-test", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(binary) })
	srv := httptest.NewServer(mux)
	defer srv.Close()

	manager := &Manager{Repo: "o/r", PublicKey: pub, ReleaseBase: srv.URL + "/latest", Client: srv.Client()}
	release, err := manager.Check(context.Background(), "0.4.1")
	if err != nil {
		t.Fatal(err)
	}
	if release == nil || release.Version != "0.4.2" {
		t.Fatalf("release = %+v", release)
	}
	path, err := manager.Download(context.Background(), release, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(binary) {
		t.Fatalf("downloaded binary = %q", got)
	}
	if release.Asset.Size != int64(len(binary)) {
		t.Fatalf("size = %d", release.Asset.Size)
	}
}

func TestCheckRejectsTamperedManifest(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"version":"0.4.2","assets":{"` + AssetKey(runtime.GOOS, runtime.GOARCH) + `":{"name":"x","sha256":"` + repeatHex(64) + `","size":1}}}`)
	mux := http.NewServeMux()
	mux.HandleFunc("/latest/"+ManifestName, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) })
	mux.HandleFunc("/latest/"+SignatureName, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("not-a-signature")) })
	srv := httptest.NewServer(mux)
	defer srv.Close()

	manager := &Manager{Repo: "o/r", PublicKey: pub, ReleaseBase: srv.URL + "/latest", Client: srv.Client()}
	if _, err := manager.Check(context.Background(), "0.4.1"); err == nil {
		t.Fatal("tampered release was accepted")
	}
}
