package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
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
	app, err := New(root, "secret-token")
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
	app, err := New(root, "t")
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

	last := app.Logs(ctx, 10)
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
