package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// inspectTimeout bounds every short read-only git command.
	inspectTimeout = 15 * time.Second
	// writeTimeout bounds commit/push/pull style commands.
	writeTimeout = 120 * time.Second
	// maxUntrackedScanBytes caps the file read used to count untracked lines.
	maxUntrackedScanBytes = 256 << 10
)

// Discover finds the Git repositories of a workspace. When the root itself is
// a repository it is returned alone; otherwise direct children are scanned,
// mirroring Nemorous' unregistered-sibling discovery.
func Discover(root string) ([]Repo, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s 不是目录", abs)
	}
	var repos []Repo
	add := func(path string) {
		rel, err := filepath.Rel(abs, path)
		if err != nil {
			return
		}
		repos = append(repos, Repo{
			ID:   repoID(path),
			Name: filepath.Base(path),
			Path: path,
			Rel:  rel,
		})
	}
	if isGitRepo(abs) {
		add(abs)
		return repos, nil
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(abs, e.Name())
		if isGitRepo(p) {
			add(p)
		}
	}
	return repos, nil
}

func repoID(abs string) string {
	sum := sha1.Sum([]byte(abs))
	return hex.EncodeToString(sum[:])[:12]
}

func isGitRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// git runs a git command inside dir with a timeout and a non-interactive env.
func git(ctx context.Context, dir string, timeout time.Duration, args ...string) (stdout, stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	full := append([]string{"-C", dir}, args...)
	cmd := exec.CommandContext(ctx, "git", full...)
	cmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"LC_ALL=C",
		"GIT_PAGER=cat",
	)
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return out.String(), errb.String(), fmt.Errorf("git %s 超时", args[0])
	}
	return out.String(), errb.String(), err
}

func gitOK(ctx context.Context, dir string, timeout time.Duration, args ...string) (string, error) {
	out, errOut, err := git(ctx, dir, timeout, args...)
	if err != nil {
		msg := strings.TrimSpace(errOut)
		if msg == "" {
			msg = err.Error()
		}
		return out, errors.New(firstLine(msg))
	}
	return out, nil
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = s[:i]
	}
	if len(s) > 400 {
		s = s[:400] + "…"
	}
	return s
}

var branchHeaderRe = regexp.MustCompile(`^(.*?)(?:\.\.\.(.*?))?(?: \[(.*)\])?$`)

func inspect(ctx context.Context, repo Repo) RepoState {
	st := RepoState{Repo: repo, Files: []FileChange{}, Health: "clean", UpdatedAt: time.Now().Unix()}
	out, errOut, err := git(ctx, repo.Path, inspectTimeout,
		"status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		msg := strings.TrimSpace(errOut)
		if msg == "" {
			msg = err.Error()
		}
		st.Error = firstLine(msg)
		st.Health = "error"
		return st
	}
	parseStatusZ(ctx, out, &st)
	st.DefaultBranch = detectDefaultBranch(ctx, repo.Path, st.Branch)
	st.Health = healthOf(st)
	st.LastCommit = lastCommit(ctx, repo.Path)
	return st
}

// parseStatusZ parses `git status --porcelain=v1 -z --branch` output.
func parseStatusZ(ctx context.Context, out string, st *RepoState) {
	fields := strings.Split(out, "\x00")
	seen := map[string]int{}
	for i := 0; i < len(fields); i++ {
		rec := fields[i]
		if rec == "" {
			continue
		}
		if strings.HasPrefix(rec, "## ") {
			parseBranchHeader(strings.TrimPrefix(rec, "## "), st)
			continue
		}
		if len(rec) < 4 {
			continue
		}
		x, y := rec[0], rec[1]
		path := rec[3:]
		// `git status --untracked-files=all` still collapses a nested
		// repository/worktree into a single directory entry ending in "/".
		// Its contents belong to that other repository and cannot be
		// committed here, so keep it out of this repo's change list.
		if x == '?' && y == '?' && strings.HasSuffix(path, "/") {
			continue
		}
		f := FileChange{
			Path:       path,
			Index:      string(x),
			Worktree:   string(y),
			Staged:     x != ' ' && x != '?',
			Unstaged:   y != ' ' && y != '?',
			Untracked:  x == '?' && y == '?',
			Conflicted: isConflictXY(string(x), string(y)),
		}
		if x == 'R' || x == 'C' {
			if i+1 < len(fields) {
				f.OrigPath = fields[i+1]
				i++
			}
		}
		f.Status = statusKind(f)
		st.Files = append(st.Files, f)
		seen[path] = len(st.Files) - 1
	}
	// Line stats. Renames are disabled so the paths keyed here are real paths.
	for _, cached := range []bool{false, true} {
		args := []string{"diff", "--numstat", "--no-renames", "--no-color"}
		if cached {
			args = append(args, "--cached")
		}
		numOut, _, err := git(ctx, st.Path, inspectTimeout, args...)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(numOut, "\n") {
			parts := strings.SplitN(line, "\t", 3)
			if len(parts) != 3 {
				continue
			}
			idx, ok := seen[parts[2]]
			if !ok {
				continue
			}
			add, _ := strconv.Atoi(parts[0])
			del, _ := strconv.Atoi(parts[1])
			if cached {
				st.Files[idx].Added += add
				st.Files[idx].Deleted += del
			} else if !st.Files[idx].Staged || st.Files[idx].Unstaged {
				st.Files[idx].Added += add
				st.Files[idx].Deleted += del
			}
		}
	}
	for i := range st.Files {
		f := &st.Files[i]
		if f.Untracked {
			// Untracked files are not in any diff; count their lines directly.
			if n, ok := countLines(filepath.Join(st.Path, f.Path)); ok {
				f.Added = n
			}
		}
		switch {
		case f.Conflicted:
			st.ConflictCount++
		case f.Untracked:
			st.UntrackedCount++
		case f.Staged:
			st.StagedCount++
			if f.Unstaged {
				st.ModifiedCount++
			}
		default:
			st.ModifiedCount++
		}
		st.AddedLines += f.Added
		st.DeletedLines += f.Deleted
	}
}

