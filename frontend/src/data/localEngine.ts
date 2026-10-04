/**
 * Standalone browser engine.
 *
 * Port of the FastAPI MarketHub: polls the public exchange APIs straight from
 * the browser, falls back to the seeded simulator when the venues are
 * unreachable (offline, CORS-blocked, everything down), and exposes the same
 * `MarketUpdate` snapshot shape the React app already renders.
 *
 * This is what makes the deployed app work on a phone with no server at all.
 */

import { scanDirectional, scanTriangular } from '../engine/arbitrage'
import { buildAdapters } from '../engine/adapters'
import { MarketSimulator } from '../engine/simulator'
import { VENUES } from '../engine/venues'
import type {
  ExchangeStatus,
  HistoryPoint,
  MarketUpdate,
  Opportunity,
  Quote,
  SymbolSnapshot,
} from '../types'
import type { RuntimeSettings } from './settings'

const PROBE_EVERY_CYCLES = 45
const MIN_LIVE_VENUES = 2
const HISTORY_LENGTH = 240
const MAX_OPPORTUNITIES = 250

export interface EdgeHistoryPoint {
  ts: number
  net_spread_pct: number
}

export class LocalEngine {
  private settings: RuntimeSettings
  private simulator: MarketSimulator
  private adapters = buildAdapters()
  private quotes = new Map<string, Quote>()
  private opportunities: Opportunity[] = []
  private triangles: MarketUpdate['triangles'] = []
  private markets: SymbolSnapshot[] = []
  private statuses = new Map<string, ExchangeStatus>()
  private history = new Map<string, HistoryPoint[]>()
  private edgeHistory = new Map<string, EdgeHistoryPoint[]>()
  private snapshotCache: MarketUpdate | null = null
  private reason = 'starting up'
  private effective: 'live' | 'sim' | 'probing' = 'probing'
  private cycle = 0
  private cycleMs = 0
  private startedAt = Date.now()
  private busy: Promise<MarketUpdate> | null = null

  constructor(settings: RuntimeSettings, seed = 20_261_004) {
    this.settings = settings
    this.seed = seed
    this.simulator = this.buildSimulator(seed)
    this.resetStatuses()
  }

  private seed: number

  private buildSimulator(seed: number): MarketSimulator {
    return new MarketSimulator({
      venues: this.settings.disabledExchanges.length
        ? VENUES.map((venue) => venue.id).filter((id) => !this.settings.disabledExchanges.includes(id))
        : VENUES.map((venue) => venue.id),
      symbols: this.settings.symbols,
      quoteCurrency: this.settings.quoteCurrency,
      seed,
      venueNames: Object.fromEntries(VENUES.map((venue) => [venue.id, venue.name])),
    })
  }

  private resetStatuses(): void {
    this.statuses = new Map(
      VENUES.map((venue) => {
        const enabled = !this.settings.disabledExchanges.includes(venue.id)
        return [
          venue.id,
          {
            id: venue.id,
            name: venue.name,
            enabled,
            status: enabled ? 'probing' : 'disabled',
            fee_taker_pct: this.feeFor(venue.id),
            latency_ms: null,
            pairs: 0,
            last_update: null,
            error: null,
            docs: venue.docs,
            simulated: false,
          } satisfies ExchangeStatus,
        ]
      }),
    )
  }

  feeFor(exchange: string): number {
    return this.settings.fees[exchange] ?? 0.1
  }

  updateSettings(settings: RuntimeSettings): void {
    const symbolsChanged =
      settings.symbols.join(',') !== this.settings.symbols.join(',') ||
      settings.disabledExchanges.join(',') !== this.settings.disabledExchanges.join(',') ||
      settings.quoteCurrency !== this.settings.quoteCurrency
    const feesChanged = JSON.stringify(settings.fees) !== JSON.stringify(this.settings.fees)
    this.settings = settings
    if (symbolsChanged) {
      this.simulator = this.buildSimulator(this.seed)
      this.quotes.clear()
    }
    if (symbolsChanged || feesChanged) this.resetStatuses()
  }

  resetSimulator(seed: number): void {
    this.seed = seed
    this.simulator = this.buildSimulator(seed)
  }

  getSnapshot(): MarketUpdate {
    return this.snapshotCache ?? this.buildSnapshot()
  }

  /** Run one full scan (live or simulated), then update caches and history. */
  async scan(force = false): Promise<MarketUpdate> {
    if (this.busy && !force) return this.busy
    this.busy = this.runCycle().finally(() => {
      this.busy = null
    })
    return this.busy
  }

