import { useEffect, useState } from 'react'
import type { RuntimeConfig, RuntimeConfigPatch } from '../types'

interface Props {
  config: RuntimeConfig
  onPatch: (patch: RuntimeConfigPatch) => Promise<void>
  busy: boolean
  /** True when the scanner runs in this browser (no backend). */
  standalone?: boolean
}

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON', 'DOT', 'LTC']

/**
 * Runtime controls.  Edits are staged locally and sent as one PATCH, so the
 * engine re-scans exactly once per change instead of on every keystroke.
 */
export function SettingsPanel({ config, onPatch, busy, standalone = false }: Props) {
  const [mode, setMode] = useState(config.data_mode)
  const [notional, setNotional] = useState(config.notional_usd)
  const [minEdge, setMinEdge] = useState(config.min_net_spread_pct)
  const [slippage, setSlippage] = useState(config.slippage_buffer_pct)
  const [interval, setIntervalSeconds] = useState(config.poll_interval)
  const [symbols, setSymbols] = useState<string[]>(config.symbols)
  const [fees, setFees] = useState<Record<string, number>>(config.taker_fees)

  useEffect(() => {
    setMode(config.data_mode)
    setNotional(config.notional_usd)
    setMinEdge(config.min_net_spread_pct)
    setSlippage(config.slippage_buffer_pct)
    setIntervalSeconds(config.poll_interval)
    setSymbols(config.symbols)
    setFees(config.taker_fees)
  }, [config])

  const apply = (patch: RuntimeConfigPatch) => void onPatch({ ...patch, refresh: false })

  const toggleSymbol = (base: string) => {
    const next = symbols.includes(base) ? symbols.filter((item) => item !== base) : [...symbols, base]
    if (!next.length) return
    setSymbols(next)
    apply({ symbols: next })
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h2>Scanner settings</h2>
        {busy ? <span className="panel__meta">applying…</span> : <span className="panel__meta">live applied</span>}
      </div>

      <div className="field">
        <label>Data source</label>
        <div className="segmented">
          {(['auto', 'live', 'sim'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => {
                setMode(option)
                apply({ data_mode: option })
              }}
            >
              {option === 'auto' ? 'Auto' : option === 'live' ? 'Live APIs' : 'Simulated'}
            </button>
          ))}
        </div>
        <p className="hint">{config.data_mode_reason || 'auto probes the exchange APIs and falls back to the simulator.'}</p>
      </div>

      <div className="field">
        <label htmlFor="notional">Trade size (notional per leg)</label>
        <div className="row-inline">
          <input
            id="notional"
            type="range"
            min={500}
            max={250_000}
            step={500}
            value={notional}
            onChange={(event) => setNotional(Number(event.target.value))}
            onPointerUp={() => apply({ notional_usd: notional })}
          />
          <span className="value mono">${notional.toLocaleString()}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="min-edge">Minimum net edge</label>
        <div className="row-inline">
          <input
            id="min-edge"
            type="range"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={minEdge}
            onChange={(event) => setMinEdge(Number(event.target.value))}
            onPointerUp={() => apply({ min_net_spread_pct: minEdge })}
          />
          <span className="value mono">{minEdge.toFixed(2)}%</span>
        </div>
        <p className="hint">Lower it (even below zero) to surface near-miss spreads.</p>
      </div>

      <div className="field">
        <label htmlFor="slippage">Slippage buffer</label>
        <div className="row-inline">
          <input
            id="slippage"
            type="range"
            min={0}
            max={0.3}
            step={0.01}
            value={slippage}
            onChange={(event) => setSlippage(Number(event.target.value))}
            onPointerUp={() => apply({ slippage_buffer_pct: slippage })}
          />
          <span className="value mono">{slippage.toFixed(2)}%</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="interval">Poll interval</label>
        <div className="row-inline">
          <input
            id="interval"
            type="range"
            min={2}
            max={30}
            step={1}
            value={interval}
            onChange={(event) => setIntervalSeconds(Number(event.target.value))}
            onPointerUp={() => apply({ poll_interval: interval })}
          />
          <span className="value mono">{interval.toFixed(0)}s</span>
        </div>
        {standalone ? <p className="hint">How often this device re-queries the exchanges directly.</p> : null}
      </div>

      <div className="field">
        <label>Watch-list ({symbols.length} markets)</label>
        <div className="chips">
          {(config.supported_symbols.length ? config.supported_symbols : WATCHLIST).map((base) => (
            <button
              key={base}
              type="button"
              className={symbols.includes(base) ? 'chip chip--on' : 'chip'}
              onClick={() => toggleSymbol(base)}
            >
              {base}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Taker fees (assumed, per side)</label>
        <div className="fee-grid">
          {Object.entries(fees).map(([venue, fee]) => (
            <label key={venue} className="fee-row">
              <span>{venue}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={fee}
                onChange={(event) => setFees({ ...fees, [venue]: Number(event.target.value) })}
                onBlur={() => apply({ taker_fees: { [venue]: fees[venue] } })}
              />
            </label>
          ))}
        </div>
      </div>

      {standalone ? (
        <p className="hint">
          Settings are stored on this device. Some venues (Binance in particular) do not allow direct browser calls —
          they show as <em>offline</em> unless you deploy with a CORS proxy in <code>config.js</code>.
        </p>
      ) : null}
    </div>
  )
}
