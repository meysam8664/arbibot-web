/** Venue-agnostic symbol handling — mirrors backend/app/exchanges/symbols.py. */

/** Quote assets we understand, longest first so BTCUSDT does not match BTC. */
export const QUOTE_ASSETS = [
  'USDT',
  'USDC',
  'FDUSD',
  'TUSD',
  'BUSD',
  'USDP',
  'DAI',
  'USD',
  'EUR',
  'TRY',
  'GBP',
  'BRL',
  'JPY',
  'AUD',
  'BTC',
  'ETH',
  'BNB',
] as const

/** Venue-specific base tickers that map onto a canonical asset. */
export const BASE_ALIASES: Record<string, string> = {
  XBT: 'BTC',
  XDG: 'DOGE',
  WETH: 'ETH',
  WBTC: 'BTC',
  BCC: 'BCH',
  BCHABC: 'BCH',
  IOT: 'IOTA',
  MIOTA: 'IOTA',
  TONCOIN: 'TON',
  MATIC: 'POL',
}

const SEPARATORS = ['-', '_', '/', ':', ' ']

function clean(raw: string): string {
  let text = raw.trim().toUpperCase()
  for (const separator of SEPARATORS) text = text.split(separator).join('')
  return text
}

/** Split an exchange ticker into `[base, quote]`, or null when unrecognised. */
export function splitSymbol(raw: string, quotes: readonly string[] = QUOTE_ASSETS): [string, string] | null {
  if (!raw) return null
  const text = clean(raw)
  for (const quote of quotes) {
    const q = clean(quote)
    if (!q || text.length <= q.length || !text.endsWith(q)) continue
    const base = text.slice(0, text.length - q.length)
    return [BASE_ALIASES[base] ?? base, quote.toUpperCase()]
  }
  return null
}

export function canonicalBase(base: string): string {
  const upper = base.trim().toUpperCase()
  return BASE_ALIASES[upper] ?? upper
}
