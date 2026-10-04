import { describe, expect, it } from 'vitest'
import { directionalEdge, scanDirectional, scanTriangular } from '../arbitrage'
import type { Quote } from '../../types'

const quote = (
  exchange: string,
  bid: number,
  ask: number,
  extra: Partial<Quote> = {},
): Quote => ({
  exchange,
  exchange_name: exchange,
  symbol: 'BTC/USDT',
  base: 'BTC',
  quote: 'USDT',
  bid,
  ask,
  bid_qty: 0,
  ask_qty: 0,
  ts: Date.now() / 1000,
  ...extra,
})

const noFees = () => 0

describe('directional edges', () => {
  it('nets out both taker fees and the slippage buffer', () => {
    const opportunity = directionalEdge(quote('a', 99.9, 100), quote('b', 101, 101.1), {
      notionalUsd: 10_000,
      buyFeePct: 0.1,
      sellFeePct: 0.2,
      slippagePct: 0.02,
    })
    expect(opportunity.gross_spread_pct).toBeCloseTo(1, 6)
    expect(opportunity.total_fees_pct).toBeCloseTo(0.3, 6)
    expect(opportunity.net_spread_pct).toBeCloseTo(0.68, 6)
    expect(opportunity.est_profit_usd).toBeCloseTo(
      10_100 - 10_100 * 0.002 - 10_000 - 10_000 * 0.001 - 10_000 * 0.0002,
      4,
    )
    expect(opportunity.profitable).toBe(true)
    expect(opportunity.legs.map((leg) => leg.side)).toEqual(['buy', 'sell'])
  })

  it('caps the size at published depth and flags it', () => {
    const opportunity = directionalEdge(
      quote('a', 99.9, 100, { ask_qty: 2 }),
      quote('b', 101, 101.1, { bid_qty: 50 }),
      { notionalUsd: 10_000, buyFeePct: 0, sellFeePct: 0, slippagePct: 0 },
    )
    expect(opportunity.qty).toBe(2)
    expect(opportunity.executable_notional_usd).toBe(200)
    expect(opportunity.depth_limited).toBe(true)
  })

  it('marks rows that do not clear costs as not profitable', () => {
    const opportunity = directionalEdge(quote('a', 100, 100.05), quote('b', 100.06, 100.1), {
      notionalUsd: 1_000,
      buyFeePct: 0.1,
      sellFeePct: 0.1,
      slippagePct: 0.02,
    })
    expect(opportunity.net_spread_pct).toBeLessThan(0)
    expect(opportunity.profitable).toBe(false)
  })
})

describe('directional scan', () => {
  const options = {
    notionalUsd: 5_000,
    feeLookup: noFees,
    slippagePct: 0,
    minNetSpreadPct: 0,
    maxResults: 10,
    quoteCurrency: 'USDT',
  }

  it('picks the cheapest ask and the richest bid', () => {
    const found = scanDirectional(
      [quote('binance', 100, 100.1), quote('kraken', 101.5, 101.6), quote('okx', 100.8, 100.9)],
      options,
    )
    expect(found).toHaveLength(1)
    expect(found[0].buy_exchange).toBe('binance')
    expect(found[0].sell_exchange).toBe('kraken')
  })

  it('drops stale quotes and single-venue markets', () => {
    const stale = quote('kraken', 200, 200.1, { ts: Date.now() / 1000 - 600 })
    expect(scanDirectional([quote('binance', 100, 100.1), stale], options)).toHaveLength(0)
  })

  it('ignores pairs quoted in another currency', () => {
    const other = quote('kraken', 101, 101.1, { symbol: 'BTC/USDC', quote: 'USDC' })
    expect(scanDirectional([quote('binance', 100, 100.1), other], options)).toHaveLength(0)
  })
})

describe('triangular cycles', () => {
  const fair = 3150 / 68_000
  const triangle = (ethBtcAsk: number): Quote[] => [
    { ...quote('x', 67_900, 68_000), symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' },
    { ...quote('x', 3_149, 3_150), symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT' },
    {
      ...quote('x', ethBtcAsk - 0.00001, ethBtcAsk),
      symbol: 'ETH/BTC',
      base: 'ETH',
      quote: 'BTC',
    },
  ]

  it('finds a profitable cycle when a cross rate is knocked out of line', () => {
    const found = scanTriangular(triangle(fair * 0.997), {
      notionalUsd: 10_000,
      feeLookup: noFees,
      minNetSpreadPct: 0.05,
      quoteCurrency: 'USDT',
    })
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].path[0]).toBe('USDT')
    expect(found[0].path.at(-1)).toBe('USDT')
    expect(found[0].legs).toHaveLength(3)
    expect(found[0].net_spread_pct).toBeGreaterThan(0)
    expect(found[0].net_spread_pct).toBeLessThan(1)
  })

  it('rejects the same cycle once fees exceed the dislocation', () => {
    const found = scanTriangular(triangle(fair * 0.997), {
      notionalUsd: 10_000,
      feeLookup: () => 0.3,
      minNetSpreadPct: 0.05,
      quoteCurrency: 'USDT',
    })
    expect(found).toHaveLength(0)
  })
})
