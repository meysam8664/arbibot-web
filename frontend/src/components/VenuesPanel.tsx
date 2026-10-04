import type { ExchangeStatus } from '../types'
import { timeAgo } from '../format'

interface Props {
  exchanges: ExchangeStatus[]
  onToggle?: (id: string, enabled: boolean) => void
}

const STATUS_LABEL: Record<ExchangeStatus['status'], string> = {
  online: 'online',
  degraded: 'degraded',
  offline: 'offline',
  disabled: 'disabled',
  probing: 'probing',
}

/** Venue health: is the public API reachable, how fast, and what does it cost. */
export function VenuesPanel({ exchanges, onToggle }: Props) {
  const sorted = [...exchanges].sort((a, b) => {
    const rank = (status: ExchangeStatus['status']) =>
      status === 'online' ? 0 : status === 'degraded' ? 1 : status === 'probing' ? 2 : status === 'offline' ? 3 : 4
    return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)
  })

  return (
    <div className="panel">
      <div className="panel__head">
        <h2>Venues</h2>
        <span className="panel__meta">
          {exchanges.filter((venue) => venue.status === 'online').length}/{exchanges.length} online
        </span>
      </div>
      <ul className="venue-list">
        {sorted.map((venue) => (
          <li key={venue.id} className={`venue venue--${venue.status}`}>
            <span className={`dot dot--${venue.status}`} aria-hidden />
            <div className="venue__body">
              <div className="venue__title">
                <span className="venue__name">{venue.name}</span>
                <span className="venue__fee" title="Assumed taker fee">
                  {venue.fee_taker_pct.toFixed(2)}%
                </span>
              </div>
              <div className="venue__meta">
                <span>{STATUS_LABEL[venue.status]}</span>
                {venue.status === 'online' || venue.status === 'degraded' ? (
                  <>
                    <span>· {venue.pairs} pairs</span>
                    {venue.latency_ms ? <span>· {venue.latency_ms.toFixed(0)} ms</span> : null}
                    {venue.simulated ? <span className="sim-tag">sim</span> : null}
                  </>
                ) : null}
                {venue.last_update ? <span>· {timeAgo(venue.last_update)}</span> : null}
              </div>
              {venue.error ? <div className="venue__error" title={venue.error}>{venue.error}</div> : null}
            </div>
            {onToggle ? (
              <button
                type="button"
                className={`switch ${venue.enabled ? 'switch--on' : ''}`}
                aria-label={`${venue.enabled ? 'Disable' : 'Enable'} ${venue.name}`}
                onClick={() => onToggle(venue.id, !venue.enabled)}
              >
                <span />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
