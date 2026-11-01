import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchList, BranchesResponse, Commit, CommitDetail, CommitFile, Workspace } from '../types'
import { api } from '../api'
import { back, go, replace, useDebounced, useDiffFontSize, useImmersive, usePinchZoom, useSidebarWidth, useSidebarZoom } from '../hooks'
import { Empty, Icon, ImmersiveDiffBar, ImmersiveDock, MultiPatchView, PatchView, SectionTitle, Sheet, SidebarResizer, Spinner, ago, dayKey, repoColor, timeOf, useToast, type PatchViewHandle } from '../components'
import { TreeLevel, buildTree, collectDirPaths, type TreeFileMeta } from './Code'
import { languageOf } from '../syntax'

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

export function GitScreen({ ws }: { ws: Workspace }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 250)
  const [filters, setFilters] = useState<CommitFilters>(EMPTY_FILTERS)
  const [draft, setDraft] = useState<CommitFilters>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [repoSheet, setRepoSheet] = useState<string | null>(null)
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
  }, [debouncedQuery, filters, ws.generatedAt])

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
      </header>

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
              <span className="repo-row-title">
                <span className="repo-name">{repo.name}</span>
                {repo.files.length > 0 ? <em className="repo-change-count">{repo.files.length} 改动</em> : null}
              </span>
              <span className="repo-sub">
                <Icon name="branch" size={13} />
                <code>{repo.branch || '(无分支)'}</code>
                {repo.ahead > 0 ? <em className="ahead">↑{repo.ahead}</em> : null}
                {repo.behind > 0 ? <em className="behind">↓{repo.behind}</em> : null}
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
      />

      <div className="screen-bottom-space" />
    </div>
  )
}

