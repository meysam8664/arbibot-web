interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Force a colour; otherwise the trend of the series decides. */
  color?: string
  /** Draw a soft area fill under the line. */
  area?: boolean
  /** Draw a dashed baseline at zero. */
  zeroLine?: boolean
  strokeWidth?: number
}

/**
 * Dependency-free SVG sparkline. Keeps the bundle tiny and renders fine at the
 * row heights used in the tables.
 */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  color,
  area = true,
  zeroLine = false,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!values.length) {
    return <div className="sparkline sparkline--empty" style={{ width, height }} />
  }

  const series = values.length === 1 ? [values[0], values[0]] : values
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || Math.abs(max) || 1
  const pad = 2
  const stepX = (width - pad * 2) / (series.length - 1)

  const points = series.map((value, index) => {
    const x = pad + index * stepX
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const stroke = color ?? (series[series.length - 1] >= series[0] ? 'var(--pos)' : 'var(--neg)')
  const zeroY =
    zeroLine && min < 0 && max > 0
      ? height - pad - ((0 - min) / span) * (height - pad * 2)
      : null

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
      preserveAspectRatio="none"
    >
      {area && (
        <polygon
          points={`${pad},${height} ${points.join(' ')} ${width - pad},${height}`}
          fill={stroke}
          opacity={0.12}
        />
      )}
      {zeroY !== null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
