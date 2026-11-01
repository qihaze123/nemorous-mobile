package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceAddSelectAndPersist(t *testing.T) {
	ctx := context.Background()
	state := t.TempDir()
	rootA := t.TempDir()
	rootB := t.TempDir()
	newRepo(t, rootA, "repo-a", false)
	newRepo(t, rootB, "repo-b", false)
	app, err := NewWithOptions(rootA, Options{StateDir: state, PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	res := app.Workspaces(ctx)
	if res.Active != rootA || len(res.Workspaces) != 1 {
		t.Fatalf("initial workspaces = %+v", res)
	}
	res, err = app.AddWorkspace(ctx, rootB, false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Active != rootB || len(res.Workspaces) != 2 {
		t.Fatalf("after add = %+v", res)
	}
	if got := app.Workspace(ctx).Root; got != rootB {
		t.Fatalf("active root = %s, want %s", got, rootB)
	}

	// The active workspace and list survive a restart.
	app, err = NewWithOptions(rootA, Options{StateDir: state, PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	if got := app.Workspace(ctx).Root; got != rootB {
		t.Fatalf("restored root = %s, want %s", got, rootB)
	}
	if _, err := app.SelectWorkspace(ctx, rootA); err != nil {
		t.Fatal(err)
	}
	if got := app.Workspace(ctx).Root; got != rootA {
		t.Fatalf("selected root = %s, want %s", got, rootA)
	}

	// Creating an empty workspace is allowed, then repos can be added later.
	empty := filepath.Join(t.TempDir(), "empty-workspace")
	if _, err := app.AddWorkspace(ctx, empty, true); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(empty); err != nil || !info.IsDir() {
		t.Fatalf("created workspace missing: %v", err)
	}
}

func TestWorkspaceHiddenReposPersist(t *testing.T) {
	ctx := context.Background()
	state := t.TempDir()
	root := t.TempDir()
	newRepo(t, root, "repo-a", false)
	newRepo(t, root, "repo-b", false)
	app, err := NewWithOptions(root, Options{StateDir: state, PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	ws := app.Workspace(ctx)
	if len(ws.Repos) != 2 {
		t.Fatalf("visible repos = %d, want 2", len(ws.Repos))
	}
	var id string
	for _, repo := range ws.Repos {
		if repo.Name == "repo-a" {
			id = repo.ID
		}
	}
	res, err := app.SetRepoHidden(ctx, id, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(app.Workspace(ctx).Repos) != 1 {
		t.Fatalf("visible after hide = %d, want 1", len(app.Workspace(ctx).Repos))
	}
	found := false
	for _, repo := range res.Repos {
		if repo.Name == "repo-a" && repo.Hidden {
			found = true
		}
	}
	if !found {
		t.Fatalf("hidden repo missing from response: %+v", res.Repos)
	}

	app, err = NewWithOptions(root, Options{StateDir: state, PairCode: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	if len(app.Workspace(ctx).Repos) != 1 {
		t.Fatalf("hidden state not restored")
	}
	if _, err := app.SetRepoHidden(ctx, id, false); err != nil {
		t.Fatal(err)
	}
	if len(app.Workspace(ctx).Repos) != 2 {
		t.Fatalf("show did not restore repo")
	}
}
