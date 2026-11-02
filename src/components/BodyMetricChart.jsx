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
  const values = data.map((point) => Number(point.value))
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.12, maximum * 0.02, 0.5)
  const timestamps = data.map((point) => point.date.getTime())
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const series = data.map((point) => ({ ...point, timestamp: point.date.getTime() }))
  const formatDate = (value) =>
    new Date(Number(value)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return (
    <div className="progress-chart-surface body-metric-chart-surface">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={series}
          margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[
              first === last ? first - 86400000 : first,
              first === last ? last + 86400000 : last,
            ]}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
            tick={{ fontSize: 11 }}
            tickFormatter={formatDate}
          />
          <YAxis
            domain={[Math.max(0, minimum - padding), maximum + padding]}
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) =>
              Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
            }
          />
          <Tooltip
            cursor={false}
            labelFormatter={formatDate}
            formatter={(value) => [
              `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`,
              'Valor',
            ]}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--fgColor-accent)"
            strokeWidth={2}
            dot={{ r: data.length > 40 ? 2 : 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <details className="chart-data-table">
        <summary>Ver medições em texto</summary>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point, index) => (
              <tr key={`${point.date?.toISOString()}-${index}`}>
                <th>{point.date?.toLocaleDateString('pt-BR')}</th>
                <td>
                  {Number(point.value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
