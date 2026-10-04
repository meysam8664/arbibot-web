/** Types mirroring the FastAPI models in backend/app/models.py. */

export type DataMode = 'live' | 'sim' | 'probing'
export type RequestedMode = 'auto' | 'live' | 'sim'
export type VenueStatus = 'online' | 'degraded' | 'offline' | 'disabled' | 'probing'

export interface Quote {
  exchange: string
  exchange_name: string
  symbol: string
  base: string
  quote: string
  bid: number
  ask: number
  bid_qty: number
  ask_qty: number
  ts: number
}

export interface Leg {
  exchange: string
  exchange_name: string
  side: 'buy' | 'sell' | 'sell_base' | 'buy_base'
  symbol: string
  price: number
  qty: number
  fee_pct: number
  fee_usd: number
  notional_usd: number
}

export interface Opportunity {
  id: string
  symbol: string
  base: string
  quote: string
  buy_exchange: string
  buy_exchange_name: string
  sell_exchange: string
  sell_exchange_name: string
  buy_ask: number
  sell_bid: number
  buy_ask_qty: number
  sell_bid_qty: number
  reference_price: number
  gross_spread_pct: number
  net_spread_pct: number
  total_fees_pct: number
  notional_usd: number
  executable_notional_usd: number
  qty: number
  est_profit_usd: number
  profitable: boolean
  depth_limited: boolean
  buy_fee_pct: number
  sell_fee_pct: number
  legs: Leg[]
  ts: number
}

export interface TriangleLeg {
  symbol: string
  side: 'buy' | 'sell'
  price: number
  fee_pct: number
}

export interface TriangleOpportunity {
  id: string
  exchange: string
  exchange_name: string
  path: string[]
  legs: TriangleLeg[]
  gross_spread_pct: number
  net_spread_pct: number
  total_fees_pct: number
  notional_usd: number
  est_profit_usd: number
  ts: number
}

export interface ExchangeStatus {
  id: string
  name: string
  enabled: boolean
  status: VenueStatus
  fee_taker_pct: number
  latency_ms: number | null
  pairs: number
  last_update: number | null
  error: string | null
  docs: string
  simulated: boolean
}

export interface SymbolSnapshot {
  symbol: string
  base: string
  quote: string
  reference_price: number
  best_bid: number
  best_ask: number
  best_bid_exchange: string
  best_ask_exchange: string
  max_net_spread_pct: number
  venues: number
  quotes: Quote[]
}

export interface EngineStats {
  cycle: number
  cycle_ms: number
  poll_interval: number
  exchanges_online: number
  exchanges_total: number
  symbols: number
  quotes: number
  opportunities: number
  triangles: number
  best_net_spread_pct: number
  best_profit_usd: number
  avg_latency_ms: number
  data_mode: DataMode
  notional_usd: number
  uptime_s: number
  clients: number
}

export interface MarketUpdate {
  type: 'snapshot'
  ts: number
  data_mode: DataMode
  data_mode_reason: string
  cycle: number
  cycle_ms: number
  opportunities: Opportunity[]
  triangles: TriangleOpportunity[]
  exchanges: ExchangeStatus[]
  markets: SymbolSnapshot[]
  stats: EngineStats
}

export interface RuntimeConfig {
  data_mode: RequestedMode
  effective_mode: DataMode
  data_mode_reason: string
  poll_interval: number
  quote_currency: string
  symbols: string[]
  notional_usd: number
  min_net_spread_pct: number
  slippage_buffer_pct: number
  taker_fees: Record<string, number>
  disabled_exchanges: string[]
  supported_exchanges: string[]
  supported_symbols: string[]
  version: string
}

export interface RuntimeConfigPatch {
  data_mode?: RequestedMode
  poll_interval?: number
  symbols?: string[]
  notional_usd?: number
  min_net_spread_pct?: number
  slippage_buffer_pct?: number
  taker_fees?: Record<string, number>
  disabled_exchanges?: string[]
  refresh?: boolean
}

export interface HistoryPoint {
  ts: number
  price: number
  net_spread_pct: number
}

export interface EdgeHistoryPoint {
  ts: number
  net_spread_pct: number
}
