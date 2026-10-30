package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func run(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_TERMINAL_PROMPT=0",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func runAs(t *testing.T, dir, name, email string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+name, "GIT_AUTHOR_EMAIL="+email,
		"GIT_COMMITTER_NAME="+name, "GIT_COMMITTER_EMAIL="+email,
		"GIT_TERMINAL_PROMPT=0",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newRepo creates a repository with one commit and an optional bare origin.
func newRepo(t *testing.T, root, name string, withRemote bool) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	run(t, dir, "init", "-q", "-b", "main")
	run(t, dir, "config", "user.name", "Test")
	run(t, dir, "config", "user.email", "test@example.com")
	writeFile(t, filepath.Join(dir, "a.txt"), "line one\nline two\n")
	writeFile(t, filepath.Join(dir, "docs", "readme.md"), "# docs\n")
	run(t, dir, "add", "-A")
	run(t, dir, "commit", "-qm", "initial")
	if withRemote {
		bare := filepath.Join(root, name+"-remote.git")
		run(t, root, "init", "-q", "--bare", bare)
		run(t, dir, "remote", "add", "origin", bare)
		run(t, dir, "push", "-q", "-u", "origin", "main")
	}
	return dir
}

func newTestApp(t *testing.T) (*App, string) {
	t.Helper()
	root := t.TempDir()
	a := newRepo(t, root, "repo-a", true)
	newRepo(t, root, "repo-b", false)
	writeFile(t, filepath.Join(a, "a.txt"), "line one\nline two changed\n")
	writeFile(t, filepath.Join(a, "new.txt"), "brand new\n")
	app, err := NewWithOptions(root, Options{Token: "secret-token", StateDir: t.TempDir(), PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	return app, root
}

func findRepo(t *testing.T, ws Workspace, name string) RepoState {
	t.Helper()
	for _, r := range ws.Repos {
		if r.Name == name {
			return r
		}
	}
	t.Fatalf("repo %s not found", name)
	return RepoState{}
}

func TestWorkspaceInspection(t *testing.T) {
	app, _ := newTestApp(t)
	ws := app.Workspace(context.Background())
	if len(ws.Repos) != 2 {
		t.Fatalf("repos = %d, want 2", len(ws.Repos))
	}
	a := findRepo(t, ws, "repo-a")
	if a.Health != "dirty" {
		t.Errorf("health = %q, want dirty", a.Health)
	}
	if a.UntrackedCount != 1 || a.ModifiedCount != 1 {
		t.Errorf("counts = untracked %d modified %d, want 1/1", a.UntrackedCount, a.ModifiedCount)
	}
	if a.AddedLines < 2 {
		t.Errorf("added lines = %d, want >= 2", a.AddedLines)
	}
	if a.LastCommit == nil || a.LastCommit.Subject != "initial" {
		t.Errorf("last commit = %+v", a.LastCommit)
	}
	b := findRepo(t, ws, "repo-b")
	if b.Health != "clean" {
		t.Errorf("clean repo health = %q", b.Health)
	}
	if b.DefaultBranch != "main" {
		t.Errorf("default branch = %q", b.DefaultBranch)
	}
}

func TestDiffStageCommitPush(t *testing.T) {
	app, root := newTestApp(t)
	ctx := context.Background()
	ws := app.Workspace(ctx)
	a := findRepo(t, ws, "repo-a")

	d, err := app.Diff(ctx, a.ID, "new.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Patch, "+brand new") || !d.Untracked {
		t.Fatalf("untracked diff = %q untracked=%v", d.Patch, d.Untracked)
	}
	if _, err := app.Diff(ctx, a.ID, "../../etc/passwd", false); err == nil {
		t.Fatal("traversal path was accepted")
	}
	if err := app.Stage(ctx, a.ID, []string{"a.txt"}); err != nil {
		t.Fatal(err)
	}
	ws = app.Workspace(ctx)
	a = findRepo(t, ws, "repo-a")
	if a.StagedCount != 1 {
		t.Fatalf("staged = %d, want 1", a.StagedCount)
	}
	hash, err := app.Commit(ctx, a.ID, "mobile commit", []string{"a.txt", "new.txt"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if hash == "" {
		t.Fatal("empty commit hash")
	}
	ws = app.Workspace(ctx)
	a = findRepo(t, ws, "repo-a")
	if a.Health != "ahead" || a.Ahead != 1 {
		t.Fatalf("after commit health=%q ahead=%d", a.Health, a.Ahead)
	}
	res, err := app.Push(ctx, a.ID)
	if err != nil || res.Status != "OK" {
		t.Fatalf("push = %+v err=%v", res, err)
	}
	remoteLog := run(t, filepath.Join(root, "repo-a-remote.git"), "log", "--oneline")
	if !strings.Contains(remoteLog, "mobile commit") {
		t.Fatalf("remote log missing commit:\n%s", remoteLog)
	}
}

func TestUnstageWithoutHeadAndDiscardUntracked(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "fresh")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	run(t, dir, "init", "-q", "-b", "main")
	run(t, dir, "config", "user.name", "Test")
	run(t, dir, "config", "user.email", "test@example.com")
	writeFile(t, filepath.Join(dir, "x.txt"), "x\n")
	app, err := NewWithOptions(root, Options{Token: "t", StateDir: t.TempDir(), PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	repo := app.Repos()[0]
	if err := app.Stage(context.Background(), repo.ID, []string{"x.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := app.Unstage(context.Background(), repo.ID, []string{"x.txt"}); err != nil {
		t.Fatalf("unstage without HEAD: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "x.txt")); err != nil {
		t.Fatal("unstage deleted the file")
	}
	if err := app.Discard(context.Background(), repo.ID, []string{"x.txt"}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "x.txt")); !os.IsNotExist(err) {
		t.Fatal("discard did not remove untracked file")
	}
	if err := app.Discard(context.Background(), repo.ID, []string{"x.txt"}, false); err == nil {
		t.Fatal("discard without confirm was accepted")
	}
}

func TestCheckoutSkipsDirtyAndCreatesBranch(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	a := findRepo(t, app.Workspace(ctx), "repo-a")
	res, err := app.Checkout(ctx, a.ID, "feature", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "SKIP" {
		t.Fatalf("dirty checkout = %+v, want SKIP", res)
	}
	if err := app.Discard(ctx, a.ID, []string{"a.txt", "new.txt"}, true); err != nil {
		t.Fatal(err)
	}
	res, err = app.Checkout(ctx, a.ID, "feature/x", true)
	if err != nil || res.Status != "OK" {
		t.Fatalf("create branch = %+v err=%v", res, err)
	}
	a = findRepo(t, app.Workspace(ctx), "repo-a")
	if a.Branch != "feature/x" {
		t.Fatalf("branch = %q", a.Branch)
	}
}

func TestFilesSearchAndCommitDetail(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	a := findRepo(t, app.Workspace(ctx), "repo-a")

	rf, err := app.Files(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(rf.Files, "\n")
	if !strings.Contains(joined, "docs/readme.md") || !strings.Contains(joined, "new.txt") {
		t.Fatalf("files = %v", rf.Files)
	}
	fc, err := app.File(ctx, a.ID, "docs/readme.md", "")
	if err != nil {
		t.Fatal(err)
	}
	if fc.Content != "# docs\n" {
		t.Fatalf("content = %q", fc.Content)
	}
	if _, err := app.File(ctx, a.ID, "../secret", ""); err == nil {
		t.Fatal("traversal was accepted by File")
	}
	res, err := app.Search(ctx, "brand", "content", false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != 1 || res.Matches[0].Path != "new.txt" {
		t.Fatalf("search = %+v", res)
	}
	files, err := app.Search(ctx, "readme", "files", false, false, []string{a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(files.Files) != 1 || files.Files[0].Path != "docs/readme.md" {
		t.Fatalf("file search = %+v", files)
	}

	last, err := app.Logs(ctx, LogFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(last) == 0 {
		t.Fatal("no commits")
	}
	detail, err := app.CommitDetail(ctx, last[0].RepoID, last[0].Hash)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Commit.Subject != "initial" || len(detail.Files) == 0 {
		t.Fatalf("detail = %+v", detail)
	}
	if !strings.Contains(detail.Patch, "a.txt") {
		t.Fatalf("patch missing a.txt: %q", detail.Patch)
	}
}

func TestHTTPAuthAndTraversal(t *testing.T) {
	app, _ := newTestApp(t)
	srv := httptest.NewServer(app.APIHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token status = %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/workspace", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authorized status = %d", resp.StatusCode)
	}
	var ws Workspace
	if err := json.NewDecoder(resp.Body).Decode(&ws); err != nil {
		t.Fatal(err)
	}
	if len(ws.Repos) != 2 {
		t.Fatalf("workspace repos = %d", len(ws.Repos))
	}

	body, _ := json.Marshal(map[string]string{"message": "x"})
	req, _ = http.NewRequest(http.MethodPost, srv.URL+"/api/repos/"+ws.Repos[0].ID+"/commit", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty commit status = %d", resp.StatusCode)
	}
}

func TestBatchCommitAcrossRepos(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	ws := app.Workspace(ctx)
	a := findRepo(t, ws, "repo-a")
	b := findRepo(t, ws, "repo-b")
	writeFile(t, filepath.Join(b.Path, "b.txt"), "b\n")
	results, err := app.BatchCommit(ctx, []CommitTarget{
		{RepoID: a.ID, Paths: []string{"a.txt", "new.txt"}},
		{RepoID: b.ID, Paths: []string{"b.txt"}},
	}, "unified", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %d", len(results))
	}
	for _, r := range results {
		if r.Status != "OK" {
			t.Fatalf("result = %+v", r)
		}
	}
	for _, id := range []string{a.ID, b.ID} {
		state, err := app.RepoDetail(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(state.Repo.Files) != 0 {
			t.Fatalf("%s still has %d changed files", state.Repo.Name, len(state.Repo.Files))
		}
	}
}

func TestPullSkipsDirtyAndNoUpstream(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	ws := app.Workspace(ctx)
	a := findRepo(t, ws, "repo-a")
	res, err := app.Pull(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "SKIP" || !strings.Contains(res.Message, "未提交") {
		t.Fatalf("dirty pull = %+v", res)
	}
	b := findRepo(t, ws, "repo-b")
	res, err = app.Pull(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "SKIP" || !strings.Contains(res.Message, "上游") {
		t.Fatalf("no-upstream pull = %+v", res)
	}
}

func TestCommitOnlySelectedPathsKeepsOtherStagedFiles(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	a := findRepo(t, app.Workspace(ctx), "repo-a")
	writeFile(t, filepath.Join(a.Path, "docs", "readme.md"), "# docs changed\n")
	if err := app.Stage(ctx, a.ID, []string{"a.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(ctx, a.ID, "only readme", []string{"docs/readme.md"}, false); err != nil {
		t.Fatal(err)
	}
	ws := app.Workspace(ctx)
	a = findRepo(t, ws, "repo-a")
	if len(a.Files) != 2 {
		t.Fatalf("files = %+v, want a.txt + new.txt", a.Files)
	}
	for _, f := range a.Files {
		if f.Path == "a.txt" && !f.Staged {
			t.Fatalf("a.txt lost its staged state: %+v", f)
		}
	}
	names := run(t, a.Path, "show", "--name-only", "--format=", "HEAD")
	if strings.Contains(names, "a.txt") || !strings.Contains(names, "docs/readme.md") {
		t.Fatalf("commit included wrong files:\n%s", names)
	}
}

func TestContentSearchFallsBackWithoutRipgrep(t *testing.T) {
	app, _ := newTestApp(t)
	t.Setenv("PATH", "/nonexistent")
	res, err := app.Search(context.Background(), "brand", "content", false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != 1 || res.Matches[0].Path != "new.txt" || res.Matches[0].Line != 1 {
		t.Fatalf("fallback search = %+v", res.Matches)
	}
}

func newCookieClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Jar: jar}
}

func postJSON(t *testing.T, client *http.Client, target string, body any, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, out
}

func TestPairingCookieDevicesAndRevocation(t *testing.T) {
	app, _ := newTestApp(t)
	srv := httptest.NewServer(app.APIHandler())
	defer srv.Close()
	client := newCookieClient(t)

	res, body := postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "000000", "name": "iPhone"}, nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong code status = %d (%s)", res.StatusCode, body)
	}
	res, body = postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "123456", "name": "iPhone"}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pair status = %d (%s)", res.StatusCode, body)
	}
	u, _ := url.Parse(srv.URL)
	if len(client.Jar.Cookies(u)) == 0 {
		t.Fatal("pairing did not set a cookie")
	}
	res, err := client.Get(srv.URL + "/api/workspace")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("workspace after pairing: %v %d", err, res.StatusCode)
	}
	res.Body.Close()

	var devices struct {
		Devices   []Device `json:"devices"`
		CurrentID string   `json:"currentId"`
	}
	res, err = client.Get(srv.URL + "/api/devices")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(res.Body).Decode(&devices); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if len(devices.Devices) != 1 || !devices.Devices[0].Current || devices.Devices[0].Name != "iPhone" {
		t.Fatalf("devices = %+v", devices)
	}

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/devices/"+devices.CurrentID, nil)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("revoke status = %d", res.StatusCode)
	}
	res, err = client.Get(srv.URL + "/api/workspace")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked cookie still works: %d", res.StatusCode)
	}
}

func TestPairingRateLimit(t *testing.T) {
	app, _ := newTestApp(t)
	srv := httptest.NewServer(app.APIHandler())
	defer srv.Close()
	client := newCookieClient(t)
	for range maxPairFails {
		res, _ := postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "000001", "name": "x"}, nil)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("fail %d status = %d", 0, res.StatusCode)
		}
	}
	res, body := postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "123456", "name": "x"}, nil)
	if res.StatusCode != http.StatusUnauthorized || !strings.Contains(string(body), "过多") {
		t.Fatalf("rate limit not enforced: %d %s", res.StatusCode, body)
	}
}

func TestCookieWritesRequireSameOrigin(t *testing.T) {
	app, _ := newTestApp(t)
	srv := httptest.NewServer(app.APIHandler())
	defer srv.Close()
	client := newCookieClient(t)
	res, body := postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "123456", "name": "x"}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pair: %d %s", res.StatusCode, body)
	}
	res, err := client.Get(srv.URL + "/api/workspace")
	if err != nil {
		t.Fatal(err)
	}
	var ws Workspace
	if err := json.NewDecoder(res.Body).Decode(&ws); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	repo := ws.Repos[0]
	file := repo.Files[0]

	target := srv.URL + "/api/repos/" + repo.ID + "/stage"
	res, _ = postJSON(t, client, target, map[string]any{"paths": []string{file.Path}}, map[string]string{"Origin": "https://evil.example"})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-site write status = %d", res.StatusCode)
	}
	res, _ = postJSON(t, client, target, map[string]any{"paths": []string{file.Path}}, map[string]string{"Origin": srv.URL})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("same-origin write status = %d", res.StatusCode)
	}
}

func TestDeviceSessionSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	stateDir := t.TempDir()
	app1, err := NewWithOptions(root, Options{StateDir: stateDir, PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	srv1 := httptest.NewServer(app1.APIHandler())
	client := newCookieClient(t)
	res, body := postJSON(t, client, srv1.URL+"/api/pair", map[string]string{"code": "123456", "name": "phone"}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pair: %d %s", res.StatusCode, body)
	}
	u, _ := url.Parse(srv1.URL)
	cookies := client.Jar.Cookies(u)
	srv1.Close()

	app2, err := NewWithOptions(root, Options{StateDir: stateDir, PairCode: "654321"})
	if err != nil {
		t.Fatal(err)
	}
	srv2 := httptest.NewServer(app2.APIHandler())
	defer srv2.Close()
	req, _ := http.NewRequest(http.MethodGet, srv2.URL+"/api/workspace", nil)
	req.AddCookie(cookies[0])
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("persisted session status = %d", res.StatusCode)
	}
}

func TestEventsStreamInvalidatesAfterMutation(t *testing.T) {
	app, _ := newTestApp(t)
	srv := httptest.NewServer(app.APIHandler())
	defer srv.Close()
	client := newCookieClient(t)
	res, body := postJSON(t, client, srv.URL+"/api/pair", map[string]string{"code": "123456", "name": "x"}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pair: %d %s", res.StatusCode, body)
	}
	res, err := client.Get(srv.URL + "/api/workspace")
	if err != nil {
		t.Fatal(err)
	}
	var ws Workspace
	if err := json.NewDecoder(res.Body).Decode(&ws); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	repo := ws.Repos[0]

	stream, err := client.Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	if line, err := reader.ReadString('\n'); err != nil || !strings.Contains(line, "retry:") {
		t.Fatalf("events preamble = %q err=%v", line, err)
	}
	if res, body := postJSON(t, client, srv.URL+"/api/repos/"+repo.ID+"/stage", map[string]any{"paths": []string{repo.Files[0].Path}}, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("stage: %d %s", res.StatusCode, body)
	}
	got := make(chan string, 1)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				got <- "error"
				return
			}
			if strings.Contains(line, "invalidate") {
				got <- "invalidate"
				return
			}
		}
	}()
	select {
	case event := <-got:
		if event != "invalidate" {
			t.Fatalf("event = %q", event)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for invalidate")
	}
}

