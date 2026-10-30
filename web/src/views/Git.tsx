import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchList, BranchPreset, BranchesResponse, Commit, CommitDetail, CommitFile, OpResult, PresetsResponse, UndoResult, Workspace } from '../types'
import { api, post } from '../api'
import { back, go, useDebounced } from '../hooks'
import { ConfirmSheet, Empty, Icon, PatchView, SectionTitle, Sheet, Spinner, ago, dayKey, repoColor, timeOf, useToast, type PatchViewHandle } from '../components'

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

interface CommitFilters {
  repoId: string
  branch: string
  mine: boolean
  path: string
  days: number
  regex: boolean
  caseSensitive: boolean
}

const EMPTY_FILTERS: CommitFilters = {
  repoId: '',
  branch: '',
  mine: false,
  path: '',
  days: 0,
  regex: false,
  caseSensitive: false,
}

function filterCount(f: CommitFilters): number {
  return [f.repoId, f.branch, f.mine, f.path, f.days, f.regex, f.caseSensitive].filter(Boolean).length
}

export function GitScreen({ ws, refresh }: { ws: Workspace; refresh: () => Promise<void> }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 250)
  const [filters, setFilters] = useState<CommitFilters>(EMPTY_FILTERS)
  const [draft, setDraft] = useState<CommitFilters>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [reload, setReload] = useState(0)
  const [results, setResults] = useState<OpResult[] | null>(null)
  const [repoSheet, setRepoSheet] = useState<string | null>(null)
  const [branchSheet, setBranchSheet] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [createBranch, setCreateBranch] = useState(false)
  const [stashFirst, setStashFirst] = useState(false)
  const [presets, setPresets] = useState<BranchPreset[]>([])
  const [busy, setBusy] = useState(false)
  const notify = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ limit: '150' })
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
    if (filters.repoId) params.append('repo', filters.repoId)
    if (filters.branch) params.set('branch', filters.branch)
    if (filters.mine) params.set('mine', '1')
    if (filters.path.trim()) params.set('path', filters.path.trim())
    if (filters.days > 0) params.set('days', String(filters.days))
    if (filters.regex) params.set('regex', '1')
    if (filters.caseSensitive) params.set('case', '1')
    api<Commit[]>(`/api/commits?${params.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setCommits(res)
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取提交历史失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, filters, ws.generatedAt, reload])

  const batch = async (action: 'pull' | 'push') => {
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>('/api/batch', { action })
      setResults(res.results)
      await refresh()
      setReload((v) => v + 1)
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openBranchSheet = () => {
    setBranchSheet(true)
    api<PresetsResponse>('/api/presets').then((res) => setPresets(res.presets)).catch(() => {})
  }

  const applyPreset = async (name: string) => {
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>('/api/presets/apply', { name })
      setResults(res.results)
      setBranchSheet(false)
      await refresh()
      setReload((v) => v + 1)
    } catch (err) {
      notify(err instanceof Error ? err.message : '应用预设失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const batchStash = async (pop: boolean) => {
    setBusy(true)
    try {
      const res = await post<{ results: OpResult[] }>(pop ? '/api/batch/stash/pop' : '/api/batch/stash', { repos: [] })
      setResults(res.results)
      await refresh()
      setReload((v) => v + 1)
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
      let stashResults: OpResult[] = []
      if (stashFirst) {
        const stashed = await post<{ results: OpResult[] }>('/api/batch/stash', { repos: [] })
        stashResults = stashed.results
      }
      const res = await post<{ results: OpResult[] }>('/api/batch', {
        action: 'checkout',
        branch: branchInput.trim(),
        create: createBranch,
      })
      setResults([...stashResults, ...res.results])
      setBranchSheet(false)
      setStashFirst(false)
      await refresh()
      setReload((v) => v + 1)
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

  const active = filterCount(filters)
  const repoName = ws.repos.find((r) => r.id === filters.repoId)?.name
  const branchOptions = branches
    ? (filters.repoId ? (branches.byRepo[filters.repoId] ?? []) : branches.branches).slice(0, 40)
    : []

  const openFilters = () => {
    setDraft(filters)
    setFilterOpen(true)
    api<BranchesResponse>('/api/branches')
      .then(setBranches)
      .catch((err) => setError(err instanceof Error ? err.message : '读取分支失败'))
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">提交</div>
          <h1>统一提交森林</h1>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            void refresh()
            setReload((v) => v + 1)
          }}
          aria-label="刷新"
        >
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
        <button className="btn subtle" disabled={busy} onClick={openBranchSheet}>
          <Icon name="git" size={16} /> 统一切分支
        </button>
      </div>
      <div className="action-row">
        <button className="btn subtle" disabled={busy} onClick={() => void batchStash(false)}>
          <Icon name="folder" size={16} /> 全部 Stash
        </button>
        <button className="btn subtle" disabled={busy} onClick={() => void batchStash(true)}>
          <Icon name="refresh" size={16} /> 恢复全部 Stash
        </button>
      </div>

      <div className="commit-search search-box">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索提交信息 / 哈希 / 作者…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query ? (
          <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="清空搜索">
            <Icon name="close" size={16} />
          </button>
        ) : null}
        <button className={`icon-btn tiny filter-toggle ${active ? 'on' : ''}`} onClick={openFilters} aria-label="筛选提交">
          <Icon name="filter" size={17} />
          {active ? <em>{active}</em> : null}
        </button>
      </div>

      {active ? (
        <div className="active-filters">
          {repoName ? <span className="chip on">{repoName}</span> : null}
          {filters.branch ? <span className="chip on">{filters.branch}</span> : null}
          {filters.mine ? <span className="chip on">只看我</span> : null}
          {filters.path ? <span className="chip on">路径 {filters.path}</span> : null}
          {filters.days ? <span className="chip on">最近 {filters.days} 天</span> : null}
          {filters.regex ? <span className="chip on">正则</span> : null}
          {filters.caseSensitive ? <span className="chip on">区分大小写</span> : null}
          <button className="chip clear" onClick={() => setFilters(EMPTY_FILTERS)}>清除</button>
        </div>
      ) : null}

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

      <SectionTitle>
        {loading ? '提交历史' : active || debouncedQuery.trim() ? `匹配 ${commits.length} 次提交` : `最近 ${commits.length} 次提交`}
      </SectionTitle>
      {error ? <div className="error-banner"><Icon name="warning" size={15} /> {error}</div> : null}
      {loading ? <Spinner label="汇总各仓库提交…" /> : null}
      {!loading && commits.length === 0 ? (
        <Empty
          title={active || debouncedQuery.trim() ? '没有匹配的提交' : '还没有提交'}
          hint={active || debouncedQuery.trim() ? '试试更短的关键词，或清除部分筛选条件。' : undefined}
          icon="git"
        />
      ) : null}
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

      <Sheet
        open={filterOpen}
        title="筛选提交"
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
              }}
            >
              重置
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setFilters(draft)
                setFilterOpen(false)
              }}
            >
              应用
            </button>
          </>
        }
      >
        <SectionTitle>仓库</SectionTitle>
        <div className="repo-chips wrap">
          <button className={`chip ${draft.repoId === '' ? 'on' : ''}`} onClick={() => setDraft({ ...draft, repoId: '', branch: '' })}>
            全部仓库
          </button>
          {ws.repos.map((repo) => (
            <button
              key={repo.id}
              className={`chip ${draft.repoId === repo.id ? 'on' : ''}`}
              onClick={() => setDraft({ ...draft, repoId: repo.id, branch: '' })}
            >
              {repo.name}
            </button>
          ))}
        </div>

        <SectionTitle>分支</SectionTitle>
        <div className="repo-chips wrap">
          <button className={`chip ${draft.branch === '' ? 'on' : ''}`} onClick={() => setDraft({ ...draft, branch: '' })}>
            全部分支
          </button>
          {branchOptions.map((branch) => (
            <button
              key={branch}
              className={`chip ${draft.branch === branch ? 'on' : ''}`}
              onClick={() => setDraft({ ...draft, branch })}
            >
              {branch}
            </button>
          ))}
          {!branches ? <span className="hint">读取分支…</span> : null}
        </div>

        <label className="check-row">
          <input type="checkbox" checked={draft.mine} onChange={(e) => setDraft({ ...draft, mine: e.target.checked })} />
          <span>只看我的提交（按仓库 user.email）</span>
        </label>

        <label className="field">
          <span>路径（可选，仓库相对路径或目录）</span>
          <input
            className="text-input"
            value={draft.path}
            onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            placeholder="例如 sms-api/src/main/java"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <SectionTitle>时间</SectionTitle>
        <div className="segmented">
          {[{ v: 0, label: '全部' }, { v: 7, label: '7 天' }, { v: 30, label: '30 天' }, { v: 90, label: '90 天' }].map((item) => (
            <button
              key={item.v}
              className={draft.days === item.v ? 'on' : ''}
              onClick={() => setDraft({ ...draft, days: item.v })}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="filter-row">
          <button className={`chip ${draft.regex ? 'on' : ''}`} onClick={() => setDraft({ ...draft, regex: !draft.regex })}>
            .* 正则
          </button>
          <button className={`chip ${draft.caseSensitive ? 'on' : ''}`} onClick={() => setDraft({ ...draft, caseSensitive: !draft.caseSensitive })}>
            Aa 区分大小写
          </button>
        </div>
        <p className="hint">文本匹配提交信息、完整/短哈希与作者；分支和路径由 Git 在历史中筛选，最多扫描每仓 1000 条。</p>
      </Sheet>

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
        {presets.length > 0 ? (
          <>
            <SectionTitle>已保存的组合</SectionTitle>
            <div className="repo-chips wrap">
              {presets.map((preset) => (
                <button key={preset.name} className="chip" disabled={busy} onClick={() => void applyPreset(preset.name)}>
                  {preset.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
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
        <label className="check-row">
          <input type="checkbox" checked={stashFirst} onChange={(e) => setStashFirst(e.target.checked)} />
          <span>先 stash 有改动的仓库（不自动恢复）</span>
        </label>
        <p className="hint">有未提交改动的仓库默认会被安全跳过；勾选 stash 后会先收起改动再切换，恢复需手动操作。</p>
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
  const [confirmUndo, setConfirmUndo] = useState(false)

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

  const undo = async () => {
    if (!repoId) return
    setBusy('undo')
    try {
      const res = await post<UndoResult>(`/api/repos/${repoId}/undo`, {})
      notify(`已撤销 ${res.short} ${res.subject}`, 'ok')
      setConfirmUndo(false)
      await refresh()
      setDetail(await api<BranchList>(`/api/repos/${repoId}`))
    } catch (err) {
      notify(err instanceof Error ? err.message : '撤销失败', 'error')
    } finally {
      setBusy('')
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
          <div className="action-row">
            <button className="btn subtle" disabled={!!busy} onClick={() => void act('/stash', { message: '' }, '暂存改动')}>暂存改动</button>
            <button className="btn subtle" disabled={!!busy} onClick={() => void act('/stash/pop', {}, '恢复 Stash')}>恢复 Stash</button>
            <button className="btn subtle" disabled={!!busy} onClick={() => setConfirmUndo(true)}>撤销提交</button>
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
          <ConfirmSheet
            open={confirmUndo}
            title="撤销上一次提交"
            body={`将对 ${detail.repo.name} 执行 git reset --soft HEAD~1：提交回到暂存区，工作区文件不变。仅允许撤销未推送、非合并的提交。`}
            confirmText="确认撤销"
            danger
            onCancel={() => setConfirmUndo(false)}
            onConfirm={() => void undo()}
          />
        </>
      ) : null}
    </Sheet>
  )
}

function splitPatch(patch: string): Map<string, string> {
  const out = new Map<string, string>()
  let current = ''
  let lines: string[] = []
  const flush = () => {
    if (current && lines.length) out.set(current, lines.join('\n'))
  }
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      const rest = line.slice('diff --git '.length)
      const sep = rest.lastIndexOf(' b/')
      current = sep >= 0 ? rest.slice(sep + 3) : ''
      lines = [line]
    } else if (current) {
      lines.push(line)
    }
  }
  flush()
  return out
}

interface CommitTreeNode {
  name: string
  path: string
  dir: boolean
  children: CommitTreeNode[]
  file?: CommitFile
}

function buildCommitTree(files: CommitFile[]): CommitTreeNode[] {
  const root: CommitTreeNode[] = []
  for (const file of files) {
    const parts = file.path.split('/')
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
      if (dir) {
        level = node.children
      } else {
        node.file = file
      }
    }
  }
  const sortLevel = (nodes: CommitTreeNode[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    for (const node of nodes) if (node.dir) sortLevel(node.children)
  }
  sortLevel(root)
  return root
}

function CommitTreeRows({
  nodes,
  depth,
  collapsed,
  onToggle,
  onOpen,
}: {
  nodes: CommitTreeNode[]
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <Fragment key={`${node.dir ? 'd' : 'f'}:${node.path}`}>
          {node.dir ? (
            <>
              <button
                className="commit-tree-row dir"
                style={{ paddingLeft: 4 + depth * 14 }}
                onClick={() => onToggle(node.path)}
              >
                <Icon name={collapsed.has(node.path) ? 'chevron' : 'down'} size={13} />
                <Icon name="folder" size={15} />
                <span className="tree-name">{node.name}</span>
              </button>
              {!collapsed.has(node.path) ? (
                <CommitTreeRows nodes={node.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />
              ) : null}
            </>
          ) : (
            <button
              className="commit-tree-row file"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onOpen(node.path)}
            >
              <span className={`status-letter s-${node.file?.status.slice(0, 1) === '?' ? 'untracked' : node.file?.status.slice(0, 1)}`}>
                {node.file?.status.slice(0, 1)}
              </span>
              <span className="tree-name" title={node.path}>{node.name}</span>
              <span className="file-stats">
                {(node.file?.added ?? 0) > 0 ? <em className="plus">+{node.file?.added}</em> : null}
                {(node.file?.deleted ?? 0) > 0 ? <em className="minus">−{node.file?.deleted}</em> : null}
              </span>
              <Icon name="chevron" size={14} />
            </button>
          )}
        </Fragment>
      ))}
    </>
  )
}

export function CommitScreen({ repoId, hash }: { repoId: string; hash: string }) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  useEffect(() => {
    setDetail(null)
    setCollapsed(new Set())
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash])

  const tree = useMemo(() => buildCommitTree(detail?.files ?? []), [detail])

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
          <SectionTitle
            action={
              <button
                className="mini-btn"
                onClick={() => go(`#/commit-patch?repo=${repoId}&hash=${hash}`)}
              >
                完整 Patch
              </button>
            }
          >
            {detail.files.length} 个文件变更
          </SectionTitle>
          <div className="commit-tree">
            <div className="commit-tree-root">
              <Icon name="folder" size={15} />
              <span>{detail.commit.repoName}</span>
            </div>
            <CommitTreeRows
              nodes={tree}
              depth={0}
              collapsed={collapsed}
              onToggle={(path) =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              }
              onOpen={(path) =>
                go(`#/commit-file?repo=${repoId}&hash=${hash}&path=${encodeURIComponent(path)}`)
              }
            />
          </div>
          <p className="hint">点文件查看单独 Diff；目录可折叠；完整 Patch 在右上角。</p>
        </>
      ) : null}
      <div className="screen-bottom-space" />
    </div>
  )
}

