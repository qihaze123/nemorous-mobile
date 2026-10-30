interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export const INSTALL_EVENT = 'nemorous-installable'

let deferred: InstallPromptEvent | null = null

export function initPWA() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    window.dispatchEvent(new Event(INSTALL_EVENT))
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    window.dispatchEvent(new Event(INSTALL_EVENT))
  })
}

export function canInstall(): boolean {
  return deferred !== null
}

export async function installApp(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const choice = await deferred.userChoice
  if (choice.outcome === 'accepted') deferred = null
  return choice.outcome === 'accepted'
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isSecureContext(): boolean {
  return window.isSecureContext
}

export function canFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function'
}

export async function enterFullscreen() {
  if (canFullscreen()) await document.documentElement.requestFullscreen()
}
