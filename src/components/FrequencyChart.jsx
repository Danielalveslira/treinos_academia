import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from 'recharts'

function FrequencyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const week = payload[0].payload
  return (
    <div className="frequency-tooltip">
      <strong>
        {week.isCurrent ? 'Semana atual' : 'Semana'} · {week.range}
      </strong>
      <div>
        {week.count} {week.count === 1 ? 'treino' : 'treinos'}
      </div>
    </div>
  )
}

export function FrequencyChart({ data }) {
  return (
    <div>
      <div className="frequency-legend">
        <span /> Semana atual
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={data}
          margin={{ top: 24, right: 8, left: -28, bottom: 8 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--fgColor-muted)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={8}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, 7]}
            ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
            tick={{ fontSize: 12, fill: 'var(--fgColor-muted)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<FrequencyTooltip />}
            cursor={{ fill: 'var(--bgColor-neutral-muted)' }}
          />
          <Bar
            dataKey="count"
            name="Treinos"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
          >
            {data.map((week) => (
              <Cell
                key={week.week}
                fill={week.isCurrent ? 'var(--fgColor-success)' : 'var(--fgColor-accent)'}
                fillOpacity={week.isCurrent ? 1 : 0.65}
              />
            ))}
            <LabelList dataKey="count" position="top" fill="var(--fgColor-default)" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <details className="frequency-data">
        <summary>Ver treinos por semana</summary>
        <ul>
          {data.map((week) => (
            <li key={week.week}>
              {week.range}
              {week.isCurrent ? ' (atual)' : ''}: {week.count}{' '}
              {week.count === 1 ? 'treino' : 'treinos'}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
