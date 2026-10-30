package app

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
	Hash     string `json:"hash"`
	Short    string `json:"short"`
	Subject  string `json:"subject"`
	Author   string `json:"author"`
	Time     int64  `json:"time"`
	RepoID   string `json:"repoId,omitempty"`
	RepoName string `json:"repoName,omitempty"`
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
	Health         string       `json:"health"` // clean dirty conflict behind ahead diverged
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
	Path   string `json:"path"`
	Status string `json:"status"`
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
