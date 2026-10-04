/**
 * Unified data client.
 *
 * The dashboard only talks to this module, which routes to either
 *  - the FastAPI backend, or
 *  - the in-browser engine (static hosting, GitHub Pages, a phone with no
 *    server) — so one build works everywhere.
 *
 * How the source is chosen (`config.js → window.__ARBIBOT_CONFIG__.backendUrl`):
 *  - `null`      → always run in the browser
 *  - `'https://…'` → always use that backend
 *  - `''` (default) → auto-detect: use the same-origin `/api` when it answers
 *    like an ArbiBot API, otherwise run the scanner in the browser.
 */

import { LocalEngine } from './localEngine'
import { getSettings, saveSettings, type RuntimeSettings } from './settings'
import type {
  EdgeHistoryPoint,
  HistoryPoint,
  MarketUpdate,
  RuntimeConfig,
  RuntimeConfigPatch,
} from '../types'

export type DataSource = 'backend' | 'local'

let engine: LocalEngine | null = null
let mode: DataSource | 'unknown' = 'unknown'
let resolution: Promise<DataSource> | null = null

export function currentDataSource(): DataSource | 'unknown' {
  return mode
}

/** Resolve (once) whether this deployment has a backend. */
export function resolveDataSource(): Promise<DataSource> {
  if (!resolution) resolution = detect()
  return resolution
}

async function detect(): Promise<DataSource> {
  mode = await detectDataSource(fetch, getSettings().backendUrl)
  return mode
}

/**
 * Decide where data comes from. Exported (and dependency-injected) so it can be
 * unit-tested without a browser.
 *
 *   null   → always local
 *   'url'  → always that backend
 *   ''     → same-origin autodetect: a static host answers /api/health with
 *            index.html, so only a JSON body that looks like our API counts.
 */
export async function detectDataSource(
  fetchImpl: typeof fetch,
  backendUrl: string | null,
  timeoutMs = 2500,
): Promise<DataSource> {
  if (backendUrl === null) return 'local'
  if (backendUrl) return 'backend'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetchImpl('/api/health', { signal: controller.signal, credentials: 'omit' })
    clearTimeout(timer)
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && contentType.includes('json')) {
      const body = (await response.json()) as { status?: string }
      if (body.status === 'ok') return 'backend'
    }
  } catch {
    /* no backend — run everything in the browser */
  }
  return 'local'
}

export function isStandalone(): boolean {
  return mode === 'local'
}

export function getEngine(): LocalEngine {
  if (!engine) engine = new LocalEngine(getSettings())
  return engine
}

function apiBase(): string {
  const url = getSettings().backendUrl
  return url ? url.replace(/\/$/, '') : ''
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, init)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

export async function fetchSnapshot(): Promise<MarketUpdate> {
  const source = await resolveDataSource()
  return source === 'local' ? getEngine().scan() : http<MarketUpdate>('/api/snapshot')
}

export async function refresh(): Promise<MarketUpdate> {
  const source = await resolveDataSource()
  return source === 'local'
    ? getEngine().scan(true)
    : http<MarketUpdate>('/api/refresh', { method: 'POST' })
}

export async function fetchConfig(): Promise<RuntimeConfig> {
  const source = await resolveDataSource()
  if (source === 'backend') return http<RuntimeConfig>('/api/config')
  const settings = getSettings()
  const engineInstance = getEngine()
  engineInstance.updateSettings(settings)
  return localConfig(settings, engineInstance.getSnapshot())
}

export async function patchConfig(patch: RuntimeConfigPatch): Promise<RuntimeConfig> {
  const source = await resolveDataSource()
  if (source === 'backend') {
    const response = await fetch(`${apiBase()}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return (await response.json()) as RuntimeConfig
  }

  const current = getSettings()
  const next: RuntimeSettings = {
    ...current,
    dataMode: patch.data_mode ?? current.dataMode,
    pollInterval: patch.poll_interval ?? current.pollInterval,
    symbols: patch.symbols ? patch.symbols.map((symbol) => symbol.toUpperCase()) : current.symbols,
    notionalUsd: patch.notional_usd ?? current.notionalUsd,
    minNetSpreadPct: patch.min_net_spread_pct ?? current.minNetSpreadPct,
    slippageBufferPct: patch.slippage_buffer_pct ?? current.slippageBufferPct,
    fees: { ...current.fees, ...(patch.taker_fees ?? {}) },
    disabledExchanges: patch.disabled_exchanges ?? current.disabledExchanges,
  }
  saveSettings(next)
  const engineInstance = getEngine()
  engineInstance.updateSettings(next)
  // Simulated data is free to recompute, so refresh immediately after a change.
  const snapshot = next.dataMode === 'auto' ? engineInstance.getSnapshot() : await engineInstance.scan(true)
  return localConfig(next, snapshot)
}

function localConfig(settings: RuntimeSettings, snapshot: MarketUpdate): RuntimeConfig {
  return {
    data_mode: settings.dataMode,
    effective_mode: snapshot.data_mode,
    data_mode_reason: snapshot.data_mode_reason,
    poll_interval: settings.pollInterval,
    quote_currency: settings.quoteCurrency,
    symbols: settings.symbols,
    notional_usd: settings.notionalUsd,
    min_net_spread_pct: settings.minNetSpreadPct,
    slippage_buffer_pct: settings.slippageBufferPct,
    taker_fees: settings.fees,
    disabled_exchanges: settings.disabledExchanges,
    supported_exchanges: Object.keys(settings.fees),
    supported_symbols: settings.symbols,
    version: '1.0.0-browser',
  }
}

export async function fetchHistory(symbol: string): Promise<HistoryPoint[]> {
  const source = await resolveDataSource()
  if (source === 'local') return getEngine().historyFor(symbol)
  const body = await http<{ points: HistoryPoint[] }>(`/api/history/${symbol}`)
  return body.points
}

export async function fetchEdgeHistory(edgeId: string): Promise<EdgeHistoryPoint[]> {
  const source = await resolveDataSource()
  if (source === 'local') return getEngine().edgeHistoryFor(edgeId)
  const body = await http<{ points: EdgeHistoryPoint[] }>(
    `/api/edge-history?edge_id=${encodeURIComponent(edgeId)}`,
  )
  return body.points
}
