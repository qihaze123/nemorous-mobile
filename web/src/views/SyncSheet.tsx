import { useEffect, useState } from 'react'
import type { OpResult, Workspace } from '../types'
import { post } from '../api'
import { Icon, Sheet, repoColor } from '../components'
import { summarizeResults, type ToastKind } from './BranchSwitchSheet'

type Mode = 'pull' | 'push'

export function SyncSheet({
  open,
  mode,
  ws,
  onClose,
  refresh,
  notify,
}: {
  open: boolean
  mode: Mode
  ws: Workspace
  onClose: () => void
  refresh: () => Promise<void>
  notify: (text: string, kind?: ToastKind) => void
}) {
  const [scope, setScope] = useState('all')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setScope(ws.repos.length > 1 ? 'all' : (ws.repos[0]?.id ?? 'all'))
    setBusy(false)
  }, [open, mode, ws.repos.length])

  const label = mode === 'pull' ? '拉取' : '推送'
  const single = scope !== 'all'
  const target = ws.repos.find((repo) => repo.id === scope)

  const run = async () => {
    if (busy || (!single && ws.repos.length === 0)) return
    setBusy(true)
    try {
      const results = single
        ? [await post<OpResult>(`/api/repos/${scope}/${mode}`, {})]
        : (await post<{ results: OpResult[] }>('/api/batch', { action: mode })).results
      const summary = summarizeResults(results)
      notify(summary.text, summary.kind)
      await refresh()
      if (summary.kind !== 'error') onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : `${label}失败`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      title={label}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy || (single && !target)} onClick={() => void run()}>
            {busy ? `${label}中…` : label}
          </button>
        </>
      }
    >
      <div className="scope-list">
        {ws.repos.length > 1 ? (
          <button className={`scope-row ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')} disabled={busy}>
            <span className="scope-radio">{scope === 'all' ? <i /> : null}</span>
            <Icon name="git" size={17} />
            <span className="scope-main">
              <span className="scope-name">全部项目</span>
              <span className="scope-sub">{ws.repos.length} 个仓库</span>
            </span>
          </button>
        ) : null}
        {ws.repos.map((repo) => (
          <button
            key={repo.id}
            className={`scope-row ${scope === repo.id ? 'on' : ''}`}
            onClick={() => setScope(repo.id)}
            disabled={busy}
          >
            <span className="scope-radio">{scope === repo.id ? <i /> : null}</span>
            <span className="repo-avatar small" style={{ background: repoColor(repo.name) }}>{repo.name.slice(0, 2)}</span>
            <span className="scope-main">
              <span className="scope-name">{repo.name}</span>
              <span className="scope-sub">{repo.branch || '(无分支)'}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">
        {mode === 'pull'
          ? '未暂存的 tracked 改动会自动 stash 并在拉取后恢复；有已暂存改动或冲突的仓库会跳过。'
          : '只推送已有的本地提交，不使用 --force；没有上游的分支会尝试设置 origin/HEAD。'}
      </p>
    </Sheet>
  )
}
