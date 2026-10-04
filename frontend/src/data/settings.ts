/**
 * Deployment + runtime settings.
 *
 * A deployment can configure the app by including `public/config.js`:
 *
 *   window.__ARBIBOT_CONFIG__ = {
 *     backendUrl: 'https://arbibot-api.onrender.com',  // omit to run entirely
 *                                                     // in the browser
 *     symbols: ['BTC', 'ETH', 'SOL'],
 *   }
 *
 * Anything the user changes in the Settings panel is stored in localStorage and
 * layered on top, so a static deployment keeps working with no server at all.
 */

import { DEFAULT_FEES, VENUES } from '../engine/venues'

export type DataMode = 'auto' | 'live' | 'sim'

export interface RuntimeSettings {
  /** Absolute API origin, or null to run the scanner inside the browser. */
  backendUrl: string | null
  dataMode: DataMode
  symbols: string[]
  pollInterval: number
  notionalUsd: number
  minNetSpreadPct: number
  slippageBufferPct: number
  fees: Record<string, number>
  disabledExchanges: string[]
  /** Optional CORS proxy template used by the browser engine, e.g.
   *  "https://corsproxy.io/?url=" — only needed for venues that block browsers. */
  corsProxy: string
  quoteCurrency: string
  /** Hide the settings/venue toggles (useful for read-only public demos). */
  lockSettings: boolean
  title: string
}

export interface DeploymentConfig extends Partial<RuntimeSettings> {
  /** Shown in the phone panel so people know where the data comes from. */
  note?: string
}

const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON', 'DOT', 'LTC',
]

const STORAGE_KEY = 'arbibot.settings.v1'

function deployment(): DeploymentConfig {
  if (typeof window === 'undefined') return {}
  return (window as unknown as { __ARBIBOT_CONFIG__?: DeploymentConfig }).__ARBIBOT_CONFIG__ ?? {}
}

export function defaultSettings(): RuntimeSettings {
  const config = deployment()
  const symbols = (config.symbols ?? DEFAULT_SYMBOLS).map((symbol) => symbol.toUpperCase())
  return {
    backendUrl: config.backendUrl ?? null,
    dataMode: config.dataMode ?? 'auto',
    symbols,
    pollInterval: config.pollInterval ?? 4,
    notionalUsd: config.notionalUsd ?? 10_000,
    minNetSpreadPct: config.minNetSpreadPct ?? 0.02,
    slippageBufferPct: config.slippageBufferPct ?? 0.02,
    fees: { ...DEFAULT_FEES, ...(config.fees ?? {}) },
    disabledExchanges: config.disabledExchanges ?? [],
    corsProxy: config.corsProxy ?? '',
    quoteCurrency: (config.quoteCurrency ?? 'USDT').toUpperCase(),
    lockSettings: config.lockSettings ?? false,
    title: config.title ?? 'ArbiBot Web',
  }
}

function stored(): Partial<RuntimeSettings> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<RuntimeSettings>) : {}
  } catch {
    return {}
  }
}

let current: RuntimeSettings | null = null

export function getSettings(): RuntimeSettings {
  if (!current) {
    // Stored values win, except backendUrl/lockSettings/title which are
    // deployment decisions and must not be overridable from the client.
    const base = defaultSettings()
    const saved = stored()
    const merged: RuntimeSettings = {
      ...base,
      ...saved,
      backendUrl: base.backendUrl,
      lockSettings: base.lockSettings,
      title: base.title,
      fees: { ...base.fees, ...(saved.fees ?? {}) },
    }
    if (!VENUES.some((venue) => !merged.disabledExchanges.includes(venue.id))) {
      merged.disabledExchanges = []
    }
    current = merged
  }
  return current
}

export function saveSettings(patch: Partial<RuntimeSettings>): RuntimeSettings {
  const next = { ...getSettings(), ...patch }
  current = next
  if (typeof localStorage !== 'undefined') {
    try {
      const { backendUrl: _b, lockSettings: _l, title: _t, ...persistable } = next
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable))
    } catch {
      /* storage may be disabled (private mode) — settings stay in memory */
    }
  }
  return next
}

export function resetSettings(): RuntimeSettings {
  current = null
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  return getSettings()
}

export { DEFAULT_SYMBOLS }
