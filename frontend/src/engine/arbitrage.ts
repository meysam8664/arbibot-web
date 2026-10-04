/**
 * Arbitrage maths for the browser engine.
 *
 * A faithful TypeScript port of backend/app/engine/arbitrage.py so a static
 * deployment (no Python host) produces exactly the same numbers as the API.
 * Pure functions, no I/O.
 */

import type { Opportunity, Quote, TriangleLeg, TriangleOpportunity } from '../types'

const round = (value: number, digits = 8): number =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0

export type FeeLookup = (exchange: string) => number

export interface ScanOptions {
  notionalUsd: number
  feeLookup: FeeLookup
  slippagePct: number
  minNetSpreadPct: number
  maxResults: number
  quoteCurrency: string
  maxQuoteAgeSec?: number
}

/** Evaluate buying on one venue and selling on another, net of all costs. */
export function directionalEdge(
  buy: Quote,
  sell: Quote,
  options: { notionalUsd: number; buyFeePct: number; sellFeePct: number; slippagePct: number },
): Opportunity {
  const { notionalUsd, buyFeePct, sellFeePct, slippagePct } = options

  const grossPct = ((sell.bid - buy.ask) / buy.ask) * 100
  const feesPct = buyFeePct + sellFeePct
  const netPct = grossPct - feesPct - slippagePct

  const targetQty = notionalUsd / buy.ask
  let depthQty: number | null = null
  if (buy.ask_qty > 0 && sell.bid_qty > 0) depthQty = Math.min(buy.ask_qty, sell.bid_qty)
  const qty = depthQty === null ? targetQty : Math.min(targetQty, depthQty)
  const depthLimited = depthQty !== null && qty < targetQty * 0.999

  const executableNotional = qty * buy.ask
  const buyFeeUsd = (executableNotional * buyFeePct) / 100
  const grossProceeds = qty * sell.bid
  const sellFeeUsd = (grossProceeds * sellFeePct) / 100
  const slippageUsd = (executableNotional * slippagePct) / 100
  const profit = grossProceeds - sellFeeUsd - executableNotional - buyFeeUsd - slippageUsd

  return {
    id: `${buy.symbol}:${buy.exchange}->${sell.exchange}`,
    symbol: buy.symbol,
    base: buy.base,
    quote: buy.quote,
    buy_exchange: buy.exchange,
    buy_exchange_name: buy.exchange_name,
    sell_exchange: sell.exchange,
    sell_exchange_name: sell.exchange_name,
    buy_ask: round(buy.ask),
    sell_bid: round(sell.bid),
    buy_ask_qty: round(buy.ask_qty),
    sell_bid_qty: round(sell.bid_qty),
    reference_price: round((buy.ask + sell.bid) / 2),
    gross_spread_pct: round(grossPct, 4),
    net_spread_pct: round(netPct, 4),
    total_fees_pct: round(feesPct, 4),
    notional_usd: round(notionalUsd, 2),
    executable_notional_usd: round(executableNotional, 2),
    qty: round(qty),
    est_profit_usd: round(profit, 4),
    profitable: profit > 0,
    depth_limited: depthLimited,
    buy_fee_pct: round(buyFeePct, 4),
    sell_fee_pct: round(sellFeePct, 4),
    legs: [
      {
        exchange: buy.exchange,
        exchange_name: buy.exchange_name,
        side: 'buy',
        symbol: buy.symbol,
        price: round(buy.ask),
        qty: round(qty),
        fee_pct: round(buyFeePct, 4),
        fee_usd: round(buyFeeUsd, 4),
        notional_usd: round(executableNotional, 2),
      },
      {
        exchange: sell.exchange,
        exchange_name: sell.exchange_name,
        side: 'sell',
        symbol: sell.symbol,
        price: round(sell.bid),
        qty: round(qty),
        fee_pct: round(sellFeePct, 4),
        fee_usd: round(sellFeeUsd, 4),
        notional_usd: round(grossProceeds, 2),
      },
    ],
    ts: Math.max(buy.ts, sell.ts, Date.now() / 1000),
  }
}

/** Best buy-venue / sell-venue pair for every watched symbol. */
export function scanDirectional(quotes: Quote[], options: ScanOptions): Opportunity[] {
  const now = Date.now() / 1000
  const maxAge = options.maxQuoteAgeSec ?? 60
  const bySymbol = new Map<string, Quote[]>()

  for (const quote of quotes) {
    if (quote.quote !== options.quoteCurrency) continue
    if (quote.ask <= 0 || quote.bid <= 0) continue
    if (now - quote.ts > maxAge) continue
    const group = bySymbol.get(quote.symbol)
    if (group) group.push(quote)
    else bySymbol.set(quote.symbol, [quote])
  }

  const found: Opportunity[] = []
  for (const group of bySymbol.values()) {
    if (group.length < 2) continue
    const cheapestAsk = group.reduce((best, quote) => (quote.ask < best.ask ? quote : best))
    const richestBid = group.reduce((best, quote) => (quote.bid > best.bid ? quote : best))
    if (cheapestAsk.exchange === richestBid.exchange) continue
    const opportunity = directionalEdge(cheapestAsk, richestBid, {
      notionalUsd: options.notionalUsd,
      buyFeePct: options.feeLookup(cheapestAsk.exchange),
      sellFeePct: options.feeLookup(richestBid.exchange),
      slippagePct: options.slippagePct,
    })
    if (opportunity.net_spread_pct >= options.minNetSpreadPct) found.push(opportunity)
  }

  found.sort((a, b) => b.net_spread_pct - a.net_spread_pct)
  return found.slice(0, options.maxResults)
}

