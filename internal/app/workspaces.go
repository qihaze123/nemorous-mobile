package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type workspaceFile struct {
	Roots  []string            `json:"roots"`
	Active string              `json:"active"`
	Hidden map[string][]string `json:"hidden,omitempty"`
}

type workspaceStore struct {
	mu     sync.Mutex
	path   string
	roots  []string
	active string
	hidden map[string][]string
}

func newWorkspaceStore(stateDir, initial string) (*workspaceStore, error) {
	s := &workspaceStore{
		path:   filepath.Join(stateDir, "workspaces.json"),
		roots:  []string{},
		active: initial,
		hidden: map[string][]string{},
	}
	data, err := os.ReadFile(s.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		var file workspaceFile
		if err := json.Unmarshal(data, &file); err != nil {
			return nil, err
		}
		s.roots = append(s.roots, file.Roots...)
		if file.Active != "" {
			s.active = file.Active
		}
		if file.Hidden != nil {
			s.hidden = file.Hidden
		}
	}
	seen := map[string]bool{}
	clean := make([]string, 0, len(s.roots)+1)
	for _, root := range append(s.roots, initial) {
		abs, err := filepath.Abs(root)
		if err != nil || seen[abs] {
			continue
		}
		seen[abs] = true
		clean = append(clean, abs)
	}
	s.roots = clean
	if _, ok := seen[s.active]; !ok {
		s.active = initial
	}
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *workspaceStore) saveLocked() error {
	data, err := json.MarshalIndent(workspaceFile{Roots: s.roots, Active: s.active, Hidden: s.hidden}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *workspaceStore) list() ([]string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.roots...), s.active
}

func (s *workspaceStore) has(root string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.roots {
		if r == root {
			return true
		}
	}
	return false
}

func (s *workspaceStore) add(root string) error {
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.roots {
		if r == abs {
			s.active = abs
			return s.saveLocked()
		}
	}
	s.roots = append(s.roots, abs)
	sort.Strings(s.roots)
	s.active = abs
	return s.saveLocked()
}

func (s *workspaceStore) hiddenFor(root string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.hidden[root]...)
}

func (s *workspaceStore) hide(root, repo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	for _, h := range s.hidden[root] {
		if h == repo {
			return nil
		}
	}
	s.hidden[root] = append(s.hidden[root], repo)
	return s.saveLocked()
}

func (s *workspaceStore) show(root, repo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	out := s.hidden[root][:0]
	for _, h := range s.hidden[root] {
		if h != repo {
			out = append(out, h)
		}
	}
	s.hidden[root] = out
	return s.saveLocked()
}

func (s *workspaceStore) activate(root string) error {
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.roots {
		if r == abs {
			s.active = abs
			return s.saveLocked()
		}
	}
	return errors.New("工作区不存在，请先添加")
}

func (s *workspaceStore) visible(root string, repos []Repo) []Repo {
	hidden := map[string]bool{}
	for _, h := range s.hiddenFor(root) {
		hidden[filepath.Clean(h)] = true
	}
	out := make([]Repo, 0, len(repos))
	for _, repo := range repos {
		if hidden[filepath.Clean(repo.Rel)] || hidden[repo.ID] {
			continue
		}
		out = append(out, repo)
	}
	return out
}

// Workspaces lists every known workspace and the active one.
func (a *App) Workspaces(ctx context.Context) WorkspacesResponse {
	roots, active := a.workspaces.list()
	root, all := a.snapshotAll()
	visible := a.workspaces.visible(root, all)
	res := WorkspacesResponse{Active: active, Workspaces: make([]WorkspaceSummary, 0, len(roots)), Repos: []WorkspaceRepo{}}
	if active == root {
		hidden := map[string]bool{}
		for _, h := range a.workspaces.hiddenFor(root) {
			hidden[filepath.Clean(h)] = true
		}
		for _, repo := range all {
			res.Repos = append(res.Repos, WorkspaceRepo{
				ID: repo.ID, Name: repo.Name, Rel: repo.Rel,
				Hidden: hidden[filepath.Clean(repo.Rel)] || hidden[repo.ID],
			})
		}
	}
	for _, item := range roots {
		count, hiddenCount := 0, len(a.workspaces.hiddenFor(item))
		if item == active {
			count = len(visible)
		} else if repos, err := Discover(item); err == nil {
			count = len(a.workspaces.visible(item, repos))
		}
		res.Workspaces = append(res.Workspaces, WorkspaceSummary{
			Root: item, Name: filepath.Base(item), Repos: count, Hidden: hiddenCount, Active: item == active,
		})
	}
	return res
}