export function CommitFileScreen({ repoId, hash, path }: { repoId: string; hash: string; path: string }) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState('')
  const patchRef = useRef<PatchViewHandle>(null)
  useEffect(() => {
    setDetail(null)
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash])

  const chunks = useMemo(() => splitPatch(detail?.patch ?? ''), [detail])
  const index = detail ? detail.files.findIndex((f) => f.path === path) : -1
  const file = detail && index >= 0 ? detail.files[index] : null

  const jump = (direction: 1 | -1): boolean => {
    if (!detail) return false
    const next = detail.files[index + direction]
    if (!next) return false
    go(`#/commit-file?repo=${repoId}&hash=${hash}&path=${encodeURIComponent(next.path)}`)
    return true
  }

  const step = (direction: 1 | -1) => {
    if (patchRef.current?.scrollToHunk(direction)) return
    jump(direction)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        step(-1)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go(`#/commit?repo=${repoId}&hash=${hash}`)} aria-label="返回提交">
          <Icon name="back" />
        </button>
        <div className="grow">
          <div className="eyebrow">文件 Diff</div>
          <h1 className="file-title">{path}</h1>
        </div>
        <button
          className="icon-btn"
          onClick={() => go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}&rev=${hash}`)}
          aria-label="查看文件"
        >
          <Icon name="file" />
        </button>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {!detail && !error ? <Spinner label="读取提交…" /> : null}
      {detail ? (
        <>
          <div className="commit-file-meta">
            <span className={`status-letter s-${file?.status.slice(0, 1) === '?' ? 'untracked' : file?.status.slice(0, 1)}`}>{file?.status.slice(0, 1)}</span>
            <span className="grow">{path}</span>
            <span className="file-stats">
              {(file?.added ?? 0) > 0 ? <em className="plus">+{file?.added}</em> : null}
              {(file?.deleted ?? 0) > 0 ? <em className="minus">−{file?.deleted}</em> : null}
            </span>
          </div>
          <div className="diff-nav-row">
            <button className="mini-btn" onClick={() => step(-1)} aria-label="上一处">
              <Icon name="up" size={14} /> 上一处
            </button>
            <button className="mini-btn" onClick={() => step(1)} aria-label="下一处">
              <Icon name="down" size={14} /> 下一处
            </button>
            <span className="spacer" />
            <button
              className="mini-btn"
              onClick={() => go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}&rev=${hash}`)}
            >
              查看此版本
            </button>
            <span className="diff-position">{index >= 0 ? `${index + 1}/${detail.files.length}` : ''}</span>
          </div>
          <PatchView ref={patchRef} patch={chunks.get(path) ?? ''} />
        </>
      ) : null}
      <div className="screen-bottom-space" />
    </div>
  )
}

