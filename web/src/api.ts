const SERVER_KEY = 'nemorous.server'
const TOKEN_KEY = 'nemorous.token'
const THEME_KEY = 'nemorous.theme'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The console is normally served by the Go daemon itself, so its origin is
 *  the default API base. Capacitor/standalone installs keep a saved base. */
export function getServer(): string {
  const saved = localStorage.getItem(SERVER_KEY)
  if (saved) return saved.replace(/\/+$/, '')
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin
  return ''
}

export function setServer(url: string) {
  const clean = url.trim().replace(/\/+$/, '')
  if (clean) localStorage.setItem(SERVER_KEY, clean)
  else localStorage.removeItem(SERVER_KEY)
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearPairing() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(SERVER_KEY)
}

/** Pairing links print ?token=...; keep only the token after first open. */
export function absorbPairingLink() {
  const url = new URL(location.href)
  const token = url.searchParams.get('token')
  const server = url.searchParams.get('server')
  if (!token && !server) return
  if (token) setToken(token)
  if (server) setServer(server)
  url.searchParams.delete('token')
  url.searchParams.delete('server')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getServer()
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers })
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

export async function checkPairing(server: string, token: string): Promise<void> {
  const base = server.trim().replace(/\/+$/, '')
  const res = await fetch(base + '/api/workspace', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status === 401) throw new Error('令牌不正确')
    throw new Error(`无法连接 (${res.status})`)
  }
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
