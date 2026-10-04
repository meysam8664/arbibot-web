/**
 * Progressive Web App plumbing: service-worker registration and install prompt.
 * Both are no-ops when the browser does not support them, so the dashboard
 * still works as a plain web page.
 */

export interface InstallState {
  available: boolean
  installed: boolean
  prompt: (() => Promise<'accepted' | 'dismissed' | 'unavailable'>) | null
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return

  const register = () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL ?? '/'}sw.js`)
      .catch(() => {
        /* offline support is a bonus, never a requirement */
      })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

export function watchInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    listeners.forEach((listener) => listener())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((listener) => listener())
  })
}

export function onInstallStateChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function installState(): InstallState {
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true)
  return {
    available: deferredPrompt !== null,
    installed: Boolean(standalone),
    prompt: deferredPrompt
      ? async () => {
          const event = deferredPrompt
          if (!event) return 'unavailable' as const
          await event.prompt()
          const choice = await event.userChoice
          if (choice.outcome === 'accepted') deferredPrompt = null
          listeners.forEach((listener) => listener())
          return choice.outcome
        }
      : null,
  }
}
