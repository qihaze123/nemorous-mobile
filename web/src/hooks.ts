import { useEffect, useState } from 'react'

export type Screen = 'changes' | 'code' | 'git' | 'settings' | 'diff' | 'file' | 'commit' | 'commit-file' | 'commit-patch' | 'tree'

export interface Route {
  screen: Screen
  params: URLSearchParams
}

const screens: Screen[] = ['changes', 'code', 'git', 'settings', 'diff', 'file', 'commit', 'commit-file', 'commit-patch', 'tree']

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [name, query = ''] = raw.split('?')
  const screen = (screens as string[]).includes(name) ? (name as Screen) : 'changes'
  return { screen, params: new URLSearchParams(query) }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

const DEPTH_KEY = 'nemorous.depth'

function navDepth(): number {
  const value = Number(sessionStorage.getItem(DEPTH_KEY) ?? '0')
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function go(target: string) {
  if (location.hash === target) return
  sessionStorage.setItem(DEPTH_KEY, String(navDepth() + 1))
  location.hash = target
}

export function back(fallback = '#/changes') {
  if (navDepth() <= 0) {
    location.replace(fallback)
    return
  }
  const before = location.hash
  history.back()
  // A history entry that never arrives (e.g. the app was opened directly)
  // must not trap the user on the same screen.
  setTimeout(() => {
    if (location.hash === before) location.replace(fallback)
  }, 250)
}

// Browser back/forward also traverses app entries; keep the counter in sync.
addEventListener('popstate', () => {
  const depth = navDepth()
  if (depth > 0) sessionStorage.setItem(DEPTH_KEY, String(depth - 1))
})

export function repoQuery(repoId: string, path: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ repo: repoId, path })
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v)
  return q.toString()
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
