import { useMemo, useState } from 'react'
import type { Opportunity } from '../types'
import { pct, price, qty, tone, usd } from '../format'
import { Sparkline } from './Sparkline'

type SortKey = 'net' | 'gross' | 'profit' | 'symbol' | 'spread'

interface Props {
  opportunities: Opportunity[]
  edges: Record<string, number[]>
  onSelect: (opportunity: Opportunity) => void
  selectedId?: string
  showNearMisses: boolean
}

export function OpportunitiesTable({ opportunities, edges, onSelect, selectedId, showNearMisses }: Props) {
  const [sort, setSort] = useState<SortKey>('net')
  const [descending, setDescending] = useState(true)

  const rows = useMemo(() => {
    const filtered = opportunities.filter((row) => showNearMisses || row.profitable)
    const direction = descending ? -1 : 1
    const value = (row: Opportunity): number | string => {
      switch (sort) {
        case 'gross':
          return row.gross_spread_pct
        case 'profit':
          return row.est_profit_usd
        case 'symbol':
          return row.symbol
        case 'spread':
          return (row.sell_bid - row.buy_ask) / row.buy_ask
        default:
          return row.net_spread_pct
      }
    }
    return [...filtered].sort((a, b) => {
      const left = value(a)
      const right = value(b)
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction
      }
      return (left - right) * direction
    })
  }, [opportunities, sort, descending, showNearMisses])

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right', hint?: string) => (
    <th
      className={`num-head ${align}`}
      title={hint}
      onClick={() => {
        if (sort === key) setDescending((value) => !value)
        else {
          setSort(key)
          setDescending(true)
        }
      }}
    >
      {label}
      <span className={`sort-caret ${sort === key ? 'active' : ''}`}>
        {sort === key ? (descending ? '▾' : '▴') : '↕'}
      </span>
    </th>
  )

  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">◎</div>
        <h3>No priced edges right now</h3>
        <p>
          Every cross-venue spread is currently thinner than the taker fees plus slippage buffer.
          That is the normal state of a liquid market — turn on <strong>show near misses</strong> to see the
          closest candidates, or widen the watch-list in Settings.
        </p>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {header('symbol', 'Market', 'left')}
            <th className="left">Route</th>
            {header('gross', 'Gross', 'right', 'Raw price difference before costs')}
            <th className="num-head right">Fees</th>
            {header('net', 'Net edge', 'right', 'Edge after taker fees and the slippage buffer')}
            {header('profit', `Profit @ size`, 'right', 'Estimated P&L for the configured notional')}
            <th className="num-head right">Size</th>
            <th className="num-head right">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const series = edges[row.id] ?? []
            return (
              <tr
                key={row.id}
                className={`row ${selectedId === row.id ? 'row--selected' : ''} ${
                  row.profitable ? '' : 'row--near'
                }`}
                onClick={() => onSelect(row)}
              >
                <td className="left">
                  <div className="market-cell">
                    <span className="market-cell__base">{row.base}</span>
                    <span className="market-cell__quote">/{row.quote}</span>
                  </div>
                  {row.depth_limited && <span className="chip chip--warn" title="Book depth caps the size">depth capped</span>}
                  {!row.profitable && <span className="chip chip--muted" title="Does not clear costs yet">near miss</span>}
                </td>
                <td className="left" data-label="Route">
                  <div className="route">
                    <span className="route__venue buy" title={`Buy at ${price(row.buy_ask)}`}>
                      {row.buy_exchange_name || row.buy_exchange}
                    </span>
                    <span className="route__arrow">→</span>
                    <span className="route__venue sell" title={`Sell at ${price(row.sell_bid)}`}>
                      {row.sell_exchange_name || row.sell_exchange}
                    </span>
                  </div>
                  <div className="route__prices">
                    {price(row.buy_ask)} <span className="muted">/</span> {price(row.sell_bid)}
                  </div>
                </td>
                <td className="right mono" data-label="Gross">{pct(row.gross_spread_pct, 3)}</td>
                <td className="right mono muted" data-label="Fees">−{row.total_fees_pct.toFixed(3)}%</td>
                <td className={`right mono strong tone-${tone(row.net_spread_pct)}`} data-label="Net edge">
                  {pct(row.net_spread_pct, 3)}
                </td>
                <td className={`right mono tone-${tone(row.est_profit_usd)}`} data-label="Profit">
                  {usd(row.est_profit_usd)}
                  <span className="muted small"> / {qty(row.qty)} {row.base}</span>
                </td>
                <td className="right mono muted" data-label="Size">{usd(row.executable_notional_usd, 0)}</td>
                <td className="right" data-label="Trend">
                  <Sparkline values={series} zeroLine color={row.profitable ? 'var(--pos)' : 'var(--muted)'} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