interface GraphEdge {
  next: string
  rate: number
  quote: Quote
}

/** Enumerate cycles of at most `maxLegs` legs that start and end in the quote currency. */
export function scanTriangular(
  quotes: Quote[],
  options: {
    notionalUsd: number
    feeLookup: FeeLookup
    minNetSpreadPct: number
    quoteCurrency: string
    maxResults?: number
    maxLegs?: number
    maxAgeSec?: number
    venueNames?: Record<string, string>
  },
): TriangleOpportunity[] {
  const now = Date.now() / 1000
  const maxAge = options.maxAgeSec ?? 60
  const maxLegs = options.maxLegs ?? 3
  const graphs = new Map<string, Map<string, GraphEdge[]>>()

  for (const quote of quotes) {
    if (now - quote.ts > maxAge || quote.bid <= 0 || quote.ask <= 0) continue
    const fee = 1 - options.feeLookup(quote.exchange) / 100
    if (fee <= 0) continue
    let graph = graphs.get(quote.exchange)
    if (!graph) {
      graph = new Map()
      graphs.set(quote.exchange, graph)
    }
    pushEdge(graph, quote.quote, { next: quote.base, rate: (1 / quote.ask) * fee, quote })
    pushEdge(graph, quote.base, { next: quote.quote, rate: quote.bid * fee, quote })
  }

  const results: TriangleOpportunity[] = []
  for (const [exchange, graph] of graphs) {
    if (!graph.has(options.quoteCurrency)) continue
    const best = new Map<string, TriangleOpportunity>()
    walk({
      graph,
      start: options.quoteCurrency,
      node: options.quoteCurrency,
      path: [options.quoteCurrency],
      edges: [],
      rate: 1,
      depthLeft: maxLegs,
      best,
      exchange,
      exchangeName: options.venueNames?.[exchange] ?? titleCase(exchange),
      options,
    })
    for (const cycle of best.values()) {
      if (cycle.net_spread_pct >= options.minNetSpreadPct) results.push(cycle)
    }
  }

  results.sort((a, b) => b.net_spread_pct - a.net_spread_pct)
  return results.slice(0, options.maxResults ?? 25)
}

function pushEdge(graph: Map<string, GraphEdge[]>, from: string, edge: GraphEdge): void {
  const list = graph.get(from)
  if (list) list.push(edge)
  else graph.set(from, [edge])
}

interface WalkArgs {
  graph: Map<string, GraphEdge[]>
  start: string
  node: string
  path: string[]
  edges: GraphEdge[]
  rate: number
  depthLeft: number
  best: Map<string, TriangleOpportunity>
  exchange: string
  exchangeName: string
  options: Parameters<typeof scanTriangular>[1]
}

function walk(args: WalkArgs): void {
  const { graph, start, node, path, edges, rate, depthLeft, best, exchange, exchangeName, options } = args
  if (depthLeft === 0) return

  for (const edge of graph.get(node) ?? []) {
    const newRate = rate * edge.rate
    if (edge.next === start) {
      if (path.length < 3) continue // ignore 1- and 2-leg pseudo cycles
      const key = canonicalKey(path)
      const netPct = (newRate - 1) * 100
      const candidate = buildCycle({
        exchange,
        exchangeName,
        path: [...path, start],
        edges: [...edges, edge],
        netPct,
        options,
      })
      const current = best.get(key)
      if (!current || candidate.net_spread_pct > current.net_spread_pct) best.set(key, candidate)
      continue
    }
    if (path.includes(edge.next)) continue
    walk({
      ...args,
      node: edge.next,
      path: [...path, edge.next],
      edges: [...edges, edge],
      rate: newRate,
      depthLeft: depthLeft - 1,
    })
  }
}

function canonicalKey(path: string[]): string {
  const body = path.slice(0, -1)
  if (!body.length) return path.join('|')
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join('|'))
  return rotations.sort()[0]
}

function buildCycle(args: {
  exchange: string
  exchangeName: string
  path: string[]
  edges: GraphEdge[]
  netPct: number
  options: Parameters<typeof scanTriangular>[1]
}): TriangleOpportunity {
  const { exchange, exchangeName, path, edges, netPct, options } = args
  const feePct = round(options.feeLookup(exchange), 4)
  const legs: TriangleLeg[] = edges.map((edge, index) => {
    const fromAsset = path[index]
    const toAsset = path[index + 1]
    const isBuy = edge.quote.base === toAsset && edge.quote.quote === fromAsset
    return {
      symbol: edge.quote.symbol,
      side: isBuy ? 'buy' : 'sell',
      price: round(isBuy ? edge.quote.ask : edge.quote.bid),
      fee_pct: feePct,
    }
  })
  const totalFeesPct = round(feePct * legs.length, 4)
  return {
    id: `${exchange}:${path.join('->')}`,
    exchange,
    exchange_name: exchangeName,
    path,
    legs,
    gross_spread_pct: round(netPct + totalFeesPct, 4),
    net_spread_pct: round(netPct, 4),
    total_fees_pct: totalFeesPct,
    notional_usd: round(options.notionalUsd, 2),
    est_profit_usd: round((options.notionalUsd * netPct) / 100, 4),
    ts: Date.now() / 1000,
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
