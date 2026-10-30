const THEME_KEY = 'nemorous.theme'
const PAIR_KEY = 'nemorous.pairCode'
const LEGACY_TOKEN_KEY = 'nemorous.token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The console is served by the Go daemon, so its origin is the API base. */
export function getServer(): string {
  // Cookie sessions only work same-origin, and the daemon serves this page.
  return location.protocol === 'http:' || location.protocol === 'https:' ? location.origin : ''
}

/** Pairing links print ?pair=123456; keep the code for the pairing screen. */
export function absorbPairingLink() {
  // Older builds stored a long-lived bearer token; sessions are cookies now.
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  const url = new URL(location.href)
  const code = url.searchParams.get('pair')
  if (!code) return
  sessionStorage.setItem(PAIR_KEY, code)
  url.searchParams.delete('pair')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export function pendingPairCode(): string {
  return sessionStorage.getItem(PAIR_KEY) ?? ''
}

export function forgetPairCode() {
  sessionStorage.removeItem(PAIR_KEY)
}

/** A human-readable device name for the Settings device list. */
export function deviceName(): string {
  const ua = navigator.userAgent
  const platform =
    /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
          : /Macintosh/.test(ua) ? 'Mac'
            : /Windows/.test(ua) ? 'Windows'
              : /Linux/.test(ua) ? 'Linux'
                : '浏览器'
  const browser =
    /CriOS\//.test(ua) ? 'Chrome'
      : /FxiOS\//.test(ua) ? 'Firefox'
        : /Edg\//.test(ua) ? 'Edge'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Firefox\//.test(ua) ? 'Firefox'
              : /Safari\//.test(ua) ? 'Safari'
                : ''
  return browser ? `${platform} · ${browser}` : platform
}

/** Exchange a six-digit code for an HttpOnly session cookie. */
export async function pairDevice(server: string, code: string): Promise<void> {
  const base = server.trim().replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(base + '/api/pair', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), name: deviceName() }),
    })
  } catch {
    throw new ApiError(0, '无法连接电脑端服务，请确认服务在运行且网络可达')
  }
  if (!res.ok) {
    let msg = `配对失败 (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getServer()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, '无法连接伴生服务，请检查电脑端是否运行、手机与电脑是否在同一网络')
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export function clearPairing() {
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  sessionStorage.removeItem(PAIR_KEY)
}

export function getTheme(): string {
  return localStorage.getItem(THEME_KEY) ?? 'auto'
}

export function setTheme(theme: string) {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

export function applyTheme(theme: string) {
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f14' : '#f6f7f9')
}
