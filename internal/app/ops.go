package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Options configures the application core.
type Options struct {
	// Token is an optional API bearer token. The mobile client pairs with a
	// short code and an HttpOnly cookie; the token remains for scripts.
	Token string
	// StateDir stores paired devices across restarts.
	StateDir string
	// PairCode overrides the generated six-digit code (used by tests).
	PairCode string
	// PairTTL is how long a pairing code stays valid. Defaults to 10 minutes.
	PairTTL time.Duration
}

// App owns the workspace configuration shared by all handlers.
type App struct {
	Root     string
	Token    string
	StateDir string
	repos    []Repo
	devices  *deviceStore
	pairs    *pairStore
	presets  *presetStore
	hub      *Hub
}

// New discovers the workspace and returns the application core with the
// default state directory.
func New(root, token string) (*App, error) {
	return NewWithOptions(root, Options{Token: token})
}

// NewWithOptions discovers the workspace and opens the device store.
func NewWithOptions(root string, opts Options) (*App, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	repos, err := Discover(abs)
	if err != nil {
		return nil, err
	}
	stateDir := opts.StateDir
	if stateDir == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		stateDir = filepath.Join(dir, "nemorous-mobile")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, err
	}
	devices, err := newDeviceStore(stateDir)
	if err != nil {
		return nil, err
	}
	ttl := opts.PairTTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	pairs, err := newPairStore(opts.PairCode, ttl)
	if err != nil {
		return nil, err
	}
	presets, err := newPresetStore(stateDir)
	if err != nil {
		return nil, err
	}
	return &App{
		Root: abs, Token: opts.Token, StateDir: stateDir,
		repos: repos, devices: devices, pairs: pairs, presets: presets, hub: newHub(),
	}, nil
}

// PairCode returns the current pairing code and its expiry.
func (a *App) PairCode() (string, time.Time) {
	return a.pairs.current()
}

func (a *App) Repos() []Repo { return a.repos }

func (a *App) repo(id string) (Repo, error) {
	for _, r := range a.repos {
		if r.ID == id {
			return r, nil
		}
	}
	return Repo{}, fmt.Errorf("未知仓库 %s", id)
}

func (a *App) Workspace(ctx context.Context) Workspace {
	states := inspectAll(ctx, a.repos, 8)
	return Workspace{
		Name:        filepath.Base(a.Root),
		Root:        a.Root,
		Repos:       states,
		GeneratedAt: time.Now().Unix(),
	}
}

func (a *App) RepoDetail(ctx context.Context, id string) (BranchList, error) {
	repo, err := a.repo(id)
	if err != nil {
		return BranchList{}, err
	}
	st := inspect(ctx, repo)
	local, _ := gitOK(ctx, repo.Path, inspectTimeout,
		"for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads")
	remote, _ := gitOK(ctx, repo.Path, inspectTimeout,
		"for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes")
	return BranchList{
		Repo:     st,
		Branches: splitLines(local),
		Remotes:  splitLines(remote),
	}, nil
}

func splitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

// safeRel normalizes a repository-relative path and rejects escapes.
func safeRel(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", errors.New("路径不能为空")
	}
	if strings.ContainsRune(rel, 0) {
		return "", errors.New("非法路径")
	}
	clean := filepath.Clean(strings.TrimPrefix(rel, "/"))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || filepath.IsAbs(clean) {
		return "", errors.New("非法路径")
	}
	if clean == ".git" || strings.HasPrefix(clean, ".git/") {
		return "", errors.New("不允许访问 .git")
	}
	return clean, nil
}

func repoPath(repo Repo, rel string) (string, error) {
	clean, err := safeRel(rel)
	if err != nil {
		return "", err
	}
	full := filepath.Join(repo.Path, clean)
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", err
	}
	base, err := filepath.EvalSymlinks(repo.Path)
	if err != nil {
		return "", err
	}
	if resolved != base && !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
		return "", errors.New("非法路径")
	}
	return resolved, nil
}

// Diff returns a unified patch for one file.
func (a *App) Diff(ctx context.Context, id, rel string, staged bool) (DiffResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return DiffResult{}, err
	}
	clean, err := safeRel(rel)
	if err != nil {
		return DiffResult{}, err
	}
	st := inspect(ctx, repo)
	untracked := false
	for _, f := range st.Files {
		if f.Path == clean && f.Untracked {
			untracked = true
		}
	}
	var out string
	if untracked && !staged {
		// A new file has no index entry, so diff it against /dev/null.
		out, _, err = git(ctx, repo.Path, inspectTimeout,
			"diff", "--no-index", "--no-color", "/dev/null", clean)
		if err != nil && !isExitOne(err) {
			return DiffResult{}, errors.New(firstLine(out))
		}
	} else {
		args := []string{"diff", "--no-color", "--no-ext-diff", "--no-renames"}
		if staged {
			args = append(args, "--cached")
		}
		args = append(args, "--", clean)
		out, err = gitOK(ctx, repo.Path, inspectTimeout, args...)
		if err != nil {
			return DiffResult{}, err
		}
	}
	return DiffResult{
		Path:      clean,
		Staged:    staged,
		Patch:     out,
		Binary:    strings.Contains(out, "Binary files") || strings.Contains(out, "GIT binary patch"),
		Untracked: untracked,
	}, nil
}

