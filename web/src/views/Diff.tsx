import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { DiffResult, Workspace } from '../types'
import { api } from '../api'
import { back, go, replace, useDiffFontSize, useImmersive, usePinchZoom, useSidebarWidth, useSidebarZoom } from '../hooks'
import { FileTypeIcon, Icon, ImmersiveDiffBar, ImmersiveDock, PatchView, SidebarResizer, Spinner, StatusLetter, repoColor, type PatchViewHandle } from '../components'
import { languageOf } from '../syntax'

function DiffSidebar({
  ws,
  repoId,
  path,
  staged,
  open,
  width,
  onWidth,
  onClose,
  asideRef,
  zoom,
}: {
  ws: Workspace
  repoId: string
  path: string
  staged: boolean
  open: boolean
  width: number
  onWidth: (next: number) => void
  onClose: () => void
  asideRef?: Ref<HTMLElement>
  zoom: number
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
    <aside ref={asideRef} className={`diff-sidebar ${open ? 'open' : ''}`} style={{ width: width / zoom, zoom } as React.CSSProperties}>
      <div className="diff-sidebar-zoom">
      <div className="diff-sidebar-head">
        <span>文件</span>
        <button className="icon-btn" onClick={onClose} aria-label="收起文件栏">
          <Icon name="left" size={15} />
        </button>
      </div>
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
                      <FileTypeIcon path={file.path} />
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
      </div>
      <SidebarResizer width={width} onWidth={onWidth} />
    </aside>
  )
}

export function DiffScreen({
  ws,
  repoId,
  path,
  staged,
}: {
  ws: Workspace
  repoId: string
  path: string
  staged: boolean
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [immersive, setImmersive] = useImmersive()
  const [diffFontSize, setDiffFontSize] = useDiffFontSize()
  const [fontPanelOpen, setFontPanelOpen] = useState(false)
  const [error, setError] = useState('')
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const [folded, setFolded] = useState(true)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [find, setFind] = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findActive, setFindActive] = useState(0)
  const [copiedPath, setCopiedPath] = useState(false)
  const diffRoot = useRef<HTMLDivElement>(null)
  const patchRef = useRef<PatchViewHandle>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('nemorous.sidebar') !== 'closed')
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth('nemorous.diffSidebarWidth')
  const [sidebarZoom, setSidebarZoom] = useSidebarZoom()
  const sidebarRef = useRef<HTMLElement>(null)
  usePinchZoom(diffRoot, () => diffFontSize, setDiffFontSize, immersive)
  usePinchZoom(sidebarRef, () => sidebarZoom, setSidebarZoom, immersive && sidebarOpen)

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

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem('nemorous.sidebar', prev ? 'closed' : 'open')
      return !prev
    })
  }

  const jumpFile = (direction: 1 | -1): boolean => {
    const target = navFiles[navIndex + direction]
    if (!target) return false
    replace(`#/diff?repo=${target.repoId}&path=${encodeURIComponent(target.path)}&staged=${target.staged ? 1 : 0}`)
    return true
  }

  const stepChange = (direction: 1 | -1) => {
    if (patchRef.current?.scrollToChange(direction)) return
    jumpFile(direction)
  }

  useEffect(() => {
    setDiffStyle('unified')
    setFolded(true)
    setToolsOpen(false)
    setFindOpen(false)
    setFind('')
    setFindActive(0)
  }, [path, staged])

  useEffect(() => {
    let cancelled = false
    setDiff(null)
    setError('')
    api<DiffResult>(`/api/repos/${repoId}/diff?path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}&context=full`)
      .then((res) => {
        if (!cancelled) setDiff(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取差异失败')
      })
    return () => {
      cancelled = true
    }
  }, [repoId, path, staged])

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
  }, [find, findActive, diff, folded, diffStyle])

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

  return (
    <div className={`diff-page ${immersive ? 'immersive' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      <DiffSidebar ws={ws} repoId={repoId} path={path} staged={staged} open={sidebarOpen} width={sidebarWidth} onWidth={setSidebarWidth} onClose={toggleSidebar} asideRef={sidebarRef} zoom={sidebarZoom} />
      <div className="diff-main">
        <div className={`screen diff-screen fill-screen ${immersive ? 'immersive' : ''}`}>
          <header className="topbar commit-diff-header">
            <button className="icon-btn sidebar-toggle" onClick={toggleSidebar} aria-label="文件栏">
              <Icon name="panel" />
            </button>
            <button className="icon-btn" onClick={() => back('#/changes')} aria-label="返回">
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

          {error ? <div className="error-banner"><Icon name="warning" size={15} /> {error}</div> : null}
          {!diff && !error ? <Spinner label="读取差异…" /> : null}
          {diff ? (
            <>
              <div className={`diff-nav-row commit-file-nav ${toolsOpen ? 'tools-open' : ''}`}>
                <button className="nav-icon" onClick={() => stepChange(-1)} title="上一处改动" aria-label="上一处改动">
                  <Icon name="up" size={15} />
                </button>
                <button className="nav-icon" onClick={() => stepChange(1)} title="下一处改动" aria-label="下一处改动">
                  <Icon name="down" size={15} />
                </button>
                <button className="nav-icon" onClick={() => jumpFile(-1)} disabled={navIndex <= 0} title="上一个文件" aria-label="上一个文件">
                  <Icon name="left" size={15} />
                </button>
                <button className="nav-icon" onClick={() => jumpFile(1)} disabled={navIndex < 0 || navIndex >= navFiles.length - 1} title="下一个文件" aria-label="下一个文件">
                  <Icon name="right" size={15} />
                </button>
                <span className="diff-position">{navIndex >= 0 ? `${navIndex + 1}/${navFiles.length}` : ''}</span>
                <div className="commit-file-tools">
                  <button className="nav-icon nav-tool font-tool" onClick={() => setFontPanelOpen((open) => !open)} aria-label="字号" aria-pressed={fontPanelOpen} title="字号">Aa</button>
                  <button className="nav-icon tools-toggle" onClick={toggleTools} aria-label={toolsOpen ? '收起附加操作' : '展开附加操作'} aria-expanded={toolsOpen}>
                    <Icon name={toolsOpen ? 'left' : 'right'} size={15} />
                  </button>
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
                          go(`#/file?repo=${repoId}&path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`)
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
                <PatchView ref={patchRef} patch={diff.patch} binary={diff.binary} style={diffStyle} idea folded={folded} focusChange="first" fontSize={diffFontSize} language={languageOf(path)} />
              </div>
            </>
          ) : null}
          <div className="screen-bottom-space" />
          {immersive ? (
            <ImmersiveDiffBar
              onPrevChange={() => stepChange(-1)}
              onNextChange={() => stepChange(1)}
              onPrevFile={() => jumpFile(-1)}
              onNextFile={() => jumpFile(1)}
              canPrevFile={navIndex > 0}
              canNextFile={navIndex >= 0 && navIndex < navFiles.length - 1}
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