export function CommitPatchScreen({ repoId, hash }: { repoId: string; hash: string }) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState('')
  const notify = useToast()
  useEffect(() => {
    setDetail(null)
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash])

  const added = detail?.files.reduce((n, f) => n + f.added, 0) ?? 0
  const deleted = detail?.files.reduce((n, f) => n + f.deleted, 0) ?? 0

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go(`#/commit?repo=${repoId}&hash=${hash}`)} aria-label="返回提交">
          <Icon name="back" />
        </button>
        <div className="grow">
          <div className="eyebrow">完整 Patch</div>
          <h1 className="file-title">{detail?.commit.subject ?? hash.slice(0, 8)}</h1>
        </div>
        <button
          className="icon-btn"
          disabled={!detail?.patch}
          onClick={async () => {
            if (!detail) return
            try {
              await navigator.clipboard.writeText(detail.patch)
              notify('已复制完整 Patch', 'ok')
            } catch {
              notify('复制失败', 'error')
            }
          }}
          aria-label="复制完整 Patch"
        >
          <Icon name="copy" />
        </button>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {!detail && !error ? <Spinner label="读取提交…" /> : null}
      {detail ? (
        <>
          <div className="commit-patch-meta">
            <span>{detail.files.length} 个文件</span>
            <span className="plus">+{added}</span>
            <span className="minus">−{deleted}</span>
            <span className="grow" />
            <code>{detail.commit.short}</code>
          </div>
          <PatchView patch={detail.patch} />
        </>
      ) : null}
      <div className="screen-bottom-space" />
    </div>
  )
}