func (a *App) setActiveWorkspace(root string, repos []Repo) {
	a.mu.Lock()
	a.Root = root
	a.allRepos = repos
	a.repos = a.workspaces.visible(root, repos)
	a.mu.Unlock()
	a.hub.notify()
}

// AddWorkspace adds an existing directory (or creates it) and makes it active.
func (a *App) AddWorkspace(ctx context.Context, raw string, create bool) (WorkspacesResponse, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return WorkspacesResponse{}, errors.New("工作区路径不能为空")
	}
	if !filepath.IsAbs(raw) {
		return WorkspacesResponse{}, errors.New("请输入绝对路径")
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return WorkspacesResponse{}, err
	}
	info, err := os.Stat(abs)
	if errors.Is(err, os.ErrNotExist) {
		if !create {
			return WorkspacesResponse{}, errors.New("目录不存在")
		}
		if err := os.MkdirAll(abs, 0o755); err != nil {
			return WorkspacesResponse{}, errors.New("创建目录失败")
		}
		info, err = os.Stat(abs)
	}
	if err != nil {
		return WorkspacesResponse{}, errors.New("无法读取目录")
	}
	if !info.IsDir() {
		return WorkspacesResponse{}, errors.New("路径不是目录")
	}
	repos, err := Discover(abs)
	if err != nil {
		return WorkspacesResponse{}, err
	}
	if err := a.workspaces.add(abs); err != nil {
		return WorkspacesResponse{}, err
	}
	a.setActiveWorkspace(abs, repos)
	return a.Workspaces(ctx), nil
}

// SelectWorkspace switches the process-wide active workspace.
func (a *App) SelectWorkspace(ctx context.Context, raw string) (WorkspacesResponse, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return WorkspacesResponse{}, errors.New("工作区路径不能为空")
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return WorkspacesResponse{}, err
	}
	if !a.workspaces.has(abs) {
		return WorkspacesResponse{}, errors.New("工作区不存在，请先添加")
	}
	repos, err := Discover(abs)
	if err != nil {
		return WorkspacesResponse{}, err
	}
	if err := a.workspaces.activate(abs); err != nil {
		return WorkspacesResponse{}, err
	}
	a.setActiveWorkspace(abs, repos)
	return a.Workspaces(ctx), nil
}

// SetRepoHidden hides or restores a repository in the active workspace.
func (a *App) SetRepoHidden(ctx context.Context, id string, hidden bool) (WorkspacesResponse, error) {
	root, all := a.snapshotAll()
	var target *Repo
	for i := range all {
		if all[i].ID == id || all[i].Rel == id {
			target = &all[i]
			break
		}
	}
	if target == nil {
		return WorkspacesResponse{}, errors.New("仓库不存在")
	}
	if target.Rel == "." {
		return WorkspacesResponse{}, errors.New("工作区根仓库不能隐藏")
	}
	var err error
	if hidden {
		err = a.workspaces.hide(root, target.Rel)
	} else {
		err = a.workspaces.show(root, target.Rel)
	}
	if err != nil {
		return WorkspacesResponse{}, err
	}
	a.mu.Lock()
	a.repos = a.workspaces.visible(root, all)
	a.mu.Unlock()
	a.hub.notify()
	return a.Workspaces(ctx), nil
}
