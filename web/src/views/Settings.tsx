import { useCallback, useEffect, useState } from 'react'
import type { DevicesResponse, PairCodeResponse, Workspace } from '../types'
import { api, clearPairing, getServer, getTheme, setTheme } from '../api'
import { Icon, SectionTitle, Spinner, ago, useToast } from '../components'

const THEMES = [
  { id: 'auto', label: '跟随系统' },
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
]

export function SettingsScreen({ ws }: { ws: Workspace }) {
  const [devices, setDevices] = useState<DevicesResponse | null>(null)
  const [pair, setPair] = useState<PairCodeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [theme, setThemeValue] = useState(getTheme())
  const [version, setVersion] = useState('')
  const notify = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [devicesRes, pairRes] = await Promise.all([
        api<DevicesResponse>('/api/devices'),
        api<PairCodeResponse>('/api/pair/code'),
      ])
      setDevices(devicesRes)
      setPair(pairRes)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取设备失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api<{ version: string }>('/api/health').then((h) => setVersion(h.version)).catch(() => {})
  }, [load])

  const revoke = async (id: string, current: boolean) => {
    setBusy(id)
    try {
      await api(`/api/devices/${id}`, { method: 'DELETE' })
      if (current) {
        clearPairing()
        location.reload()
        return
      }
      await load()
      notify('已撤销设备', 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : '撤销失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const changeTheme = (id: string) => {
    setThemeValue(id)
    setTheme(id)
  }

  const copyCode = async () => {
    if (!pair) return
    try {
      await navigator.clipboard.writeText(pair.code)
      notify('配对码已复制', 'ok')
    } catch {
      notify('复制失败', 'error')
    }
  }

  const currentDevice = devices?.devices.find((d) => d.id === devices.currentId)

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <div className="eyebrow">设置</div>
          <h1>连接与外观</h1>
        </div>
        <button className="icon-btn" onClick={() => void load()} aria-label="刷新">
          <Icon name="refresh" />
        </button>
      </header>

      <SectionTitle>配对码</SectionTitle>
      <div className="panel pair-panel">
        {loading && !pair ? <Spinner label="读取配对码…" /> : null}
        {pair ? (
          <>
            <div className="pair-code">{pair.code}</div>
            <p className="hint">
              10 分钟内有效 · {new Date(pair.expiresAt * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 过期
            </p>
            <div className="action-row">
              <button className="btn subtle" onClick={() => void copyCode()}>
                <Icon name="copy" size={15} /> 复制配对码
              </button>
              <button className="btn subtle" onClick={() => void load()}>
                <Icon name="refresh" size={15} /> 刷新
              </button>
            </div>
          </>
        ) : null}
        <p className="hint">在新手机上打开服务地址，输入这个配对码即可加入。</p>
      </div>

      <SectionTitle>已配对设备</SectionTitle>
      <div className="panel device-panel">
        {error ? <p className="error-text">{error}</p> : null}
        {devices?.devices.length === 0 ? <p className="hint">还没有其他设备。</p> : null}
        {devices?.devices.map((device) => (
          <div className="device-row" key={device.id}>
            <span className="device-icon"><Icon name={device.current ? 'check' : 'power'} size={15} /></span>
            <span className="device-main">
              <span className="device-name">
                {device.name}
                {device.current ? <em>本机</em> : null}
              </span>
              <span className="device-meta">最近 {ago(device.lastSeenAt)} · 加入于 {new Date(device.createdAt * 1000).toLocaleDateString('zh-CN')}</span>
            </span>
            <button className="mini-btn" disabled={busy === device.id} onClick={() => void revoke(device.id, !!device.current)}>
              {device.current ? '退出' : '撤销'}
            </button>
          </div>
        ))}
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
        <span>服务</span><code>{getServer()}</code>
        <span>版本</span><span>{version || '—'}</span>
        <span>会话</span><span>{currentDevice ? currentDevice.name : '—'}</span>
      </div>

      <SectionTitle>安全说明</SectionTitle>
      <div className="panel">
        <ul className="safety-list">
          <li><Icon name="check" size={15} /> 会话保存在 HttpOnly Cookie，页面脚本读不到凭证。</li>
          <li><Icon name="check" size={15} /> 配对码 6 位、10 分钟有效，按 IP 限制尝试次数。</li>
          <li><Icon name="check" size={15} /> 所有 Git 命令在电脑端执行，手机不保存仓库副本。</li>
          <li><Icon name="check" size={15} /> 推送、切换分支前会检查未提交改动，绝不强制覆盖。</li>
          <li><Icon name="warning" size={15} /> 设备等同于工作区写权限，丢失手机请在这里立即撤销。</li>
        </ul>
      </div>

      <p className="hint center">Nemorous Mobile · 手机是遥控器，Git 在电脑上跑</p>
      <div className="screen-bottom-space" />
    </div>
  )
}
