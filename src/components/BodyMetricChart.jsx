import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function BodyMetricChart({ data, unit }) {
  return (
    <div className="progress-chart-surface body-metric-chart-surface">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          margin={{ top: 12, right: 12, left: -12, bottom: 4 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(value) => [
              `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`,
              'Valor',
            ]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--fgColor-accent)"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
