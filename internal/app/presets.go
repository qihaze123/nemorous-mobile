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
	"time"
)

type presetFile struct {
	Workspaces map[string][]BranchPreset `json:"workspaces"`
}

type presetStore struct {
	mu         sync.Mutex
	path       string
	workspaces map[string][]BranchPreset
}

func newPresetStore(dir string) (*presetStore, error) {
	s := &presetStore{path: filepath.Join(dir, "presets.json"), workspaces: map[string][]BranchPreset{}}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var file presetFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, err
	}
	if file.Workspaces != nil {
		s.workspaces = file.Workspaces
	}
	return s, nil
}

func (s *presetStore) saveLocked() error {
	data, err := json.MarshalIndent(presetFile{Workspaces: s.workspaces}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *presetStore) list(root string) []BranchPreset {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]BranchPreset(nil), s.workspaces[root]...)
	if out == nil {
		out = []BranchPreset{}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *presetStore) get(root, name string) (BranchPreset, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.workspaces[root] {
		if p.Name == name {
			return p, true
		}
	}
	return BranchPreset{}, false
}

func (s *presetStore) save(root string, preset BranchPreset) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.workspaces[root]
	replaced := false
	for i := range list {
		if list[i].Name == preset.Name {
			list[i] = preset
			replaced = true
			break
		}
	}
	if !replaced {
		list = append(list, preset)
	}
	s.workspaces[root] = list
	return s.saveLocked()
}

func (s *presetStore) delete(root, name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.workspaces[root]
	out := list[:0]
	found := false
	for _, p := range list {
		if p.Name == name {
			found = true
			continue
		}
		out = append(out, p)
	}
	if found {
		s.workspaces[root] = out
		_ = s.saveLocked()
	}
	return found
}

// Presets returns this workspace's saved branch combinations.
func (a *App) Presets() PresetsResponse {
	return PresetsResponse{Presets: a.presets.list(a.Root)}
}

// SavePreset records the current branch combination under a name.
func (a *App) SavePreset(name string, branches map[string]string) (BranchPreset, error) {
	name = sanitizePresetName(name)
	if name == "" {
		return BranchPreset{}, errors.New("预设名称不能为空")
	}
	clean := map[string]string{}
	for id, branch := range branches {
		branch = strings.TrimSpace(branch)
		if branch == "" {
			continue
		}
		if _, err := a.repo(id); err != nil {
			continue
		}
		if err := validBranch(branch); err != nil {
			return BranchPreset{}, err
		}
		clean[id] = branch
	}
	if len(clean) == 0 {
		return BranchPreset{}, errors.New("没有可保存的分支")
	}
	preset := BranchPreset{Name: name, Branches: clean, UpdatedAt: time.Now().Unix()}
	if err := a.presets.save(a.Root, preset); err != nil {
		return BranchPreset{}, err
	}
	return preset, nil
}

// DeletePreset removes a saved combination.
func (a *App) DeletePreset(name string) (bool, error) {
	name = sanitizePresetName(name)
	if name == "" {
		return false, errors.New("预设名称不能为空")
	}
	return a.presets.delete(a.Root, name), nil
}

// ApplyPreset switches each repository in the preset to its recorded branch.
// Dirty repositories are skipped by checkoutRepo.
func (a *App) ApplyPreset(ctx context.Context, name string) ([]OpResult, error) {
	preset, ok := a.presets.get(a.Root, sanitizePresetName(name))
	if !ok {
		return nil, errors.New("预设不存在")
	}
	var repos []Repo
	for id := range preset.Branches {
		if repo, err := a.repo(id); err == nil {
			repos = append(repos, repo)
		}
	}
	if len(repos) == 0 {
		return nil, errors.New("预设中的仓库已不在工作区")
	}
	sort.Slice(repos, func(i, j int) bool { return repos[i].Name < repos[j].Name })
	return runParallel(repos, 8, func(repo Repo) OpResult {
		return checkoutRepo(ctx, repo, preset.Branches[repo.ID], false)
	}), nil
}

func sanitizePresetName(name string) string {
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
	return name
}