func isExitOne(err error) bool {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode() == 1
	}
	return false
}

func (a *App) Stage(ctx context.Context, id string, paths []string) error {
	repo, err := a.repo(id)
	if err != nil {
		return err
	}
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	args := append([]string{"add", "--"}, clean...)
	_, err = gitOK(ctx, repo.Path, inspectTimeout, args...)
	return err
}

func (a *App) Unstage(ctx context.Context, id string, paths []string) error {
	repo, err := a.repo(id)
	if err != nil {
		return err
	}
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	args := append([]string{"restore", "--staged", "--"}, clean...)
	if _, err := gitOK(ctx, repo.Path, inspectTimeout, args...); err != nil {
		// Repositories without any commit have no HEAD to restore from.
		if _, headErr := gitOK(ctx, repo.Path, inspectTimeout, "rev-parse", "--verify", "HEAD"); headErr != nil {
			rm := append([]string{"rm", "--cached", "-r", "--ignore-unmatch", "--"}, clean...)
			_, rmErr := gitOK(ctx, repo.Path, inspectTimeout, rm...)
			return rmErr
		}
		return err
	}
	return nil
}

// Discard throws away local changes. Untracked files are deleted; callers must
// pass confirm=true after an explicit user confirmation.
func (a *App) Discard(ctx context.Context, id string, paths []string, confirm bool) error {
	if !confirm {
		return errors.New("需要确认后才能丢弃改动")
	}
	repo, err := a.repo(id)
	if err != nil {
		return err
	}
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	st := inspect(ctx, repo)
	untracked := map[string]bool{}
	for _, f := range st.Files {
		if f.Untracked {
			untracked[f.Path] = true
		}
	}
	var tracked []string
	for _, p := range clean {
		if untracked[p] {
			full, err := repoPath(repo, p)
			if err != nil {
				return err
			}
			if err := os.RemoveAll(full); err != nil {
				return err
			}
			continue
		}
		tracked = append(tracked, p)
	}
	if len(tracked) > 0 {
		args := append([]string{"restore", "--source=HEAD", "--staged", "--worktree", "--"}, tracked...)
		if _, err := gitOK(ctx, repo.Path, inspectTimeout, args...); err != nil {
			return err
		}
	}
	return nil
}

func cleanPaths(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, errors.New("未选择文件")
	}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		clean, err := safeRel(p)
		if err != nil {
			return nil, err
		}
		out = append(out, clean)
	}
	return out, nil
}

func (a *App) Commit(ctx context.Context, id, message string, paths []string, amend bool) (string, error) {
	repo, err := a.repo(id)
	if err != nil {
		return "", err
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return "", errors.New("提交说明不能为空")
	}
	if amend {
		if err := ensureUnpublished(ctx, repo.Path); err != nil {
			return "", err
		}
	}
	if len(paths) > 0 {
		if err := a.Stage(ctx, id, paths); err != nil {
			return "", err
		}
	}
	args := []string{"commit", "-m", message}
	if amend {
		args = append(args, "--amend")
	}
	if len(paths) > 0 {
		// A pathspec commit records only the selected files; other staged
		// changes stay in the index for a later commit.
		args = append(args, "--")
		for _, p := range paths {
			clean, err := safeRel(p)
			if err != nil {
				return "", err
			}
			args = append(args, clean)
		}
	}
	if _, err := gitOK(ctx, repo.Path, writeTimeout, args...); err != nil {
		return "", err
	}
	out, err := gitOK(ctx, repo.Path, inspectTimeout, "rev-parse", "--short", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func (a *App) Push(ctx context.Context, id string) (OpResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return OpResult{}, err
	}
	return pushRepo(ctx, repo), nil
}

func pushRepo(ctx context.Context, repo Repo) OpResult {
	res := OpResult{RepoID: repo.ID, RepoName: repo.Name}
	out, errOut, err := git(ctx, repo.Path, writeTimeout, "push")
	if err == nil {
		res.Status = "OK"
		res.Message = firstNonEmptyLine(out, "推送完成")
		return res
	}
	msg := strings.TrimSpace(errOut)
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "no upstream branch") || strings.Contains(lower, "has no upstream") {
		out, errOut, err = git(ctx, repo.Path, writeTimeout, "push", "-u", "origin", "HEAD")
		if err == nil {
			res.Status = "OK"
			res.Message = firstNonEmptyLine(out, "已设置上游并推送")
			return res
		}
		msg = strings.TrimSpace(errOut)
	}
	res.Status = "FAIL"
	res.Message = firstNonEmptyLine(msg, "推送失败")
	return res
}

