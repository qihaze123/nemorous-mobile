export type Health = 'clean' | 'dirty' | 'conflict' | 'behind' | 'ahead' | 'diverged' | 'error'

export interface RepoRef {
  id: string
  name: string
  path: string
  rel: string
}

export interface FileChange {
  path: string
  origPath?: string
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?'
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
  added: number
  deleted: number
}

export interface Commit {
  hash: string
  short: string
  subject: string
  author: string
  time: number
  repoId?: string
  repoName?: string
}

export interface RepoState extends RepoRef {
  branch: string
  defaultBranch: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  health: Health
  error?: string
  files: FileChange[]
  stagedCount: number
  modifiedCount: number
  untrackedCount: number
  conflictCount: number
  addedLines: number
  deletedLines: number
  lastCommit?: Commit
  updatedAt: number
}

export interface Workspace {
  name: string
  root: string
  repos: RepoState[]
  generatedAt: number
}

export interface BranchList {
  repo: RepoState
  branches: string[]
  remotes: string[]
}

export interface DiffResult {
  path: string
  staged: boolean
  patch: string
  binary: boolean
  untracked: boolean
}

export interface OpResult {
  repoId: string
  repoName: string
  status: 'OK' | 'SKIP' | 'FAIL'
  message: string
}

export interface CommitFile {
  path: string
  status: string
}

export interface CommitDetail {
  commit: Commit
  files: CommitFile[]
  patch: string
}

export interface FileContent {
  path: string
  rev: string
  content: string
  binary: boolean
  size: number
}

export interface RepoFiles {
  repoId: string
  files: string[]
  truncated: boolean
}

export interface SearchFile {
  repoId: string
  repoName: string
  path: string
}

export interface SearchMatch extends SearchFile {
  line: number
  text: string
}

export interface SearchResult {
  files?: SearchFile[]
  matches?: SearchMatch[]
  truncated: boolean
}

export interface CommitTarget {
  repoId: string
  paths: string[]
  amend?: boolean
}
