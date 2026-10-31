import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { FileChange, RepoHealth } from './types'

/* ---------- icons ---------- */

const iconPaths: Record<string, string[]> = {
  changes: ['M4 5h12', 'M4 12h8', 'M4 19h14', 'M18 3v4M16 5h4', 'M14 17v4M12 19h4'],
  code: ['M8 6 2 12l6 6', 'M16 6l6 6-6 6'],
  git: ['M6 3v12', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 15c0-3 6-3 9-4.5'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
  back: ['M15 18l-6-6 6-6'],
  refresh: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 5v6h-6'],
  check: ['M4 12l5 5L20 6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M20 20l-4-4'],
  filter: ['M4 5h16l-6 7v6l-4 2v-8Z'],
  close: ['M6 6l12 12M18 6L6 18'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  file: ['M6 3h8l4 4v14H6Z', 'M14 3v5h4'],
  chevron: ['M9 6l6 6-6 6'],
  down: ['M6 9l6 6 6-6'],
  up: ['M18 15l-6-6-6 6'],
  left: ['M15 18l-6-6 6-6'],
  right: ['M9 6l6 6-6 6'],
  jump: ['M14 4h6v6', 'M20 4 9 15'],
  panel: ['M4 5h16v14H4Z', 'M9 5v14'],
  rows: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  columns: ['M4 5h16v14H4Z', 'M12 5v14'],
  copy: ['M9 9h11v11H9Z', 'M5 15H4V4h11v1'],
  warning: ['M12 4 2 20h20Z', 'M12 10v4M12 17h.01'],
  branch: ['M6 3v12', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 15c0-3 6-4 12-5'],
  sync: ['M4 12a8 8 0 0 1 13.7-5.7L20 8', 'M20 3v5h-5', 'M20 12a8 8 0 0 1-13.7 5.7L4 16', 'M4 21v-5h5'],
  power: ['M12 3v9', 'M6.6 6.6a8 8 0 1 0 10.8 0'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14'],
}

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(iconPaths[name] ?? []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/* ---------- small display pieces ---------- */

const healthLabel: Record<RepoHealth, string> = {
  clean: '干净',
  dirty: '有改动',
  conflict: '冲突',
  behind: '落后',
  ahead: '待推送',
  diverged: '已分叉',
  error: '错误',
}

export function HealthPill({ health }: { health: RepoHealth }) {
  return <span className={`pill health-${health}`}>{healthLabel[health]}</span>
}

const STATUS_LABELS: Record<string, string> = {
  '?': '未跟踪',
  A: '新增',
  M: '修改',
  D: '删除',
  R: '重命名',
  U: '冲突',
}

const STATUS_CLASSES: Record<string, string> = {
  '?': 'untracked',
  A: 'add',
  M: 'mod',
  D: 'del',
  R: 'rename',
  U: 'conflict',
}

export function FileTag({ status }: { status: string }) {
  const kind = status.slice(0, 1)
  return <span className={`file-tag tag-${STATUS_CLASSES[kind] ?? 'mod'}`}>{STATUS_LABELS[kind] ?? kind}</span>
}

export function StatusLetter({ file }: { file: FileChange }) {
  return <span className={`status-letter s-${file.status === '?' ? 'untracked' : file.status}`}>{file.status}</span>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  )
}

export function Empty({ title, hint, icon = 'folder' }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {action}
    </div>
  )
}

/* ---------- toast ---------- */

type ToastKind = 'ok' | 'error' | 'info'
interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(1)
  const notify = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = idRef.current++
    setItems((prev) => [...prev.slice(-2), { id, text, kind }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/* ---------- sheet ---------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmText = '确认',
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmText?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="confirm-body">{body}</p>
    </Sheet>
  )
}

/* ---------- diff ---------- */

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  old?: number
  new?: number
  hunkNew?: number
}

export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      out.push({ kind: 'hunk', text: raw, hunkNew: newNo })
      inHunk = true
      continue
    }
    if (!inHunk) {
      if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('new file mode') ||
        raw.startsWith('deleted file mode') || raw.startsWith('old mode') || raw.startsWith('new mode') ||
        raw.startsWith('similarity index') || raw.startsWith('rename from') || raw.startsWith('rename to') ||
        raw.startsWith('--- ') || raw.startsWith('+++ ')) {
        continue
      }
      if (raw === '') continue
      out.push({ kind: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('\\')) {
      out.push({ kind: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), new: newNo++ })
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), old: oldNo++ })
    } else if (raw.startsWith(' ')) {
      out.push({ kind: 'ctx', text: raw.slice(1), old: oldNo++, new: newNo++ })
    } else if (raw === '') {
      continue
    } else {
      out.push({ kind: 'meta', text: raw })
    }
  }
  return out
}

