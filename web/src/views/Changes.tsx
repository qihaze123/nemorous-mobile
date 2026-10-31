import { useEffect, useMemo, useState } from 'react'
import type { FileChange, OpResult, RepoState, Workspace } from '../types'
import { post } from '../api'
import { go } from '../hooks'
import { Empty, HealthPill, Icon, Sheet, repoColor, useToast } from '../components'

function keyOf(repoId: string, path: string) {
  return `${repoId}::${path}`
}

function fileName(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

function dirName(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

interface RepoFiles {
  repo: RepoState
  files: FileChange[]
}

export function ChangesScreen({ ws, refresh }: { ws: Workspace; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [commitOpen, setCommitOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const notify = useToast()

  const repos = useMemo<RepoFiles[]>(
    () => ws.repos.map((repo) => ({ repo, files: repo.files })).filter((group) => group.files.length > 0),
    [ws],
  )
  const allFiles = useMemo(
    () => repos.flatMap((group) => group.files.map((file) => ({ repo: group.repo, file }))),
    [repos],
  )
  const totalFiles = allFiles.length
  const totalConflicts = ws.repos.reduce((n, r) => n + r.conflictCount, 0)
  const allSelected = totalFiles > 0 && allFiles.every(({ repo, file }) => selected.has(keyOf(repo.id, file.path)))

  const keys = useMemo(() => {
    const set = new Set<string>()
    for (const repo of ws.repos) for (const file of repo.files) set.add(keyOf(repo.id, file.path))
    return set
  }, [ws])

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => keys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [keys])

  const groups = useMemo(() => {
    const map = new Map<string, { repo: RepoState; paths: Set<string> }>()
    for (const repo of ws.repos) {
      for (const file of repo.files) {
        if (!selected.has(keyOf(repo.id, file.path))) continue
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

  const toggle = (repoId: string, path: string) => {
    const key = keyOf(repoId, path)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setMany = (list: { repo: RepoState; file: FileChange }[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const { repo, file } of list) {
        const key = keyOf(repo.id, file.path)
        if (select) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const quick = async (repo: RepoState, action: 'pull' | 'push') => {
    setBusyKey(`${repo.id}:${action}`)
    try {
      const res = await post<OpResult>(`/api/repos/${repo.id}/${action}`, {})
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
      if (failed.length) {
        notify(`${failed.length} 个仓库失败：${failed[0].repoName} ${failed[0].message}`, 'error')
      } else {
        notify(
          `已在 ${res.results.length} 个仓库提交 ${groups.reduce((n, g) => n + g.paths.length, 0)} 个文件${pushAfter ? '并推送' : ''}`,
          'ok',
        )
      }
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

  if (ws.repos.length === 0) {
    return (
      <div className="screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">改动</div>
            <h1>{ws.name}</h1>
          </div>
        </header>
        <Empty title="工作区里没有找到 Git 仓库" hint="在电脑上启动服务时指向包含多个仓库的目录，或直接指向单个仓库。" icon="folder" />
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">改动</div>
          <h1>{ws.name}</h1>
        </div>
        <button className="icon-btn" onClick={() => void refresh()} aria-label="刷新">
          <Icon name="refresh" />
        </button>
      </header>

      <div className="summary-strip">
        <span><b>{ws.repos.length}</b> 个仓库</span>
        <span><b>{totalFiles}</b> 个待提交文件</span>
        {totalConflicts > 0 ? <span className="danger-text"><b>{totalConflicts}</b> 处冲突</span> : null}
      </div>

      {totalFiles > 0 ? (
        <section className="change-section">
          <div className="change-section-head">
            <div className="section-toggle">
              <span className="section-name">待提交</span>
              <span className="section-count">{totalFiles}</span>
            </div>
            <div className="section-actions">
              <button className="mini-btn" onClick={() => setMany(allFiles, !allSelected)}>
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
          </div>

          {repos.map(({ repo, files }) => (
            <div className="repo-block" key={repo.id}>
              <div className="repo-block-head">
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
                <HealthPill health={repo.health} />
                <span className="repo-sync">
                  <button
                    className="icon-btn tiny"
                    aria-label={`拉取 ${repo.name}`}
                    disabled={busyKey === `${repo.id}:pull`}
                    onClick={() => void quick(repo, 'pull')}
                  >
                    <Icon name="sync" size={15} />
                  </button>
                  <button
                    className="icon-btn tiny"
                    aria-label={`推送 ${repo.name}`}
                    disabled={busyKey === `${repo.id}:push` || repo.ahead === 0}
                    onClick={() => void quick(repo, 'push')}
                  >
                    <Icon name="branch" size={15} />
                  </button>
                </span>
              </div>
              <div className="file-list">
                {files.map((file) => {
                  const selectedNow = selected.has(keyOf(repo.id, file.path))
                  const stagedOnly = file.staged && !file.unstaged
                  return (
                    <div
                      className={`file-row ${selectedNow ? 'picked' : ''}`}
                      key={`${repo.id}:${file.path}`}
                      onClick={() =>
                        go(`#/diff?repo=${repo.id}&path=${encodeURIComponent(file.path)}&staged=${stagedOnly ? 1 : 0}`)
                      }
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          go(`#/diff?repo=${repo.id}&path=${encodeURIComponent(file.path)}&staged=${stagedOnly ? 1 : 0}`)
                        }
                      }}
                    >
                      <span
                        className={`checkbox ${selectedNow ? 'on' : ''}`}
                        role="checkbox"
                        aria-checked={selectedNow}
                        aria-label={`选择 ${file.path}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggle(repo.id, file.path)
                        }}
                      >
                        {selectedNow ? <Icon name="check" size={12} /> : null}
                      </span>
                      <span className="file-info">
                        <span className="file-dir">{dirName(file.path)}</span>
                        <span className="file-name">{fileName(file.path)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <Empty title="工作区干净" hint="所有仓库都没有未提交改动。" icon="check" />
      )}

      {selected.size > 0 ? (
        <div className="floating-bar">
          <span>已选 <b>{selected.size}</b> 个文件 · {groups.length} 个仓库</span>
          <button className="btn primary" onClick={() => setCommitOpen(true)}>
            提交
          </button>
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
    </div>
  )
}
