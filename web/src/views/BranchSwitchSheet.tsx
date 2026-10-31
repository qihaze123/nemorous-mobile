import { useEffect, useState } from 'react'
import type { BranchPreset, OpResult, PresetsResponse, Workspace } from '../types'
import { api, post } from '../api'
import { SectionTitle, Sheet } from '../components'

export type ToastKind = 'ok' | 'error' | 'info'

/** One-line human summary for a batch-op result list, suitable for a toast. */
export function summarizeResults(results: OpResult[]): { text: string; kind: ToastKind } {
  if (results.length === 0) return { text: '没有可执行的操作', kind: 'info' }
  const ok = results.filter((r) => r.status === 'OK').length
  const skip = results.filter((r) => r.status === 'SKIP').length
  const failed = results.filter((r) => r.status !== 'OK' && r.status !== 'SKIP')
  if (failed.length > 0) {
    const tail = ok + skip > 0 ? `（成功 ${ok}，跳过 ${skip}）` : ''
    return { text: `${failed.length} 个仓库失败：${failed[0].repoName} ${failed[0].message}${tail}`, kind: 'error' }
  }
  if (ok === 0) return { text: `${skip} 个仓库已跳过`, kind: 'info' }
  return { text: `${ok} 个仓库成功${skip > 0 ? `，${skip} 个跳过` : ''}`, kind: 'ok' }
}

/** Git ref-name sanity check before hitting the API. */
function branchError(name: string): string {
  if (!name) return ''
  if (name.startsWith('-')) return '分支名不能以 - 开头'
  if (/[\s~^:?*\\[]/.test(name)) return '分支名不能包含空格或 ~ ^ : ? * \\ [ 等字符'
  if (name.includes('..') || name.includes('@{')) return '分支名不能包含 .. 或 @{'
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    return '分支名不能以 /、. 或 .lock 结尾'
  }
  return ''
}

export function BranchSwitchSheet({
  open,
  ws,
  onClose,
  refresh,
  notify,
}: {
  open: boolean
  ws: Workspace
  onClose: () => void
  refresh: () => Promise<void>
  notify: (text: string, kind?: ToastKind) => void
}) {
  const [branchInput, setBranchInput] = useState('')
  const [createBranch, setCreateBranch] = useState(false)
  const [stashFirst, setStashFirst] = useState(false)
  const [presets, setPresets] = useState<BranchPreset[]>([])
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!open) return
    api<PresetsResponse>('/api/presets')
      .then((res) => setPresets(res.presets))
      .catch(() => setPresets([]))
  }, [open])

  const branch = branchInput.trim()
  const invalid = branchError(branch)
  const canSubmit = !busy && branch.length > 0 && !invalid

  const reset = () => {
    setBranchInput('')
    setCreateBranch(false)
    setStashFirst(false)
  }

  const finish = async (summary: { text: string; kind: ToastKind }, prefix: string) => {
    notify(`${prefix}${summary.text}`, summary.kind)
    await refresh()
    if (summary.kind !== 'error') {
      reset()
      onClose()
    }
  }

  const applyPreset = async (name: string) => {
    if (busy) return
    setBusy(`preset:${name}`)
    try {
      const res = await post<{ results: OpResult[] }>('/api/presets/apply', { name })
      await finish(summarizeResults(res.results), `${name}：`)
    } catch (err) {
      notify(err instanceof Error ? err.message : '应用预设失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const switchAll = async () => {
    if (!canSubmit) return
    setBusy('switch')
    try {
      let stashResults: OpResult[] | null = null
      if (stashFirst) {
        const stashed = await post<{ results: OpResult[] }>('/api/batch/stash', { repos: [] })
        stashResults = stashed.results
      }
      const res = await post<{ results: OpResult[] }>('/api/batch', {
        action: 'checkout',
        branch,
        create: createBranch,
      })
      const summary = summarizeResults(res.results)
      const stashSummary = stashResults ? summarizeResults(stashResults) : null
      if (summary.kind !== 'error' && stashSummary?.kind !== 'error') {
        await finish({ text: summary.text, kind: summary.kind }, `切换到 ${branch}：`)
      } else {
        const parts = [`切换到 ${branch}：${summary.text}`]
        if (stashSummary) parts.unshift(`Stash：${stashSummary.text}`)
        notify(parts.join('；'), 'error')
        await refresh()
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '切换分支失败', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <Sheet
      open={open}
      title="所有仓库统一切分支"
      onClose={() => {
        if (busy) return
        reset()
        onClose()
      }}
      footer={
        <>
          <button className="btn ghost" disabled={!!busy} onClick={() => { reset(); onClose() }}>取消</button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => void switchAll()}>
            {busy === 'switch' ? '切换中…' : '执行'}
          </button>
        </>
      }
    >
      {presets.length > 0 ? (
        <>
          <SectionTitle>已保存的组合</SectionTitle>
          <div className="repo-chips wrap">
            {presets.map((preset) => (
              <button
                key={preset.name}
                className="chip"
                disabled={!!busy}
                onClick={() => void applyPreset(preset.name)}
              >
                {busy === `preset:${preset.name}` ? `${preset.name}…` : preset.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <input
        className="text-input"
        value={branchInput}
        onChange={(e) => setBranchInput(e.target.value)}
        placeholder="分支名，例如 feature/login"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {invalid ? <p className="hint danger-text">{invalid}</p> : null}
      <label className="check-row">
        <input type="checkbox" checked={createBranch} onChange={(e) => setCreateBranch(e.target.checked)} />
        <span>不存在时基于当前提交新建</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={stashFirst} onChange={(e) => setStashFirst(e.target.checked)} />
        <span>先 stash 有改动的仓库（不自动恢复）</span>
      </label>
      <p className="hint">
        将尝试 {ws.repos.length} 个仓库；有未提交改动的仓库默认会被安全跳过，勾选 stash 后会先收起改动再切换，恢复需手动操作。
      </p>
    </Sheet>
  )
}