interface WordSegment {
  text: string
  changed: boolean
}

interface SplitCell {
  kind: 'add' | 'del' | 'ctx' | 'blank'
  text: string
  no?: number
  segments?: WordSegment[]
}

function wordPair(oldText: string, newText: string): { left: WordSegment[]; right: WordSegment[] } {
  const max = Math.min(oldText.length, newText.length)
  let prefix = 0
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++
  const oldMiddle = oldText.slice(prefix, oldText.length - suffix)
  const newMiddle = newText.slice(prefix, newText.length - suffix)
  const left: WordSegment[] = []
  const right: WordSegment[] = []
  if (prefix) {
    left.push({ text: oldText.slice(0, prefix), changed: false })
    right.push({ text: newText.slice(0, prefix), changed: false })
  }
  if (oldMiddle || newMiddle) {
    left.push({ text: oldMiddle, changed: true })
    right.push({ text: newMiddle, changed: true })
  }
  if (suffix) {
    left.push({ text: oldText.slice(oldText.length - suffix), changed: false })
    right.push({ text: newText.slice(newText.length - suffix), changed: false })
  }
  return { left, right }
}

function annotateWordChanges(lines: DiffLine[]): (WordSegment[] | undefined)[] {
  const out: (WordSegment[] | undefined)[] = new Array(lines.length)
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'del' && lines[i].kind !== 'add') {
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && (lines[i].kind === 'del' || lines[i].kind === 'add')) {
      if (lines[i].kind === 'del') dels.push(i)
      else adds.push(i)
      i++
    }
    const count = Math.min(dels.length, adds.length)
    for (let j = 0; j < count; j++) {
      const pair = wordPair(lines[dels[j]].text, lines[adds[j]].text)
      out[dels[j]] = pair.left
      out[adds[j]] = pair.right
    }
  }
  return out
}

interface SplitRow {
  kind: 'hunk' | 'meta' | 'split'
  text?: string
  hunkNew?: number
  left?: SplitCell
  right?: SplitCell
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'hunk' || line.kind === 'meta') {
      out.push({ kind: line.kind, text: line.text, hunkNew: line.hunkNew })
      i++
      continue
    }
    if (line.kind === 'ctx') {
      out.push({
        kind: 'split',
        left: { kind: 'ctx', text: line.text, no: line.old },
        right: { kind: 'ctx', text: line.text, no: line.new },
      })
      i++
      continue
    }
    const dels: SplitCell[] = []
    const adds: SplitCell[] = []
    while (i < lines.length && (lines[i].kind === 'del' || lines[i].kind === 'add')) {
      const changed = lines[i]
      if (changed.kind === 'del') dels.push({ kind: 'del', text: changed.text, no: changed.old })
      else adds.push({ kind: 'add', text: changed.text, no: changed.new })
      i++
    }
    const count = Math.max(dels.length, adds.length)
    for (let j = 0; j < count; j++) {
      const left = dels[j] ?? { kind: 'blank', text: '' }
      const right = adds[j] ?? { kind: 'blank', text: '' }
      if (left.kind === 'del' && right.kind === 'add') {
        const pair = wordPair(left.text, right.text)
        left.segments = pair.left
        right.segments = pair.right
      }
      out.push({ kind: 'split', left, right })
    }
  }
  return out
}

const DIFF_LINE_HEIGHT = 20
const DIFF_OVERSCAN = 12
const DIFF_VIRTUAL_THRESHOLD = 200

