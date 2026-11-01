package app

//go:generate go run ./gentypes

// RepoHealth is the high-level state shown on a repository card.
type RepoHealth string

const (
	HealthClean    RepoHealth = "clean"
	HealthDirty    RepoHealth = "dirty"
	HealthConflict RepoHealth = "conflict"
	HealthBehind   RepoHealth = "behind"
	HealthAhead    RepoHealth = "ahead"
	HealthDiverged RepoHealth = "diverged"
	HealthError    RepoHealth = "error"
)

// Repo is a Git repository discovered under the workspace root.
type Repo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"` // absolute path
	Rel  string `json:"rel"`  // path relative to the workspace root, "." for the root itself
}

// FileChange is one entry of `git status`.
type FileChange struct {
	Path       string `json:"path"`
	OrigPath   string `json:"origPath,omitempty"`
	Status     string `json:"status"` // M A D R U ?
	Index      string `json:"index"`  // porcelain X
	Worktree   string `json:"worktree"`
	Staged     bool   `json:"staged"`
	Unstaged   bool   `json:"unstaged"`
	Untracked  bool   `json:"untracked"`
	Conflicted bool   `json:"conflicted"`
	Added      int    `json:"added"`
	Deleted    int    `json:"deleted"`
}

// Commit is a log entry, optionally attributed to a repository.
type Commit struct {
	Hash        string `json:"hash"`
	Short       string `json:"short"`
	Subject     string `json:"subject"`
	Author      string `json:"author"`
	AuthorEmail string `json:"authorEmail,omitempty"`
	Time        int64  `json:"time"`
	RepoID      string `json:"repoId,omitempty"`
	RepoName    string `json:"repoName,omitempty"`
}

// RepoState is the live snapshot rendered by the mobile client.
type RepoState struct {
	Repo
	Branch         string       `json:"branch"`
	DefaultBranch  string       `json:"defaultBranch"`
	Detached       bool         `json:"detached"`
	Upstream       string       `json:"upstream,omitempty"`
	Ahead          int          `json:"ahead"`
	Behind         int          `json:"behind"`
	Health         RepoHealth   `json:"health"` // clean dirty conflict behind ahead diverged
	Error          string       `json:"error,omitempty"`
	Files          []FileChange `json:"files"`
	StagedCount    int          `json:"stagedCount"`
	ModifiedCount  int          `json:"modifiedCount"`
	UntrackedCount int          `json:"untrackedCount"`
	ConflictCount  int          `json:"conflictCount"`
	AddedLines     int          `json:"addedLines"`
	DeletedLines   int          `json:"deletedLines"`
	LastCommit     *Commit      `json:"lastCommit,omitempty"`
	UpdatedAt      int64        `json:"updatedAt"`
}

// Workspace is the payload of GET /api/workspace.
type Workspace struct {
	Name        string      `json:"name"`
	Root        string      `json:"root"`
	Repos       []RepoState `json:"repos"`
	GeneratedAt int64       `json:"generatedAt"`
}

// BranchList is returned by GET /api/repos/{id}.
type BranchList struct {
	Repo     RepoState `json:"repo"`
	Branches []string  `json:"branches"`
	Remotes  []string  `json:"remotes"`
}

// DiffResult is a unified patch for one file.
type DiffResult struct {
	Path      string `json:"path"`
	Staged    bool   `json:"staged"`
	Patch     string `json:"patch"`
	Binary    bool   `json:"binary"`
	Untracked bool   `json:"untracked"`
}

// OpResult describes the outcome of an operation on one repository.
type OpResult struct {
	RepoID   string `json:"repoId"`
	RepoName string `json:"repoName"`
	Status   string `json:"status"` // OK SKIP FAIL
	Message  string `json:"message"`
}

// CommitFile is one changed file inside a commit.
type CommitFile struct {
	Path    string `json:"path"`
	Status  string `json:"status"`
	Added   int    `json:"added"`
	Deleted int    `json:"deleted"`
}

// CommitDetail is returned by GET /api/repos/{id}/commits/{hash}.
type CommitDetail struct {
	Commit Commit       `json:"commit"`
	Files  []CommitFile `json:"files"`
	Patch  string       `json:"patch"`
}

// FileContent is returned by GET /api/repos/{id}/file.
type FileContent struct {
	Path    string `json:"path"`
	Rev     string `json:"rev"`
	Content string `json:"content"`
	Binary  bool   `json:"binary"`
	Size    int    `json:"size"`
}

// SearchMatch is one content match.
type SearchMatch struct {
	RepoID   string `json:"repoId"`
	RepoName string `json:"repoName"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Text     string `json:"text"`
}

// SearchFile is one file-name match.
type SearchFile struct {
	RepoID   string `json:"repoId"`
	RepoName string `json:"repoName"`
	Path     string `json:"path"`
}

// SearchResult is returned by GET /api/search.
type SearchResult struct {
	Files     []SearchFile  `json:"files,omitempty"`
	Matches   []SearchMatch `json:"matches,omitempty"`
	Truncated bool          `json:"truncated"`
}

// RepoFiles is returned by GET /api/repos/{id}/files.
type RepoFiles struct {
	RepoID    string   `json:"repoId"`
	Files     []string `json:"files"`
	Truncated bool     `json:"truncated"`
}

// CommitTarget is one repository selection for a unified commit.
type CommitTarget struct {
	RepoID string   `json:"repoId"`
	Paths  []string `json:"paths"`
	Amend  bool     `json:"amend"`
}

// Device is one paired browser or phone, as shown in Settings.
type Device struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	Current    bool   `json:"current,omitempty"`
}

// DevicesResponse is returned by GET /api/devices.
type DevicesResponse struct {
	Devices   []Device `json:"devices"`
	CurrentID string   `json:"currentId"`
}

// PairCodeResponse is returned by GET /api/pair/code.
type PairCodeResponse struct {
	Code      string `json:"code"`
	ExpiresAt int64  `json:"expiresAt"`
}

// PairResponse is returned by POST /api/pair.
type PairResponse struct {
	Device Device `json:"device"`
}

// BranchesResponse is returned by GET /api/branches.
type BranchesResponse struct {
	Branches []string            `json:"branches"`
	ByRepo   map[string][]string `json:"byRepo"`
}

// UndoResult is returned by POST /api/repos/{id}/undo.
type UndoResult struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
}

// BranchPreset stores a per-repository branch combination for one workspace.
type BranchPreset struct {
	Name      string            `json:"name"`
	Branches  map[string]string `json:"branches"`
	UpdatedAt int64             `json:"updatedAt"`
}

// PresetsResponse is returned by GET /api/presets.
type PresetsResponse struct {
	Presets []BranchPreset `json:"presets"`
}

// WorkspaceSummary is one selectable workspace root.
type WorkspaceSummary struct {
	Root   string `json:"root"`
	Name   string `json:"name"`
	Repos  int    `json:"repos"`
	Active bool   `json:"active"`
}

// WorkspacesResponse lists all known workspaces and the active root.
type WorkspacesResponse struct {
	Active     string             `json:"active"`
	Workspaces []WorkspaceSummary `json:"workspaces"`
}
