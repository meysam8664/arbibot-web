import { describe, expect, it } from 'vitest'
import { MarketSimulator, VENUE_PROFILES } from '../simulator'
import { scanDirectional, scanTriangular } from '../arbitrage'

const build = (seed: number, symbols = ['BTC', 'ETH', 'SOL']) =>
  new MarketSimulator({ symbols, seed })

describe('simulated feed', () => {
  it('is deterministic for a given seed', () => {
    const a = build(42)
    const b = build(42)
    for (let index = 0; index < 5; index += 1) {
      const left = a.quotes()
      const right = b.quotes()
      expect(left.map((q) => [q.exchange, q.symbol, q.bid, q.ask])).toEqual(
        right.map((q) => [q.exchange, q.symbol, q.bid, q.ask]),
      )
    }
  })

  it('diverges for different seeds', () => {
    const a = build(1)
    const b = build(2)
    expect(a.quotes().map((q) => q.bid)).not.toEqual(b.quotes().map((q) => q.bid))
  })

  it('produces sane, fully populated books', () => {
    const quotes = build(7).quotes()
    for (const quote of quotes) {
      expect(quote.bid).toBeGreaterThan(0)
      expect(quote.ask).toBeGreaterThan(quote.bid)
      expect(quote.bid_qty).toBeGreaterThan(0)
      expect(quote.ask_qty).toBeGreaterThan(0)
      expect(((quote.ask - quote.bid) / quote.bid) * 100).toBeLessThan(1)
    }
    for (const venue of Object.keys(VENUE_PROFILES)) {
      for (const symbol of ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']) {
        expect(quotes.some((q) => q.exchange === venue && q.symbol === symbol)).toBe(true)
      }
    }
  })

  it('eventually creates cross-venue edges a scanner can find', () => {
    const simulator = build(7)
    let rows = 0
    for (let index = 0; index < 120; index += 1) {
      rows += scanDirectional(simulator.quotes(), {
        notionalUsd: 10_000,
        feeLookup: () => 0.1,
        slippagePct: 0.02,
        minNetSpreadPct: 0.02,
        maxResults: 50,
        quoteCurrency: 'USDT',
        maxQuoteAgeSec: 3600,
      }).length
    }
    expect(rows).toBeGreaterThan(0)
  })

  it('can create triangular dislocations too', () => {
    const simulator = build(11, ['BTC', 'ETH', 'XRP'])
    let hits = 0
    for (let index = 0; index < 160; index += 1) {
      hits += scanTriangular(simulator.quotes(), {
        notionalUsd: 10_000,
        feeLookup: () => 0.1,
        minNetSpreadPct: 0.05,
        quoteCurrency: 'USDT',
        maxAgeSec: 3600,
      }).length
    }
    expect(hits).toBeGreaterThan(0)
  })
})
