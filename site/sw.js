/**
 * ArbiBot Web service worker.
 *
 * Strategy
 *  - Navigation requests: network first, falling back to the cached shell and
 *    finally to a small offline page (the dashboard needs live data, but the
 *    shell should still open on a phone with no signal).
 *  - Built assets (hashed filenames): cache first, refreshed in the background.
 *  - API + WebSocket traffic: never cached; market data must always be fresh.
 */

const VERSION = 'arbibot-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const OFFLINE_URL = 'offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(['./', `./${OFFLINE_URL}`, './manifest.webmanifest']).catch(() => undefined)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never cache API calls, WebSocket upgrades or cross-origin exchange data.
  if (url.origin !== self.location.origin) return
  if (url.pathname.includes('/api/') || url.pathname === '/ws') return

  // Files a deployment edits by hand must not be served stale.
  const networkFirst =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/config.js') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/sw.js')

  if (networkFirst) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('./', response.clone()).catch(() => undefined)
          return response
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (
            (await cache.match(request)) ||
            (await cache.match('./')) ||
            (await cache.match(`./${OFFLINE_URL}`)) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          )
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE)
      const cached = await cache.match(request)
      if (cached) {
        // Refresh in the background for the next visit.
        fetch(request)
          .then((response) => response.ok && cache.put(request, response.clone()))
          .catch(() => undefined)
        return cached
      }
      try {
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone()).catch(() => undefined)
        return response
      } catch (error) {
        if (cached) return cached
        throw error
      }
    })(),
  )
})
