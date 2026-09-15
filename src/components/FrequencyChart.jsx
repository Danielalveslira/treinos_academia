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

// Cada indicador do seletor do Dashboard usa os mesmos dados semanais (getTrainingConsistency),
// só muda qual campo vira barra e como esse número é lido. cardio tem dois campos possíveis
// (distância opcional, duração sempre presente) — o Dashboard decide qual dos dois faz
// sentido mostrar (ver getPreferredCardioField) e passa em cardioField.
const METRICS = {
  trainings: {
    dataKey: 'count',
    unit: (v) => (v === 1 ? 'dia ativo' : 'dias ativos'),
    formatValue: (v) => `${v}`,
    yDomain: [0, 7],
    yTicks: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  volume: {
    dataKey: 'volumeKg',
    unit: () => 'kg',
    formatValue: (v) => v.toLocaleString('pt-BR'),
  },
  distanceKm: {
    dataKey: 'distanceKm',
    unit: () => 'km',
    formatValue: (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
  },
  durationMinutes: {
    dataKey: 'durationMinutes',
    unit: () => 'min',
    formatValue: (v) => `${v}`,
  },
}

function FrequencyTooltip({ active, payload, config }) {
  if (!active || !payload?.length) return null
  const week = payload[0].payload
  const value = week[config.dataKey]
  return (
    <div className="frequency-tooltip">
      <strong>
        {week.isCurrent ? 'Semana atual' : 'Semana'} · {week.range}
      </strong>
      <div>
        {config.formatValue(value)} {config.unit(value)}
      </div>
    </div>
  )
}

export function FrequencyChart({ data, metric = 'trainings' }) {
  const config = METRICS[metric] || METRICS.trainings
  return (
    <div>
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
            domain={config.yDomain}
            ticks={config.yTicks}
            tick={{ fontSize: 12, fill: 'var(--fgColor-muted)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<FrequencyTooltip config={config} />}
            cursor={{ fill: 'var(--bgColor-neutral-muted)' }}
          />
          <Bar
            dataKey={config.dataKey}
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
            <LabelList
              dataKey={config.dataKey}
              position="top"
              fill="var(--fgColor-default)"
              fontSize={12}
              formatter={config.formatValue}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <details className="frequency-data">
        <summary>Ver por semana</summary>
        <ul>
          {data.map((week) => (
            <li key={week.week}>
              {week.range}
              {week.isCurrent ? ' (atual)' : ''}: {config.formatValue(week[config.dataKey])}{' '}
              {config.unit(week[config.dataKey])}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