func firstNonEmptyLine(s, fallback string) string {
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return fallback
}

func (a *App) Pull(ctx context.Context, id string) (OpResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return OpResult{}, err
	}
	return pullRepo(ctx, repo), nil
}

func pullRepo(ctx context.Context, repo Repo) OpResult {
	res := OpResult{RepoID: repo.ID, RepoName: repo.Name}
	st := inspect(ctx, repo)
	if st.Error != "" {
		res.Status = "FAIL"
		res.Message = st.Error
		return res
	}
	if st.ConflictCount > 0 {
		res.Status = "SKIP"
		res.Message = "有未解决的冲突，已跳过"
		return res
	}
	if st.StagedCount > 0 {
		res.Status = "SKIP"
		res.Message = "有已暂存改动，已跳过"
		return res
	}
	if st.Upstream == "" {
		res.Status = "SKIP"
		res.Message = "没有远端上游，已跳过"
		return res
	}
	args := []string{"pull", "--ff-only"}
	if st.ModifiedCount > 0 {
		// Unstaged tracked edits do not block a fast-forward pull; stash them
		// around the merge and re-apply them afterwards.
		args = append(args, "--autostash")
	}
	out, errOut, err := git(ctx, repo.Path, writeTimeout, args...)
	if err != nil {
		res.Status = "FAIL"
		res.Message = firstLine(firstNonEmptyLine(errOut, err.Error()))
		return res
	}
	if msg := autostashConflictMessage(errOut); msg != "" {
		// git pull exits 0 when the autostash re-apply conflicts, leaving the
		// edit in the stash; surface the git warning instead of a false OK.
		res.Status = "FAIL"
		res.Message = msg
		return res
	}
	res.Status = "OK"
	res.Message = firstNonEmptyLine(out, "已快进同步")
	return res
}

func autostashConflictMessage(errOut string) string {
	for _, line := range strings.Split(errOut, "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "autostash") && strings.Contains(lower, "conflict") {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

var branchNameRe = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

func validBranch(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("分支名不能为空")
	}
	if !branchNameRe.MatchString(name) || strings.HasPrefix(name, "-") ||
		strings.Contains(name, "..") || strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") {
		return errors.New("非法分支名")
	}
	return nil
}

func (a *App) Checkout(ctx context.Context, id, branch string, create bool) (OpResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return OpResult{}, err
	}
	return checkoutRepo(ctx, repo, branch, create), nil
}

func checkoutRepo(ctx context.Context, repo Repo, branch string, create bool) OpResult {
	res := OpResult{RepoID: repo.ID, RepoName: repo.Name}
	if err := validBranch(branch); err != nil {
		res.Status = "FAIL"
		res.Message = err.Error()
		return res
	}
	st := inspect(ctx, repo)
	if st.Error != "" {
		res.Status = "FAIL"
		res.Message = st.Error
		return res
	}
	if len(st.Files) > 0 {
		res.Status = "SKIP"
		res.Message = "有未提交改动，已跳过"
		return res
	}
	args := []string{"checkout"}
	if create {
		args = append(args, "-b")
	}
	args = append(args, branch)
	_, errOut, err := git(ctx, repo.Path, writeTimeout, args...)
	if err != nil {
		res.Status = "FAIL"
		res.Message = firstLine(firstNonEmptyLine(errOut, err.Error()))
		return res
	}
	res.Status = "OK"
	res.Message = "已切换到 " + branch
	return res
}

// Batch runs one repository-wide action across the selected repositories.
func (a *App) Batch(ctx context.Context, action string, ids []string, branch string, create bool) ([]OpResult, error) {
	var selected []Repo
	if len(ids) == 0 {
		selected = a.repos
	} else {
		for _, id := range ids {
			repo, err := a.repo(id)
			if err != nil {
				return nil, err
			}
			selected = append(selected, repo)
		}
	}
	if len(selected) == 0 {
		return nil, errors.New("没有仓库")
	}
	fn := func(repo Repo) OpResult {
		switch action {
		case "pull":
			return pullRepo(ctx, repo)
		case "push":
			return pushRepo(ctx, repo)
		case "fetch":
			_, errOut, err := git(ctx, repo.Path, writeTimeout, "fetch", "--all", "--prune")
			res := OpResult{RepoID: repo.ID, RepoName: repo.Name}
			if err != nil {
				res.Status = "FAIL"
				res.Message = firstLine(firstNonEmptyLine(errOut, err.Error()))
			} else {
				res.Status = "OK"
				res.Message = "已获取远端更新"
			}
			return res
		case "checkout":
			return checkoutRepo(ctx, repo, branch, create)
		default:
			return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: "未知操作"}
		}
	}
	return runParallel(selected, 8, fn), nil
}

