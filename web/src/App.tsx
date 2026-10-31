import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Workspace } from './types'
import { ApiError, api, clearPairing, deviceName, forgetPairCode, getServer, pairDevice, pendingPairCode } from './api'
import { go, useRoute } from './hooks'
import { Icon, Spinner } from './components'
import { ChangesScreen } from './views/Changes'
import { CodeScreen, FileScreen, TreeScreen } from './views/Code'
import { CommitFileScreen, CommitPatchScreen, CommitScreen, GitScreen } from './views/Git'
import { DiffScreen } from './views/Diff'
import { SettingsScreen } from './views/Settings'

const TABS = [
  { id: 'changes', label: '改动', icon: 'changes' },
  { id: 'code', label: '代码', icon: 'code' },
  { id: 'git', label: '提交', icon: 'git' },
  { id: 'settings', label: '设置', icon: 'settings' },
]

function Shell({ children, tab }: { children: ReactNode; tab?: string }) {
  return (
    <div className={`app ${tab ? 'with-tab' : ''}`}>
      <div className="app-content">{children}</div>
      {tab ? (
        <nav className="tabbar" aria-label="主导航">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(`#/${t.id}`)}>
              <Icon name={t.icon} size={21} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

function PairingScreen({ initialError }: { initialError?: string }) {
  const autoCode = useRef(pendingPairCode())
  const attempted = useRef(false)
  const [code, setCode] = useState(autoCode.current)
  const [error, setError] = useState(initialError ?? '')
  const [busy, setBusy] = useState(false)

  const connect = useCallback(async (value: string) => {
    const clean = value.trim()
    if (!/^\d{6}$/.test(clean)) {
      setError('请输入电脑端显示的 6 位配对码')
      return
    }
    setBusy(true)
    setError('')
    try {
      await pairDevice(getServer(), clean)
      forgetPairCode()
      location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '配对失败')
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (attempted.current || !/^\d{6}$/.test(autoCode.current)) return
    attempted.current = true
    void connect(autoCode.current)
  }, [connect])

  return (
    <div className="pairing">
      <div className="pairing-brand">
        <span className="brand-mark">N</span>
        <div>
          <h1>Nemorous Mobile</h1>
          <p>手机上的多仓 Git 控制台</p>
        </div>
      </div>
      <div className="panel pairing-panel">
        <p className="pairing-lead">
          在电脑端启动服务后，把终端打印的 6 位配对码填到这里。Git 操作始终在电脑上执行，手机不保存仓库副本。
        </p>
        <label className="field">
          <span>配对码</span>
          <input
            className="text-input code-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              setError('')
            }}
            placeholder="000000"
            autoFocus
            autoComplete="one-time-code"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void connect(code)
            }}
          />
        </label>
        <p className="hint">本机将被记录为：{deviceName()}</p>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn primary block" disabled={busy || code.length !== 6} onClick={() => void connect(code)}>
          {busy ? '配对中…' : '连接工作区'}
        </button>
      </div>
      <div className="pairing-steps">
        <p><b>1</b> 电脑端启动：<code>./nemorous-mobile -workspace ~/code</code></p>
        <p><b>2</b> 手机与电脑处于同一局域网 / Tailscale</p>
        <p><b>3</b> 打开终端打印的链接（自动带配对码），或手动输入配对码</p>
      </div>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const [authFailed, setAuthFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api<Workspace>('/api/workspace')
      setWs(data)
      setError('')
      setAuthFailed(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setWs(null)
        setAuthFailed(true)
      } else {
        setError(err instanceof Error ? err.message : '无法连接服务')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live invalidation: the server only says "something changed"; the client
  // refetches through the normal API. A slow poll remains as a fallback.
  const connected = ws !== null
  useEffect(() => {
    if (!connected || authFailed) return
    let debounce: number | undefined
    let lastErrorCheck = 0
    const events = new EventSource('/api/events')
    events.addEventListener('invalidate', () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void refresh(), 250)
    })
    events.onopen = () => void refresh()
    events.onerror = () => {
      // EventSource reconnects on its own; a 401 only surfaces via the API.
      const now = Date.now()
      if (now - lastErrorCheck > 5000) {
        lastErrorCheck = now
        void refresh()
      }
    }
    return () => {
      events.close()
      window.clearTimeout(debounce)
    }
  }, [connected, authFailed, refresh])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && !authFailed) void refresh()
    }
    const timer = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh, authFailed])

  useEffect(() => {
    if (route.screen === 'changes' || route.screen === 'git') void refresh()
  }, [route.screen, refresh])

  if (authFailed) {
    return <PairingScreen initialError="设备未配对或会话已失效，请输入电脑端当前的配对码" />
  }

  if (loading && !ws) {
    return (
      <div className="boot">
        <span className="brand-mark">N</span>
        <Spinner label="连接工作区…" />
      </div>
    )
  }

  if (!ws) {
    return (
      <div className="pairing">
        <div className="panel pairing-panel">
          <h2>无法连接工作区</h2>
          <p className="error-text">{error}</p>
          <div className="action-row">
            <button className="btn primary" onClick={() => void refresh()}>重试</button>
            <button className="btn ghost" onClick={() => { clearPairing(); location.reload() }}>清除本地配对</button>
          </div>
          <p className="hint">确认电脑端服务仍在运行，且手机可访问当前地址。</p>
        </div>
      </div>
    )
  }

  const tab =
    route.screen === 'diff' ? 'changes'
      : route.screen === 'file' || route.screen === 'tree' ? 'code'
        : route.screen === 'commit' || route.screen === 'commit-file' || route.screen === 'commit-patch' ? 'git'
          : route.screen

  const detail = ['diff', 'file', 'tree', 'commit', 'commit-file', 'commit-patch'].includes(route.screen)
  const p = route.params
  const repoId = p.get('repo') ?? ''
  const path = p.get('path') ?? ''

  let screen: ReactNode
  switch (route.screen) {
    case 'diff':
      screen = path && repoId
        ? <DiffScreen ws={ws} repoId={repoId} path={path} staged={p.get('staged') === '1'} refresh={refresh} />
        : <div className="screen"><p className="hint">缺少文件参数。</p></div>
      break
    case 'file':
      screen = path && repoId
        ? <FileScreen repoId={repoId} path={path} rev={p.get('rev') ?? undefined} line={Number(p.get('line')) || undefined} />
        : <div className="screen"><p className="hint">缺少文件参数。</p></div>
      break
    case 'tree':
      screen = repoId
        ? <TreeScreen repoId={repoId} repoName={ws.repos.find((r) => r.id === repoId)?.name ?? '仓库文件'} />
        : <div className="screen"><p className="hint">缺少仓库参数。</p></div>
      break
    case 'commit':
      screen = repoId && p.get('hash')
        ? <CommitScreen repoId={repoId} hash={p.get('hash') ?? ''} />
        : <div className="screen"><p className="hint">缺少提交参数。</p></div>
      break
    case 'commit-file':
      screen = repoId && p.get('hash') && path
        ? <CommitFileScreen repoId={repoId} hash={p.get('hash') ?? ''} path={path} />
        : <div className="screen"><p className="hint">缺少提交文件参数。</p></div>
      break
    case 'commit-patch':
      screen = repoId && p.get('hash')
        ? <CommitPatchScreen repoId={repoId} hash={p.get('hash') ?? ''} />
        : <div className="screen"><p className="hint">缺少提交参数。</p></div>
      break
    case 'git':
      screen = <GitScreen ws={ws} />
      break
    case 'code':
      screen = <CodeScreen ws={ws} />
      break
    case 'settings':
      screen = <SettingsScreen ws={ws} />
      break
    default:
      screen = <ChangesScreen ws={ws} refresh={refresh} />
  }

  return (
    <Shell tab={detail ? undefined : tab}>
      {error ? (
        <div className="error-banner global" onClick={() => void refresh()}>
          <Icon name="warning" size={15} /> {error}（点按重试）
        </div>
      ) : null}
      {screen}
    </Shell>
  )
}
