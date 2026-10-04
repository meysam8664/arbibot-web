/**
 * Browser-side exchange adapters (port of backend/app/exchanges/*).
 *
 * These call the same public, keyless REST endpoints; they work from any
 * browser because browsers are not subject to server-side egress restrictions.
 * CORS varies per venue, so failures are isolated per adapter and reported in
 * the venue health panel rather than breaking the scan.
 */

import type { Quote } from '../types'
import { splitSymbol } from './symbols'
import { VENUE_BY_ID } from './venues'

export class AdapterError extends Error {}

export interface FetchContext {
  quoteCurrency: string
  timeoutMs: number
  /** Optional Cross-Origin proxy prefix, e.g. "https://proxy.example/?url=" */
  proxy?: string
}

function proxied(url: string, context: FetchContext): string {
  if (!context.proxy) return url
  return `${context.proxy}${encodeURIComponent(url)}`
}

async function getJson(url: string, context: FetchContext): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), context.timeoutMs)
  try {
    const response = await fetch(proxied(url, context), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      mode: 'cors',
    })
    if (!response.ok) throw new AdapterError(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    if (error instanceof AdapterError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AdapterError(`timeout after ${context.timeoutMs} ms`)
    }
    throw new AdapterError(error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}

interface Adapter {
  id: string
  /** Fetch top of book for the watched bases (plus cross pairs where supported). */
  fetch(context: FetchContext, bases: Set<string>): Promise<Quote[]>
}

function makeQuote(args: {
  venue: string
  rawSymbol: string
  bid: number
  ask: number
  bidQty?: number
  askQty?: number
}): Quote | null {
  const parts = splitSymbol(args.rawSymbol)
  if (!parts) return null
  const [base, quote] = parts
  if (!Number.isFinite(args.bid) || !Number.isFinite(args.ask)) return null
  if (args.bid <= 0 || args.ask <= 0) return null
  return {
    exchange: args.venue,
    exchange_name: VENUE_BY_ID[args.venue]?.name ?? args.venue,
    symbol: `${base}/${quote}`,
    base,
    quote,
    bid: args.bid,
    ask: args.ask,
    bid_qty: args.bidQty ?? 0,
    ask_qty: args.askQty ?? 0,
    ts: Date.now() / 1000,
  }
}

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Fetch helper: keep only pairs we watch (cross pairs included when allowed). */
function keep(quote: Quote | null, venue: string, bases: Set<string>): Quote | null {
  if (!quote) return null
  if (!bases.has(quote.base)) return null
  if (quote.quote !== 'USDT' && quote.quote !== 'USD' && quote.quote !== 'BTC' && quote.quote !== 'ETH') {
    return null
  }
  void venue
  return quote
}

const adapters: Adapter[] = [
  {
    id: 'binance',
    async fetch(context, bases) {
      const rows = (await getJson('https://api.binance.com/api/v3/ticker/bookTicker', context)) as Array<
        Record<string, unknown>
      >
      return rows
        .map((row) =>
          keep(
            makeQuote({
              venue: 'binance',
              rawSymbol: String(row.symbol ?? ''),
              bid: num(row.bidPrice),
              ask: num(row.askPrice),
              bidQty: num(row.bidQty),
              askQty: num(row.askQty),
            }),
            'binance',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'okx',
    async fetch(context, bases) {
      const payload = (await getJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT', context)) as {
        data?: Array<Record<string, unknown>>
      }
      return (payload.data ?? [])
        .map((row) =>
          keep(
            makeQuote({
              venue: 'okx',
              rawSymbol: String(row.instId ?? ''),
              bid: num(row.bidPx),
              ask: num(row.askPx),
              bidQty: num(row.bidSz),
              askQty: num(row.askSz),
            }),
            'okx',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'bybit',
    async fetch(context, bases) {
      const payload = (await getJson('https://api.bybit.com/v5/market/tickers?category=spot', context)) as {
        result?: { list?: Array<Record<string, unknown>> }
      }
      return (payload.result?.list ?? [])
        .map((row) =>
          keep(
            makeQuote({
              venue: 'bybit',
              rawSymbol: String(row.symbol ?? ''),
              bid: num(row.bid1Price),
              ask: num(row.ask1Price),
              bidQty: num(row.bid1Size),
              askQty: num(row.ask1Size),
            }),
            'bybit',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'kucoin',
    async fetch(context, bases) {
      const payload = (await getJson('https://api.kucoin.com/api/v1/market/allTickers', context)) as {
        data?: { ticker?: Array<Record<string, unknown>> }
      }
      return (payload.data?.ticker ?? [])
        .map((row) =>
          keep(
            makeQuote({
              venue: 'kucoin',
              rawSymbol: String(row.symbol ?? ''),
              bid: num(row.buy),
              ask: num(row.sell),
              bidQty: num(row.buySize),
              askQty: num(row.sellSize),
            }),
            'kucoin',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'gateio',
    async fetch(context, bases) {
      const rows = (await getJson('https://api.gateio.ws/api/v4/spot/tickers', context)) as Array<
        Record<string, unknown>
      >
      return rows
        .map((row) =>
          keep(
            makeQuote({
              venue: 'gateio',
              rawSymbol: String(row.currency_pair ?? ''),
              bid: num(row.highest_bid),
              ask: num(row.lowest_ask),
              bidQty: num(row.highest_size),
              askQty: num(row.lowest_size),
            }),
            'gateio',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'mexc',
    async fetch(context, bases) {
      const rows = (await getJson('https://api.mexc.com/api/v3/ticker/bookTicker', context)) as Array<
        Record<string, unknown>
      >
      return rows
        .map((row) =>
          keep(
            makeQuote({
              venue: 'mexc',
              rawSymbol: String(row.symbol ?? ''),
              bid: num(row.bidPrice),
              ask: num(row.askPrice),
              bidQty: num(row.bidQty),
              askQty: num(row.askQty),
            }),
            'mexc',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'bitget',
    async fetch(context, bases) {
      const payload = (await getJson('https://api.bitget.com/api/v2/spot/market/tickers', context)) as {
        data?: Array<Record<string, unknown>>
      }
      return (payload.data ?? [])
        .map((row) =>
          keep(
            makeQuote({
              venue: 'bitget',
              rawSymbol: String(row.symbol ?? ''),
              bid: num(row.bidPr),
              ask: num(row.askPr),
              bidQty: num(row.bidSz),
              askQty: num(row.askSz),
            }),
            'bitget',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'htx',
    async fetch(context, bases) {
      const payload = (await getJson('https://api.huobi.pro/market/tickers', context)) as {
        data?: Array<Record<string, unknown>>
      }
      return (payload.data ?? [])
        .map((row) =>
          keep(
            makeQuote({
              venue: 'htx',
              rawSymbol: String(row.symbol ?? '').toUpperCase(),
              bid: num(row.bid),
              ask: num(row.ask),
              bidQty: num(row.bidSize),
              askQty: num(row.askSize),
            }),
            'htx',
            bases,
          ),
        )
        .filter((quote): quote is Quote => quote !== null)
    },
  },
  {
    id: 'kraken',
    async fetch(context, bases) {
      const pairs = (await getJson('https://api.kraken.com/0/public/AssetPairs', context)) as {
        result?: Record<string, { wsname?: string; altname?: string }>
      }
      const names = new Map<string, string>()
      for (const [key, meta] of Object.entries(pairs.result ?? {})) {
        if (meta.wsname) names.set(key, meta.wsname)
        if (meta.altname && meta.wsname) names.set(meta.altname, meta.wsname)
      }
      const payload = (await getJson('https://api.kraken.com/0/public/Ticker', context)) as {
        result?: Record<string, { b?: unknown[]; a?: unknown[] }>
      }
      const out: Quote[] = []
      for (const [key, row] of Object.entries(payload.result ?? {})) {
        const wsname = names.get(key) ?? key
        const bid = Array.isArray(row.b) ? num(row.b[0]) : 0
        const ask = Array.isArray(row.a) ? num(row.a[0]) : 0
        const bidQty = Array.isArray(row.b) ? num(row.b[2]) : 0
        const askQty = Array.isArray(row.a) ? num(row.a[2]) : 0
        const quote = keep(makeQuote({ venue: 'kraken', rawSymbol: wsname, bid, ask, bidQty, askQty }), 'kraken', bases)
        if (quote) out.push(quote)
      }
      return out
    },
  },
  {
    id: 'coinbase',
    async fetch(context, bases) {
      const targets = [...bases]
      const results = await Promise.all(
        targets.map(async (base) => {
          const product = `${base}-USDT`
          try {
            const row = (await getJson(
              `https://api.exchange.coinbase.com/products/${product}/ticker`,
              context,
            )) as Record<string, unknown>
            return makeQuote({
              venue: 'coinbase',
              rawSymbol: product,
              bid: num(row.bid),
              ask: num(row.ask),
              bidQty: num(row.bid_size),
              askQty: num(row.ask_size),
            })
          } catch {
            return null
          }
        }),
      )
      return results.filter((quote): quote is Quote => quote !== null)
    },
  },
]

export function buildAdapters(): Adapter[] {
  return adapters
}