func runParallel(repos []Repo, concurrency int, fn func(Repo) OpResult) []OpResult {
	results := make([]OpResult, len(repos))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, r := range repos {
		wg.Add(1)
		go func(i int, r Repo) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = fn(r)
		}(i, r)
	}
	wg.Wait()
	return results
}

// ensureUnpublished refuses to rewrite a commit that already exists on a
// remote or is pointed at by a tag.
func ensureUnpublished(ctx context.Context, repoPath string) error {
	if _, err := gitOK(ctx, repoPath, inspectTimeout, "rev-parse", "--verify", "HEAD"); err != nil {
		return errors.New("还没有可修改的提交")
	}
	out, err := gitOK(ctx, repoPath, inspectTimeout,
		"for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/remotes", "refs/tags")
	if err != nil {
		return err
	}
	if strings.TrimSpace(out) != "" {
		return errors.New("提交已推送到远端或已打标签，拒绝改写")
	}
	return nil
}

// UndoLastCommit soft-resets the last unpublished, non-merge commit. The
// working tree is untouched; its changes stay in the index.
func (a *App) UndoLastCommit(ctx context.Context, id string) (UndoResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return UndoResult{}, err
	}
	parents, err := gitOK(ctx, repo.Path, inspectTimeout, "rev-list", "--parents", "-n", "1", "HEAD")
	if err != nil {
		return UndoResult{}, errors.New("还没有可撤销的提交")
	}
	fields := strings.Fields(parents)
	if len(fields) < 2 {
		return UndoResult{}, errors.New("根提交不能撤销")
	}
	if len(fields) > 2 {
		return UndoResult{}, errors.New("合并提交不能撤销")
	}
	if err := ensureUnpublished(ctx, repo.Path); err != nil {
		return UndoResult{}, err
	}
	meta, err := gitOK(ctx, repo.Path, inspectTimeout, "log", "-1", "--pretty=format:%H%x1f%h%x1f%s")
	if err != nil {
		return UndoResult{}, err
	}
	parts := strings.Split(meta, "\x1f")
	if len(parts) < 3 {
		return UndoResult{}, errors.New("读取提交失败")
	}
	if _, err := gitOK(ctx, repo.Path, writeTimeout, "reset", "--soft", "HEAD~1"); err != nil {
		return UndoResult{}, err
	}
	return UndoResult{Hash: parts[0], Short: parts[1], Subject: parts[2]}, nil
}

// Stash shelves tracked and untracked changes. Ignored files stay untouched.
func (a *App) Stash(ctx context.Context, id, message string) (OpResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return OpResult{}, err
	}
	st := inspect(ctx, repo)
	if st.Error != "" {
		return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: st.Error}, nil
	}
	if len(st.Files) == 0 {
		return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "SKIP", Message: "没有可暂存的改动"}, nil
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "nemorous-mobile " + time.Now().Format("2006-01-02 15:04")
	}
	_, errOut, err := git(ctx, repo.Path, writeTimeout, "stash", "push", "-u", "-m", message)
	if err != nil {
		return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: firstLine(firstNonEmptyLine(errOut, err.Error()))}, nil
	}
	return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "OK", Message: "已暂存改动"}, nil
}

// StashPop restores the newest stash entry.
func (a *App) StashPop(ctx context.Context, id string) (OpResult, error) {
	repo, err := a.repo(id)
	if err != nil {
		return OpResult{}, err
	}
	list, err := gitOK(ctx, repo.Path, inspectTimeout, "stash", "list")
	if err != nil || strings.TrimSpace(list) == "" {
		return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "SKIP", Message: "没有可恢复的 Stash"}, nil
	}
	_, errOut, err := git(ctx, repo.Path, writeTimeout, "stash", "pop")
	if err != nil {
		return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: firstLine(firstNonEmptyLine(errOut, err.Error()))}, nil
	}
	return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "OK", Message: "已恢复 Stash"}, nil
}

func (a *App) resolveRepos(ids []string) ([]Repo, error) {
	if len(ids) == 0 {
		return a.repos, nil
	}
	repos := make([]Repo, 0, len(ids))
	for _, id := range ids {
		repo, err := a.repo(id)
		if err != nil {
			return nil, err
		}
		repos = append(repos, repo)
	}
	return repos, nil
}

// BatchStash shelves changes in every selected repository.
func (a *App) BatchStash(ctx context.Context, ids []string, message string) ([]OpResult, error) {
	repos, err := a.resolveRepos(ids)
	if err != nil {
		return nil, err
	}
	if len(repos) == 0 {
		return nil, errors.New("没有仓库")
	}
	return runParallel(repos, 8, func(repo Repo) OpResult {
		res, err := a.Stash(ctx, repo.ID, message)
		if err != nil {
			return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: err.Error()}
		}
		return res
	}), nil
}

