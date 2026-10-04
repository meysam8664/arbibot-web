import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  EdgeHistoryPoint,
  HistoryPoint,
  MarketUpdate,
  RuntimeConfig,
  RuntimeConfigPatch,
} from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

export const api = {
  snapshot: () => request<MarketUpdate>('/api/snapshot'),
  config: () => request<RuntimeConfig>('/api/config'),
  patchConfig: (patch: RuntimeConfigPatch) =>
    request<RuntimeConfig>('/api/config', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  refresh: () => request<MarketUpdate>('/api/refresh', { method: 'POST' }),
  history: (symbol: string) => request<{ symbol: string; points: HistoryPoint[] }>(`/api/history/${symbol}`),
  edgeHistory: (edgeId: string) =>
    request<{ edge_id: string; points: EdgeHistoryPoint[] }>(
      `/api/edge-history?edge_id=${encodeURIComponent(edgeId)}`,
    ),
}

export type StreamState = 'connecting' | 'streaming' | 'polling'

const POLL_FALLBACK_MS = 4000

/**
 * Subscribes to the engine's WebSocket snapshot stream.
 *
 * Falls back to REST polling if the socket cannot be established or keeps
 * dropping, so the dashboard stays live behind restrictive proxies.
 */
export function useMarketStream() {
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
    let failures = 0

    const stopPolling = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      pollTimer = undefined
    }

    const startPolling = () => {
      if (pollTimer !== undefined) return
      setState('polling')
      const tick = async () => {
        try {
          applySnapshot(await api.snapshot())
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
      void tick()
      pollTimer = window.setInterval(tick, POLL_FALLBACK_MS)
    }

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${protocol}://${window.location.host}/ws`
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
          const payload = JSON.parse(event.data) as MarketUpdate | { type: 'pong' }
          if (payload.type === 'snapshot') applySnapshot(payload)
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
    return () => {
      stopPolling()
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      const active = socket
      socket = null
      if (active) {
        active.onclose = null
        active.close()
      }
    }
  }, [applySnapshot])

  return { snapshot, state, error, paused, setPaused }
}
