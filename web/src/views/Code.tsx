import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import hljs from 'highlight.js/lib/common'
import type { FileContent, RepoFiles, SearchMatch, SearchResult, Workspace } from '../types'
import { api } from '../api'
import { back, go, replace, useDebounced, useImmersive, useSidebarWidth } from '../hooks'
import { Empty, Icon, ImmersiveDock, SectionTitle, SidebarResizer, Spinner, repoColor, useToast } from '../components'
import { languageOf } from '../syntax'

function fileName(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

function dirPath(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ---------------- code screen ---------------- */

export function CodeScreen({ ws }: { ws: Workspace }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'files' | 'content'>('files')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [repoId, setRepoId] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const debounced = useDebounced(query, 250)

  useEffect(() => {
    const q = debounced.trim()
    if (!q) {
      setResult(null)
      setError('')
      return
    }
    const params = new URLSearchParams({ q, mode })
    if (regex) params.set('regex', '1')
    if (caseSensitive) params.set('case', '1')
    if (repoId) params.append('repo', repoId)
    let cancelled = false
    setSearching(true)
    setError('')
    api<SearchResult>(`/api/search?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '搜索失败')
          setResult(null)
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, mode, regex, caseSensitive, repoId])

  const contentGroups = useMemo(() => {
    const groups = new Map<string, { repoId: string; repoName: string; path: string; matches: SearchMatch[] }>()
    for (const match of result?.matches ?? []) {
      const key = `${match.repoId}:${match.path}`
      let group = groups.get(key)
      if (!group) {
        group = { repoId: match.repoId, repoName: match.repoName, path: match.path, matches: [] }
        groups.set(key, group)
      }
      group.matches.push(match)
    }
    return [...groups.values()]
  }, [result])

  const openFile = (id: string, path: string, line?: number) => {
    const q = new URLSearchParams({ repo: id, path })
    if (line) q.set('line', String(line))
    go(`#/file?${q.toString()}`)
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">代码</div>
          <h1>极速查阅</h1>
        </div>
      </header>

      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'files' ? '搜索文件名…' : '搜索文件内容…'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query ? (
          <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="清空">
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      <div className="filter-row">
        <div className="segmented">
          <button className={mode === 'files' ? 'on' : ''} onClick={() => setMode('files')}>文件名</button>
          <button className={mode === 'content' ? 'on' : ''} onClick={() => setMode('content')}>内容</button>
        </div>
        <button className={`chip ${regex ? 'on' : ''}`} onClick={() => setRegex((v) => !v)}>.* 正则</button>
        <button className={`chip ${caseSensitive ? 'on' : ''}`} onClick={() => setCaseSensitive((v) => !v)}>Aa 区分</button>
      </div>

      <div className="repo-chips">
        <button className={`chip ${repoId === '' ? 'on' : ''}`} onClick={() => setRepoId('')}>全部仓库</button>
        {ws.repos.map((repo) => (
          <button key={repo.id} className={`chip ${repoId === repo.id ? 'on' : ''}`} onClick={() => setRepoId(repo.id)}>
            {repo.name}
          </button>
        ))}
      </div>

      {searching ? <Spinner label="搜索中…" /> : null}
      {error ? <div className="error-banner"><Icon name="warning" size={15} /> {error}</div> : null}

      {!query.trim() ? (
        <div className="repo-list">
          <SectionTitle>浏览仓库文件</SectionTitle>
          {ws.repos.map((repo) => (
            <button className="repo-row" key={repo.id} onClick={() => go(`#/tree?repo=${repo.id}`)}>
              <span className="repo-avatar small" style={{ background: repoColor(repo.name) }}>{repo.name.slice(0, 2)}</span>
              <span className="repo-row-main">
                <span className="repo-name">{repo.name}</span>
                <span className="repo-sub"><Icon name="branch" size={13} /> <code>{repo.branch}</code></span>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
          <p className="hint">文件名搜索走 Git 索引；内容搜索优先使用 ripgrep，跨仓库并行。</p>
        </div>
      ) : null}

      {result && mode === 'files' && result.files?.length ? (
        <div className="result-list result-scroll">
          {result.files.map((f) => (
            <button
              className="result-row"
              key={`${f.repoId}:${f.path}`}
              title={f.path}
              onClick={() => openFile(f.repoId, f.path)}
            >
              <span className="repo-chip" style={{ borderColor: repoColor(f.repoName) }}>{f.repoName}</span>
              <span className="result-file">
                <span className="result-file-name">{fileName(f.path)}</span>
                <span className="result-file-dir">{dirPath(f.path)}</span>
              </span>
            </button>
          ))}
          {result.truncated ? <p className="hint">结果过多，仅显示前 200 条。</p> : null}
        </div>
      ) : null}

      {result && mode === 'content' && contentGroups.length ? (
        <div className="result-list result-scroll">
          {contentGroups.map((group) => (
            <section className="match-file" key={`${group.repoId}:${group.path}`}>
              <button
                className="match-file-head"
                title={group.path}
                onClick={() => openFile(group.repoId, group.path)}
              >
                <span className="repo-chip" style={{ borderColor: repoColor(group.repoName) }}>{group.repoName}</span>
                <span className="result-file">
                  <span className="result-file-name">{fileName(group.path)}</span>
                  <span className="result-file-dir">{dirPath(group.path)}</span>
                </span>
                <span className="match-count">{group.matches.length} 处</span>
              </button>
              <div className="match-lines">
                {group.matches.map((match, i) => (
                  <button
                    className="match-line"
                    key={`${match.line}:${i}`}
                    title={`${match.path}:${match.line}`}
                    onClick={() => openFile(match.repoId, match.path, match.line)}
                  >
                    <span className="line-no">:{match.line}</span>
                    <code className="match-text">{match.text}</code>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {result.truncated ? <p className="hint">结果过多，仅显示前 300 条。</p> : null}
        </div>
      ) : null}

      {result && !result.files?.length && !result.matches?.length && !searching && query.trim() ? (
        <Empty title="没有匹配结果" hint="试试更短的关键词，或切换文件名 / 内容模式。" icon="search" />
      ) : null}

      <div className="screen-bottom-space" />
    </div>
  )
}

/* ---------------- file tree ---------------- */

export interface TreeNode {
  name: string
  path: string
  dir: boolean
  children: TreeNode[]
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const p of paths) {
    const parts = p.split('/')
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
    }
  }
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    for (const n of nodes) if (n.dir) sortLevel(n.children)
  }
  sortLevel(root)
  return root
}

export function TreeLevel({
  nodes,
  depth,
  expanded,
  onToggle,
  onOpen,
  activePath,
}: {
  nodes: TreeNode[]
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  activePath?: string
}) {
  return (
    <>
      {nodes.map((node) => (
        <Fragment key={`${node.dir ? 'd' : 'f'}:${node.path}`}>
          {node.dir ? (
            <>
              <div
                className="tree-row dir"
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() => onToggle(node.path)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onToggle(node.path)
                }}
              >
                <Icon name={expanded.has(node.path) ? 'down' : 'chevron'} size={14} />
                <Icon name="folder" size={16} />
                <span>{node.name}</span>
              </div>
              {expanded.has(node.path) ? (
                <TreeLevel nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} activePath={activePath} />
              ) : null}
            </>
          ) : (
            <div
              className={`tree-row file ${activePath === node.path ? 'active' : ''}`}
              style={{ paddingLeft: 12 + depth * 16 + 18 }}
              onClick={() => onOpen(node.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen(node.path)
              }}
            >
              <Icon name="file" size={15} />
              <span>{node.name}</span>
            </div>
          )}
        </Fragment>
      ))}
    </>
  )
}

export function TreeScreen({ repoId, repoName }: { repoId: string; repoName: string }) {
  const [files, setFiles] = useState<RepoFiles | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    setFiles(null)
    api<RepoFiles>(`/api/repos/${repoId}/files`)
      .then(setFiles)
      .catch((err) => setError(err instanceof Error ? err.message : '读取文件树失败'))
  }, [repoId])

  const tree = useMemo(() => buildTree(files?.files ?? []), [files])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return []
    return (files?.files ?? []).filter((p) => p.toLowerCase().includes(q)).slice(0, 400)
  }, [filter, files])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go('#/code')} aria-label="返回">
          <Icon name="back" />
        </button>
        <div className="grow">
          <div className="eyebrow">文件树</div>
          <h1>{repoName}</h1>
        </div>
      </header>
      <div className="search-box compact">
        <Icon name="search" size={18} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="过滤文件路径…" />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!files && !error ? <Spinner label="读取文件索引…" /> : null}
      {files ? (
        filter.trim() ? (
          <div className="result-list">
            {filtered.map((p) => (
              <button className="result-row" key={p} onClick={() => go(`#/file?repo=${repoId}&path=${encodeURIComponent(p)}`)}>
                <Icon name="file" size={15} />
                <span className="result-path">{p}</span>
              </button>
            ))}
            {filtered.length === 0 ? <Empty title="没有匹配文件" icon="search" /> : null}
          </div>
        ) : (
          <div className="tree">
            <TreeLevel
              nodes={tree}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onOpen={(path) => go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}`)}
            />
          </div>
        )
      ) : null}
      {files?.truncated ? <p className="hint">仓库文件超过 20000 个，仅展示前 20000 个。</p> : null}
      <div className="screen-bottom-space" />
    </div>
  )
}

/* ---------------- landscape file explorer ---------------- */

function FileTreePanel({
  repoId,
  path,
  rev,
  onOpen,
  onClose,
}: {
  repoId: string
  path: string
  rev?: string
  onOpen: (path: string) => void
  onClose: () => void
}) {
  const [files, setFiles] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    setFiles([])
    setError('')
    if (rev) {
      api<{ files?: { path: string }[] }>(`/api/repos/${repoId}/commits/${encodeURIComponent(rev)}?context=full`)
        .then((detail) => setFiles((detail.files ?? []).map((file) => file.path)))
        .catch((err) => setError(err instanceof Error ? err.message : '读取提交文件失败'))
    } else {
      api<RepoFiles>(`/api/repos/${repoId}/files`)
        .then((res) => setFiles(res.files ?? []))
        .catch((err) => setError(err instanceof Error ? err.message : '读取文件树失败'))
    }
  }, [repoId, rev])

  const tree = useMemo(() => buildTree(files), [files])

  useEffect(() => {
    if (!path) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let prefix = ''
      for (const part of path.split('/').slice(0, -1)) {
        prefix = prefix ? `${prefix}/${part}` : part
        next.add(prefix)
      }
      return next
    })
  }, [path])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="file-tree-body">
      <div className="file-tree-head">
        <span>文件</span>
        <button className="icon-btn" onClick={onClose} aria-label="收起目录">
          <Icon name="left" />
        </button>
      </div>
      {error ? <p className="hint danger-text">{error}</p> : null}
      {files.length === 0 && !error ? <Spinner label="读取文件索引…" /> : null}
      <div className="tree file-tree">
        <TreeLevel nodes={tree} depth={0} expanded={expanded} onToggle={toggle} onOpen={onOpen} activePath={path} />
      </div>
    </div>
  )
}

/* ---------------- file viewer ---------------- */

const MAX_HIGHLIGHT_LINES = 4000
const MAX_HIGHLIGHT_BYTES = 300_000

export function FileScreen({ repoId, path, rev, line }: { repoId: string; path: string; rev?: string; line?: number }) {
  const [file, setFile] = useState<FileContent | null>(null)
  const [error, setError] = useState('')
  const [immersive, setImmersive] = useImmersive()
  const [fontPanelOpen, setFontPanelOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('nemorous.fileSidebar') !== 'closed')
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth('nemorous.fileSidebarWidth')
  const [fontSize, setFontSizeState] = useState(() => {
    const saved = Number(localStorage.getItem('nemorous.codeFontSize'))
    return saved >= 6 && saved <= 22 ? saved : 13
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const notify = useToast()
  const lineParam = line ?? 0
  const lineHeight = Math.round(fontSize * 1.6)
  const codeStyle = { '--code-font-size': `${fontSize}px`, '--code-line-height': `${lineHeight}px` } as CSSProperties
  const setFontSize = (next: number) => {
    const clamped = Math.min(22, Math.max(6, next))
    setFontSizeState(clamped)
    localStorage.setItem('nemorous.codeFontSize', String(clamped))
  }

  useEffect(() => {
    setFile(null)
    setError('')
    const q = new URLSearchParams({ path })
    if (rev) q.set('rev', rev)
    api<FileContent>(`/api/repos/${repoId}/file?${q.toString()}`)
      .then(setFile)
      .catch((err) => setError(err instanceof Error ? err.message : '读取文件失败'))
  }, [repoId, path, rev])

  const lines = useMemo(() => (file && !file.binary ? file.content.split('\n') : []), [file])
  const lineCount = useMemo(() => {
    if (!file || file.binary) return 0
    return file.content.length > 0 && file.content.endsWith('\n') ? lines.length - 1 : lines.length
  }, [file, lines])

  const canHighlight = lineCount > 0 && lineCount <= MAX_HIGHLIGHT_LINES && (file?.size ?? 0) <= MAX_HIGHLIGHT_BYTES
  const html = useMemo(() => {
    if (!file || file.binary || !canHighlight) return ''
    try {
      return hljs.highlight(file.content, { language: languageOf(path) }).value
    } catch {
      return escapeHtml(file.content)
    }
  }, [file, canHighlight, path])

  useEffect(() => {
    if (!file || !lineParam || !scrollRef.current) return
    scrollRef.current.scrollTop = Math.max(0, (lineParam - 1) * lineHeight - 120)
  }, [file, lineParam, lineHeight])

  useEffect(() => {
    if (!immersive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setFontSize(fontSize + 1)
      } else if (event.key === '-') {
        event.preventDefault()
        setFontSize(fontSize - 1)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [immersive, fontSize])

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem('nemorous.fileSidebar', open ? 'closed' : 'open')
      return !open
    })
  }

  const openTreeFile = (next: string) => {
    if (rev) replace(`#/file?repo=${repoId}&path=${encodeURIComponent(next)}&rev=${encodeURIComponent(rev)}`)
    else replace(`#/file?repo=${repoId}&path=${encodeURIComponent(next)}`)
  }

  const copy = async () => {
    if (!file) return
    try {
      await navigator.clipboard.writeText(file.content)
      notify('已复制文件内容', 'ok')
    } catch {
      notify('复制失败', 'error')
    }
  }

  return (
    <div className={`file-page ${immersive ? 'immersive' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <aside className={`file-tree-sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: sidebarWidth }}>
        <FileTreePanel repoId={repoId} path={path} rev={rev} onOpen={openTreeFile} onClose={toggleSidebar} />
        <SidebarResizer width={sidebarWidth} onWidth={setSidebarWidth} />
      </aside>
      <div className="file-main">
        <div className={`screen file-screen fill-screen ${immersive ? 'immersive' : ''}`} style={codeStyle}>
          <header className="topbar">
            <button className="icon-btn sidebar-toggle" onClick={toggleSidebar} aria-label="文件目录">
              <Icon name="panel" />
            </button>
            <button
              className="icon-btn"
              onClick={() => {
            if (repoId && rev) {
              back(`#/commit-file?repo=${encodeURIComponent(repoId)}&hash=${encodeURIComponent(rev)}&path=${encodeURIComponent(path)}`)
            } else {
              back('#/code')
            }
          }}
          aria-label="返回"
        >
          <Icon name="back" />
        </button>
        <div className="grow file-head">
          <div className="eyebrow">{repoId ? '文件' : ''}</div>
          <h1 className="file-title">{path}</h1>
          {rev ? <span className="pill">{rev}</span> : null}
        </div>
        <button className="icon-btn" onClick={() => setImmersive(true)} aria-label="沉浸查看" title="沉浸查看">
          <Icon name="expand" />
        </button>
        <button className="icon-btn font-toggle" onClick={() => setFontPanelOpen((open) => !open)} aria-label="字号" aria-pressed={fontPanelOpen} title="字号">Aa</button>
        <button className="icon-btn" onClick={() => void copy()} aria-label="复制">
          <Icon name="copy" />
        </button>
      </header>

      {error ? <div className="error-banner"><Icon name="warning" size={15} /> {error}</div> : null}
      {!file && !error ? <Spinner label="读取文件…" /> : null}
      {file?.binary ? <Empty icon="warning" title="二进制文件" hint={`${file.size} 字节，手机端不展示。`} /> : null}
      {file && !file.binary ? (
        <>
          <div className="code-meta">
            <span>{lineCount} 行</span>
            <span>{languageOf(path)}</span>
            <span>{(file.size / 1024).toFixed(1)} KB</span>
            {lineParam ? <span>第 {lineParam} 行</span> : null}
          </div>
          <div className="code-scroll" ref={scrollRef}>
            <div className="code-inner">
              <div className="gutter-col" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className={lineParam === i + 1 ? 'hit' : undefined}>{i + 1}</div>
                ))}
              </div>
              <pre className="code-pre">
                {canHighlight ? (
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <code className="hljs">{file.content}</code>
                )}
              </pre>
            </div>
          </div>
          {!canHighlight ? <p className="hint">文件较大，已关闭语法高亮（仍可完整查看）。</p> : null}
        </>
      ) : null}
      <div className="screen-bottom-space" />
      {(immersive || fontPanelOpen) && file && !file.binary ? (
        <ImmersiveDock
          onExit={() => {
            if (immersive) setImmersive(false)
            else setFontPanelOpen(false)
          }}
          exitLabel={immersive ? '退出沉浸查看' : '关闭字号调整'}
          font={{ size: fontSize, min: 6, max: 22, onChange: setFontSize }}
        />
      ) : null}
        </div>
      </div>
    </div>
  )
}
