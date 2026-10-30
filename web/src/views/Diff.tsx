import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffResult, Workspace } from '../types'
import { post, api } from '../api'
import { back, go } from '../hooks'
import { ConfirmSheet, DiffNavBar, Icon, PatchView, Spinner, StatusLetter, repoColor, useToast, type PatchViewHandle } from '../components'

function DiffSidebar({
  ws,
  repoId,
  path,
  staged,
  open,
}: {
  ws: Workspace
  repoId: string
  path: string
  staged: boolean
  open: boolean
}) {
  const groups = [
    {
      key: 'staged' as const,
      title: '已暂存',
      repos: ws.repos
        .map((repo) => ({ repo, files: repo.files.filter((f) => f.staged) }))
        .filter((g) => g.files.length > 0),
    },
    {
      key: 'unstaged' as const,
      title: '未暂存',
      repos: ws.repos
        .map((repo) => ({ repo, files: repo.files.filter((f) => f.untracked || f.unstaged || !f.staged) }))
        .filter((g) => g.files.length > 0),
    },
  ]
  return (
    <aside className={`diff-sidebar ${open ? 'open' : ''}`}>
      <div className="diff-sidebar-head">文件</div>
      {groups.map((group) => {
        const count = group.repos.reduce((n, g) => n + g.files.length, 0)
        return (
          <div className="diff-sidebar-section" key={group.key}>
            <div className="diff-sidebar-title">
              <span className={group.key === 'staged' ? 'staged' : ''}>{group.title}</span>
              <em>{count}</em>
            </div>
            {group.repos.map(({ repo, files }) => (
              <div className="diff-sidebar-repo" key={repo.id}>
                <div className="diff-sidebar-repo-name">
                  <span className="repo-dot" style={{ background: repoColor(repo.name) }} />
                  <span>{repo.name}</span>
                  <em>{files.length}</em>
                </div>
                {files.map((file) => {
                  const active =
                    repo.id === repoId &&
                    file.path === path &&
                    (group.key === 'staged' ? staged : !staged)
                  return (
                    <button
                      key={`${file.path}:${group.key}`}
                      className={`diff-sidebar-file ${active ? 'active' : ''}`}
                      onClick={() =>
                        go(`#/diff?repo=${repo.id}&path=${encodeURIComponent(file.path)}&staged=${group.key === 'staged' ? 1 : 0}`)
                      }
                      title={file.path}
                    >
                      <StatusLetter file={file} />
                      <span className="diff-sidebar-path">{file.path}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
      {groups.every((g) => g.repos.length === 0) ? <p className="hint">工作区没有改动。</p> : null}
    </aside>
  )
}

export function DiffScreen({
  ws,
  repoId,
  path,
  staged,
  refresh,
}: {
  ws: Workspace
  repoId: string
  path: string
  staged: boolean
  refresh: () => Promise<void>
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [version, setVersion] = useState(0)
  const patchRef = useRef<PatchViewHandle>(null)
  const boundary = useRef<{ direction: 1 | -1; at: number } | null>(null)
  const notify = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('nemorous.sidebar') !== 'closed')

  const repo = ws.repos.find((r) => r.id === repoId)
  const file = repo?.files.find((f) => f.path === path)
  const navFiles = useMemo(() => {
    const out: { repoId: string; path: string; staged: boolean }[] = []
    for (const r of ws.repos) {
      for (const f of r.files.filter((item) => item.staged)) out.push({ repoId: r.id, path: f.path, staged: true })
      for (const f of r.files.filter((item) => item.untracked || item.unstaged || !item.staged)) {
        out.push({ repoId: r.id, path: f.path, staged: false })
      }
    }
    return out
  }, [ws])
  const navIndex = navFiles.findIndex((f) => f.repoId === repoId && f.path === path && f.staged === staged)

  const jumpFile = (direction: 1 | -1): boolean => {
    const target = navFiles[navIndex + direction]
    if (!target) return false
    go(`#/diff?repo=${target.repoId}&path=${encodeURIComponent(target.path)}&staged=${target.staged ? 1 : 0}`)
    return true
  }

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem('nemorous.sidebar', prev ? 'closed' : 'open')
      return !prev
    })
  }

  const stepChange = (direction: 1 | -1) => {
    if (patchRef.current?.scrollToHunk(direction)) {
      boundary.current = null
      return
    }
    const now = Date.now()
    if (boundary.current?.direction === direction && now - boundary.current.at < 1600) {
      boundary.current = null
      jumpFile(direction)
      return
    }
    boundary.current = { direction, at: now }
    notify(direction > 0 ? '已到文件末尾，再按一次进入下一个文件' : '已到文件开头，再按一次进入上一个文件', 'info')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        stepChange(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        stepChange(-1)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    let cancelled = false
    setDiff(null)
    setError('')
    api<DiffResult>(`/api/repos/${repoId}/diff?path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`)
      .then((res) => {
        if (!cancelled) setDiff(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取差异失败')
      })
    return () => {
      cancelled = true
    }
  }, [repoId, path, staged, version])

  const act = async (action: 'stage' | 'unstage' | 'discard') => {
    setBusy(action)
    try {
      if (action === 'discard') {
        await post(`/api/repos/${repoId}/discard`, { paths: [path], confirm: true })
        notify('已丢弃本地改动', 'ok')
        setConfirmDiscard(false)
        await refresh()
        back('#/changes')
      } else {
        await post(`/api/repos/${repoId}/${action}`, { paths: [path] })
        notify(action === 'stage' ? '已暂存' : '已取消暂存', 'ok')
        await refresh()
        if (action === 'stage') {
          go(`#/diff?repo=${repoId}&path=${encodeURIComponent(path)}&staged=1`)
        }
        setVersion((v) => v + 1)
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="diff-page">
      <DiffSidebar ws={ws} repoId={repoId} path={path} staged={staged} open={sidebarOpen} />
      <div className="diff-main">
        <div className="screen diff-screen fill-screen">
      <header className="topbar">
        <button className="icon-btn sidebar-toggle" onClick={toggleSidebar} aria-label="文件栏">
          <Icon name="panel" />
        </button>
        <button className="icon-btn" onClick={() => back('#/changes')} aria-label="返回">
          <Icon name="back" />
        </button>
        <div className="grow">
          <div className="eyebrow">差异{file ? <StatusLetter file={file} /> : null}</div>
          <h1 className="file-title">{path}</h1>
        </div>
      </header>

      <div className="diff-toolbar">
        <div className="segmented">
          <button
            className={!staged ? 'on' : ''}
            onClick={() => go(`#/diff?repo=${repoId}&path=${encodeURIComponent(path)}&staged=0`)}
          >
            工作区
          </button>
          <button
            className={staged ? 'on' : ''}
            onClick={() => go(`#/diff?repo=${repoId}&path=${encodeURIComponent(path)}&staged=1`)}
          >
            暂存区
          </button>
        </div>
        <div className="spacer" />
        {file?.untracked || !staged ? (
          <button className="mini-btn" disabled={!!busy} onClick={() => void act('stage')}>暂存</button>
        ) : (
          <button className="mini-btn" disabled={!!busy} onClick={() => void act('unstage')}>取消暂存</button>
        )}
        <button
          className="mini-btn"
          disabled={!diff?.patch}
          onClick={async () => {
            if (!diff) return
            try {
              await navigator.clipboard.writeText(diff.patch)
              notify('已复制 patch', 'ok')
            } catch {
              notify('复制失败', 'error')
            }
          }}
        >
          复制
        </button>
        <button className="mini-btn danger" disabled={!!busy} onClick={() => setConfirmDiscard(true)}>丢弃</button>
      </div>

      <DiffNavBar
        position={navIndex >= 0 ? `${navIndex + 1}/${navFiles.length}` : ''}
        canPrevFile={navIndex > 0}
        canNextFile={navIndex >= 0 && navIndex < navFiles.length - 1}
        onPrevChange={() => stepChange(-1)}
        onNextChange={() => stepChange(1)}
        onPrevFile={() => jumpFile(-1)}
        onNextFile={() => jumpFile(1)}
        onOpen={() => {
          const line = patchRef.current?.currentLine()
          go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`)
        }}
      />

      {error ? <div className="error-banner"><Icon name="warning" size={15} /> {error}</div> : null}
      {!diff && !error ? <Spinner label="读取差异…" /> : null}
      {diff ? <PatchView ref={patchRef} patch={diff.patch} binary={diff.binary} /> : null}

      <ConfirmSheet
        open={confirmDiscard}
        title="丢弃本地改动"
        body={`将把 ${path} 恢复为 HEAD 的内容；未跟踪文件会被直接删除。此操作不可撤销。`}
        confirmText="确认丢弃"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => void act('discard')}
      />
      <div className="screen-bottom-space" />
        </div>
      </div>
    </div>
  )
}
