import { Fragment, useEffect, useMemo, useState } from 'react'
import type { FileChange, OpResult, RepoState, Workspace } from '../types'
import { post } from '../api'
import { go } from '../hooks'
import { Empty, Icon, Sheet, repoColor, useToast } from '../components'

type SectionKey = 'staged' | 'unstaged'
type Mode = 'list' | 'tree'

interface Section {
  key: SectionKey
  title: string
  repos: { repo: RepoState; files: FileChange[] }[]
  files: FileChange[]
}

interface TreeNode {
  name: string
  path: string
  dir: boolean
  children: TreeNode[]
  file?: FileChange
}

function fileKey(repoId: string, path: string) {
  return `${repoId}::${path}`
}

function normalizePath(path: string) {
  return path.replace(/\/+$/, '')
}

function baseName(path: string) {
  const clean = normalizePath(path)
  const i = clean.lastIndexOf('/')
  return i < 0 ? clean : clean.slice(i + 1)
}

function displayName(path: string) {
  const name = baseName(path)
  return path.endsWith('/') ? `${name}/` : name
}

function dirName(path: string) {
  const clean = normalizePath(path)
  const i = clean.lastIndexOf('/')
  return i < 0 ? '' : clean.slice(0, i + 1)
}

function statusClass(status: string) {
  switch (status) {
    case '?':
      return 'status-untracked'
    case 'A':
      return 'status-add'
    case 'D':
      return 'status-del'
    case 'R':
      return 'status-rename'
    case 'U':
      return 'status-conflict'
    default:
      return 'status-mod'
  }
}

function buildTree(files: FileChange[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let level = root
    let prefix = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const dir = i < parts.length - 1
      prefix = prefix ? `${prefix}/${part}` : part
      let node = level.find((n) => n.name === part && n.dir === dir)
      if (!node) {
        node = { name: part, path: prefix, dir, children: [] }
        level.push(node)
      }
      if (dir) level = node.children
      else node.file = file
    }
  }
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    for (const node of nodes) if (node.dir) sortLevel(node.children)
  }
  sortLevel(root)
  return root
}

function collectFiles(node: TreeNode): FileChange[] {
  const out: FileChange[] = []
  if (node.file) out.push(node.file)
  for (const child of node.children) out.push(...collectFiles(child))
  return out
}

function TriCheckbox({
  state,
  label,
  onToggle,
}: {
  state: 'none' | 'some' | 'all'
  label: string
  onToggle: () => void
}) {
  return (
    <span
      className={`checkbox tri ${state === 'all' ? 'on' : ''} ${state === 'some' ? 'some' : ''}`}
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'all'}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {state === 'all' ? <Icon name="check" size={12} /> : state === 'some' ? <span className="tri-dash" /> : null}
    </span>
  )
}

