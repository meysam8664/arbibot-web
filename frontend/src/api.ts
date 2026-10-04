import { useCallback, useEffect, useRef, useState } from 'react'
import * as client from './data/client'
import { getSettings } from './data/settings'
import type { MarketUpdate } from './types'

export type StreamState = 'connecting' | 'streaming' | 'polling'

const BACKEND_POLL_FALLBACK_MS = 4000

/**
 * Keeps a fresh engine snapshot in React state.
 *
 * - Backend deployment: WebSocket push (`/ws`) with automatic REST polling if
 *   the socket cannot be established.
 * - Standalone (static host / phone): the in-browser engine is driven on an
 *   interval, so no server is required at all.
 */
export function useMarketStream(pollIntervalSec?: number) {
  const [snapshot, setSnapshot] = useState<MarketUpdate | null>(null)
  const [state, setState] = useState<StreamState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const applySnapshot = useCallback((update: MarketUpdate) => {
    if (pausedRef.current) return
    setSnapshot(update)
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let pollTimer: number | undefined
    let retryTimer: number | undefined
    let cancelled = false
    let failures = 0

    const settings = getSettings()
    const standalone = client.isStandalone()
    const intervalMs = Math.max(1000, (pollIntervalSec ?? settings.pollInterval) * 1000)

    const tick = async () => {
      try {
        applySnapshot(await client.fetchSnapshot())
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    const stopPolling = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      pollTimer = undefined
    }

    const startPolling = (interval = BACKEND_POLL_FALLBACK_MS) => {
      if (pollTimer !== undefined) return
      setState('polling')
      void tick()
      pollTimer = window.setInterval(tick, interval)
    }

    if (standalone) {
      // No server: run the scan loop locally.
      setState('polling')
      void tick()
      pollTimer = window.setInterval(tick, intervalMs)
    } else {
      const connect = () => {
        if (cancelled) return
        const base = (getSettings().backendUrl ?? '').replace(/\/$/, '')
        const url = base
          ? `${base.replace(/^http/, 'ws')}/ws`
          : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
        try {
          socket = new WebSocket(url)
        } catch {
          startPolling()
          return
        }
        socket.onopen = () => {
          failures = 0
          setError(null)
          stopPolling()
          setState('streaming')
        }
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data as string) as MarketUpdate | { type: 'pong' }
            if (payload.type === 'snapshot') applySnapshot(payload as MarketUpdate)
          } catch {
            /* ignore malformed frames */
          }
        }
        socket.onerror = () => setError('websocket error')
        socket.onclose = () => {
          if (socket?.readyState === WebSocket.CLOSED) socket = null
          failures += 1
          if (failures >= 2) startPolling()
          retryTimer = window.setTimeout(connect, Math.min(15000, 1000 * failures))
        }
      }
      connect()
    }

    return () => {
      cancelled = true
      stopPolling()
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      const active = socket
      socket = null
      if (active) {
        active.onclose = null
        active.close()
      }
    }
  }, [applySnapshot, pollIntervalSec])

  return { snapshot, state, error, paused, setPaused }
}

export const api = {
  config: client.fetchConfig,
  patchConfig: client.patchConfig,
  refresh: client.refresh,
  edgeHistory: (edgeId: string) => client.fetchEdgeHistory(edgeId).then((points) => ({ points })),
  history: (symbol: string) =>
    client.fetchHistory(symbol).then((points) => ({ symbol: symbol.toUpperCase(), points })),
}
