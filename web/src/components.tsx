import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  close: ['M6 6l12 12M18 6L6 18'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  file: ['M6 3h8l4 4v14H6Z', 'M14 3v5h4'],
  chevron: ['M9 6l6 6-6 6'],
  down: ['M6 9l6 6 6-6'],
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
      out.push({ kind: 'hunk', text: raw })
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

const DIFF_LINE_HEIGHT = 20
const DIFF_OVERSCAN = 12
const DIFF_VIRTUAL_THRESHOLD = 200

export function PatchView({ patch, binary }: { patch: string; binary?: boolean }) {
  const lines = useMemo(() => parsePatch(patch), [patch])
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const settle = useRef<number | undefined>(undefined)
  const virtual = lines.length > DIFF_VIRTUAL_THRESHOLD

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    setScrollTop(0)
    el.scrollTop = 0
    setHeight(el.clientHeight || 600)
    const observer = new ResizeObserver(() => setHeight(el.clientHeight || 600))
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(settle.current)
    }
  }, [patch])

  if (binary) return <Empty icon="warning" title="二进制文件" hint="手机端不展示二进制差异，请在桌面端查看。" />
  if (!patch.trim()) return <Empty title="没有差异" hint="文件内容与对比版本一致。" />

  let start = 0
  let end = lines.length
  if (virtual) {
    start = Math.max(0, Math.floor(scrollTop / DIFF_LINE_HEIGHT) - DIFF_OVERSCAN)
    end = Math.min(lines.length, Math.ceil((scrollTop + height) / DIFF_LINE_HEIGHT) + DIFF_OVERSCAN)
  }
  const visible = virtual ? lines.slice(start, end) : lines
  return (
    <div
      className="patch-viewport"
      ref={viewport}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        flushSync(() => setScrollTop(top))
        // Some browsers coalesce the last scroll event of a fling.
        window.clearTimeout(settle.current)
        settle.current = window.setTimeout(() => {
          if (viewport.current) setScrollTop(viewport.current.scrollTop)
        }, 120)
      }}
    >
      <div
        className={`patch ${virtual ? 'virtual' : ''}`}
        style={virtual ? { height: lines.length * DIFF_LINE_HEIGHT } : undefined}
      >
        {visible.map((line, i) => {
          const index = virtual ? start + i : i
          return (
            <div
              key={index}
              className={`diff-line ${line.kind}`}
              style={virtual ? { position: 'absolute', top: index * DIFF_LINE_HEIGHT, left: 0, minWidth: '100%', width: 'max-content' } : undefined}
            >
              <span className="gutter">{line.old ?? ''}</span>
              <span className="gutter">{line.new ?? ''}</span>
              <span className="code">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'ctx' ? ' ' : ''}{line.text}</span>
            </div>
          )
        })}
      </div>
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
