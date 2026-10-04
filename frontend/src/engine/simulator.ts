/**
 * Seeded simulated market feed for the browser engine.
 *
 * Port of backend/app/engine/simulator.py: every venue quotes a common "true"
 * price with its own basis and half-spread, cross pairs are derived from the
 * true prices (so triangles stay internally consistent), and short-lived
 * dislocations appear and decay to create realistic arbitrage windows.
 */

import type { Quote } from '../types'
import { canonicalBase } from './symbols'
import { VENUES } from './venues'

/** Rough reference prices (USD). */
export const REFERENCE_PRICES: Record<string, number> = {
  BTC: 68_400, ETH: 3_150, SOL: 168, XRP: 0.58, BNB: 592, DOGE: 0.163,
  ADA: 0.47, AVAX: 36.5, LINK: 17.8, TON: 7.1, DOT: 6.9, LTC: 84,
  BCH: 430, TRX: 0.128, SHIB: 0.0000245, POL: 0.72, ATOM: 8.4, NEAR: 5.6,
  APT: 9.3, ARB: 1.12,
}

/** Per-venue character: [basis bps, half-spread bps, depth USD]. */
export const VENUE_PROFILES: Record<string, [number, number, number]> = {
  binance: [-1.5, 1.0, 250_000],
  okx: [0.5, 1.2, 180_000],
  bybit: [1.0, 1.4, 150_000],
  kucoin: [3.0, 2.2, 90_000],
  gateio: [-2.5, 2.6, 80_000],
  mexc: [4.0, 2.0, 60_000],
  bitget: [2.0, 1.8, 70_000],
  htx: [-1.0, 3.0, 55_000],
  kraken: [5.0, 3.5, 120_000],
  coinbase: [6.0, 5.0, 100_000],
}

const CROSS_QUOTES = ['BTC', 'ETH'] as const
const CROSS_QUOTE_VENUES = new Set(['binance', 'okx', 'bybit', 'kucoin', 'gateio', 'mexc', 'bitget'])
const DISLOCATION_PROBABILITY = 0.45
const DISLOCATION_DECAY = 0.88
const DISLOCATION_MIN_BPS = 25
const DISLOCATION_MAX_BPS = 110

const DEFAULT_PROFILE: [number, number, number] = [0, 2, 50_000]

/** Deterministic 32-bit PRNG (mulberry32) with a gaussian helper. */
class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Box–Muller gaussian, matching the shape of Python's random.gauss(). */
  gauss(mean = 0, sigma = 1): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
}

export interface SimulatorOptions {
  venues?: string[]
  symbols: string[]
  quoteCurrency?: string
  seed?: number
  venueNames?: Record<string, string>
}

export class MarketSimulator {
  private readonly rng: Rng
  private readonly venues: string[]
  private readonly symbols: string[]
  private readonly quoteCurrency: string
  private readonly venueNames: Record<string, string>
  private readonly truePrice = new Map<string, number>()
  private readonly drift = new Map<string, number>()
  private readonly basis = new Map<string, number>()
  private readonly dislocations = new Map<string, number>()
  private tick = 0

  constructor(options: SimulatorOptions) {
    this.venues = options.venues ?? VENUES.map((venue) => venue.id)
    this.symbols = options.symbols.map(canonicalBase)
    this.quoteCurrency = (options.quoteCurrency ?? 'USDT').toUpperCase()
    this.seed = options.seed ?? 1337
    this.rng = new Rng(this.seed)
    this.venueNames = options.venueNames ?? {}
    for (const base of this.symbols) {
      this.truePrice.set(base, REFERENCE_PRICES[base] ?? this.fallbackPrice(base))
      this.drift.set(base, 0)
      for (const venue of this.venues) this.basis.set(`${venue}|${base}`, this.profile(venue)[0] / 10_000)
    }
  }

  private seed: number

  reSeed(seed: number): void {
    this.seed = seed
  }

  private profile(venue: string): [number, number, number] {
    return VENUE_PROFILES[venue] ?? DEFAULT_PROFILE
  }

  private fallbackPrice(base: string): number {
    const rng = new Rng(hashString(`${base}-price`))
    return Number(rng.range(1.5, 240).toFixed(6))
  }

