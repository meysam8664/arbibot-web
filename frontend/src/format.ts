/** Small formatting helpers shared across the dashboard. */

export function price(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 10_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  if (abs >= 1) return value.toFixed(4)
  if (abs >= 0.01) return value.toFixed(6)
  return value.toPrecision(4)
}

export function usd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

export function compactUsd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

/** Percentages with a fixed sign so profit and loss read at a glance. */
export function pct(value: number, digits = 3, signed = true): string {
  if (!Number.isFinite(value)) return '—'
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function qty(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toFixed(2)
  if (Math.abs(value) >= 1) return value.toFixed(4)
  return value.toFixed(6)
}

export function timeAgo(ts: number): string {
  if (!ts) return '—'
  const seconds = Math.max(0, (Date.now() - ts * 1000) / 1000)
  if (seconds < 1) return 'now'
  if (seconds < 60) return `${seconds.toFixed(0)}s ago`
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m ago`
  return `${(seconds / 3600).toFixed(1)}h ago`
}

export function clockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Tone helper used to colour numbers: profit green, loss red, flat muted. */
export function tone(value: number): 'pos' | 'neg' | 'flat' {
  if (value > 0.0001) return 'pos'
  if (value < -0.0001) return 'neg'
  return 'flat'
}
