import { useEffect, useState } from 'react'
import { api } from '../api'
import { pct, price, qty, tone, usd } from '../format'
import type { EdgeHistoryPoint, Opportunity, SymbolSnapshot } from '../types'

export type Selection =
  | { kind: 'opportunity'; opportunity: Opportunity }
  | { kind: 'market'; market: SymbolSnapshot }
  | null

interface Props {
  selection: Selection
  onClose: () => void
}

/** Slide-over with the full cost breakdown for a selected row. */
export function DetailDrawer({ selection, onClose }: Props) {
  const [history, setHistory] = useState<EdgeHistoryPoint[]>([])

  useEffect(() => {
    let cancelled = false
    if (selection?.kind === 'opportunity') {
      api
        .edgeHistory(selection.opportunity.id)
        .then((result) => {
          if (!cancelled) setHistory(result.points)
        })
        .catch(() => setHistory([]))
    } else {
      setHistory([])
    }
    return () => {
      cancelled = true
    }
  }, [selection])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!selection) return null

  return (
    <>
      <div className="drawer__scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Details">
        <header className="drawer__head">
          <div>
            {selection.kind === 'opportunity' ? (
              <>
                <h2>
                  {selection.opportunity.base}
                  <span className="muted">/{selection.opportunity.quote}</span>
                </h2>
                <p className="drawer__sub">
                  {selection.opportunity.buy_exchange_name} → {selection.opportunity.sell_exchange_name}
                </p>
              </>
            ) : (
              <>
                <h2>
                  {selection.market.base}
                  <span className="muted">/{selection.market.quote}</span>
                </h2>
                <p className="drawer__sub">{selection.market.venues} venues quoting</p>
              </>
            )}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {selection.kind === 'opportunity' ? (
          <OpportunityDetail opportunity={selection.opportunity} history={history} />
        ) : (
          <MarketLadder market={selection.market} />
        )}
      </aside>
    </>
  )
}

