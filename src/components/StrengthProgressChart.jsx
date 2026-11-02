import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const formatKg = (value) =>
  `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`

export function StrengthProgressChart({ data, showEstimate }) {
  const plotted = data.flatMap((point, index) => {
    const previous = data[index - 1]
    return previous && point.date - previous.date > 7 * 86400000
      ? [{ key: `gap-${point.key}`, label: '', maxWeightKg: null, estimated1RMKg: null }, point]
      : [point]
  })
  return (
    <div className="progress-chart-surface">
      <div className="progress-chart-legend" aria-label="Legenda do gráfico de força">
        <span>
          <i className="is-current" />
          Melhor carga
        </span>
        {showEstimate && (
          <span>
            <i className="is-estimate" />
            1RM estimado
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={plotted}
          margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickLine={false}
            axisLine={false}
            width={58}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            cursor={false}
            formatter={(value, name) => [formatKg(value), name]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.date?.toLocaleDateString('pt-BR') || ''
            }
          />
          <Line
            type="linear"
            name="Melhor carga"
            dataKey="maxWeightKg"
            stroke="var(--fgColor-accent)"
            strokeWidth={2}
            dot={data.length <= 20 ? { r: 3 } : false}
            isAnimationActive={false}
          />
          {showEstimate && (
            <Line
              type="linear"
              name="1RM estimado"
              dataKey="estimated1RMKg"
              stroke="var(--fgColor-muted)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={data.length <= 20 ? { r: 3 } : false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <details className="chart-data-table">
        <summary>Ver evolução em texto</summary>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Melhor carga</th>
              {showEstimate && <th>1RM estimado</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.key}>
                <th>{point.label}</th>
                <td>{formatKg(point.maxWeightKg)}</td>
                {showEstimate && <td>{formatKg(point.estimated1RMKg)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
