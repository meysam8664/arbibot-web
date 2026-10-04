import type { TriangleOpportunity } from '../types'
import { pct, price, tone, usd } from '../format'

interface Props {
  triangles: TriangleOpportunity[]
}

/**
 * Triangular (three-leg, single-venue) cycles.  The path is rendered as a
 * currency chain so the direction of every leg is obvious.
 */
export function TrianglesTable({ triangles }: Props) {
  if (!triangles.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">△</div>
        <h3>No triangular cycles clear costs</h3>
        <p>
          The scanner checks every ≤3-leg path that starts and ends in the quote currency (for example
          USDT → ETH → BTC → USDT) on venues that publish cross pairs. Three taker fees are hard to beat —
          the list stays empty unless a pair is genuinely knocked out of line.
        </p>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="left">Venue</th>
            <th className="left">Cycle</th>
            <th className="left">Legs</th>
            <th className="num-head right">Gross</th>
            <th className="num-head right">Fees</th>
            <th className="num-head right">Net edge</th>
            <th className="num-head right">Profit @ size</th>
          </tr>
        </thead>
        <tbody>
          {triangles.map((cycle) => (
            <tr key={cycle.id} className="row">
              <td className="left" data-label="Venue">
                <span className="venue-pill">{cycle.exchange_name || cycle.exchange}</span>
              </td>
              <td className="left" data-label="Cycle">
                <div className="path">
                  {cycle.path.map((asset, index) => (
                    <span key={`${asset}-${index}`} className="path__item">
                      <span className={index === 0 ? 'path__anchor' : ''}>{asset}</span>
                      {index < cycle.path.length - 1 && <span className="path__arrow">→</span>}
                    </span>
                  ))}
                </div>
              </td>
              <td className="left" data-label="Legs">
                <div className="legs">
                  {cycle.legs.map((leg, index) => (
                    <span key={`${leg.symbol}-${index}`} className={`leg leg--${leg.side}`}>
                      <span className="leg__side">{leg.side === 'buy' ? 'BUY' : 'SELL'}</span>
                      <span className="leg__symbol">{leg.symbol.replace('/', '·')}</span>
                      <span className="leg__price mono">{price(leg.price)}</span>
                    </span>
                  ))}
                </div>
              </td>
              <td className="right mono" data-label="Gross">{pct(cycle.gross_spread_pct, 3)}</td>
              <td className="right mono muted" data-label="Fees">−{cycle.total_fees_pct.toFixed(3)}%</td>
              <td className={`right mono strong tone-${tone(cycle.net_spread_pct)}`} data-label="Net edge">
                {pct(cycle.net_spread_pct, 3)}
              </td>
              <td className={`right mono tone-${tone(cycle.est_profit_usd)}`} data-label="Profit">
                {usd(cycle.est_profit_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
