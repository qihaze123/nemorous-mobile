import { useCallback, useEffect, useState } from 'react'
import type { BranchPreset, DevicesResponse, PairCodeResponse, PresetsResponse, Workspace, WorkspacesResponse } from '../types'
import { api, clearPairing, deviceName, getServer, getTheme, post, setTheme } from '../api'
import { canFullscreen, canInstall, enterFullscreen, INSTALL_EVENT, installApp, isSecureContext, isStandalone } from '../pwa'
import { Icon, SectionTitle, Sheet, Spinner, ago, useToast } from '../components'

const THEMES = [
  { id: 'auto', label: '跟随系统' },
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
]

export function SettingsScreen({ ws }: { ws: Workspace }) {
  const [devices, setDevices] = useState<DevicesResponse | null>(null)
  const [pair, setPair] = useState<PairCodeResponse | null>(null)
  const [presets, setPresets] = useState<BranchPreset[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspacesResponse | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceCreate, setWorkspaceCreate] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [installable, setInstallable] = useState(canInstall())
  const [standalone, setStandalone] = useState(isStandalone())
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
      const [devicesRes, pairRes, presetsRes, workspacesRes] = await Promise.all([
        api<DevicesResponse>('/api/devices'),
        api<PairCodeResponse>('/api/pair/code'),
        api<PresetsResponse>('/api/presets'),
        api<WorkspacesResponse>('/api/workspaces'),
      ])
      setDevices(devicesRes)
      setPair(pairRes)
      setPresets(presetsRes.presets ?? [])
      setWorkspaces(workspacesRes)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取设备失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api<{ version: string }>('/api/health').then((h) => setVersion(h.version)).catch(() => {})
    const syncInstall = () => {
      setInstallable(canInstall())
      setStandalone(isStandalone())
    }
    addEventListener(INSTALL_EVENT, syncInstall)
    return () => removeEventListener(INSTALL_EVENT, syncInstall)
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

  const savePreset = async () => {
    const branches = Object.fromEntries(ws.repos.filter((r) => r.branch).map((r) => [r.id, r.branch]))
    if (!presetName.trim() || Object.keys(branches).length === 0) return
    setBusy('preset')
    try {
      await post('/api/presets', { name: presetName.trim(), branches })
      setPresetName('')
      await load()
      notify('已保存分支预设', 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const deletePreset = async (name: string) => {
    setBusy(`preset:${name}`)
    try {
      await post('/api/presets/delete', { name })
      await load()
      notify('已删除预设', 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const switchWorkspace = async (path: string) => {
    if (busy) return
    setBusy(`workspace:${path}`)
    try {
      await post('/api/workspaces/select', { path })
      location.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换工作区失败', 'error')
      setBusy('')
    }
  }

  const addWorkspace = async () => {
    const path = workspacePath.trim()
    if (!path) return
    setBusy('workspace:add')
    try {
      await post('/api/workspaces', { path, create: workspaceCreate })
      location.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : '添加工作区失败', 'error')
      setBusy('')
    }
  }

  const install = async () => {
    try {
      const accepted = await installApp()
      notify(accepted ? '已开始安装' : '已取消安装', accepted ? 'ok' : 'info')
    } catch {
      notify('当前浏览器没有提供安装入口', 'error')
    }
  }

  const fullscreen = async () => {
    try {
      await enterFullscreen()
    } catch {
      notify('当前浏览器不支持全屏', 'error')
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
      </header>

      <SectionTitle>工作区</SectionTitle>
      <div className="panel workspace-panel">
        {workspaces?.workspaces.map((item) => (
          <button
            key={item.root}
            className={`workspace-row ${item.active ? 'on' : ''}`}
            disabled={!!busy || item.active}
            onClick={() => void switchWorkspace(item.root)}
          >
            <span className="workspace-main">
              <span className="workspace-name">
                {item.name}
                {item.active ? <em>当前</em> : null}
              </span>
              <code className="workspace-path">{item.root}</code>
            </span>
            <span className="workspace-count">{item.repos} 仓库</span>
            <Icon name={item.active ? 'check' : busy === `workspace:${item.root}` ? 'refresh' : 'chevron'} size={15} />
          </button>
        ))}
        {!workspaces ? <Spinner label="读取工作区…" /> : null}
        <button className="btn ghost block" onClick={() => setWorkspaceOpen(true)}>
          <Icon name="plus" size={15} /> 添加 / 创建工作区
        </button>
        <p className="hint">切换工作区会刷新当前页面；所有已配对设备共享同一活动工作区。</p>
      </div>

      <Sheet
        open={workspaceOpen}
        title="添加或创建工作区"
        onClose={() => { if (!busy) setWorkspaceOpen(false) }}
        footer={
          <>
            <button className="btn ghost" disabled={!!busy} onClick={() => setWorkspaceOpen(false)}>取消</button>
            <button className="btn primary" disabled={!!busy || !workspacePath.trim()} onClick={() => void addWorkspace()}>
              {busy === 'workspace:add' ? '处理中…' : '添加并切换'}
            </button>
          </>
        }
      >
        <label className="field">
          <span>工作区目录（绝对路径）</span>
          <input
            className="text-input"
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="/Users/you/code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={workspaceCreate} onChange={(e) => setWorkspaceCreate(e.target.checked)} />
          <span>目录不存在时创建空目录</span>
        </label>
        <p className="hint">添加后，本机所有已配对设备都能访问该目录下的 Git 仓库。空工作区需要先在电脑端放入或克隆仓库。</p>
      </Sheet>

      <SectionTitle>安装到手机</SectionTitle>
      <div className="panel">
        {standalone ? (
          <p className="install-state"><Icon name="check" size={15} /> 已作为独立应用运行</p>
        ) : installable ? (
          <button className="btn primary block" onClick={() => void install()}>
            安装到手机
          </button>
        ) : (
          <p className="hint">
            {isSecureContext()
              ? `${deviceName()}: ${deviceName().includes('iPhone') || deviceName().includes('iPad') ? 'Safari → 分享 → 添加到主屏幕' : deviceName().includes('Android') ? 'Chrome 菜单 → 安装应用 / 添加到主屏幕' : '浏览器菜单 → 安装应用 / 添加到主屏幕'}`
              : '当前是 HTTP，浏览器不会提供安装入口。请改用 HTTPS 地址访问。'}
          </p>
        )}
        <p className="hint">地址：{location.origin} · {isSecureContext() ? '安全上下文' : '非安全上下文'}</p>
        {!standalone && canFullscreen() ? (
          <button className="btn ghost block" onClick={() => void fullscreen()}>
            临时全屏显示
          </button>
        ) : null}
        <p className="hint">安装后会以独立窗口运行，不再显示浏览器地址栏。</p>
      </div>

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

      <SectionTitle>分支预设</SectionTitle>
      <div className="panel">
        <div className="inline-form">
          <input
            className="text-input"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="预设名称，例如 Billing-V2"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="btn primary" disabled={busy === 'preset' || !presetName.trim()} onClick={() => void savePreset()}>
            保存当前
          </button>
        </div>
        <p className="hint">保存当前各仓库的分支组合；应用时脏仓库仍会被跳过。</p>
        {presets.length === 0 ? <p className="hint">还没有预设。</p> : null}
        {presets.map((preset) => (
          <div className="preset-row" key={preset.name}>
            <div className="preset-main">
              <span className="preset-name">{preset.name}</span>
              <span className="preset-branches">
                {Object.entries(preset.branches).map(([repoId, branch]) => {
                  const repo = ws.repos.find((r) => r.id === repoId)
                  return <span className="repo-chip" key={repoId}>{repo?.name ?? '已移除仓库'} → {branch}</span>
                })}
              </span>
            </div>
            <button className="mini-btn" disabled={busy === `preset:${preset.name}`} onClick={() => void deletePreset(preset.name)}>
              删除
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
