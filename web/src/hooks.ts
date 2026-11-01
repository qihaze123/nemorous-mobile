import { useEffect, useRef, useState, type RefObject } from 'react'

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

// When the app is opened directly on a deep screen, synthesize the parent
// history entries so the system back button still walks up the hierarchy.
;(function seedDeepLinkHistory() {
  const chain: string[] = []
  let cursor: Route = lastRoute
  const seen = new Set<string>()
  while (true) {
    const parent = parentOf(cursor)
    if (!parent) break
    if (seen.has(parent)) break
    seen.add(parent)
    chain.unshift(parent)
    cursor = parseHash(parent)
  }
  if (chain.length === 0) return
  const current = location.hash || '#/changes'
  history.replaceState(null, '', chain[0])
  for (let i = 1; i < chain.length; i++) history.pushState(null, '', chain[i])
  history.pushState(null, '', current)
})()

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

export function replace(target: string) {
  if (location.hash !== target) location.replace(target)
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

export function useDiffFontSize() {
  const [fontSize, setFontSizeState] = useState(() => {
    const saved = Number(localStorage.getItem('nemorous.diffFontSize'))
    return saved >= 6 && saved <= 20 ? saved : 12
  })
  const setFontSize = (next: number) => {
    const clamped = Math.min(20, Math.max(6, next))
    setFontSizeState(clamped)
    localStorage.setItem('nemorous.diffFontSize', String(clamped))
  }
  return [fontSize, setFontSize] as const
}

export function usePinchZoom(
  target: RefObject<HTMLElement | null>,
  getValue: () => number,
  setValue: (value: number) => void,
  enabled = true,
) {
  const getValueRef = useRef(getValue)
  const setValueRef = useRef(setValue)
  getValueRef.current = getValue
  setValueRef.current = setValue

  useEffect(() => {
    const element = target.current
    if (!enabled || !element) return
    let startDistance = 0
    let startValue = 0
    let active = false
    const distance = (touches: TouchList) => {
      if (touches.length < 2) return 0
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.hypot(dx, dy)
    }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      startDistance = distance(event.touches)
      startValue = getValueRef.current()
      active = startDistance > 0
      if (active) event.preventDefault()
    }
    const onMove = (event: TouchEvent) => {
      if (!active || event.touches.length !== 2) return
      event.preventDefault()
      const next = distance(event.touches)
      if (startDistance > 0 && next > 0) setValueRef.current(startValue * (next / startDistance))
    }
    const onEnd = () => {
      active = false
      startDistance = 0
    }
    // Safari exposes pinch as GestureEvents; Chrome/Android use TouchEvents.
    const onGestureStart = (event: Event) => {
      const gesture = event as Event & { scale?: number }
      startValue = getValueRef.current()
      startDistance = 1
      active = true
      gesture.preventDefault()
    }
    const onGestureChange = (event: Event) => {
      const gesture = event as Event & { scale?: number }
      if (!active) return
      gesture.preventDefault()
      const scale = gesture.scale ?? 1
      if (scale > 0) setValueRef.current(startValue * scale)
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      onEnd()
    }
    element.addEventListener('touchstart', onStart, { passive: false })
    element.addEventListener('touchmove', onMove, { passive: false })
    element.addEventListener('touchend', onEnd)
    element.addEventListener('touchcancel', onEnd)
    element.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions)
    element.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions)
    element.addEventListener('gestureend', onGestureEnd, { passive: false } as AddEventListenerOptions)
    return () => {
      element.removeEventListener('touchstart', onStart)
      element.removeEventListener('touchmove', onMove)
      element.removeEventListener('touchend', onEnd)
      element.removeEventListener('touchcancel', onEnd)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
      element.removeEventListener('gestureend', onGestureEnd)
    }
  }, [target, enabled])
}

export function useSidebarWidth(key = 'nemorous.sidebarWidth', initial = 264) {
  const [width, setWidthState] = useState(() => {
    const saved = Number(localStorage.getItem(key))
    return saved >= 160 && saved <= 560 ? saved : initial
  })
  const setWidth = (next: number) => {
    const clamped = Math.min(560, Math.max(160, Math.round(next)))
    setWidthState(clamped)
    localStorage.setItem(key, String(clamped))
  }
  return [width, setWidth] as const
}

export function useImmersive() {
  const [immersive, setImmersive] = useState(false)
  const requestedFullscreen = useRef(false)

  useEffect(() => {
    if (!immersive) {
      if (requestedFullscreen.current) {
        requestedFullscreen.current = false
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      }
      return
    }
    const root = document.documentElement
    let active = true
    if (root.requestFullscreen && !document.fullscreenElement) {
      const request = root.requestFullscreen({ navigationUI: 'hide' })
      if (request) {
        void request.then(() => {
          if (!active) {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
            return
          }
          requestedFullscreen.current = true
        }).catch(() => {
          /* iOS Safari and desktop browsers may reject; CSS mode still works. */
        })
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImmersive(false)
    }
    addEventListener('keydown', onKey)
    return () => {
      active = false
      removeEventListener('keydown', onKey)
    }
  }, [immersive])

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && requestedFullscreen.current) {
        requestedFullscreen.current = false
        setImmersive(false)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return [immersive, setImmersive] as const
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
