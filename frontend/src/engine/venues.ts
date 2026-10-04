/**
 * Venue metadata shared by the browser adapters and the UI — mirrors the
 * adapter registry in backend/app/exchanges/registry.py.
 */

export interface VenueMeta {
  id: string
  name: string
  /** Assumed taker fee, percent per side. */
  fee: number
  docs: string
  /** Whether the venue also publishes cross pairs (BTC/ETH...) for triangles. */
  crossPairs: boolean
}

export const VENUES: VenueMeta[] = [
  { id: 'binance', name: 'Binance', fee: 0.1, crossPairs: true, docs: 'https://api.binance.com/api/v3/ticker/bookTicker' },
  { id: 'okx', name: 'OKX', fee: 0.08, crossPairs: true, docs: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT' },
  { id: 'bybit', name: 'Bybit', fee: 0.1, crossPairs: true, docs: 'https://api.bybit.com/v5/market/tickers?category=spot' },
  { id: 'kucoin', name: 'KuCoin', fee: 0.1, crossPairs: true, docs: 'https://api.kucoin.com/api/v1/market/allTickers' },
  { id: 'gateio', name: 'Gate.io', fee: 0.2, crossPairs: true, docs: 'https://api.gateio.ws/api/v4/spot/tickers' },
  { id: 'mexc', name: 'MEXC', fee: 0.05, crossPairs: true, docs: 'https://api.mexc.com/api/v3/ticker/bookTicker' },
  { id: 'bitget', name: 'Bitget', fee: 0.1, crossPairs: true, docs: 'https://api.bitget.com/api/v2/spot/market/tickers' },
  { id: 'htx', name: 'HTX', fee: 0.2, crossPairs: true, docs: 'https://api.huobi.pro/market/tickers' },
  { id: 'kraken', name: 'Kraken', fee: 0.26, crossPairs: true, docs: 'https://api.kraken.com/0/public/Ticker' },
  { id: 'coinbase', name: 'Coinbase', fee: 0.6, crossPairs: false, docs: 'https://api.exchange.coinbase.com/products/{id}/ticker' },
]

export const VENUE_BY_ID: Record<string, VenueMeta> = Object.fromEntries(
  VENUES.map((venue) => [venue.id, venue]),
)

export const DEFAULT_FEES: Record<string, number> = Object.fromEntries(
  VENUES.map((venue) => [venue.id, venue.fee]),
)
