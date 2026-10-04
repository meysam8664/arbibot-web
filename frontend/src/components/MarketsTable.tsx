import type { SymbolSnapshot } from '../types'
import { pct, price, tone } from '../format'
import { Sparkline } from './Sparkline'

interface Props {
  markets: SymbolSnapshot[]
  history: Record<string, number[]>
  onSelect?: (market: SymbolSnapshot) => void
}

/** Per-symbol overview: where the best bid/ask sit and how wide the window is. */
export function MarketsTable({ markets, history, onSelect }: Props) {
  if (!markets.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">◍</div>
        <h3>No venues are reporting yet</h3>
        <p>The engine is still probing the exchange APIs. This panel fills in as soon as quotes arrive.</p>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="left">Market</th>
            <th className="num-head right">Reference</th>
            <th className="num-head right">Best bid</th>
            <th className="left">Bid venue</th>
            <th className="num-head right">Best ask</th>
            <th className="left">Ask venue</th>
            <th className="num-head right">Venues</th>
            <th className="num-head right">Best net edge</th>
            <th className="num-head right">Trend</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => (
            <tr
              key={market.symbol}
              className="row"
              onClick={() => onSelect?.(market)}
              title="Click for the full venue ladder"
            >
              <td className="left">
                <div className="market-cell">
                  <span className="market-cell__base">{market.base}</span>
                  <span className="market-cell__quote">/{market.quote}</span>
                </div>
              </td>
              <td className="right mono">{price(market.reference_price)}</td>
              <td className="right mono tone-pos">{price(market.best_bid)}</td>
              <td className="left">
                <span className="venue-pill">{market.best_bid_exchange}</span>
              </td>
              <td className="right mono tone-neg">{price(market.best_ask)}</td>
              <td className="left">
                <span className="venue-pill">{market.best_ask_exchange}</span>
              </td>
              <td className="right mono muted">{market.venues}</td>
              <td className={`right mono strong tone-${tone(market.max_net_spread_pct)}`}>
                {pct(market.max_net_spread_pct, 3)}
              </td>
              <td className="right">
                <Sparkline
                  values={history[market.base] ?? []}
                  zeroLine
                  width={110}
                  color={
                    (history[market.base]?.at(-1) ?? 0) >= (history[market.base]?.at(0) ?? 0)
                      ? 'var(--accent)'
                      : 'var(--neg)'
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
