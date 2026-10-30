import { useEffect, useState } from 'react'
import type { Workspace } from '../types'
import { api, checkPairing, clearPairing, getServer, getTheme, setServer, setTheme, setToken } from '../api'
import { Icon, SectionTitle, useToast } from '../components'

const THEMES = [
  { id: 'auto', label: '跟随系统' },
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
]

export function SettingsScreen({ ws }: { ws: Workspace }) {
  const [server, setServerValue] = useState(getServer())
  const [token, setTokenValue] = useState('')
  const [theme, setThemeValue] = useState(getTheme())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState('')
  const notify = useToast()

  useEffect(() => {
    api<{ version: string }>('/api/health').then((h) => setVersion(h.version)).catch(() => {})
  }, [])

  const save = async () => {
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
      notify('配对已更新', 'ok')
      setTimeout(() => location.reload(), 300)
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败')
    } finally {
      setBusy(false)
    }
  }

  const changeTheme = (id: string) => {
    setThemeValue(id)
    setTheme(id)
  }

  const disconnect = () => {
    clearPairing()
    location.reload()
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">设置</div>
          <h1>连接与外观</h1>
        </div>
      </header>

      <SectionTitle>伴生服务</SectionTitle>
      <div className="panel">
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
            placeholder="电脑端启动时打印的令牌"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn primary block" disabled={busy} onClick={() => void save()}>
          {busy ? '验证中…' : '验证并保存'}
        </button>
        <p className="hint">令牌保存在本机浏览器；服务端只接受带令牌的请求。</p>
      </div>

      <SectionTitle>外观</SectionTitle>
      <div className="segmented theme-seg">
        {THEMES.map((t) => (
          <button key={t.id} className={theme === t.id ? 'on' : ''} onClick={() => changeTheme(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <SectionTitle>工作区</SectionTitle>
      <div className="panel info-grid">
        <span>名称</span><span>{ws.name}</span>
        <span>路径</span><code>{ws.root}</code>
        <span>仓库</span><span>{ws.repos.length} 个</span>
        <span>服务版本</span><span>{version || '—'}</span>
      </div>

      <SectionTitle>安全说明</SectionTitle>
      <div className="panel">
        <ul className="safety-list">
          <li><Icon name="check" size={15} /> 所有 Git 命令在电脑端执行，手机不保存仓库副本。</li>
          <li><Icon name="check" size={15} /> 推送、切换分支前会检查未提交改动，绝不强制覆盖。</li>
          <li><Icon name="check" size={15} /> 任何推送都不会使用 <code>--force</code> 或 <code>--force-with-lease</code>。</li>
          <li><Icon name="warning" size={15} /> 令牌等同于工作区写权限，请在可信网络中启动服务。</li>
          <li><Icon name="warning" size={15} /> 手机丢失时，重启服务并设置新令牌即可失效旧令牌。</li>
        </ul>
      </div>

      <SectionTitle>配对</SectionTitle>
      <div className="panel">
        <button className="btn ghost block danger-text" onClick={disconnect}>
          <Icon name="power" size={16} /> 清除配对并重新连接
        </button>
      </div>

      <p className="hint center">Nemorous Mobile · 手机是遥控器，Git 在电脑上跑</p>
      <div className="screen-bottom-space" />
    </div>
  )
}
