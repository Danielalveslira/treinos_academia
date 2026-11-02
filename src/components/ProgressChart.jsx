import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function TooltipContent({ active, payload, formatValue, showPrevious }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const formatDate = (key) =>
    key
      ?.split(' a ')
      .map((part) => new Date(`${part}T12:00:00`).toLocaleDateString('pt-BR'))
      .join(' a ') || ''
  return (
    <div className="frequency-tooltip">
      <strong>{point.label}</strong>
      <div>
        Atual ({formatDate(point.currentDate)}): {formatValue(point.currentValue)}
      </div>
      {showPrevious && (
        <div>
          Anterior ({formatDate(point.previousDate)}): {formatValue(point.previousValue)}
        </div>
      )}
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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 8 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
            tick={{ fontSize: 11 }}
            tickFormatter={(label) =>
              String(label).length > 12 ? `${String(label).slice(0, 11)}…` : label
            }
          />
          <YAxis
            domain={[0, 'auto']}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={58}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) =>
              Number(value).toLocaleString('pt-BR', { notation: 'compact' })
            }
          />
          <Tooltip
            cursor={false}
            content={<TooltipContent formatValue={formatValue} showPrevious={showPrevious} />}
          />
          <Bar
            dataKey="currentValue"
            fill="var(--fgColor-accent)"
            maxBarSize={22}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          {showPrevious && (
            <Bar
              dataKey="previousValue"
              fill="var(--fgColor-muted)"
              maxBarSize={22}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      <details className="chart-data-table">
        <summary>Ver dados do gráfico em texto</summary>
        <table>
          <thead>
            <tr>
              <th>Período</th>
              <th>Atual</th>
              {showPrevious && <th>Anterior</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.key}>
                <th>{point.label}</th>
                <td>
                  {point.currentDate}: {formatValue(point.currentValue)}
                </td>
                {showPrevious && (
                  <td>
                    {point.previousDate}: {formatValue(point.previousValue)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
