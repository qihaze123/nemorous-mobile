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


const TOP_LEVEL: Screen[] = ['changes', 'code', 'git', 'settings']

function topLevel(screen: Screen) {
  return TOP_LEVEL.includes(screen)
}

function parentOf(route: Route): string | null {
  const p = route.params
  const repo = p.get('repo')
  const hash = p.get('hash')
  const path = p.get('path')
  const rev = p.get('rev')
  switch (route.screen) {
    case 'commit-file':
      return repo && hash ? `#/commit?repo=${encodeURIComponent(repo)}&hash=${encodeURIComponent(hash)}` : '#/git'
    case 'commit-patch':
      return repo && hash ? `#/commit?repo=${encodeURIComponent(repo)}&hash=${encodeURIComponent(hash)}` : '#/git'
    case 'commit':
      return '#/git'
    case 'file':
      if (repo && rev && path) {
        return `#/commit-file?repo=${encodeURIComponent(repo)}&hash=${encodeURIComponent(rev)}&path=${encodeURIComponent(path)}`
      }
      return '#/code'
    case 'tree':
      return '#/code'
    case 'diff':
      return '#/changes'
    default:
      return null
  }
}

let lastRoute = parseHash(location.hash)
let exiting = false
let exitTimer = 0

addEventListener('hashchange', () => {
  if (!exiting) lastRoute = parseHash(location.hash)
})

addEventListener('popstate', () => {
  if (internalNav) {
    lastRoute = parseHash(location.hash)
    return
  }
  const before = lastRoute
  const after = parseHash(location.hash)
  lastRoute = after

  // Once the user backs out from a top-level screen, skip any in-app history
  // entries behind it and let the browser leave the PWA.
  if (exiting) {
    if (location.hash) window.setTimeout(() => history.back(), 30)
    return
  }
  if (topLevel(before.screen)) {
    exiting = true
    window.clearTimeout(exitTimer)
    exitTimer = window.setTimeout(() => { exiting = false }, 900)
    history.back()
    return
  }

  // Back must move up the screen hierarchy, never to an older sibling screen.
  const parent = parentOf(before)
  if (parent && location.hash !== parent) location.replace(parent)
})

const DEPTH_KEY = 'nemorous.depth'

function navDepth(): number {
  const value = Number(sessionStorage.getItem(DEPTH_KEY) ?? '0')
  return Number.isFinite(value) && value > 0 ? value : 0
}

let internalNav = false
let internalTimer = 0

function markInternalNav() {
  internalNav = true
  window.clearTimeout(internalTimer)
  internalTimer = window.setTimeout(() => { internalNav = false }, 200)
}

export function go(target: string) {
  if (location.hash === target) return
  markInternalNav()
  sessionStorage.setItem(DEPTH_KEY, String(navDepth() + 1))
  location.hash = target
}

export function replace(target: string) {
  if (location.hash !== target) {
    markInternalNav()
    location.replace(target)
  }
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