function OpportunityDetail({ opportunity, history }: { opportunity: Opportunity; history: EdgeHistoryPoint[] }) {
  const series = history.map((point) => point.net_spread_pct)
  const costs = [
    { label: 'Buy fee', value: opportunity.buy_fee_pct, side: opportunity.buy_exchange },
    { label: 'Sell fee', value: opportunity.sell_fee_pct, side: opportunity.sell_exchange },
  ]
  const feesUsd = opportunity.legs.reduce((total, leg) => total + leg.fee_usd, 0)

  return (
    <div className="drawer__body">
      <div className="metric-row">
        <div className="metric">
          <span className="metric__label">Net edge</span>
          <span className={`metric__value tone-${tone(opportunity.net_spread_pct)}`}>
            {pct(opportunity.net_spread_pct, 3)}
          </span>
        </div>
        <div className="metric">
          <span className="metric__label">Est. profit</span>
          <span className={`metric__value tone-${tone(opportunity.est_profit_usd)}`}>
            {usd(opportunity.est_profit_usd)}
          </span>
        </div>
        <div className="metric">
          <span className="metric__label">Executable</span>
          <span className="metric__value">{usd(opportunity.executable_notional_usd, 0)}</span>
        </div>
      </div>

      <section>
        <h3>Legs</h3>
        <div className="leg-cards">
          {opportunity.legs.map((leg, index) => (
            <div key={`${leg.exchange}-${index}`} className={`leg-card leg-card--${leg.side}`}>
              <div className="leg-card__side">{leg.side === 'buy' ? 'BUY' : 'SELL'}</div>
              <div className="leg-card__venue">{leg.exchange_name || leg.exchange}</div>
              <dl>
                <div>
                  <dt>Price</dt>
                  <dd className="mono">{price(leg.price)}</dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd className="mono">
                    {qty(leg.qty)} {opportunity.base}
                  </dd>
                </div>
                <div>
                  <dt>Notional</dt>
                  <dd className="mono">{usd(leg.notional_usd)}</dd>
                </div>
                <div>
                  <dt>Fee {leg.fee_pct.toFixed(2)}%</dt>
                  <dd className="mono neg">−{usd(leg.fee_usd)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Cost breakdown</h3>
        <ul className="breakdown">
          <li>
            <span>Gross spread</span>
            <span className="mono">{pct(opportunity.gross_spread_pct)}</span>
          </li>
          {costs.map((cost) => (
            <li key={cost.label}>
              <span>
                {cost.label} <span className="muted">({cost.side})</span>
              </span>
              <span className="mono neg">−{cost.value.toFixed(3)}%</span>
            </li>
          ))}
          <li>
            <span>Slippage buffer</span>
            <span className="mono neg">
              −
              {(
                opportunity.gross_spread_pct -
                opportunity.net_spread_pct -
                opportunity.total_fees_pct
              ).toFixed(3)}
              %
            </span>
          </li>
        </ul>
        <ul className="breakdown">
          <li className="breakdown__total">
            <span>Net edge</span>
            <span className={`mono tone-${tone(opportunity.net_spread_pct)}`}>
              {pct(opportunity.net_spread_pct)}
            </span>
          </li>
          <li>
            <span>Fees in dollars</span>
            <span className="mono neg">−{usd(feesUsd)}</span>
          </li>
        </ul>
        {opportunity.depth_limited && (
          <p className="alert alert--warn">
            Book depth capped the size at {qty(opportunity.qty)} {opportunity.base} (
            {usd(opportunity.executable_notional_usd, 0)} of {usd(opportunity.notional_usd, 0)} requested) — top-of-book
            only, so the realised edge will likely be smaller.
          </p>
        )}
        {!opportunity.profitable && (
          <p className="alert">
            This spread does not clear costs at the current fee assumptions. It is listed because its net edge passes
            the configured threshold.
          </p>
        )}
      </section>

      <section>
        <h3>Edge history</h3>
        <EdgeChart values={series} />
      </section>
    </div>
  )
}

function MarketLadder({ market }: { market: SymbolSnapshot }) {
  const byAsk = [...market.quotes].sort((a, b) => a.ask - b.ask)
  return (
    <div className="drawer__body">
      <div className="metric-row">
        <div className="metric">
          <span className="metric__label">Reference</span>
          <span className="metric__value mono">{price(market.reference_price)}</span>
        </div>
        <div className="metric">
          <span className="metric__label">Best net edge</span>
          <span className={`metric__value tone-${tone(market.max_net_spread_pct)}`}>
            {pct(market.max_net_spread_pct)}
          </span>
        </div>
        <div className="metric">
          <span className="metric__label">Venues</span>
          <span className="metric__value">{market.venues}</span>
        </div>
      </div>

      <section>
        <h3>Venue ladder (cheapest ask first)</h3>
        <table className="data-table data-table--compact">
          <thead>
            <tr>
              <th className="left">Venue</th>
              <th className="right">Bid</th>
              <th className="right">Ask</th>
              <th className="right">Spread</th>
              <th className="right">Bid depth</th>
              <th className="right">Ask depth</th>
            </tr>
          </thead>
          <tbody>
            {byAsk.map((quote) => (
              <tr key={quote.exchange} className="row">
                <td className="left">{quote.exchange_name || quote.exchange}</td>
                <td className="right mono tone-pos">{price(quote.bid)}</td>
                <td className="right mono tone-neg">{price(quote.ask)}</td>
                <td className="right mono">
                  {(((quote.ask - quote.bid) / quote.bid) * 100).toFixed(4)}%
                </td>
                <td className="right mono muted">{usd(quote.bid * quote.bid_qty, 0)}</td>
                <td className="right mono muted">{usd(quote.ask * quote.ask_qty, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function EdgeChart({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <p className="hint">
        Collecting samples — the chart fills in as the engine keeps observing this route over the next few minutes.
      </p>
    )
  }
  const width = 420
  const height = 120
  const pad = 18
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (values.length - 1)
  const points = values.map((value, index) => {
    const x = pad + index * stepX
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2)
  const last = values[values.length - 1]

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart__svg" preserveAspectRatio="none">
        <line x1={pad} x2={width - pad} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeDasharray="4 4" />
        <polygon
          points={`${pad},${zeroY} ${points.join(' ')} ${width - pad},${zeroY}`}
          fill={last >= 0 ? 'var(--pos)' : 'var(--neg)'}
          opacity={0.14}
        />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={last >= 0 ? 'var(--pos)' : 'var(--neg)'}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
      <div className="chart__axis">
        <span>{max.toFixed(3)}%</span>
        <span className="muted">{values.length} samples</span>
        <span>{min.toFixed(3)}%</span>
      </div>
    </div>
  )
}
