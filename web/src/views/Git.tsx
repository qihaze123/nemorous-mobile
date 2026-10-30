import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BranchList, Commit, CommitDetail, OpResult, Workspace } from '../types'
import { api, post } from '../api'
import { back, go } from '../hooks'
import { Empty, Icon, PatchView, SectionTitle, Sheet, Spinner, ago, dayKey, repoColor, timeOf, useToast } from '../components'

function ResultSheet({ results, onClose }: { results: OpResult[] | null; onClose: () => void }) {
  return (
    <Sheet open={!!results} title="操作结果" onClose={onClose}>
      <div className="result-list">
        {(results ?? []).map((r) => (
          <div className="op-result" key={`${r.repoId}:${r.message}`}>
            <span className={`op-status ${r.status.toLowerCase()}`}>{r.status}</span>
            <span className="repo-name">{r.repoName}</span>
            <span className="op-message">{r.message}</span>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

export function GitScreen({ ws, refresh }: { ws: Workspace; refresh: () => Promise<void> }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState<OpResult[] | null>(null)
  const [repoSheet, setRepoSheet] = useState<string | null>(null)
  const [branchSheet, setBranchSheet] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [createBranch, setCreateBranch] = useState(false)
  const [busy, setBusy] = useState(false)
  const notify = useToast()

  const loadCommits = useCallback(async () => {
    try {
      setCommits(await api<Commit[]>('/api/commits?limit=150'))
    } catch (err) {
      notify(err instanceof Error ? err.message : '读取提交历史失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadCommits()
  }, [loadCommits, ws.generatedAt])

  const batch = async (action: 'pull' | 'push') => {
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>('/api/batch', { action })
      setResults(res.results)
      await refresh()
      await loadCommits()
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const switchAll = async () => {
    if (!branchInput.trim()) return
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>('/api/batch', {
        action: 'checkout',
        branch: branchInput.trim(),
        create: createBranch,
      })
      setResults(res.results)
      setBranchSheet(false)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const grouped = useMemo(() => {
    const map: { day: string; items: Commit[] }[] = []
    for (const commit of commits) {
      const day = dayKey(commit.time)
      const last = map[map.length - 1]
      if (last && last.day === day) last.items.push(commit)
      else map.push({ day, items: [commit] })
    }
    return map
  }, [commits])

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">提交</div>
          <h1>统一提交森林</h1>
        </div>
        <button className="icon-btn" onClick={() => void refresh().then(loadCommits)} aria-label="刷新">
          <Icon name="refresh" />
        </button>
      </header>

      <div className="action-row">
        <button className="btn subtle" disabled={busy} onClick={() => void batch('pull')}>
          <Icon name="sync" size={16} /> 全部拉取
        </button>
        <button className="btn subtle" disabled={busy} onClick={() => void batch('push')}>
          <Icon name="branch" size={16} /> 全部推送
        </button>
        <button className="btn subtle" disabled={busy} onClick={() => setBranchSheet(true)}>
          <Icon name="git" size={16} /> 统一切分支
        </button>
      </div>

      <SectionTitle>仓库</SectionTitle>
      <div className="repo-list">
        {ws.repos.map((repo) => (
          <button className="repo-row" key={repo.id} onClick={() => setRepoSheet(repo.id)}>
            <span className="repo-avatar small" style={{ background: repoColor(repo.name) }}>{repo.name.slice(0, 2)}</span>
            <span className="repo-row-main">
              <span className="repo-name">{repo.name}</span>
              <span className="repo-sub">
                <Icon name="branch" size={13} />
                <code>{repo.branch || '(无分支)'}</code>
                {repo.ahead > 0 ? <em className="ahead">↑{repo.ahead}</em> : null}
                {repo.behind > 0 ? <em className="behind">↓{repo.behind}</em> : null}
                {repo.files.length > 0 ? <em className="dirty-dot">{repo.files.length} 改动</em> : null}
              </span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </div>

      <SectionTitle>{loading ? '提交历史' : `最近 ${commits.length} 次提交`}</SectionTitle>
      {loading ? <Spinner label="汇总各仓库提交…" /> : null}
      {!loading && commits.length === 0 ? <Empty title="还没有提交" icon="git" /> : null}
      {grouped.map((group) => (
        <section className="commit-day" key={group.day}>
          <div className="commit-day-title">{group.day}</div>
          {group.items.map((commit) => (
            <button
              className="commit-row"
              key={`${commit.repoId}:${commit.hash}`}
              onClick={() => go(`#/commit?repo=${commit.repoId}&hash=${commit.hash}`)}
            >
              <span className="repo-dot" style={{ background: repoColor(commit.repoName ?? '') }} />
              <span className="commit-main">
                <span className="commit-subject">{commit.subject}</span>
                <span className="commit-meta">
                  {commit.repoName} · {commit.author} · {timeOf(commit.time)} · {ago(commit.time)}
                </span>
              </span>
              <code className="commit-hash">{commit.short}</code>
            </button>
          ))}
        </section>
      ))}

      <RepoSheet
        repoId={repoSheet}
        onClose={() => setRepoSheet(null)}
        notify={notify}
        refresh={refresh}
      />

      <Sheet
        open={branchSheet}
        title="所有仓库统一切分支"
        onClose={() => setBranchSheet(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setBranchSheet(false)}>取消</button>
            <button className="btn primary" disabled={busy || !branchInput.trim()} onClick={() => void switchAll()}>
              执行
            </button>
          </>
        }
      >
        <input
          className="text-input"
          value={branchInput}
          onChange={(e) => setBranchInput(e.target.value)}
          placeholder="分支名，例如 feature/login"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <label className="check-row">
          <input type="checkbox" checked={createBranch} onChange={(e) => setCreateBranch(e.target.checked)} />
          <span>不存在时基于当前提交新建</span>
        </label>
        <p className="hint">有未提交改动的仓库会被安全跳过，不会覆盖本地代码。</p>
      </Sheet>

      <ResultSheet results={results} onClose={() => setResults(null)} />
      <div className="screen-bottom-space" />
    </div>
  )
}

function RepoSheet({
  repoId,
  onClose,
  notify,
  refresh,
}: {
  repoId: string | null
  onClose: () => void
  notify: (text: string, kind?: 'ok' | 'error' | 'info') => void
  refresh: () => Promise<void>
}) {
  const [detail, setDetail] = useState<BranchList | null>(null)
  const [busy, setBusy] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!repoId) {
      setDetail(null)
      return
    }
    setLoading(true)
    api<BranchList>(`/api/repos/${repoId}`)
      .then(setDetail)
      .catch((err) => notify(err instanceof Error ? err.message : '读取仓库失败', 'error'))
      .finally(() => setLoading(false))
  }, [repoId, notify])

  const act = async (path: string, body: unknown, label: string) => {
    if (!repoId) return
    setBusy(path)
    try {
      const res = await post<OpResult>(`/api/repos/${repoId}${path}`, body)
      notify(`${detail?.repo.name ?? ''}: ${res.message}`, res.status === 'FAIL' ? 'error' : res.status === 'SKIP' ? 'info' : 'ok')
      await refresh()
      const fresh = await api<BranchList>(`/api/repos/${repoId}`)
      setDetail(fresh)
    } catch (err) {
      notify(err instanceof Error ? err.message : `${label}失败`, 'error')
    } finally {
      setBusy('')
    }
  }

  const reload = async () => {
    if (!repoId) return
    try {
      setDetail(await api<BranchList>(`/api/repos/${repoId}`))
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : '刷新失败', 'error')
    }
  }

  const branches = detail?.branches ?? []
  const remotes = (detail?.remotes ?? []).filter((r) => !r.endsWith('/HEAD'))

  return (
    <Sheet open={!!repoId} title={detail?.repo.name ?? '仓库'} onClose={onClose}>
      {loading ? <Spinner label="读取分支…" /> : null}
      {detail ? (
        <>
          <div className="repo-detail-head">
            <span className="repo-sub">
              <Icon name="branch" size={14} /> <code>{detail.repo.branch}</code>
            </span>
            {detail.repo.ahead > 0 ? <span className="pill">待推送 {detail.repo.ahead}</span> : null}
            {detail.repo.behind > 0 ? <span className="pill">落后 {detail.repo.behind}</span> : null}
          </div>
          <div className="action-row">
            <button className="btn subtle" disabled={!!busy} onClick={() => void act('/pull', {}, '拉取')}>拉取</button>
            <button className="btn subtle" disabled={!!busy} onClick={() => void act('/push', {}, '推送')}>推送</button>
            <button className="btn subtle" disabled={!!busy} onClick={() => void reload()}>刷新</button>
          </div>

          <SectionTitle>本地分支</SectionTitle>
          <div className="branch-list">
            {branches.map((b) => (
              <button
                key={b}
                className={`branch-row ${b === detail.repo.branch ? 'current' : ''}`}
                disabled={!!busy}
                onClick={() => void act('/checkout', { branch: b }, '切换分支')}
              >
                <Icon name="branch" size={15} />
                <span>{b}</span>
                {b === detail.repo.branch ? <em>当前</em> : null}
              </button>
            ))}
            {branches.length === 0 ? <p className="hint">没有本地分支。</p> : null}
          </div>

          <div className="inline-form">
            <input
              className="text-input"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="新建分支…"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button
              className="btn primary"
              disabled={!!busy || !newBranch.trim()}
              onClick={() => void act('/checkout', { branch: newBranch.trim(), create: true }, '新建分支')}
            >
              新建
            </button>
          </div>

          {remotes.length > 0 ? (
            <>
              <SectionTitle>远端分支</SectionTitle>
              <div className="branch-list">
                {remotes.map((r) => {
                  const short = r.includes('/') ? r.slice(r.indexOf('/') + 1) : r
                  return (
                    <button
                      key={r}
                      className="branch-row remote"
                      disabled={!!busy}
                      onClick={() => void act('/checkout', { branch: short }, '切换分支')}
                    >
                      <Icon name="branch" size={15} />
                      <span>{r}</span>
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
          <p className="hint">切换分支遇到未提交改动会被安全跳过。推送永不使用 --force。</p>
        </>
      ) : null}
    </Sheet>
  )
}

export function CommitScreen({ repoId, hash }: { repoId: string; hash: string }) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setDetail(null)
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash])

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => back('#/git')} aria-label="返回">
          <Icon name="back" />
        </button>
        <div className="grow">
          <div className="eyebrow">提交详情</div>
          <h1 className="file-title">{detail?.commit.subject ?? hash.slice(0, 8)}</h1>
        </div>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {!detail && !error ? <Spinner label="读取提交…" /> : null}
      {detail ? (
        <>
          <div className="commit-card">
            <div className="commit-meta-grid">
              <span>仓库</span><span>{detail.commit.repoName}</span>
              <span>作者</span><span>{detail.commit.author}</span>
              <span>时间</span><span>{new Date(detail.commit.time * 1000).toLocaleString('zh-CN')}</span>
              <span>哈希</span><code>{detail.commit.hash}</code>
            </div>
          </div>
          <SectionTitle>{detail.files.length} 个文件变更</SectionTitle>
          <div className="commit-files">
            {detail.files.map((f) => (
              <div className="commit-file" key={f.path}>
                <span className={`status-letter s-${f.status.slice(0, 1) === '?' ? 'untracked' : f.status.slice(0, 1)}`}>{f.status.slice(0, 1)}</span>
                <span className="file-path">{f.path}</span>
              </div>
            ))}
          </div>
          <PatchView patch={detail.patch} />
        </>
      ) : null}
      <div className="screen-bottom-space" />
    </div>
  )
}
