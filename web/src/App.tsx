import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Workspace } from './types'
import { ApiError, api, checkPairing, clearPairing, getServer, getToken, setServer, setToken } from './api'
import { go, useRoute } from './hooks'
import { Icon, Spinner } from './components'
import { ChangesScreen } from './views/Changes'
import { CodeScreen, FileScreen, TreeScreen } from './views/Code'
import { CommitScreen, GitScreen } from './views/Git'
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
    <div className="app">
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
  const [server, setServerValue] = useState(getServer() || location.origin)
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    if (!server.trim() || !token.trim()) {
      setError('请填写服务地址和配对令牌')
      return
    }
    setBusy(true)
    setError('')
    try {
      await checkPairing(server, token)
      setServer(server)
      setToken(token)
      location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败')
      setBusy(false)
    }
  }

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
            先在电脑上运行伴生服务，再把启动时打印的地址与令牌填到这里。Git 操作始终在电脑上执行，手机不保存仓库副本。
          </p>
          <label className="field">
            <span>服务地址</span>
            <input
              className="text-input"
              value={server}
              onChange={(e) => setServerValue(e.target.value)}
              placeholder="http://192.168.1.5:8787"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>配对令牌</span>
            <input
              className="text-input"
              type="password"
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
              placeholder="32 位十六进制令牌"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect()
              }}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn primary block" disabled={busy} onClick={() => void connect()}>
            {busy ? '连接中…' : '连接工作区'}
          </button>
        </div>
      <div className="pairing-steps">
        <p><b>1</b> 电脑端启动：<code>./nemorous-mobile -workspace ~/code</code></p>
        <p><b>2</b> 手机与电脑处于同一局域网 / Tailscale</p>
        <p><b>3</b> 打开终端打印的链接，或在上方手动配对</p>
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
        setAuthFailed(true)
      } else {
        setError(err instanceof Error ? err.message : '无法连接服务')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!getToken()) return
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  useEffect(() => {
    if (route.screen === 'changes' || route.screen === 'git') void refresh()
  }, [route.screen, refresh])

  if (!getToken() || authFailed) {
    return <PairingScreen initialError={authFailed ? '配对令牌已失效，请重新输入电脑端当前的令牌' : undefined} />
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
            <button className="btn ghost" onClick={() => { clearPairing(); location.reload() }}>重新配对</button>
          </div>
          <p className="hint">确认电脑端服务仍在运行，且手机可访问上面的地址。</p>
        </div>
      </div>
    )
  }

  const tab =
    route.screen === 'diff' ? 'changes'
      : route.screen === 'file' || route.screen === 'tree' ? 'code'
        : route.screen === 'commit' ? 'git'
          : route.screen

  const detail = ['diff', 'file', 'tree', 'commit'].includes(route.screen)
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
    case 'git':
      screen = <GitScreen ws={ws} refresh={refresh} />
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