func TestCommitFilters(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	a := findRepo(t, app.Workspace(ctx), "repo-a")
	writeFile(t, filepath.Join(a.Path, "billing.txt"), "export\n")
	run(t, a.Path, "add", "billing.txt")
	runAs(t, a.Path, "Alice", "alice@example.com", "commit", "-qm", "feat: billing export")
	writeFile(t, filepath.Join(a.Path, "timeout.txt"), "timeout\n")
	run(t, a.Path, "add", "timeout.txt")
	runAs(t, a.Path, "Bob", "bob@example.com", "commit", "-qm", "fix: request timeout")

	all, err := app.Logs(ctx, LogFilter{Limit: 50, Repos: []string{a.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("all = %d, want 3", len(all))
	}
	byQuery, err := app.Logs(ctx, LogFilter{Limit: 50, Query: "BILLING"})
	if err != nil || len(byQuery) != 1 || byQuery[0].Subject != "feat: billing export" {
		t.Fatalf("query = %+v err=%v", byQuery, err)
	}
	byHash, err := app.Logs(ctx, LogFilter{Limit: 50, Query: all[0].Short[:6]})
	if err != nil || len(byHash) == 0 {
		t.Fatalf("hash query = %+v err=%v", byHash, err)
	}
	byRegex, err := app.Logs(ctx, LogFilter{Limit: 50, Query: "^(feat|fix):", Regex: true})
	if err != nil || len(byRegex) != 2 {
		t.Fatalf("regex = %+v err=%v", byRegex, err)
	}
	if _, err := app.Logs(ctx, LogFilter{Regex: true, Query: "(["}); err == nil {
		t.Fatal("invalid regex accepted")
	}
	byAuthor, err := app.Logs(ctx, LogFilter{Limit: 50, Author: "alice"})
	if err != nil || len(byAuthor) != 1 {
		t.Fatalf("author = %+v err=%v all=%+v", byAuthor, err, all)
	}
	mine, err := app.Logs(ctx, LogFilter{Limit: 50, Repos: []string{a.ID}, Mine: true})
	if err != nil || len(mine) != 1 {
		t.Fatalf("mine = %+v err=%v", mine, err)
	}
	byPath, err := app.Logs(ctx, LogFilter{Limit: 50, Repos: []string{a.ID}, Path: "docs"})
	if err != nil || len(byPath) != 1 || byPath[0].Subject != "initial" {
		t.Fatalf("path = %+v err=%v", byPath, err)
	}
	byDays, err := app.Logs(ctx, LogFilter{Limit: 50, Days: 1})
	if err != nil || len(byDays) == 0 {
		t.Fatalf("days = %+v err=%v", byDays, err)
	}
	byBranch, err := app.Logs(ctx, LogFilter{Limit: 50, Repos: []string{a.ID}, Branch: "main"})
	if err != nil || len(byBranch) != 3 {
		t.Fatalf("branch = %+v err=%v", byBranch, err)
	}
	if _, err := app.Logs(ctx, LogFilter{Branch: "bad..branch"}); err == nil {
		t.Fatal("invalid branch accepted")
	}
	branches := app.Branches(ctx)
	if len(branches.Branches) == 0 || len(branches.ByRepo[a.ID]) == 0 {
		t.Fatalf("branches = %+v", branches)
	}
}

func TestStashRoundTrip(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	a := findRepo(t, app.Workspace(ctx), "repo-a")
	res, err := app.Stash(ctx, a.ID, "wip")
	if err != nil || res.Status != "OK" {
		t.Fatalf("stash = %+v err=%v", res, err)
	}
	a = findRepo(t, app.Workspace(ctx), "repo-a")
	if len(a.Files) != 0 {
		t.Fatalf("after stash files = %+v", a.Files)
	}
	res, err = app.StashPop(ctx, a.ID)
	if err != nil || res.Status != "OK" {
		t.Fatalf("stash pop = %+v err=%v", res, err)
	}
	a = findRepo(t, app.Workspace(ctx), "repo-a")
	if len(a.Files) != 2 {
		t.Fatalf("after pop files = %+v", a.Files)
	}
	if res, err := app.StashPop(ctx, a.ID); err != nil || res.Status != "SKIP" {
		t.Fatalf("empty pop = %+v err=%v", res, err)
	}
}

func TestUndoAndAmendSafety(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()
	b := findRepo(t, app.Workspace(ctx), "repo-b")
	writeFile(t, filepath.Join(b.Path, "undo.txt"), "undo\n")
	if err := app.Stage(ctx, b.ID, []string{"undo.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(ctx, b.ID, "to undo", nil, false); err != nil {
		t.Fatal(err)
	}
	res, err := app.UndoLastCommit(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res.Subject != "to undo" || res.Hash == "" {
		t.Fatalf("undo result = %+v", res)
	}
	b = findRepo(t, app.Workspace(ctx), "repo-b")
	if b.LastCommit != nil && b.LastCommit.Subject == "to undo" {
		t.Fatal("HEAD still points at the undone commit")
	}
	if len(b.Files) != 1 || !b.Files[0].Staged {
		t.Fatalf("soft reset should leave staged changes: %+v", b.Files)
	}

	a := findRepo(t, app.Workspace(ctx), "repo-a")
	if _, err := app.UndoLastCommit(ctx, a.ID); err == nil {
		t.Fatal("pushed commit was undone")
	}
	if _, err := app.Commit(ctx, a.ID, "amend pushed", nil, true); err == nil {
		t.Fatal("pushed commit was amended")
	}

	if _, err := app.Commit(ctx, b.ID, "amended message", nil, true); err != nil {
		t.Fatalf("amend unpushed: %v", err)
	}
	b = findRepo(t, app.Workspace(ctx), "repo-b")
	if b.LastCommit == nil || b.LastCommit.Subject != "amended message" {
		t.Fatalf("amended subject = %+v", b.LastCommit)
	}
}
