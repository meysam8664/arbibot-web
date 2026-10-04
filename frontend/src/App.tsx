import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, useMarketStream } from './api'
import { DetailDrawer, type Selection } from './components/DetailDrawer'
import { MarketsTable } from './components/MarketsTable'
import { OpportunitiesTable } from './components/OpportunitiesTable'
import { PhonePanel } from './components/PhonePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { TrianglesTable } from './components/TrianglesTable'
import { VenuesPanel } from './components/VenuesPanel'
import * as client from './data/client'
import { getSettings } from './data/settings'
import { compactUsd, pct, tone, usd } from './format'
import type { RuntimeConfig, RuntimeConfigPatch, SymbolSnapshot } from './types'

type Tab = 'cross' | 'triangles' | 'markets'
const HISTORY_LENGTH = 60

interface AppProps {
  initialTab?: Tab
}

export default function App({ initialTab = 'cross' }: AppProps) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const { snapshot, state, error, paused, setPaused } = useMarketStream(config?.poll_interval)
  const [configError, setConfigError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [query, setQuery] = useState('')
  const [showNearMisses, setShowNearMisses] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [showPhone, setShowPhone] = useState(false)
  const [standalone, setStandalone] = useState(() => client.currentDataSource() === 'local')
  const [detecting, setDetecting] = useState(() => client.currentDataSource() === 'unknown')

  const edgeSeries = useRef<Record<string, number[]>>({})
  const priceSeries = useRef<Record<string, number[]>>({})

  const settings = getSettings()
  const title = settings.title

  useEffect(() => {
    let cancelled = false
    client.resolveDataSource().then((source) => {
      if (cancelled) return
      setStandalone(source === 'local')
      setDetecting(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((err) => setConfigError(err instanceof Error ? err.message : String(err)))
  }, [])

  // Accumulate sparkline series from the snapshot stream (no extra requests).
  useEffect(() => {
    if (!snapshot) return
    for (const opportunity of snapshot.opportunities.slice(0, 40)) {
      const series = edgeSeries.current[opportunity.id] ?? []
      edgeSeries.current[opportunity.id] = [...series, opportunity.net_spread_pct].slice(-HISTORY_LENGTH)
    }
    for (const market of snapshot.markets) {
      const series = priceSeries.current[market.base] ?? []
      priceSeries.current[market.base] = [...series, market.max_net_spread_pct].slice(-HISTORY_LENGTH)
    }
  }, [snapshot])

  const patchConfig = useCallback(async (patch: RuntimeConfigPatch) => {
    setBusy(true)
    try {
      setConfig(await api.patchConfig(patch))
      setConfigError(null)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshNow = useCallback(async () => {
    setBusy(true)
    try {
      await api.refresh()
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const toggleVenue = useCallback(
    (id: string, enabled: boolean) => {
      if (!config) return
      const disabled = new Set(config.disabled_exchanges)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      void patchConfig({ disabled_exchanges: [...disabled], refresh: true })
    },
    [config, patchConfig],
  )

  const search = query.trim().toUpperCase()

  const opportunities = useMemo(() => {
    const rows = snapshot?.opportunities ?? []
    if (!search) return rows
    return rows.filter(
      (row) =>
        row.symbol.includes(search) ||
        row.base.includes(search) ||
        row.buy_exchange_name.toUpperCase().includes(search) ||
        row.sell_exchange_name.toUpperCase().includes(search),
    )
  }, [snapshot, search])

  const triangles = useMemo(() => {
    const rows = snapshot?.triangles ?? []
    if (!search) return rows
    return rows.filter(
      (row) => row.exchange_name.toUpperCase().includes(search) || row.path.join('').includes(search),
    )
  }, [snapshot, search])

  const markets = useMemo(() => {
    const rows = snapshot?.markets ?? []
    if (!search) return rows
    return rows.filter((row) => row.symbol.includes(search))
  }, [snapshot, search])

  const stats = snapshot?.stats
  const mode = snapshot?.data_mode ?? 'probing'
  const simulated = mode === 'sim'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>
            ⬡
          </span>
          <div>
            <h1>{title}</h1>
            <p>
              {detecting
                ? 'Detecting data source…'
                : standalone
                  ? 'Runs in your browser · no server needed'
                  : 'Cross-exchange arbitrage scanner'}
            </p>
          </div>
        </div>

        <div className="topbar__status">
          <span className={`pill pill--${mode}`}>
            {mode === 'live' ? 'LIVE DATA' : mode === 'sim' ? 'SIMULATED FEED' : 'PROBING'}
          </span>
          <span className={`pill pill--stream pill--${state}`}>
            {standalone ? 'on-device' : state === 'streaming' ? 'streaming' : state === 'polling' ? 'polling' : 'connecting'}
          </span>
          <span className="pill pill--muted" title={snapshot?.data_mode_reason}>
            {stats ? `cycle #${stats.cycle} · ${stats.cycle_ms.toFixed(0)} ms` : 'waiting for data'}
          </span>
          <button
            type="button"
            className={`ghost-button ${showPhone ? 'ghost-button--active' : ''}`}
            onClick={() => setShowPhone((value) => !value)}
            title="Open this dashboard on your phone"
          >
            ▣ phone
          </button>
          <button
            type="button"
            className={`ghost-button ${paused ? 'ghost-button--active' : ''}`}
            onClick={() => setPaused(!paused)}
            title={paused ? 'Resume updates' : 'Freeze the dashboard'}
          >
            {paused ? '▶ resume' : '❚❚ pause'}
          </button>
          <button type="button" className="ghost-button" onClick={refreshNow} disabled={busy}>
            ↻ refresh
          </button>
        </div>
      </header>

      {showPhone && <PhonePanel standalone={standalone} />}

      {simulated && (
        <div className="banner banner--sim">
          <strong>Simulated market feed.</strong> {snapshot?.data_mode_reason} Prices are generated locally by a seeded
          model, so the dashboard stays usable — switch <em>Data source</em> to <strong>Live APIs</strong> in Settings
          once the exchanges answer from this device.
        </div>
      )}
      {standalone && !simulated && (
        <div className="banner banner--info">
          <strong>On-device engine.</strong> The scan runs entirely in this browser — no API keys, no backend. Ten public
          exchange APIs are polled directly from your phone or laptop.
        </div>
      )}
      {error && <div className="banner banner--warn">Transport issue: {error} — retrying automatically.</div>}
      {configError && <div className="banner banner--warn">Configuration error: {configError}</div>}

      <section className="stats">
        <Stat label="Priced edges" value={stats ? String(stats.opportunities) : '—'} hint="cross-venue routes clearing costs" />
        <Stat
          label="Best net edge"
          value={stats ? pct(stats.best_net_spread_pct, 3) : '—'}
          tone={stats ? tone(stats.best_net_spread_pct) : 'flat'}
          hint="after taker fees and slippage buffer"
        />
        <Stat
          label={`Profit @ ${stats ? compactUsd(stats.notional_usd) : '—'}`}
          value={stats ? usd(stats.best_profit_usd) : '—'}
          tone={stats ? tone(stats.best_profit_usd) : 'flat'}
          hint="per configured trade size"
        />
        <Stat
          label="Venues online"
          value={stats ? `${stats.exchanges_online}/${stats.exchanges_total}` : '—'}
          hint={stats ? `avg ${stats.avg_latency_ms.toFixed(0)} ms round-trip` : undefined}
        />
        <Stat label="Quotes tracked" value={stats ? String(stats.quotes) : '—'} hint={stats ? `${stats.symbols} markets` : undefined} />
        <Stat label="Triangular cycles" value={stats ? String(stats.triangles) : '—'} hint="≤3 legs, single venue" />
      </section>

      <main className="layout">
        <div className="content">
          <div className="toolbar">
            <nav className="tabs">
              <button type="button" className={tab === 'cross' ? 'tab tab--active' : 'tab'} onClick={() => setTab('cross')}>
                Cross-venue <span className="tab__count">{snapshot?.opportunities.length ?? 0}</span>
              </button>
              <button
                type="button"
                className={tab === 'triangles' ? 'tab tab--active' : 'tab'}
                onClick={() => setTab('triangles')}
              >
                Triangular <span className="tab__count">{snapshot?.triangles.length ?? 0}</span>
              </button>
              <button type="button" className={tab === 'markets' ? 'tab tab--active' : 'tab'} onClick={() => setTab('markets')}>
                Markets <span className="tab__count">{snapshot?.markets.length ?? 0}</span>
              </button>
            </nav>

            <div className="toolbar__right">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showNearMisses}
                  onChange={(event) => setShowNearMisses(event.target.checked)}
                />
                <span>show near misses</span>
              </label>
              <input
                className="search"
                placeholder="Filter market / venue…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="card">
            {tab === 'cross' && (
              <OpportunitiesTable
                opportunities={opportunities}
                edges={edgeSeries.current}
                onSelect={(opportunity) => setSelection({ kind: 'opportunity', opportunity })}
                selectedId={selection?.kind === 'opportunity' ? selection.opportunity.id : undefined}
                showNearMisses={showNearMisses}
              />
            )}
            {tab === 'triangles' && <TrianglesTable triangles={triangles} />}
            {tab === 'markets' && (
              <MarketsTable
                markets={markets}
                history={priceSeries.current}
                onSelect={(market: SymbolSnapshot) => setSelection({ kind: 'market', market })}
              />
            )}
          </div>

          <p className="footnote">
            Edges are computed from top-of-book quotes and are net of the taker fees you configure plus a slippage
            buffer. They are indicative, not executable: real fills depend on depth, latency, transfer times between
            venues and withdrawal limits. Nothing here is trading advice.
          </p>
        </div>

        <aside className="sidebar">
          {settings.lockSettings ? (
            <div className="panel">
              <div className="panel__head">
                <h2>Settings</h2>
              </div>
              <p className="hint">
                This deployment has a fixed configuration (watch-list, fees and thresholds are preset by the operator).
              </p>
            </div>
          ) : config ? (
            <SettingsPanel config={config} onPatch={patchConfig} busy={busy} standalone={standalone} />
          ) : (
            <div className="panel">
              <div className="panel__head">
                <h2>Scanner settings</h2>
              </div>
              <p className="hint">Loading runtime configuration…</p>
            </div>
          )}
          <VenuesPanel exchanges={snapshot?.exchanges ?? []} onToggle={settings.lockSettings ? undefined : toggleVenue} />
        </aside>
      </main>

      <DetailDrawer selection={selection} onClose={() => setSelection(null)} />
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone: statTone = 'flat',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'pos' | 'neg' | 'flat'
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value tone-${statTone}`}>{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  )
}