  private async runCycle(): Promise<MarketUpdate> {
    const started = performance.now()
    const mode = this.settings.dataMode

    if (mode === 'sim') {
      this.effective = 'sim'
      this.reason = 'simulated feed (selected in settings)'
      this.collectSimulated()
    } else if (mode === 'auto' && this.effective === 'sim' && this.cycle % PROBE_EVERY_CYCLES !== 0) {
      this.collectSimulated()
    } else {
      await this.collectLive()
      const online = [...this.statuses.values()].filter(
        (status) => status.status === 'online' || status.status === 'degraded',
      ).length
      if (mode === 'live') {
        this.effective = 'live'
        this.reason = 'live exchange APIs'
      } else if (online >= MIN_LIVE_VENUES) {
        this.effective = 'live'
        this.reason = `live exchange APIs (${online} venues responding)`
      } else {
        this.effective = 'sim'
        this.reason = 'exchange APIs unreachable from this device — showing the simulated feed'
        this.collectSimulated()
      }
    }

    this.cycle += 1
    this.recompute()
    this.recordHistory()
    this.cycleMs = performance.now() - started
    const snapshot = this.buildSnapshot()
    this.snapshotCache = snapshot
    return snapshot
  }

  private async collectLive(): Promise<void> {
    const bases = new Set(this.settings.symbols)
    const context = {
      quoteCurrency: this.settings.quoteCurrency,
      timeoutMs: 9000,
      proxy: this.settings.corsProxy || undefined,
    }
    const enabled = this.adapters.filter(
      (adapter) => !this.settings.disabledExchanges.includes(adapter.id),
    )

    await Promise.all(
      enabled.map(async (adapter) => {
        const status = this.statuses.get(adapter.id)
        if (!status) return
        const started = performance.now()
        try {
          const quotes = await adapter.fetch(context, bases)
          status.latency_ms = Math.round(performance.now() - started)
          status.error = null
          status.pairs = quotes.length
          if (!quotes.length) {
            status.status = 'degraded'
            status.error = 'no matching markets returned'
            return
          }
          status.status = 'online'
          status.simulated = false
          status.last_update = Date.now() / 1000
          for (const quote of quotes) {
            if (quote.quote === this.settings.quoteCurrency || quote.quote === 'BTC' || quote.quote === 'ETH') {
              this.quotes.set(`${quote.exchange}|${quote.symbol}`, quote)
            }
          }
        } catch (error) {
          status.latency_ms = Math.round(performance.now() - started)
          status.status = 'offline'
          status.error = error instanceof Error ? error.message : String(error)
        }
      }),
    )
  }

  private collectSimulated(): void {
    const quotes = this.simulator.quotes()
    const counts = new Map<string, number>()
    for (const quote of quotes) {
      this.quotes.set(`${quote.exchange}|${quote.symbol}`, quote)
      counts.set(quote.exchange, (counts.get(quote.exchange) ?? 0) + 1)
    }
    for (const status of this.statuses.values()) {
      if (!status.enabled) continue
      status.status = 'online'
      status.simulated = true
      status.pairs = counts.get(status.id) ?? 0
      status.latency_ms = 0
      status.last_update = Date.now() / 1000
      status.error = null
    }
  }

  /** Recompute opportunities, triangles and market aggregates from cached quotes. */
  private recompute(): void {
    const settings = this.settings
    const maxAge = Math.max(30, settings.pollInterval * 6)
    const wanted = new Set(settings.symbols)
    const cutoff = Date.now() / 1000 - Math.max(60, settings.pollInterval * 15)

    const quotes: Quote[] = []
    for (const quote of this.quotes.values()) {
      if (quote.ts < cutoff) continue
      if (!wanted.has(quote.base)) continue
      if (settings.disabledExchanges.includes(quote.exchange)) continue
      quotes.push(quote)
    }

    this.opportunities = scanDirectional(quotes, {
      notionalUsd: settings.notionalUsd,
      feeLookup: (exchange) => this.feeFor(exchange),
      slippagePct: settings.slippageBufferPct,
      minNetSpreadPct: settings.minNetSpreadPct,
      maxResults: MAX_OPPORTUNITIES,
      quoteCurrency: settings.quoteCurrency,
      maxQuoteAgeSec: maxAge,
    })

    this.triangles = scanTriangular(quotes, {
      notionalUsd: settings.notionalUsd,
      feeLookup: (exchange) => this.feeFor(exchange),
      minNetSpreadPct: Math.max(settings.minNetSpreadPct, 0.05),
      quoteCurrency: settings.quoteCurrency,
      maxResults: 15,
      maxAgeSec: maxAge,
      venueNames: Object.fromEntries(VENUES.map((venue) => [venue.id, venue.name])),
    })

    this.markets = this.buildMarkets(quotes)
  }