func countLines(path string) (int, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() > maxUntrackedScanBytes {
		return 0, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	if isBinary(data) {
		return 0, false
	}
	n := strings.Count(string(data), "\n")
	if len(data) > 0 && data[len(data)-1] != '\n' {
		n++
	}
	return n, true
}

func parseBranchHeader(hdr string, st *RepoState) {
	if strings.HasPrefix(hdr, "No commits yet on ") {
		st.Branch = strings.TrimPrefix(hdr, "No commits yet on ")
		return
	}
	if hdr == "HEAD (no branch)" {
		st.Detached = true
		return
	}
	m := branchHeaderRe.FindStringSubmatch(hdr)
	if m == nil {
		return
	}
	st.Branch = m[1]
	st.Upstream = m[2]
	if m[3] != "" {
		for _, part := range strings.Split(m[3], ",") {
			part = strings.TrimSpace(part)
			switch {
			case strings.HasPrefix(part, "ahead "):
				st.Ahead, _ = strconv.Atoi(strings.TrimPrefix(part, "ahead "))
			case strings.HasPrefix(part, "behind "):
				st.Behind, _ = strconv.Atoi(strings.TrimPrefix(part, "behind "))
			}
		}
	}
}

func isConflictXY(x, y string) bool {
	switch x + y {
	case "DD", "AU", "UD", "UA", "DU", "AA", "UU":
		return true
	}
	return false
}

func statusKind(f FileChange) string {
	switch {
	case f.Conflicted:
		return "U"
	case f.Untracked:
		return "?"
	case f.Index == "R" || f.Worktree == "R":
		return "R"
	case f.Index == "A" || f.Worktree == "A":
		return "A"
	case f.Index == "D" || f.Worktree == "D":
		return "D"
	default:
		return "M"
	}
}

func healthOf(st RepoState) RepoHealth {
	switch {
	case st.ConflictCount > 0:
		return "conflict"
	case len(st.Files) > 0:
		return "dirty"
	case st.Ahead > 0 && st.Behind > 0:
		return "diverged"
	case st.Behind > 0:
		return "behind"
	case st.Ahead > 0:
		return "ahead"
	default:
		return "clean"
	}
}

func detectDefaultBranch(ctx context.Context, dir, current string) string {
	if out, err := gitOK(ctx, dir, inspectTimeout, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil {
		name := strings.TrimSpace(out)
		if i := strings.Index(name, "/"); i >= 0 {
			name = name[i+1:]
		}
		if name != "" {
			return name
		}
	}
	for _, name := range []string{"main", "master"} {
		if _, err := gitOK(ctx, dir, inspectTimeout, "show-ref", "--verify", "--quiet", "refs/heads/"+name); err == nil {
			return name
		}
	}
	return current
}

func lastCommit(ctx context.Context, dir string) *Commit {
	out, err := gitOK(ctx, dir, inspectTimeout, "log", "-1", "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%at")
	if err != nil {
		return nil
	}
	parts := strings.Split(out, "\x1f")
	if len(parts) < 5 {
		return nil
	}
	ts, _ := strconv.ParseInt(parts[4], 10, 64)
	return &Commit{Hash: parts[0], Short: parts[1], Subject: parts[2], Author: parts[3], Time: ts}
}

func inspectAll(ctx context.Context, repos []Repo, concurrency int) []RepoState {
	if concurrency < 1 {
		concurrency = 1
	}
	out := make([]RepoState, len(repos))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, r := range repos {
		wg.Add(1)
		go func(i int, r Repo) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out[i] = inspect(ctx, r)
		}(i, r)
	}
	wg.Wait()
	return out
}

func isBinary(data []byte) bool {
	if len(data) > 8192 {
		data = data[:8192]
	}
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}