// BatchStashPop restores the newest stash in every selected repository.
func (a *App) BatchStashPop(ctx context.Context, ids []string) ([]OpResult, error) {
	repos, err := a.resolveRepos(ids)
	if err != nil {
		return nil, err
	}
	if len(repos) == 0 {
		return nil, errors.New("没有仓库")
	}
	return runParallel(repos, 8, func(repo Repo) OpResult {
		res, err := a.StashPop(ctx, repo.ID)
		if err != nil {
			return OpResult{RepoID: repo.ID, RepoName: repo.Name, Status: "FAIL", Message: err.Error()}
		}
		return res
	}), nil
}

// BatchCommit commits the given per-repository file selections with one message.
func (a *App) BatchCommit(ctx context.Context, targets []CommitTarget, message string, push bool) ([]OpResult, error) {
	if strings.TrimSpace(message) == "" {
		return nil, errors.New("提交说明不能为空")
	}
	if len(targets) == 0 {
		return nil, errors.New("未选择仓库")
	}
	repos := make([]Repo, 0, len(targets))
	byID := map[string]CommitTarget{}
	for _, t := range targets {
		repo, err := a.repo(t.RepoID)
		if err != nil {
			return nil, err
		}
		repos = append(repos, repo)
		byID[repo.ID] = t
	}
	return runParallel(repos, 1, func(repo Repo) OpResult {
		res := OpResult{RepoID: repo.ID, RepoName: repo.Name}
		t := byID[repo.ID]
		hash, err := a.Commit(ctx, repo.ID, message, t.Paths, t.Amend)
		if err != nil {
			res.Status = "FAIL"
			res.Message = err.Error()
			return res
		}
		res.Status = "OK"
		res.Message = "已提交 " + hash
		if push {
			p := pushRepo(ctx, repo)
			if p.Status != "OK" {
				res.Status = "FAIL"
				res.Message += "；推送失败：" + p.Message
			} else {
				res.Message += "，已推送"
			}
		}
		return res
	}), nil
}

// LogFilter narrows the merged commit list. Query matches subject, hash and
// author; Regex switches it to RE2; the remaining fields use git's own pathspec
// and branch selection.
type LogFilter struct {
	Limit         int
	Repos         []string
	Query         string
	Regex         bool
	CaseSensitive bool
	Branch        string
	Author        string
	Mine          bool
	Path          string
	Days          int
}

// Branches lists local branches across the workspace for the commit filter.
func (a *App) Branches(ctx context.Context) BranchesResponse {
	byRepo := map[string][]string{}
	union := map[string]bool{}
	for _, repo := range a.repos {
		out, err := gitOK(ctx, repo.Path, inspectTimeout,
			"for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads")
		if err != nil {
			continue
		}
		seen := map[string]bool{}
		var branches []string
		for _, line := range strings.Split(out, "\n") {
			name := strings.TrimSpace(line)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			branches = append(branches, name)
			union[name] = true
		}
		byRepo[repo.ID] = branches
	}
	var all []string
	for name := range union {
		all = append(all, name)
	}
	sort.Strings(all)
	return BranchesResponse{Branches: all, ByRepo: byRepo}
}