function RepoSheet({
  repoId,
  onClose,
  notify,
}: {
  repoId: string | null
  onClose: () => void
  notify: (text: string, kind?: 'ok' | 'error' | 'info') => void
}) {
  const [detail, setDetail] = useState<BranchList | null>(null)
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

          <SectionTitle>本地分支</SectionTitle>
          <div className="branch-list">
            {branches.map((b) => (
              <div key={b} className={`branch-row ${b === detail.repo.branch ? 'current' : ''}`}>
                <Icon name="branch" size={15} />
                <span>{b}</span>
                {b === detail.repo.branch ? <em>当前</em> : null}
              </div>
            ))}
            {branches.length === 0 ? <p className="hint">没有本地分支。</p> : null}
          </div>

          {remotes.length > 0 ? (
            <>
              <SectionTitle>远端分支</SectionTitle>
              <div className="branch-list">
                {remotes.map((r) => (
                  <div key={r} className="branch-row remote">
                    <Icon name="branch" size={15} />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <p className="hint">此处只读展示分支与远端信息。拉取、推送与切换分支请到改动页的「Git 操作」中执行（作用于全部仓库）。</p>
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
  dots,
  registerRow,
  onToggle,
  onOpen,
}: {
  nodes: CommitTreeNode[]
  depth: number
  collapsed: Set<string>
  dots: Set<string>
  registerRow: (key: string, el: HTMLElement | null) => void
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
                <CommitTreeRows nodes={node.children} depth={depth + 1} collapsed={collapsed} dots={dots} registerRow={registerRow} onToggle={onToggle} onOpen={onOpen} />
              ) : null}
            </>
          ) : (
            <button
              ref={(el) => registerRow(`f:${node.path}`, el)}
              className="commit-tree-row file"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onOpen(node.path)}
            >
              <span className={`status-letter s-${node.file?.status.slice(0, 1) === '?' ? 'untracked' : node.file?.status.slice(0, 1)}`}>
                {node.file?.status.slice(0, 1)}
              </span>
              <span className="tree-name" title={node.path}>{node.name}</span>
              <span className="tree-tail">
                {dots.has(`f:${node.path}`) ? <span className="tree-dots" aria-hidden="true">…</span> : null}
                <span className="file-stats">
                  {(node.file?.added ?? 0) > 0 ? <em className="plus">+{node.file?.added}</em> : null}
                  {(node.file?.deleted ?? 0) > 0 ? <em className="minus">−{node.file?.deleted}</em> : null}
                </span>
                <Icon name="chevron" size={14} />
              </span>
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
  const [dots, setDots] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLElement>())
  const registerRow = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rowEls.current.set(key, el)
    else rowEls.current.delete(key)
  }, [])
  const updateDots = useCallback(() => {
    const container = treeRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const next = new Set<string>()
    rowEls.current.forEach((el, key) => {
      if (el.getBoundingClientRect().right > rect.right + 1) next.add(key)
    })
    setDots((prev) => {
      if (prev.size === next.size && [...next].every((key) => prev.has(key))) return prev
      return next
    })
  }, [])
  useEffect(() => {
    const frame = requestAnimationFrame(updateDots)
    const observer = new ResizeObserver(updateDots)
    if (treeRef.current) observer.observe(treeRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [detail, collapsed, updateDots])
  const onTreeScroll = () => {
    updateDots()
  }
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
          <div className="commit-tree" ref={treeRef} onScroll={onTreeScroll}>
            <div className="commit-tree-inner">
            <div className="commit-tree-root">
              <Icon name="folder" size={15} />
              <span>{detail.commit.repoName}</span>
            </div>
            <CommitTreeRows
              nodes={tree}
              depth={0}
              collapsed={collapsed}
              dots={dots}
              registerRow={registerRow}
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
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const [folded, setFolded] = useState(true)
  const [findOpen, setFindOpen] = useState(false)
  const [find, setFind] = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findActive, setFindActive] = useState(0)
  const [copiedPath, setCopiedPath] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [immersive, setImmersive] = useImmersive()
  const [diffFontSize, setDiffFontSize] = useDiffFontSize()
  const [fontPanelOpen, setFontPanelOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('nemorous.commitFileSidebar') !== 'closed')
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth('nemorous.commitFileSidebarWidth')
  const [sidebarZoom, setSidebarZoom] = useSidebarZoom()
  const sidebarRef = useRef<HTMLElement>(null)
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set())
  const diffRoot = useRef<HTMLDivElement>(null)
  const patchRef = useRef<PatchViewHandle>(null)
  usePinchZoom(diffRoot, () => diffFontSize, setDiffFontSize, immersive)
  usePinchZoom(sidebarRef, () => sidebarZoom, setSidebarZoom, immersive && sidebarOpen)

  useEffect(() => {
    setDiffStyle('unified')
    setFolded(true)
    setFind('')
    setFindOpen(false)
    setFindActive(0)
    setToolsOpen(false)
    setFontPanelOpen(false)
  }, [path])

  useEffect(() => {
    setDetail(null)
    setError('')
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}?path=${encodeURIComponent(path)}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash, path])

  useEffect(() => {
    const root = diffRoot.current
    const highlights = (CSS as unknown as { highlights?: { delete: (name: string) => void; set: (name: string, value: unknown) => void } }).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!root || !highlights || !HighlightCtor) {
      setFindCount(0)
      return
    }
    highlights.delete('diff-find')
    highlights.delete('diff-find-active')
    const query = find.trim()
    if (!query) {
      setFindCount(0)
      return
    }
    const ranges: Range[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const parent = node.parentElement
      if (!parent || parent.closest('.gutter, .marker')) {
        node = walker.nextNode()
        continue
      }
      const text = node.textContent ?? ''
      const lower = text.toLowerCase()
      const needle = query.toLowerCase()
      let from = 0
      while (from < lower.length) {
        const at = lower.indexOf(needle, from)
        if (at < 0) break
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + query.length)
        ranges.push(range)
        from = at + query.length
      }
      node = walker.nextNode()
    }
    setFindCount(ranges.length)
    if (ranges.length === 0) return
    const active = Math.min(findActive, ranges.length - 1)
    highlights.set('diff-find', new HighlightCtor(...ranges))
    highlights.set('diff-find-active', new HighlightCtor(ranges[active]))
    const scroller = root.querySelector<HTMLElement>('.patch-viewport')
    if (scroller) {
      const box = scroller.getBoundingClientRect()
      const match = ranges[active].getBoundingClientRect()
      if (match.top < box.top || match.bottom > box.bottom) scroller.scrollTop += match.top - box.top - box.height / 3
      if (match.left < box.left || match.right > box.right) scroller.scrollLeft += match.left - box.left - 20
    }
  }, [find, findActive, detail, folded, diffStyle])

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopiedPath(true)
      window.setTimeout(() => setCopiedPath(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  const toggleTools = () => {
    setToolsOpen((open) => {
      if (open) {
        setFindOpen(false)
        setFind('')
        setFindActive(0)
      }
      return !open
    })
  }

  const enterImmersive = () => {
    setToolsOpen(false)
    setFindOpen(false)
    setFontPanelOpen(false)
    setImmersive(true)
  }

  const chunks = useMemo(() => splitPatch(detail?.patch ?? ''), [detail])
  const atLast = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('change') === 'last'
  const index = detail ? detail.files.findIndex((f) => f.path === path) : -1

  const jump = (direction: 1 | -1, edge?: 'last'): boolean => {
    if (!detail) return false
    const next = detail.files[index + direction]
    if (!next) return false
    const query = new URLSearchParams({ repo: repoId, hash, path: next.path })
    if (edge === 'last') query.set('change', 'last')
    replace(`#/commit-file?${query.toString()}`)
    return true
  }

  const step = (direction: 1 | -1) => {
    if (patchRef.current?.scrollToChange(direction)) return
    jump(direction, direction < 0 ? 'last' : undefined)
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

  const commitTree = useMemo(() => buildTree((detail?.files ?? []).map((file) => file.path)), [detail])
  const commitFileMeta = useMemo(() => {
    const meta = new Map<string, TreeFileMeta>()
    for (const file of detail?.files ?? []) {
      meta.set(file.path, { status: file.status, added: file.added, deleted: file.deleted })
    }
    return meta
  }, [detail])
  const allDirs = useMemo(() => collectDirPaths(commitTree), [commitTree])
  const allOpen = allDirs.length > 0 && allDirs.every((dir) => treeExpanded.has(dir))
  useEffect(() => {
    setTreeExpanded(new Set(allDirs))
  }, [allDirs])
  useEffect(() => {
    if (!path) return
    setTreeExpanded((prev) => {
      const next = new Set(prev)
      let prefix = ''
      for (const part of path.split('/').slice(0, -1)) {
        prefix = prefix ? `${prefix}/${part}` : part
        next.add(prefix)
      }
      return next
    })
  }, [path])

  const toggleTree = (key: string) => {
    setTreeExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem('nemorous.commitFileSidebar', open ? 'closed' : 'open')
      return !open
    })
  }

  return (
    <div className={`file-page ${immersive ? 'immersive' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      <aside ref={sidebarRef} className={`file-tree-sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: sidebarWidth / sidebarZoom, zoom: sidebarZoom } as React.CSSProperties}>
        <div className="file-tree-body">
          <div className="file-tree-head">
            <span>提交文件</span>
            <div className="file-tree-actions">
              <button className="icon-btn" onClick={toggleSidebar} aria-label="收起目录">
                <Icon name="left" />
              </button>
              <button
                className="icon-btn"
                onClick={() => setTreeExpanded(allOpen ? new Set() : new Set(allDirs))}
                aria-label={allOpen ? '收起全部文件夹' : '展开全部文件夹'}
                title={allOpen ? '收起全部文件夹' : '展开全部文件夹'}
              >
                <Icon name={allOpen ? 'up' : 'down'} size={15} />
              </button>
            </div>
          </div>
          <div className="tree file-tree">
            {detail ? (
              <TreeLevel
                nodes={commitTree}
                depth={0}
                expanded={treeExpanded}
                onToggle={toggleTree}
                onOpen={(next) => replace(`#/commit-file?repo=${encodeURIComponent(repoId)}&hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(next)}`)}
                activePath={path}
                fileMeta={commitFileMeta}
              />
            ) : (
              <Spinner label="读取提交文件…" />
            )}
          </div>
        </div>
        <SidebarResizer width={sidebarWidth} onWidth={setSidebarWidth} />
      </aside>
      <div className="file-main">
        <div className={`screen fill-screen commit-file-screen ${immersive ? 'immersive' : ''}`}>
      <header className="topbar commit-diff-header">
        <button className="icon-btn sidebar-toggle" onClick={toggleSidebar} aria-label="提交文件目录">
          <Icon name="panel" />
        </button>
        <button className="icon-btn" onClick={() => back(`#/commit?repo=${repoId}&hash=${hash}`)} aria-label="返回提交">
          <Icon name="back" />
        </button>
        <div className="grow commit-diff-title">
          <h1 className="file-title commit-file-name">
            <span className="commit-file-stem">{(() => { const name = path.slice(path.lastIndexOf('/') + 1); const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(0, dot) : name })()}</span>
            {(() => { const name = path.slice(path.lastIndexOf('/') + 1); const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot) : '' })()}
          </h1>
          <div className="commit-diff-meta">
            <span className="diff-path" title={path.slice(0, path.lastIndexOf('/') + 1) || './'}>
              <span dir="ltr">{path.slice(0, path.lastIndexOf('/') + 1) || './'}</span>
            </span>
          </div>
        </div>
        <button className="icon-btn" onClick={enterImmersive} aria-label="沉浸查看" title="沉浸查看">
          <Icon name="expand" />
        </button>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {!detail && !error ? <Spinner label="读取提交…" /> : null}
      {detail ? (
        <>
          <div className={`diff-nav-row commit-file-nav ${toolsOpen ? 'tools-open' : ''}`}>
            <button className="nav-icon" onClick={() => step(-1)} title="上一处改动" aria-label="上一处改动">
              <Icon name="up" size={15} />
            </button>
            <button className="nav-icon" onClick={() => step(1)} title="下一处改动" aria-label="下一处改动">
              <Icon name="down" size={15} />
            </button>
            <button className="nav-icon" onClick={() => jump(-1)} disabled={index <= 0} title="上一个文件" aria-label="上一个文件">
              <Icon name="left" size={15} />
            </button>
            <button className="nav-icon" onClick={() => jump(1)} disabled={index < 0 || index >= detail.files.length - 1} title="下一个文件" aria-label="下一个文件">
              <Icon name="right" size={15} />
            </button>
            <span className="diff-position">{index >= 0 ? `${index + 1}/${detail.files.length}` : ''}</span>
            <div className="commit-file-tools">
              <button className="nav-icon nav-tool font-tool" onClick={() => setFontPanelOpen((open) => !open)} aria-label="字号" aria-pressed={fontPanelOpen} title="字号">Aa</button>
              {toolsOpen ? (
                <div className="inline-tools">
                  <div className="segmented diff-style nav-style">
                    <button className={diffStyle === 'unified' ? 'on' : ''} onClick={() => setDiffStyle('unified')} aria-label="单栏" title="单栏">
                      <Icon name="rows" size={14} />
                    </button>
                    <button className={diffStyle === 'split' ? 'on' : ''} onClick={() => setDiffStyle('split')} aria-label="并排" title="并排">
                      <Icon name="columns" size={14} />
                    </button>
                  </div>
                  <button
                    className="nav-icon nav-tool"
                    title="打开完整文件"
                    aria-label="打开完整文件"
                    onClick={() => {
                      const line = patchRef.current?.currentLine()
                      go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}&rev=${hash}${line ? `&line=${line}` : ''}`)
                    }}
                  >
                    <Icon name="file" size={15} />
                  </button>
                  <button className="nav-icon nav-tool" title="在 Diff 中查找" onClick={() => { setFindOpen((open) => !open); setFindActive(0) }} aria-label="在 Diff 中查找" aria-pressed={findOpen}>
                    <Icon name="search" size={15} />
                  </button>
                  <button className="nav-icon nav-tool" title={folded ? '展开未修改上下文' : '折叠未修改上下文'} onClick={() => setFolded((value) => !value)} aria-label={folded ? '展开未修改上下文' : '折叠未修改上下文'} aria-pressed={folded}>
                    <Icon name="fold" size={15} />
                  </button>
                  <button className={`nav-icon nav-tool ${copiedPath ? 'ok' : ''}`} title="复制文件路径" onClick={() => void copyPath()} aria-label="复制文件路径" aria-pressed={copiedPath}>
                    <Icon name={copiedPath ? 'check' : 'copyPath'} size={15} />
                  </button>
                </div>
              ) : null}
              <button className="nav-icon tools-toggle" onClick={toggleTools} aria-label={toolsOpen ? '收起附加操作' : '展开附加操作'} aria-expanded={toolsOpen}>
                <Icon name={toolsOpen ? 'right' : 'left'} size={15} />
              </button>
            </div>
          </div>
          {findOpen ? (
            <div className="diff-find-bar">
              <Icon name="search" size={15} />
              <input
                value={find}
                onChange={(event) => { setFind(event.target.value); setFindActive(0) }}
                placeholder="在 Diff 中查找…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              <span className="diff-find-count">{findCount ? `${Math.min(findActive + 1, findCount)}/${findCount}` : '0/0'}</span>
              <button className="icon-btn tiny" disabled={findCount === 0} onClick={() => setFindActive((value) => (value - 1 + findCount) % findCount)} aria-label="上一个匹配">
                <Icon name="up" size={14} />
              </button>
              <button className="icon-btn tiny" disabled={findCount === 0} onClick={() => setFindActive((value) => (value + 1) % findCount)} aria-label="下一个匹配">
                <Icon name="down" size={14} />
              </button>
              <button className="icon-btn tiny" onClick={() => { setFindOpen(false); setFind(''); setFindActive(0) }} aria-label="关闭查找">
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : null}
          <div className="commit-file-diff-page idea-diff" ref={diffRoot}>
            <PatchView ref={patchRef} patch={chunks.get(path) ?? ''} style={diffStyle} idea folded={folded} focusChange={atLast ? 'last' : 'first'} fontSize={diffFontSize} language={languageOf(path)} />
          </div>
        </>
      ) : null}
      <div className="screen-bottom-space" />
      {immersive ? (
        <ImmersiveDiffBar
          onPrevChange={() => step(-1)}
          onNextChange={() => step(1)}
          onPrevFile={() => jump(-1)}
          onNextFile={() => jump(1)}
          canPrevFile={index > 0}
          canNextFile={!!detail && index >= 0 && index < detail.files.length - 1}
          fontSize={diffFontSize}
          onFontSize={setDiffFontSize}
          onExit={() => setImmersive(false)}
        />
      ) : null}
      {immersive && !sidebarOpen ? (
        <button className="immersive-sidebar-toggle" onClick={toggleSidebar} aria-label="展开文件栏" title="展开文件栏">
          <Icon name="panel" size={17} />
        </button>
      ) : null}
      {!immersive && fontPanelOpen ? (
        <ImmersiveDock
          onExit={() => setFontPanelOpen(false)}
          exitLabel="关闭字号调整"
          font={{ size: diffFontSize, min: 6, max: 20, onChange: setDiffFontSize }}
        />
      ) : null}
        </div>
      </div>
    </div>
  )
}

export function CommitPatchScreen({ repoId, hash }: { repoId: string; hash: string }) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [immersive, setImmersive] = useImmersive()
  const [diffFontSize, setDiffFontSize] = useDiffFontSize()
  const [fontPanelOpen, setFontPanelOpen] = useState(false)
  useEffect(() => {
    setCollapsed(new Set())
    setFontPanelOpen(false)
    setImmersive(false)
  }, [hash])
  useEffect(() => {
    setDetail(null)
    api<CommitDetail>(`/api/repos/${repoId}/commits/${hash}?context=full`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '读取提交失败'))
  }, [repoId, hash])

  const chunks = useMemo(() => splitPatch(detail?.patch ?? ''), [detail])
  const added = detail?.files.reduce((n, f) => n + f.added, 0) ?? 0
  const deleted = detail?.files.reduce((n, f) => n + f.deleted, 0) ?? 0
  const files = useMemo(
    () => (detail?.files ?? []).map((f) => ({ ...f, patch: chunks.get(f.path) ?? '' })),
    [detail, chunks],
  )

  return (
    <div className={`screen fill-screen commit-patch-screen ${immersive ? 'immersive' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => back(`#/commit?repo=${repoId}&hash=${hash}`)} aria-label="返回提交">
          <Icon name="back" />
        </button>
        <div className="grow commit-patch-head">
          <h1 className="file-title">{detail?.commit.subject ?? hash.slice(0, 8)}</h1>
          <code className="commit-patch-hash">{detail?.commit.short ?? hash.slice(0, 7)}</code>
        </div>
        <button className="icon-btn" onClick={() => { setFontPanelOpen(false); setImmersive(true) }} aria-label="沉浸查看" title="沉浸查看">
          <Icon name="expand" />
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
            <button className="mini-btn font-toggle" onClick={() => setFontPanelOpen((open) => !open)} aria-label="字号" aria-pressed={fontPanelOpen} title="字号">Aa</button>
            <button
              className="mini-btn"
              onClick={() => {
                const rows = detail.files
                setCollapsed(collapsed.size >= rows.length ? new Set() : new Set(rows.map((f) => f.path)))
              }}
            >
              {collapsed.size >= detail.files.length ? '全部展开' : '全部收起'}
            </button>
          </div>
          <MultiPatchView
            key={detail.commit.hash}
            files={files}
            fontSize={diffFontSize}
            collapsed={collapsed}
            onToggleFile={(path) =>
              setCollapsed((prev) => {
                const next = new Set(prev)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })
            }
          />
        </>
      ) : null}
      <div className="screen-bottom-space" />
      {immersive || fontPanelOpen ? (
        <ImmersiveDock
          onExit={() => {
            if (immersive) setImmersive(false)
            else setFontPanelOpen(false)
          }}
          exitLabel={immersive ? '退出沉浸查看' : '关闭字号调整'}
          font={{ size: diffFontSize, min: 6, max: 20, onChange: setDiffFontSize }}
        />
      ) : null}
    </div>
  )
}