export function ChangesScreen({ ws, refresh }: { ws: Workspace; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [commitOpen, setCommitOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem('nemorous.changesMode') === 'tree' ? 'tree' : 'list'))
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const notify = useToast()

  const sections = useMemo<Section[]>(() => {
    const make = (key: SectionKey, title: string, filter: (file: FileChange) => boolean): Section => {
      const repos = ws.repos
        .map((repo) => ({ repo, files: repo.files.filter(filter) }))
        .filter((group) => group.files.length > 0)
      return { key, title, repos, files: repos.flatMap((group) => group.files) }
    }
    return [
      make('staged', '已暂存', (file) => file.staged),
      make('unstaged', '未暂存', (file) => file.untracked || file.unstaged || !file.staged),
    ]
  }, [ws])

  const allFiles = useMemo(() => sections.flatMap((section) => section.files), [sections])
  const totalFiles = allFiles.length
  const totalConflicts = ws.repos.reduce((n, r) => n + r.conflictCount, 0)

  const keys = useMemo(() => {
    const set = new Set<string>()
    for (const repo of ws.repos) for (const file of repo.files) set.add(fileKey(repo.id, file.path))
    return set
  }, [ws])

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((key) => keys.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [keys])

  const groups = useMemo(() => {
    const map = new Map<string, { repo: RepoState; paths: Set<string> }>()
    for (const repo of ws.repos) {
      for (const file of repo.files) {
        if (!selected.has(fileKey(repo.id, file.path))) continue
        let entry = map.get(repo.id)
        if (!entry) {
          entry = { repo, paths: new Set() }
          map.set(repo.id, entry)
        }
        entry.paths.add(file.path)
      }
    }
    return [...map.values()].map((entry) => ({ repo: entry.repo, paths: [...entry.paths] }))
  }, [ws, selected])

  const changeMode = (next: Mode) => {
    setModeState(next)
    localStorage.setItem('nemorous.changesMode', next)
  }

  const toggleFile = (repoId: string, file: FileChange) => {
    const key = fileKey(repoId, file.path)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setFiles = (repo: RepoState, files: FileChange[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const file of files) {
        const key = fileKey(repo.id, file.path)
        if (select) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const stateOf = (repo: RepoState, files: FileChange[]): 'none' | 'some' | 'all' => {
    if (files.length === 0) return 'none'
    const count = files.filter((file) => selected.has(fileKey(repo.id, file.path))).length
    if (count === 0) return 'none'
    return count === files.length ? 'all' : 'some'
  }

  const pushRepo = async (repo: RepoState) => {
    setBusyKey(`${repo.id}:push`)
    try {
      const res = await post<OpResult>(`/api/repos/${repo.id}/push`, {})
      notify(`${repo.name}: ${res.message}`, res.status === 'FAIL' ? 'error' : res.status === 'SKIP' ? 'info' : 'ok')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setBusyKey('')
    }
  }

  const submit = async () => {
    if (!message.trim() || groups.length === 0) return
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>('/api/batch/commit', {
        message,
        push: pushAfter,
        repos: groups.map((g) => ({ repoId: g.repo.id, paths: g.paths, amend: amend && groups.length === 1 })),
      })
      const failed = res.results.filter((r) => r.status !== 'OK')
      if (failed.length) notify(`${failed.length} 个仓库失败：${failed[0].repoName} ${failed[0].message}`, 'error')
      else notify(`已在 ${res.results.length} 个仓库提交 ${groups.reduce((n, g) => n + g.paths.length, 0)} 个文件${pushAfter ? '并推送' : ''}`, 'ok')
      setSelected(new Set())
      setMessage('')
      setPushAfter(false)
      setAmend(false)
      setCommitOpen(false)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : '提交失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openDiff = (repo: RepoState, file: FileChange, section: SectionKey) => {
    go(`#/diff?repo=${repo.id}&path=${encodeURIComponent(file.path)}&staged=${section === 'staged' ? 1 : 0}`)
  }

  const toggleDir = (key: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (ws.repos.length === 0) {
    return (
      <div className="screen">
        <header className="topbar">
          <h1>{ws.name}</h1>
        </header>
        <Empty title="工作区里没有找到 Git 仓库" hint="在启动服务时指向包含多个仓库的目录，或直接指向单个仓库。" icon="folder" />
      </div>
    )
  }

  const renderSection = (section: Section) => {
    const sectionState =
      section.files.length === 0
        ? 'none'
        : section.repos.every((group) => stateOf(group.repo, group.files) === 'all')
          ? 'all'
          : section.repos.some((group) => stateOf(group.repo, group.files) !== 'none')
            ? 'some'
            : 'none'

    const toggleSection = () => {
      const select = sectionState !== 'all'
      setSelected((prev) => {
        const next = new Set(prev)
        for (const group of section.repos) {
          for (const file of group.files) {
            const key = fileKey(group.repo.id, file.path)
            if (select) next.add(key)
            else next.delete(key)
          }
        }
        return next
      })
    }

    return (
      <section className="change-section" key={section.key}>
        <div className="change-section-head">
          <TriCheckbox state={sectionState} label={`选择全部${section.title}文件`} onToggle={toggleSection} />
          <span className={`section-name ${section.key === 'staged' ? 'staged' : ''}`}>{section.title}</span>
          <span className="section-count">{section.files.length}</span>
        </div>

        {section.repos.map(({ repo, files }) => {
          const repoState = stateOf(repo, files)
          const tree = mode === 'tree' ? buildTree(files) : []
          return (
            <div className="repo-block" key={`${section.key}:${repo.id}`}>
              <div className="repo-block-head">
                <TriCheckbox state={repoState} label={`选择 ${repo.name} 的全部文件`} onToggle={() => setFiles(repo, files, repoState !== 'all')} />
                <span className="repo-avatar small" style={{ background: repoColor(repo.name) }}>
                  {repo.name.slice(0, 2)}
                </span>
                <span className="repo-block-main">
                  <span className="repo-name">{repo.name}</span>
                  <span className="repo-sub">
                    <Icon name="branch" size={13} />
                    <code>{repo.branch || '(无分支)'}</code>
                    {repo.ahead > 0 ? <em className="ahead">↑{repo.ahead}</em> : null}
                    {repo.behind > 0 ? <em className="behind">↓{repo.behind}</em> : null}
                  </span>
                </span>
                <span className="repo-sync">
                  <button className="icon-btn tiny" aria-label={`推送 ${repo.name}`} disabled={busyKey === `${repo.id}:push` || repo.ahead === 0} onClick={() => void pushRepo(repo)}>
                    <Icon name="branch" size={15} />
                  </button>
                </span>
              </div>

              {mode === 'list' ? (
                <div className="list-scroll">
                  <div className="list-inner">
                    {files.map((file) => (
                      <div
                        key={`${repo.id}:${file.path}`}
                        className={`file-row list-row ${selected.has(fileKey(repo.id, file.path)) ? 'picked' : ''}`}
                        onClick={() => openDiff(repo, file, section.key)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openDiff(repo, file, section.key)
                        }}
                      >
                        <span
                          className={`checkbox ${selected.has(fileKey(repo.id, file.path)) ? 'on' : ''}`}
                          role="checkbox"
                          aria-checked={selected.has(fileKey(repo.id, file.path))}
                          aria-label={`选择 ${file.path}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFile(repo.id, file)
                          }}
                        >
                          {selected.has(fileKey(repo.id, file.path)) ? <Icon name="check" size={12} /> : null}
                        </span>
                        <span className={`file-name ${statusClass(file.status)}`}>{displayName(file.path)}</span>
                        <span className="file-dir">{dirName(file.path)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <ChangeTree
                  nodes={tree}
                  depth={0}
                  repo={repo}
                  section={section.key}
                  selected={selected}
                  collapsed={collapsedDirs}
                  onToggleDir={toggleDir}
                  onToggleFile={(file) => toggleFile(repo.id, file)}
                  onToggleFiles={(list, select) => setFiles(repo, list, select)}
                  onOpen={(file) => openDiff(repo, file, section.key)}
                />
              )}
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <div className="screen">
      <header className="topbar">
        <h1>{ws.name}</h1>
        <div className="segmented mode-seg">
          <button className={mode === 'list' ? 'on' : ''} onClick={() => changeMode('list')}>列表</button>
          <button className={mode === 'tree' ? 'on' : ''} onClick={() => changeMode('tree')}>树</button>
        </div>
      </header>

      <div className="summary-strip">
        <span><b>{ws.repos.length}</b> 个仓库</span>
        <span><b>{totalFiles}</b> 个待提交文件</span>
        {totalConflicts > 0 ? <span className="danger-text"><b>{totalConflicts}</b> 处冲突</span> : null}
      </div>

      {sections.filter((section) => section.files.length > 0).map(renderSection)}
      {totalFiles === 0 ? <Empty title="工作区干净" hint="所有仓库都没有未提交改动。" icon="check" /> : null}

      {selected.size > 0 ? (
        <div className="floating-bar">
          <span>已选 <b>{selected.size}</b> 个文件 · {groups.length} 个仓库</span>
          <button className="btn primary" onClick={() => setCommitOpen(true)}>提交</button>
        </div>
      ) : null}

      <Sheet
        open={commitOpen}
        title="统一提交"
        onClose={() => setCommitOpen(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setCommitOpen(false)}>取消</button>
            <button className="btn primary" disabled={busy || !message.trim()} onClick={() => void submit()}>
              {busy ? '提交中…' : pushAfter ? '提交并推送' : '提交'}
            </button>
          </>
        }
      >
        <div className="commit-summary">
          {groups.map((g) => (
            <div className="commit-group" key={g.repo.id}>
              <span className="repo-chip" style={{ borderColor: repoColor(g.repo.name) }}>{g.repo.name}</span>
              <span>{g.paths.length} 个文件</span>
            </div>
          ))}
        </div>
        <textarea
          className="commit-input"
          rows={4}
          placeholder="提交说明（必填）"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus
        />
        <label className="check-row">
          <input type="checkbox" checked={pushAfter} onChange={(e) => setPushAfter(e.target.checked)} />
          <span>提交后立即推送到远端</span>
        </label>
        {groups.length === 1 ? (
          <label className="check-row">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            <span>修改上一次提交（--amend，仅未推送）</span>
          </label>
        ) : null}
        <p className="hint">提交会先把所选文件加入暂存区。推送永不使用 --force；已推送或已打标签的提交不能 amend。</p>
      </Sheet>
      <div className={`screen-bottom-space changes-bottom-space ${selected.size > 0 ? 'action' : ''}`} />
    </div>
  )
}

function ChangeTree({
  nodes,
  depth,
  repo,
  section,
  selected,
  collapsed,
  onToggleDir,
  onToggleFile,
  onToggleFiles,
  onOpen,
}: {
  nodes: TreeNode[]
  depth: number
  repo: RepoState
  section: SectionKey
  selected: Set<string>
  collapsed: Set<string>
  onToggleDir: (key: string) => void
  onToggleFile: (file: FileChange) => void
  onToggleFiles: (files: FileChange[], select: boolean) => void
  onOpen: (file: FileChange) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const key = `${section}:${repo.id}:${node.path}`
        if (node.dir) {
          const files = collectFiles(node)
          const count = files.filter((file) => selected.has(fileKey(repo.id, file.path))).length
          const state = count === 0 ? 'none' : count === files.length ? 'all' : 'some'
          const isCollapsed = collapsed.has(key)
          return (
            <Fragment key={`d:${key}`}>
              <div className="change-tree-row dir" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onToggleDir(key)}>
                <TriCheckbox state={state} label={`选择 ${node.path}`} onToggle={() => onToggleFiles(files, state !== 'all')} />
                <Icon name={isCollapsed ? 'chevron' : 'down'} size={12} />
                <Icon name="folder" size={14} />
                <span className="tree-name">{node.name}</span>
                <span className="tree-count">{files.length}</span>
              </div>
              {!isCollapsed ? (
                <ChangeTree
                  nodes={node.children}
                  depth={depth + 1}
                  repo={repo}
                  section={section}
                  selected={selected}
                  collapsed={collapsed}
                  onToggleDir={onToggleDir}
                  onToggleFile={onToggleFile}
                  onToggleFiles={onToggleFiles}
                  onOpen={onOpen}
                />
              ) : null}
            </Fragment>
          )
        }
        const file = node.file
        if (!file) return null
        return (
          <div
            key={`f:${key}`}
            className="change-tree-row file"
            style={{ paddingLeft: 10 + depth * 14 + 14 }}
            onClick={() => onOpen(file)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(file)
            }}
          >
            <TriCheckbox
              state={selected.has(fileKey(repo.id, file.path)) ? 'all' : 'none'}
              label={`选择 ${file.path}`}
              onToggle={() => onToggleFile(file)}
            />
            <span className={`file-name ${statusClass(file.status)}`}>{displayName(file.path)}</span>
          </div>
        )
      })}
    </>
  )
}
