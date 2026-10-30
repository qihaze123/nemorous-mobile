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

export function go(target: string) {
  if (location.hash === target) return
  sessionStorage.setItem('nemorous.depth', String(Number(sessionStorage.getItem('nemorous.depth') ?? '0') + 1))
  location.hash = target
}

export function back(fallback = '#/changes') {
  const depth = Number(sessionStorage.getItem('nemorous.depth') ?? '0')
  if (depth > 0) {
    sessionStorage.setItem('nemorous.depth', String(depth - 1))
    history.back()
    return
  }
  go(fallback)
}

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