  private buildMarkets(quotes: Quote[]): SymbolSnapshot[] {
    const bySymbol = new Map<string, Quote[]>()
    for (const quote of quotes) {
      if (quote.quote !== this.settings.quoteCurrency) continue
      const group = bySymbol.get(quote.symbol)
      if (group) group.push(quote)
      else bySymbol.set(quote.symbol, [quote])
    }

    const edgeLookup = new Map(this.opportunities.map((opportunity) => [opportunity.symbol, opportunity]))
    const snapshots: SymbolSnapshot[] = []

    for (const [symbol, group] of bySymbol) {
      const bestBid = group.reduce((best, quote) => (quote.bid > best.bid ? quote : best))
      const bestAsk = group.reduce((best, quote) => (quote.ask < best.ask ? quote : best))
      const edge = edgeLookup.get(symbol)
      let net = edge ? edge.net_spread_pct : 0
      if (!edge && group.length >= 2 && bestAsk.exchange !== bestBid.exchange) {
        const fees = this.feeFor(bestAsk.exchange) + this.feeFor(bestBid.exchange)
        net =
          ((bestBid.bid - bestAsk.ask) / bestAsk.ask) * 100 -
          fees -
          this.settings.slippageBufferPct
      }
      snapshots.push({
        symbol,
        base: symbol.split('/')[0],
        quote: symbol.split('/')[1],
        reference_price: (bestBid.bid + bestAsk.ask) / 2,
        best_bid: bestBid.bid,
        best_ask: bestAsk.ask,
        best_bid_exchange: bestBid.exchange,
        best_ask_exchange: bestAsk.exchange,
        max_net_spread_pct: Number(net.toFixed(4)),
        venues: group.length,
        quotes: [...group].sort((a, b) => a.exchange.localeCompare(b.exchange)),
      })
    }

    snapshots.sort((a, b) => b.max_net_spread_pct - a.max_net_spread_pct)
    return snapshots
  }

  private recordHistory(): void {
    const now = Date.now() / 1000
    for (const market of this.markets) {
      for (const key of [market.base, market.symbol]) {
        const series = this.history.get(key) ?? []
        series.push({ ts: now, price: market.reference_price, net_spread_pct: market.max_net_spread_pct })
        this.history.set(key, series.slice(-HISTORY_LENGTH))
      }
    }
    for (const opportunity of this.opportunities.slice(0, 25)) {
      const series = this.edgeHistory.get(opportunity.id) ?? []
      series.push({ ts: now, net_spread_pct: opportunity.net_spread_pct })
      this.edgeHistory.set(opportunity.id, series.slice(-HISTORY_LENGTH))
    }
  }

  historyFor(symbol: string): HistoryPoint[] {
    const upper = symbol.toUpperCase()
    return this.history.get(upper) ?? this.history.get(`${upper}/${this.settings.quoteCurrency}`) ?? []
  }

  edgeHistoryFor(id: string): EdgeHistoryPoint[] {
    return this.edgeHistory.get(id) ?? []
  }

  private buildSnapshot(): MarketUpdate {
    return {
      type: 'snapshot',
      ts: Date.now() / 1000,
      data_mode: this.effective,
      data_mode_reason: this.reason,
      cycle: this.cycle,
      cycle_ms: Math.round(this.cycleMs * 100) / 100,
      opportunities: this.opportunities,
      triangles: this.triangles,
      exchanges: [...this.statuses.values()],
      markets: this.markets,
      stats: this.buildStats(),
    }
  }

  private buildStats(): MarketUpdate['stats'] {
    const statuses = [...this.statuses.values()]
    const online = statuses.filter((status) => status.status === 'online' || status.status === 'degraded')
    const latencies = online.map((status) => status.latency_ms ?? 0).filter((value) => value > 0)
    const best = this.opportunities[0]
    return {
      cycle: this.cycle,
      cycle_ms: Math.round(this.cycleMs * 100) / 100,
      poll_interval: this.settings.pollInterval,
      exchanges_online: online.length,
      exchanges_total: statuses.filter((status) => status.enabled).length,
      symbols: this.settings.symbols.length,
      quotes: this.quotes.size,
      opportunities: this.opportunities.length,
      triangles: this.triangles.length,
      best_net_spread_pct: best?.net_spread_pct ?? 0,
      best_profit_usd: best?.est_profit_usd ?? 0,
      avg_latency_ms: latencies.length
        ? Math.round((latencies.reduce((total, value) => total + value, 0) / latencies.length) * 10) / 10
        : 0,
      data_mode: this.effective,
      notional_usd: this.settings.notionalUsd,
      uptime_s: Math.round((Date.now() - this.startedAt) / 100) / 10,
      clients: 1,
    }
  }
}