// Logs returns the newest commits of every selected repository merged by time.
// Query/author/time filters run in Go over up to 1000 commits per repository;
// branch and path filters are pushed into git so older history stays reachable.
func (a *App) Logs(ctx context.Context, f LogFilter) ([]Commit, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 150
	}
	var repos []Repo
	if len(f.Repos) == 0 {
		repos = a.repos
	} else {
		for _, id := range f.Repos {
			repo, err := a.repo(id)
			if err != nil {
				return nil, err
			}
			repos = append(repos, repo)
		}
	}
	if f.Branch != "" {
		if err := validBranch(f.Branch); err != nil {
			return nil, err
		}
	}
	path := ""
	if f.Path != "" {
		clean, err := safeRel(f.Path)
		if err != nil {
			return nil, err
		}
		path = clean
	}
	query := strings.TrimSpace(f.Query)
	var re *regexp.Regexp
	if f.Regex && query != "" {
		prefix := ""
		if !f.CaseSensitive {
			prefix = "(?i)"
		}
		compiled, err := regexp.Compile(prefix + query)
		if err != nil {
			return nil, errors.New("正则表达式无效")
		}
		re = compiled
	}
	lowerQuery := strings.ToLower(query)
	authorQuery := strings.ToLower(strings.TrimSpace(f.Author))
	fetchN := limit
	if query != "" || authorQuery != "" || f.Mine || f.Days > 0 {
		fetchN = 1000
		if fetchN < limit {
			fetchN = limit
		}
	}
	cutoff := int64(0)
	if f.Days > 0 {
		cutoff = time.Now().Add(-time.Duration(f.Days) * 24 * time.Hour).Unix()
	}
	matches := func(c Commit, identity string) bool {
		if cutoff > 0 && c.Time < cutoff {
			return false
		}
		if f.Mine {
			if identity == "" {
				return false
			}
			haystack := strings.ToLower(c.Author + " " + c.AuthorEmail)
			if !strings.Contains(haystack, strings.ToLower(identity)) {
				return false
			}
		}
		if authorQuery != "" && !strings.Contains(strings.ToLower(c.Author), authorQuery) {
			return false
		}
		if query == "" {
			return true
		}
		target := c.Subject + "\n" + c.Hash + "\n" + c.Short + "\n" + c.Author + "\n" + c.AuthorEmail
		if re != nil {
			return re.MatchString(target)
		}
		if f.CaseSensitive {
			return strings.Contains(target, query)
		}
		return strings.Contains(strings.ToLower(target), lowerQuery)
	}

	var mu sync.Mutex
	var all []Commit
	var wg sync.WaitGroup
	for _, repo := range repos {
		wg.Add(1)
		go func(repo Repo) {
			defer wg.Done()
			identity := ""
			if f.Mine {
				identity = repoIdentity(ctx, repo.Path)
				if identity == "" {
					return
				}
			}
			args := []string{"log", "-n", strconv.Itoa(fetchN),
				"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at"}
			if f.Branch != "" {
				args = append(args, f.Branch)
			}
			if path != "" {
				args = append(args, "--", path)
			}
			out, err := gitOK(ctx, repo.Path, inspectTimeout, args...)
			if err != nil {
				return
			}
			var commits []Commit
			for _, line := range strings.Split(out, "\n") {
				parts := strings.Split(line, "\x1f")
				if len(parts) < 6 {
					continue
				}
				ts, _ := strconv.ParseInt(parts[5], 10, 64)
				c := Commit{
					Hash: parts[0], Short: parts[1], Subject: parts[2], Author: parts[3], AuthorEmail: parts[4], Time: ts,
					RepoID: repo.ID, RepoName: repo.Name,
				}
				if matches(c, identity) {
					commits = append(commits, c)
				}
				if len(commits) >= limit {
					break
				}
			}
			mu.Lock()
			all = append(all, commits...)
			mu.Unlock()
		}(repo)
	}
	wg.Wait()
	sort.SliceStable(all, func(i, j int) bool { return all[i].Time > all[j].Time })
	if len(all) > limit {
		all = all[:limit]
	}
	if all == nil {
		all = []Commit{}
	}
	return all, nil
}

func repoIdentity(ctx context.Context, repoPath string) string {
	if out, err := gitOK(ctx, repoPath, inspectTimeout, "config", "user.email"); err == nil {
		if email := strings.TrimSpace(out); email != "" {
			return email
		}
	}
	if out, err := gitOK(ctx, repoPath, inspectTimeout, "config", "user.name"); err == nil {
		return strings.TrimSpace(out)
	}
	return ""
}