export interface PatchViewHandle {
  /** Scrolls to the next/previous hunk; false means the file boundary was reached. */
  scrollToHunk(direction: 1 | -1): boolean
  /** New-file line number at the top of the current viewport. */
  currentLine(): number | undefined
}

export const PatchView = forwardRef<PatchViewHandle, { patch: string; binary?: boolean; style?: 'unified' | 'split'; idea?: boolean }>(function PatchView(
  { patch, binary, style = 'unified', idea = false },
  ref,
) {
  const lines = useMemo(() => parsePatch(patch), [patch])
  const hasOldLines = useMemo(() => lines.some((line) => line.old !== undefined), [lines])
  const hasNewLines = useMemo(() => lines.some((line) => line.new !== undefined), [lines])
  const wordChanges = useMemo(() => (idea ? annotateWordChanges(lines) : []), [idea, lines])
  const splitRows = useMemo(() => buildSplitRows(lines), [lines])
  const rows: (DiffLine | SplitRow)[] = style === 'split' ? splitRows : lines
  const splitWidths = useMemo(() => {
    let oldWidth = 20
    let newWidth = 20
    for (const row of splitRows) {
      if (row.kind !== 'split') continue
      oldWidth = Math.max(oldWidth, row.left?.text.length ?? 0)
      newWidth = Math.max(newWidth, row.right?.text.length ?? 0)
    }
    return { old: Math.min(120, oldWidth + 4), new: Math.min(120, newWidth + 4) }
  }, [splitRows])
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const settle = useRef<number | undefined>(undefined)
  const virtual = rows.length > DIFF_VIRTUAL_THRESHOLD
  const hunkRows = useMemo(
    () => rows.map((row, index) => (row.kind === 'hunk' ? index : -1)).filter((index) => index >= 0),
    [rows],
  )

  useImperativeHandle(ref, () => ({
    scrollToHunk(direction) {
      const el = viewport.current
      if (!el || hunkRows.length === 0) return false
      const top = el.scrollTop
      const target =
        direction > 0
          ? hunkRows.find((index) => index * DIFF_LINE_HEIGHT > top + 4)
          : [...hunkRows].reverse().find((index) => index * DIFF_LINE_HEIGHT < top - 4)
      if (target === undefined) return false
      el.scrollTop = Math.max(0, target * DIFF_LINE_HEIGHT - 4)
      return true
    },
    currentLine() {
      const el = viewport.current
      if (!el) return undefined
      const top = el.scrollTop + 1
      const visible = hunkRows.find((index) => index * DIFF_LINE_HEIGHT >= top - 4)
      if (visible !== undefined && visible * DIFF_LINE_HEIGHT < top + 80) {
        const value = rows[visible].hunkNew
        if (value !== undefined) return value
      }
      let hunk: number | undefined
      for (const index of hunkRows) {
        if (index * DIFF_LINE_HEIGHT <= top) {
          const value = rows[index].hunkNew
          if (value !== undefined) hunk = value
        } else {
          break
        }
      }
      if (hunk !== undefined) return hunk
      const start = Math.max(0, Math.floor(el.scrollTop / DIFF_LINE_HEIGHT))
      for (let i = start; i < rows.length; i++) {
        const row = rows[i]
        if (row.kind === 'split') {
          if (row.right?.no !== undefined) return row.right.no
        } else {
          const next = row as DiffLine
          if (next.kind !== 'hunk' && next.kind !== 'meta' && next.new !== undefined) return next.new
        }
      }
      return undefined
    },
  }), [hunkRows, rows])

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    setScrollTop(0)
    el.scrollTop = 0
    // Split is a wider canvas; start at its middle so both sides are in view
    // instead of landing on an empty left edge.
    el.scrollLeft = style === 'split' ? Math.max(0, (el.scrollWidth - el.clientWidth) / 2) : 0
    setHeight(el.clientHeight || 600)
    const observer = new ResizeObserver(() => setHeight(el.clientHeight || 600))
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(settle.current)
    }
  }, [patch, style])

  if (binary) return <Empty icon="warning" title="二进制文件" hint="手机端不展示二进制差异，请在桌面端查看。" />
  if (!patch.trim()) return <Empty title="没有差异" hint="文件内容与对比版本一致。" />

  let start = 0
  let end = rows.length
  if (virtual) {
    start = Math.max(0, Math.floor(scrollTop / DIFF_LINE_HEIGHT) - DIFF_OVERSCAN)
    end = Math.min(rows.length, Math.ceil((scrollTop + height) / DIFF_LINE_HEIGHT) + DIFF_OVERSCAN)
  }
  const visible = virtual ? rows.slice(start, end) : rows
  const rowStyle = (index: number) =>
    virtual ? { position: 'absolute' as const, top: index * DIFF_LINE_HEIGHT, left: 0, minWidth: '100%', width: 'max-content' } : undefined
  const patchStyle = {
    ...(virtual ? { height: rows.length * DIFF_LINE_HEIGHT } : {}),
    ...(style === 'split'
      ? ({ '--split-old': `${splitWidths.old}ch`, '--split-new': `${splitWidths.new}ch` } as React.CSSProperties)
      : {}),
  }

  return (
    <div
      className="patch-viewport"
      ref={viewport}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        flushSync(() => setScrollTop(top))
        window.clearTimeout(settle.current)
        settle.current = window.setTimeout(() => {
          if (viewport.current) setScrollTop(viewport.current.scrollTop)
        }, 120)
      }}
    >
      <div className={`patch ${virtual ? 'virtual' : ''} ${style}`} style={patchStyle}>
        {visible.map((row, i) => {
          const index = virtual ? start + i : i
          if (style === 'split') {
            const split = row as SplitRow
            if (split.kind === 'hunk' || split.kind === 'meta') {
              return (
                <div key={index} className={`diff-line ${split.kind} split-wide`} style={rowStyle(index)}>
                  <span className="code">{split.text}</span>
                </div>
              )
            }
            const left = split.left ?? { kind: 'blank', text: '' }
            const right = split.right ?? { kind: 'blank', text: '' }
            if (idea && !hasOldLines) {
              return (
                <div key={index} className="diff-line split-one-side add" style={rowStyle(index)}>
                  <span className="gutter new changed">{right.no ?? ''}</span>
                  <span className="code">{right.kind === 'add' ? '+' : right.kind === 'ctx' ? ' ' : ''}{right.text}</span>
                </div>
              )
            }
            if (idea && !hasNewLines) {
              return (
                <div key={index} className="diff-line split-one-side del" style={rowStyle(index)}>
                  <span className="gutter old changed">{left.no ?? ''}</span>
                  <span className="code">{left.kind === 'del' ? '-' : left.kind === 'ctx' ? ' ' : ''}{left.text}</span>
                </div>
              )
            }
            return (
              <div key={index} className="diff-line split-row" style={rowStyle(index)}>
                <span className={`split-gutter ${left.kind}`}>{left.no ?? ''}</span>
                <span className={`split-code ${left.kind}`}>{left.kind === 'del' ? '-' : left.kind === 'ctx' ? ' ' : ''}{idea && left.segments ? left.segments.map((segment, j) => segment.changed ? <mark key={j} className="word-del">{segment.text}</mark> : segment.text) : left.text}</span>
                <span className={`split-gutter ${right.kind}`}>{right.no ?? ''}</span>
                <span className={`split-code ${right.kind}`}>{right.kind === 'add' ? '+' : right.kind === 'ctx' ? ' ' : ''}{idea && right.segments ? right.segments.map((segment, j) => segment.changed ? <mark key={j} className="word-add">{segment.text}</mark> : segment.text) : right.text}</span>
              </div>
            )
          }
          const line = row as DiffLine
          return (
            <div key={index} className={`diff-line ${line.kind}`} style={rowStyle(index)}>
              {(idea ? hasOldLines : true) ? <span className={`gutter old ${line.kind === 'del' ? 'changed' : ''}`}>{line.old ?? ''}</span> : null}
              {(idea ? hasNewLines : true) ? <span className={`gutter new ${line.kind === 'add' ? 'changed' : ''}`}>{line.new ?? ''}</span> : null}
              {idea ? <span className={`marker ${line.kind}`}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span> : null}
              <span className="code">
                {idea && wordChanges[index]
                  ? wordChanges[index]!.map((segment, j) => segment.changed ? <mark key={j} className={`word-${line.kind}`}>{segment.text}</mark> : segment.text)
                  : `${idea ? '' : line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'ctx' ? ' ' : ''}${line.text}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})

export function DiffNavBar({
  position,
  canPrevFile,
  canNextFile,
  onPrevChange,
  onNextChange,
  onPrevFile,
  onNextFile,
  onOpen,
}: {
  position: string
  canPrevFile: boolean
  canNextFile: boolean
  onPrevChange: () => void
  onNextChange: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onOpen: () => void
}) {
  return (
    <div className="diff-nav-row">
      <button className="nav-icon" onClick={onPrevChange} title="上一处改动" aria-label="上一处改动">
        <Icon name="up" size={15} />
      </button>
      <button className="nav-icon" onClick={onNextChange} title="下一处改动" aria-label="下一处改动">
        <Icon name="down" size={15} />
      </button>
      <button className="nav-icon" onClick={onOpen} title="打开文件" aria-label="打开文件">
        <Icon name="jump" size={15} />
      </button>
      <button className="nav-icon" onClick={onPrevFile} disabled={!canPrevFile} title="上一个文件" aria-label="上一个文件">
        <Icon name="left" size={15} />
      </button>
      <button className="nav-icon" onClick={onNextFile} disabled={!canNextFile} title="下一个文件" aria-label="下一个文件">
        <Icon name="right" size={15} />
      </button>
      <span className="diff-position">{position}</span>
    </div>
  )
}

export interface MultiPatchFile {
  path: string
  status: string
  added: number
  deleted: number
  patch: string
}

type MultiRow =
  | { kind: 'file'; file: MultiPatchFile; top: number; height: number }
  | { kind: 'line'; line: DiffLine; file: MultiPatchFile; top: number; height: number }

const MP_FILE_HEIGHT = 32
const MP_LINE_HEIGHT = 20
const MP_OVERSCAN = 10

export function MultiPatchView({ files }: { files: MultiPatchFile[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [range, setRange] = useState({ start: 0, end: 40 })
  const viewport = useRef<HTMLDivElement>(null)
  const settle = useRef<number | undefined>(undefined)

  const rows = useMemo<MultiRow[]>(() => {
    const out: MultiRow[] = []
    let top = 0
    for (const file of files) {
      out.push({ kind: 'file', file, top, height: MP_FILE_HEIGHT })
      top += MP_FILE_HEIGHT
      if (collapsed.has(file.path)) continue
      for (const line of parsePatch(file.patch)) {
        out.push({ kind: 'line', line, file, top, height: MP_LINE_HEIGHT })
        top += MP_LINE_HEIGHT
      }
    }
    return out
  }, [files, collapsed])
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    setHeight(el.clientHeight || 600)
    const observer = new ResizeObserver(() => setHeight(el.clientHeight || 600))
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(settle.current)
    }
  }, [])

  useEffect(() => {
    const top = scrollTop
    let lo = 0
    let hi = rows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].top + rows[mid].height < top) lo = mid + 1
      else hi = mid
    }
    let start = Math.max(0, lo - MP_OVERSCAN)
    let end = start
    while (end < rows.length && rows[end].top < top + height) end++
    end = Math.min(rows.length, end + MP_OVERSCAN)
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [rows, scrollTop, height])

  const current = useMemo(() => {
    let file: MultiPatchFile | undefined = rows[0]?.kind === 'file' ? rows[0].file : rows[0]?.file
    for (const row of rows) {
      if (row.top > scrollTop) break
      file = row.file
    }
    return file
  }, [rows, scrollTop])

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const allCollapsed = files.length > 0 && files.every((f) => collapsed.has(f.path))
  const fileTops = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of rows) {
      if (row.kind === 'file' && !map.has(row.file.path)) map.set(row.file.path, row.top)
    }
    return map
  }, [rows])

  const jumpTo = (path: string) => {
    const top = fileTops.get(path)
    if (top !== undefined && viewport.current) viewport.current.scrollTop = top
    setPicker(false)
  }

  return (
    <div className="multi-patch">
      <div className="mp-bar">
        <span className={`status-letter s-${current?.status.slice(0, 1) === '?' ? 'untracked' : current?.status.slice(0, 1)}`}>
          {current?.status.slice(0, 1)}
        </span>
        <button className="mp-current" onClick={() => setPicker(true)} title="选择文件">
          <span>{current?.path}</span>
          <Icon name="chevron" size={12} />
        </button>
        <button
          className="mini-btn"
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(files.map((f) => f.path)))
          }
        >
          {allCollapsed ? '全部展开' : '全部收起'}
        </button>
      </div>
      <div
        className="mp-viewport"
        ref={viewport}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop
          setScrollTop(top)
          window.clearTimeout(settle.current)
          settle.current = window.setTimeout(() => {
            if (viewport.current) setScrollTop(viewport.current.scrollTop)
          }, 100)
        }}
      >
        <div className="mp-inner" style={{ height: total }}>
          {rows.slice(range.start, range.end).map((row) =>
            row.kind === 'file' ? (
              <button
                key={`f:${row.file.path}`}
                className="mp-file-row"
                style={{ top: row.top, height: row.height }}
                onClick={() => toggle(row.file.path)}
                aria-expanded={!collapsed.has(row.file.path)}
              >
                <Icon name={collapsed.has(row.file.path) ? 'chevron' : 'down'} size={13} />
                <span className={`status-letter s-${row.file.status.slice(0, 1) === '?' ? 'untracked' : row.file.status.slice(0, 1)}`}>
                  {row.file.status.slice(0, 1)}
                </span>
                <span className="mp-path" title={row.file.path}>
                  <span className="mp-dir">{row.file.path.slice(0, row.file.path.lastIndexOf('/') + 1)}</span>
                  {row.file.path.slice(row.file.path.lastIndexOf('/') + 1)}
                </span>
                <span className="file-stats">
                  {row.file.added > 0 ? <em className="plus">+{row.file.added}</em> : null}
                  {row.file.deleted > 0 ? <em className="minus">−{row.file.deleted}</em> : null}
                </span>
              </button>
            ) : (
              <div
                key={`l:${row.file.path}:${row.top}`}
                className={`diff-line ${row.line.kind}`}
                style={{ top: row.top, height: row.height, left: 0, minWidth: '100%', width: 'max-content' }}
              >
                <span className="gutter">{row.line.old ?? ''}</span>
                <span className="gutter">{row.line.new ?? ''}</span>
                <span className="code">
                  {row.line.kind === 'add' ? '+' : row.line.kind === 'del' ? '-' : row.line.kind === 'ctx' ? ' ' : ''}
                  {row.line.text}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
      <Sheet open={picker} title="文件" onClose={() => setPicker(false)}>
        <div className="mp-file-list">
          {files.map((file) => (
            <button key={file.path} className="mp-file-item" onClick={() => jumpTo(file.path)}>
              <span className={`status-letter s-${file.status.slice(0, 1) === '?' ? 'untracked' : file.status.slice(0, 1)}`}>
                {file.status.slice(0, 1)}
              </span>
              <span className="file-path">{file.path}</span>
              <span className="file-stats">
                {file.added > 0 ? <em className="plus">+{file.added}</em> : null}
                {file.deleted > 0 ? <em className="minus">−{file.deleted}</em> : null}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

/* ---------- misc ---------- */

export function ago(unix: number): string {
  const diff = Math.max(0, Date.now() / 1000 - unix)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return new Date(unix * 1000).toLocaleDateString('zh-CN')
}

export function dayKey(unix: number): string {
  const d = new Date(unix * 1000)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400_000)
  if (d.toDateString() === today.toDateString()) return '今天'
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

export function timeOf(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function repoColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 55% 55%)`
}
