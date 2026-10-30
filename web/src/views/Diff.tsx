import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffResult, Workspace } from '../types'
import { post, api } from '../api'
import { back, go } from '../hooks'
import { ConfirmSheet, DiffNavBar, Icon, PatchView, Spinner, StatusLetter, useToast, type PatchViewHandle } from '../components'

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
    <div className="screen diff-screen">
      <header className="topbar">
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
        onOpen={() => go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}`)}
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
  )
}
