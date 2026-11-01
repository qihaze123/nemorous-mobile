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
	Roots  []string `json:"roots"`
	Active string   `json:"active"`
}

type workspaceStore struct {
	mu     sync.Mutex
	path   string
	roots  []string
	active string
}

func newWorkspaceStore(stateDir, initial string) (*workspaceStore, error) {
	s := &workspaceStore{
		path:   filepath.Join(stateDir, "workspaces.json"),
		roots:  []string{},
		active: initial,
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
	data, err := json.MarshalIndent(workspaceFile{Roots: s.roots, Active: s.active}, "", "  ")
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

// Workspaces lists every known workspace and the active one.
func (a *App) Workspaces(ctx context.Context) WorkspacesResponse {
	roots, active := a.workspaces.list()
	root, repos := a.snapshot()
	res := WorkspacesResponse{Active: active, Workspaces: make([]WorkspaceSummary, 0, len(roots))}
	activeRepos := 0
	if active == root {
		activeRepos = len(repos)
	}
	for _, root := range roots {
		count := 0
		if root == active {
			count = activeRepos
		} else if repos, err := Discover(root); err == nil {
			count = len(repos)
		}
		res.Workspaces = append(res.Workspaces, WorkspaceSummary{
			Root: root, Name: filepath.Base(root), Repos: count, Active: root == active,
		})
	}
	return res
}

func (a *App) setActiveWorkspace(root string, repos []Repo) {
	a.mu.Lock()
	a.Root = root
	a.repos = repos
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