  /** Advance one tick and return every venue's top of book. */
  quotes(): Quote[] {
    this.step()
    const out: Quote[] = []
    for (const base of this.symbols) {
      const truePrice = this.truePrice.get(base) ?? 1
      for (const venue of this.venues) {
        out.push(
          this.makeQuote({
            venue,
            base,
            quoteAsset: this.quoteCurrency,
            mid: truePrice * (1 + (this.basis.get(`${venue}|${base}`) ?? 0)),
          }),
        )
      }
      for (const quoteAsset of CROSS_QUOTES) {
        if (base === quoteAsset || !this.symbols.includes(quoteAsset)) continue
        const reference = this.truePrice.get(quoteAsset)
        if (!reference) continue
        const rate = truePrice / reference
        for (const venue of this.venues) {
          if (!CROSS_QUOTE_VENUES.has(venue)) continue
          const basis =
            (this.basis.get(`${venue}|${base}`) ?? 0) -
            (this.basis.get(`${venue}|${quoteAsset}`) ?? 0) +
            (this.dislocations.get(`${venue}|${base}/${quoteAsset}`) ?? 0)
          out.push(
            this.makeQuote({
              venue,
              base,
              quoteAsset,
              mid: rate * (1 + basis),
              depthScale: 0.6,
              spreadScale: 1.4,
            }),
          )
        }
      }
    }
    return out
  }

  private step(): void {
    this.tick += 1
    for (const base of this.symbols) {
      const shock = this.rng.gauss(0, 0.0006)
      this.drift.set(base, (this.drift.get(base) ?? 0) * 0.92 + shock)
      const next = Math.max(1e-12, (this.truePrice.get(base) ?? 1) * (1 + (this.drift.get(base) ?? 0)))
      this.truePrice.set(base, next)
    }

    this.stepDislocations()

    for (const key of [...this.basis.keys()]) {
      const [venue] = key.split('|')
      const target = this.profile(venue)[0] / 10_000
      const current = this.basis.get(key) ?? target
      const shock = this.dislocations.get(key) ?? 0
      this.basis.set(key, current + (target - current) * 0.08 + this.rng.gauss(0, 0.0003) + shock)
    }
  }

  private stepDislocations(): void {
    for (const [key, value] of [...this.dislocations.entries()]) {
      const decayed = value * DISLOCATION_DECAY
      if (Math.abs(decayed) < 2e-5) this.dislocations.delete(key)
      else this.dislocations.set(key, decayed)
    }
    if (this.rng.next() >= DISLOCATION_PROBABILITY) return
    const venue = this.rng.pick(this.venues)
    const markets = [
      ...this.symbols,
      ...this.crossMarkets().map(([base, quote]) => `${base}/${quote}`),
    ]
    const market = this.rng.pick(markets)
    const direction = this.rng.next() < 0.5 ? 1 : -1
    const size = this.rng.range(DISLOCATION_MIN_BPS, DISLOCATION_MAX_BPS) / 10_000
    const key = `${venue}|${market}`
    this.dislocations.set(key, (this.dislocations.get(key) ?? 0) + direction * size)
  }

  crossMarkets(): Array<[string, string]> {
    const others = this.symbols.filter((asset) => (CROSS_QUOTES as readonly string[]).includes(asset))
    const markets: Array<[string, string]> = []
    for (const base of this.symbols) {
      for (const cross of others) if (base !== cross) markets.push([base, cross])
    }
    return markets
  }

  private makeQuote(args: {
    venue: string
    base: string
    quoteAsset: string
    mid: number
    depthScale?: number
    spreadScale?: number
  }): Quote {
    const { venue, base, quoteAsset, mid, depthScale = 1, spreadScale = 1 } = args
    const halfSpread = (mid * this.profile(venue)[1]) / 10_000 * spreadScale
    const jitter = 1 + Math.abs(this.rng.gauss(0, 0.15))
    const bid = mid - halfSpread * jitter
    let ask = mid + halfSpread * jitter
    if (bid >= ask) ask = bid + mid * 1e-5
    const depthUsd = this.profile(venue)[2] * depthScale
    const scale = 1e12
    return {
      exchange: venue,
      exchange_name: this.venueNames[venue] ?? titleCase(venue),
      symbol: `${base}/${quoteAsset}`,
      base,
      quote: quoteAsset,
      bid: Math.round(bid * scale) / scale,
      ask: Math.round(ask * scale) / scale,
      bid_qty: Math.round((depthUsd / Math.max(bid, 1e-12)) * 1e8) / 1e8,
      ask_qty: Math.round((depthUsd / Math.max(ask, 1e-12)) * 1e8) / 1e8,
      ts: Date.now() / 1000,
    }
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