func (a *App) CommitDetail(ctx context.Context, id, hash string) (CommitDetail, error) {
	repo, err := a.repo(id)
	if err != nil {
		return CommitDetail{}, err
	}
	if !regexp.MustCompile(`^[0-9a-fA-F]{4,40}$`).MatchString(hash) {
		return CommitDetail{}, errors.New("非法提交哈希")
	}
	meta, err := gitOK(ctx, repo.Path, inspectTimeout,
		"log", "-1", "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%at", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	parts := strings.Split(meta, "\x1f")
	if len(parts) < 5 {
		return CommitDetail{}, errors.New("未找到提交")
	}
	ts, _ := strconv.ParseInt(parts[4], 10, 64)
	filesOut, err := gitOK(ctx, repo.Path, inspectTimeout,
		"show", "--name-status", "--format=", "--no-renames", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	stats := map[string][2]int{}
	statsOut, _ := gitOK(ctx, repo.Path, inspectTimeout,
		"show", "--numstat", "--format=", "--no-renames", hash)
	for _, line := range strings.Split(statsOut, "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		add, _ := strconv.Atoi(parts[0])
		del, _ := strconv.Atoi(parts[1])
		stats[parts[2]] = [2]int{add, del}
	}
	var files []CommitFile
	for _, line := range strings.Split(filesOut, "\n") {
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		path := parts[1]
		stat := stats[path]
		files = append(files, CommitFile{Status: strings.TrimSpace(parts[0]), Path: path, Added: stat[0], Deleted: stat[1]})
	}
	patch, err := gitOK(ctx, repo.Path, inspectTimeout,
		"show", "--format=", "--no-color", "--no-ext-diff", "--no-renames", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	return CommitDetail{
		Commit: Commit{
			Hash: parts[0], Short: parts[1], Subject: parts[2], Author: parts[3], Time: ts,
			RepoID: repo.ID, RepoName: repo.Name,
		},
		Files: files,
		Patch: patch,
	}, nil
}

// CommitFileDetail is CommitDetail with the patch for one file expanded to full context.
func (a *App) CommitFileDetail(ctx context.Context, id, hash, path string) (CommitDetail, error) {
	detail, err := a.CommitDetail(ctx, id, hash)
	if err != nil {
		return CommitDetail{}, err
	}
	found := false
	for _, file := range detail.Files {
		if file.Path == path {
			found = true
			break
		}
	}
	if !found {
		return CommitDetail{}, errors.New("文件不在这个提交里")
	}
	repo, err := a.repo(id)
	if err != nil {
		return CommitDetail{}, err
	}
	patch, err := gitOK(ctx, repo.Path, inspectTimeout,
		"show", "--format=", "--no-color", "--no-ext-diff", "--no-renames", "--unified=999999", hash, "--", path)
	if err != nil {
		return CommitDetail{}, err
	}
	detail.Patch = patch
	return detail, nil
}

// CommitDetailFull is CommitDetail with every file's unchanged context expanded.
func (a *App) CommitDetailFull(ctx context.Context, id, hash string) (CommitDetail, error) {
	detail, err := a.CommitDetail(ctx, id, hash)
	if err != nil {
		return CommitDetail{}, err
	}
	repo, err := a.repo(id)
	if err != nil {
		return CommitDetail{}, err
	}
	patch, err := gitOK(ctx, repo.Path, inspectTimeout,
		"show", "--format=", "--no-color", "--no-ext-diff", "--no-renames", "--unified=999999", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	detail.Patch = patch
	return detail, nil
}

const maxListedFiles = 20000

// Files lists tracked and untracked repository-relative paths.
func (a *App) Files(ctx context.Context, id string) (RepoFiles, error) {
	repo, err := a.repo(id)
	if err != nil {
		return RepoFiles{}, err
	}
	out, err := gitOK(ctx, repo.Path, inspectTimeout, "ls-files", "-z")
	if err != nil {
		return RepoFiles{}, err
	}
	seen := map[string]bool{}
	var files []string
	add := func(p string) {
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		files = append(files, p)
	}
	for _, p := range strings.Split(out, "\x00") {
		add(p)
	}
	st := inspect(ctx, repo)
	for _, f := range st.Files {
		if f.Untracked {
			add(f.Path)
		}
	}
	sort.Strings(files)
	truncated := false
	if len(files) > maxListedFiles {
		files = files[:maxListedFiles]
		truncated = true
	}
	return RepoFiles{RepoID: repo.ID, Files: files, Truncated: truncated}, nil
}

const maxFileBytes = 1 << 20

var revRe = regexp.MustCompile(`^(HEAD|[0-9a-fA-F]{4,40})$`)

// File returns file content from the worktree (rev empty) or a revision.
func (a *App) File(ctx context.Context, id, rel, rev string) (FileContent, error) {
	repo, err := a.repo(id)
	if err != nil {
		return FileContent{}, err
	}
	clean, err := safeRel(rel)
	if err != nil {
		return FileContent{}, err
	}
	if rev == "" {
		full, err := repoPath(repo, clean)
		if err != nil {
			return FileContent{}, err
		}
		info, err := os.Stat(full)
		if err != nil {
			return FileContent{}, errors.New("文件不存在")
		}
		if info.IsDir() {
			return FileContent{}, errors.New("这是一个目录")
		}
		if info.Size() > maxFileBytes {
			return FileContent{}, errors.New("文件超过 1 MiB，请用桌面端查看")
		}
		data, err := os.ReadFile(full)
		if err != nil {
			return FileContent{}, err
		}
		fc := FileContent{Path: clean, Size: len(data)}
		if isBinary(data) {
			fc.Binary = true
			return fc, nil
		}
		fc.Content = string(data)
		return fc, nil
	}
	if !revRe.MatchString(rev) {
		return FileContent{}, errors.New("非法版本号")
	}
	out, err := gitOK(ctx, repo.Path, inspectTimeout, "show", rev+":"+clean)
	if err != nil {
		return FileContent{}, err
	}
	fc := FileContent{Path: clean, Rev: rev, Size: len(out)}
	if isBinary([]byte(out)) {
		fc.Binary = true
		return fc, nil
	}
	if len(out) > maxFileBytes {
		return FileContent{}, errors.New("文件超过 1 MiB，请用桌面端查看")
	}
	fc.Content = out
	return fc, nil
}

var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "dist": true, "build": true,
	".next": true, ".nuxt": true, "target": true, ".venv": true,
	"__pycache__": true, ".cache": true, "Pods": true, "DerivedData": true,
}

// Search finds file names or file contents across the selected repositories.
func (a *App) Search(ctx context.Context, query, mode string, regex, caseSensitive bool, ids []string) (SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return SearchResult{}, errors.New("搜索内容不能为空")
	}
	var repos []Repo
	if len(ids) == 0 {
		repos = a.repos
	} else {
		for _, id := range ids {
			repo, err := a.repo(id)
			if err != nil {
				return SearchResult{}, err
			}
			repos = append(repos, repo)
		}
	}
	var re *regexp.Regexp
	if regex {
		flags := ""
		if !caseSensitive {
			flags = "(?i)"
		}
		compiled, err := regexp.Compile(flags + query)
		if err != nil {
			return SearchResult{}, errors.New("正则表达式无效")
		}
		re = compiled
	}
	res := SearchResult{}
	matcher := func(s string) bool {
		if re != nil {
			return re.MatchString(s)
		}
		if caseSensitive {
			return strings.Contains(s, query)
		}
		return strings.Contains(strings.ToLower(s), strings.ToLower(query))
	}
	if mode == "files" {
		for _, repo := range repos {
			rf, err := a.Files(ctx, repo.ID)
			if err != nil {
				continue
			}
			for _, p := range rf.Files {
				if matcher(p) {
					res.Files = append(res.Files, SearchFile{RepoID: repo.ID, RepoName: repo.Name, Path: p})
					if len(res.Files) >= 200 {
						res.Truncated = true
						return res, nil
					}
				}
			}
		}
		return res, nil
	}
	for _, repo := range repos {
		matches, truncated := searchRepoContent(ctx, repo, query, regex, caseSensitive)
		res.Matches = append(res.Matches, matches...)
		if truncated || len(res.Matches) >= 300 {
			res.Truncated = true
			if len(res.Matches) > 300 {
				res.Matches = res.Matches[:300]
			}
			break
		}
	}
	return res, nil
}

func searchRepoContent(ctx context.Context, repo Repo, query string, regex, caseSensitive bool) ([]SearchMatch, bool) {
	if rgPath, err := exec.LookPath("rg"); err == nil {
		args := []string{"--line-number", "--no-heading", "--color", "never",
			"--max-count", "100", "--max-filesize", "2M", "--no-messages"}
		if !regex {
			args = append(args, "-F")
		}
		if !caseSensitive {
			args = append(args, "-i")
		}
		args = append(args, "-e", query, ".")
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		cmd := exec.CommandContext(cctx, rgPath, args...)
		cmd.Dir = repo.Path
		out, _ := cmd.Output()
		var matches []SearchMatch
		for _, line := range strings.Split(string(out), "\n") {
			first := strings.Index(line, ":")
			second := -1
			if first >= 0 {
				second = strings.Index(line[first+1:], ":")
			}
			if first < 0 || second < 0 {
				continue
			}
			second += first + 1
			lineNo, err := strconv.Atoi(line[first+1 : second])
			if err != nil {
				continue
			}
			path := strings.TrimPrefix(line[:first], "./")
			text := line[second+1:]
			if len(text) > 500 {
				text = text[:500] + "…"
			}
			matches = append(matches, SearchMatch{
				RepoID: repo.ID, RepoName: repo.Name, Path: path, Line: lineNo, Text: text,
			})
			if len(matches) >= 100 {
				return matches, true
			}
		}
		return matches, false
	}
	return fallbackSearch(repo, query, regex, caseSensitive)
}

func fallbackSearch(repo Repo, query string, regex, caseSensitive bool) ([]SearchMatch, bool) {
	var re *regexp.Regexp
	if regex {
		flags := ""
		if !caseSensitive {
			flags = "(?i)"
		}
		re, _ = regexp.Compile(flags + query)
	}
	lowerQuery := strings.ToLower(query)
	var matches []SearchMatch
	truncated := false
	_ = filepath.WalkDir(repo.Path, func(path string, d os.DirEntry, err error) error {
		if err != nil || len(matches) >= 100 {
			if len(matches) >= 100 {
				truncated = true
			}
			return filepath.SkipAll
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 1<<20 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil || isBinary(data) {
			return nil
		}
		rel, _ := filepath.Rel(repo.Path, path)
		for i, line := range strings.Split(string(data), "\n") {
			hit := false
			if re != nil {
				hit = re.MatchString(line)
			} else if caseSensitive {
				hit = strings.Contains(line, query)
			} else {
				hit = strings.Contains(strings.ToLower(line), lowerQuery)
			}
			if hit {
				if len(line) > 500 {
					line = line[:500] + "…"
				}
				matches = append(matches, SearchMatch{
					RepoID: repo.ID, RepoName: repo.Name, Path: rel, Line: i + 1, Text: line,
				})
				if len(matches) >= 100 {
					return filepath.SkipAll
				}
			}
		}
		return nil
	})
	return matches, truncated
}
