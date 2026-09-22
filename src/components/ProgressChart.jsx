import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function TooltipContent({ active, payload, formatValue, showPrevious }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="frequency-tooltip">
      <strong>{point.label}</strong>
      <div>Atual: {formatValue(point.currentValue)}</div>
      {showPrevious && <div>Anterior: {formatValue(point.previousValue)}</div>}
    </div>
  )
}

export function ProgressChart({ data, formatValue, showPrevious }) {
  return (
    <div className="progress-chart-surface">
      <div className="progress-chart-legend" aria-label="Legenda do gráfico">
        <span>
          <i className="is-current" />
          Período atual
        </span>
        {showPrevious && (
          <span>
            <i className="is-previous" />
            Período anterior
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 16, right: 8, left: -20, bottom: 8 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={52} />
          <Tooltip
            content={<TooltipContent formatValue={formatValue} showPrevious={showPrevious} />}
          />
          <Bar
            dataKey="currentValue"
            fill="#2f81f7"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          {showPrevious && (
            <Bar
              dataKey="previousValue"
              fill="#8b949e"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
